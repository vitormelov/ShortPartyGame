import { ARENA_H, ARENA_W } from '@shared/arena';
import type { PlayerId } from '@shared/types';
import * as THREE from 'three';
import { PAL, RES } from '../core/draw';
import { characterInstance, wantedKind, type CastKind } from './characters3d';

/*
 * Shared base for the 3D (Nintendo 64 style) minigames.
 *
 * One WebGL renderer draws every scene into an offscreen canvas at the game's pixel density; each
 * minigame keeps its own THREE.Scene and camera and pastes the result into the 2D canvas, so the
 * HUD, comments and overlays stay 2D. Logic coordinates (x, y) map to world (x - cx, 0, y - cy).
 */

export const W3 = ARENA_W * RES;
export const H3 = ARENA_H * RES;

let shared: THREE.WebGLRenderer | null | undefined;

/** The shared renderer, or null when WebGL isn't available (the game then uses the 2D renderers). */
export function renderer3d(): THREE.WebGLRenderer | null {
  if (shared === undefined) {
    try {
      const canvas = document.createElement('canvas');
      // alpha: scenes without a background (overlays like the poll's characters) paste over the 2D.
      shared = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, alpha: true });
      shared.setClearColor(0x000000, 0);
      shared.setPixelRatio(1);
      shared.setSize(W3, H3, false);
    } catch (err) {
      console.warn('WebGL indisponível, usando os minigames 2D', err);
      shared = null;
    }
  }
  return shared;
}

export function webglAvailable(): boolean {
  return renderer3d() !== null;
}

// ---------- materials and textures ----------

/** Small blurry textures are what make it read as N64. */
export function n64Texture<T extends THREE.Texture>(t: T, smooth = true): T {
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = smooth ? THREE.LinearFilter : THREE.NearestFilter;
  t.minFilter = smooth ? THREE.LinearFilter : THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

export function canvasTexture(w: number, h: number, paint: (c: CanvasRenderingContext2D) => void, smooth = true): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  paint(cv.getContext('2d')!);
  return n64Texture(new THREE.CanvasTexture(cv), smooth);
}

export function lambert(color: THREE.ColorRepresentation, map?: THREE.Texture, extra: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color: map ? '#ffffff' : color, map, ...extra });
}

/** Standard light rig: sky/ground fill and a warm sun from the top left. */
export function addLights(scene: THREE.Scene, sky = '#d8ecff', ground = '#3a2a6a', sun = 1.7): void {
  scene.add(new THREE.HemisphereLight(sky, ground, 1.0));
  const s = new THREE.DirectionalLight('#fff4e0', sun);
  s.position.set(-120, 220, 140);
  scene.add(s);
}

/** A faceted sea that bobs (call `update(time)` each frame). */
export class Sea {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>;
  private base: Float32Array;

  constructor(y: number, a = '#1e52c8', b = '#2a6ae0', size: [number, number] = [1000, 760]) {
    const geo = new THREE.PlaneGeometry(size[0], size[1], 34, 26);
    geo.rotateX(-Math.PI / 2);
    const ca = new THREE.Color(a);
    const cb = new THREE.Color(b);
    const colors: number[] = [];
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const c = (i + Math.floor(i / 35)) % 2 ? ca : cb;
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    this.mesh.position.y = y;
    this.base = Float32Array.from(pos.array as Float32Array);
  }

  update(time: number, amp = 1): void {
    const pos = this.mesh.geometry.attributes.position;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < pos.count; i++) {
      const x = this.base[i * 3];
      const z = this.base[i * 3 + 2];
      arr[i * 3 + 1] = (Math.sin(x * 0.035 + time * 1.4) * 2.2 + Math.cos(z * 0.045 + time * 1.1) * 1.8) * amp;
    }
    pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }
}

export function blobShadow(r: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 14), new THREE.MeshBasicMaterial({ color: '#140020', transparent: true, opacity: 0.35, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

/** Expanding splash ring on the water. */
export function splashRing(): THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial> {
  const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.12, 4, 20), new THREE.MeshBasicMaterial({ color: '#e8f4ff', transparent: true }));
  m.rotation.x = Math.PI / 2;
  return m;
}

// ---------- a minigame scene ----------

export interface CharOpts {
  /** World height of the character (default: 16, about the 2D sprite size). */
  height?: number;
  visible?: boolean;
  /** Extra vertical offset (jumps, riding on things). */
  y?: number;
  /** Facing override in radians (otherwise it turns toward the movement). */
  heading?: number;
  /** Movement speed driving the run cycle (otherwise measured from the position change). */
  speed?: number;
  /** Lean/tilt (e.g. falling). */
  tilt?: number;
  /** Blob shadow on the ground (default on). */
  shadow?: boolean;
  /** Side-view scenes: world position of the feet (overrides the logic-to-ground mapping). */
  world?: [number, number, number];
}

interface CharView {
  obj: THREE.Object3D;
  kind: CastKind;
  character: number;
  heading: number;
  lastX: number;
  lastZ: number;
  shadow: THREE.Mesh;
  seen: boolean;
}

/**
 * Base class for a 3D minigame: owns the scene, the camera, the players' characters and the
 * "you" marker. Subclasses build the set once and update it from the state every frame.
 */
export abstract class Stage3D {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private chars = new Map<PlayerId, CharView>();
  private marker: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>;
  /** Logic point that maps to the world origin. */
  /** Size of the picture in game pixels (the arena, unless a scene covers the whole screen). */
  protected viewW = ARENA_W;
  protected viewH = ARENA_H;
  /** A scene with its own renderer (e.g. a different size) sets this. */
  protected ownRenderer: THREE.WebGLRenderer | null = null;

  constructor(readonly cx: number, readonly cy: number, fov = 34) {
    this.camera = new THREE.PerspectiveCamera(fov, W3 / H3, 1, 3000);
    this.marker = new THREE.Mesh(new THREE.ConeGeometry(2.6, 5.5, 4), new THREE.MeshBasicMaterial({ color: '#ffd23e' }));
    this.marker.rotation.x = Math.PI;
    this.marker.visible = false;
    this.scene.add(this.marker);
  }

  protected look(pos: [number, number, number], target: [number, number, number]): void {
    this.camera.position.set(...pos);
    this.camera.lookAt(...target);
    this.camera.updateMatrixWorld();
  }

  /** Logic -> world. */
  wx(x: number): number {
    return x - this.cx;
  }
  wz(y: number): number {
    return y - this.cy;
  }

  /** Call at the start of each frame before placing characters. */
  protected beginChars(): void {
    for (const v of this.chars.values()) v.seen = false;
    this.marker.visible = false;
  }

  /** Places a player's character at logic (x, y). Call every frame for every player to show. */
  protected placeChar(id: PlayerId, character: number, x: number, y: number, time: number, o: CharOpts = {}): THREE.Object3D {
    let v = this.chars.get(id);
    if (v && (v.character !== character || wantedKind(character) !== v.kind)) {
      this.scene.remove(v.obj);
      const next = characterInstance(character);
      v.obj = next.obj;
      v.kind = next.kind;
      v.character = character;
      this.scene.add(v.obj);
    }
    if (!v) {
      const { obj, kind } = characterInstance(character);
      const shadow = blobShadow(4.5);
      this.scene.add(obj, shadow);
      v = { obj, kind, character, heading: 0, lastX: x, lastZ: y, shadow, seen: true };
      this.chars.set(id, v);
    }
    v.seen = true;
    const h = o.height ?? 16;
    const k = h / 22;
    v.obj.scale.setScalar(k);
    const mx = x - v.lastX;
    const mz = y - v.lastZ;
    v.lastX = x;
    v.lastZ = y;
    const moved = Math.hypot(mx, mz);
    const speed = o.speed ?? (moved > 0 && moved < 20 ? moved * 60 : 0);
    if (o.heading !== undefined) v.heading = o.heading;
    else if (moved > 0.05 && moved < 20) {
      const want = Math.atan2(mx, mz);
      const d = Math.atan2(Math.sin(want - v.heading), Math.cos(want - v.heading));
      v.heading += d * 0.25;
    }
    (v.obj.userData.animate as ((t: number, s: number) => void) | undefined)?.(time + id * 0.37, speed);
    if (o.world) v.obj.position.set(o.world[0], o.world[1] + (v.obj.userData.hop ?? 0) * k, o.world[2]);
    else v.obj.position.set(this.wx(x), (o.y ?? 0) + (v.obj.userData.hop ?? 0) * k, this.wz(y));
    v.obj.rotation.set(o.tilt ?? 0, v.heading, 0);
    v.obj.visible = o.visible ?? true;
    v.shadow.visible = v.obj.visible && !o.world && (o.shadow ?? true) && (o.y ?? 0) > -1;
    v.shadow.position.set(this.wx(x), 0.3, this.wz(y));
    v.shadow.scale.setScalar(h / 16);
    return v.obj;
  }

  /** Hides characters not placed this frame and puts the marker over the local player. */
  protected endChars(localId: PlayerId, time: number, markerH = 16): void {
    for (const [id, v] of this.chars) {
      if (!v.seen) {
        v.obj.visible = false;
        v.shadow.visible = false;
      }
      if (id === localId && v.seen && v.obj.visible) {
        this.marker.visible = true;
        this.marker.position.set(v.obj.position.x, v.obj.position.y + markerH + 7 + Math.sin(time * 5) * 1.2, v.obj.position.z);
        this.marker.rotation.y = time * 3;
      }
    }
  }

  /** World point -> arena pixel (for 2D overlays and the spotlight). */
  project(x: number, y: number, z: number): [number, number] {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return [((v.x + 1) / 2) * this.viewW, ((1 - v.y) / 2) * this.viewH];
  }

  /** Logic point (at a height) -> arena pixel. */
  projectLogic(x: number, y: number, h = 0): [number, number] {
    return this.project(this.wx(x), h, this.wz(y));
  }

  /** Renders the scene and pastes it into the 2D canvas. */
  protected present(ctx: CanvasRenderingContext2D): void {
    const r = this.ownRenderer ?? renderer3d()!;
    r.render(this.scene, this.camera);
    ctx.drawImage(r.domElement, 0, 0, this.viewW, this.viewH);
  }

  /** A small cooldown bar under a point (2D, drawn after present()). */
  cooldownBar(ctx: CanvasRenderingContext2D, x: number, y: number, frac: number): void {
    const [sx, sy] = this.projectLogic(x, y + 6);
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(Math.round(sx - 7), Math.round(sy), 14, 3);
    ctx.fillStyle = PAL.cyan;
    ctx.fillRect(Math.round(sx - 6), Math.round(sy + 1), Math.round(12 * Math.max(0, Math.min(1, frac))), 1);
  }
}

/** A 3D minigame scene: draws a state and reports where the players are on screen. */
export interface StageScene<S> {
  draw(ctx: CanvasRenderingContext2D, st: S, time: number, localId: PlayerId): void;
  positions(st: S): Array<[PlayerId, number, number]>;
}

/** Wraps a scene factory as a MinigameRenderer; the scene is built the first time it's drawn. */
export function stageRenderer<S>(make: () => StageScene<S>): { render(ctx: CanvasRenderingContext2D, state: unknown, time: number, localId: PlayerId): void; positions(state: unknown): Array<[PlayerId, number, number]> } {
  let scene: StageScene<S> | null = null;
  const get = () => (scene ??= make());
  return {
    render: (ctx, state, time, localId) => get().draw(ctx, state as S, time, localId),
    positions: (state) => get().positions(state as S),
  };
}
