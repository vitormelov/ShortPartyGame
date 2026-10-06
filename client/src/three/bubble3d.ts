import { ARENA_H, ARENA_W } from '@shared/arena';
import { BALL_R, CENTER, CHARGE_COOLDOWN, FALL_TIME, START_R, type Ball, type BubbleState } from '@shared/minigames/bubble/logic';
import { CHARACTERS, type PlayerId } from '@shared/types';
import * as THREE from 'three';
import { PAL, RES } from '../core/draw';
import type { MinigameRenderer } from '../minigames/renderer';
import { characterInstance, wantedKind, type CastKind } from './characters3d';

/*
 * PILOT: Bolha Social in 3D, Nintendo 64 style (Bumper Balls).
 *
 * The logic is untouched: logic (x, y) maps to world (x - CENTER.x, 0, y - CENTER.y) with Y up.
 * Balls, platform and sea are low-poly meshes with small blurry textures and fog; the riders are the
 * 3D cast (characters3d.ts), turning to face where they roll. The scene renders to an
 * offscreen WebGL canvas at the game's pixel density and is pasted into the 2D canvas.
 */

const W3 = ARENA_W * RES;
const H3 = ARENA_H * RES;
const SEA_Y = -18;
const PLATFORM_H = 6;

interface BallView {
  group: THREE.Group;
  sphere: THREE.Mesh<THREE.SphereGeometry, THREE.MeshLambertMaterial>;
  shadow: THREE.Mesh;
  rider: THREE.Object3D;
  riderKind: CastKind;
  heading: number;
  splash: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  character: number;
  lastX: number;
  lastY: number;
}

class Bubble3D {
  readonly canvas = document.createElement('canvas');
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(34, W3 / H3, 1, 2000);
  private sea: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>;
  private seaBase: Float32Array;
  private platform = new THREE.Group();
  private rim: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  private marker: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>;
  private views = new Map<PlayerId, BallView>();

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(W3, H3, false);
    this.renderer.setClearColor('#1e52c8');

    this.scene.fog = new THREE.Fog('#4a7ae0', 300, 600);
    this.camera.position.set(0, 205, 232);
    this.camera.lookAt(0, -14, 10);
    this.camera.updateMatrixWorld();

    this.scene.add(new THREE.HemisphereLight('#d8ecff', '#3a2a6a', 1.0));
    const sun = new THREE.DirectionalLight('#fff4e0', 1.7);
    sun.position.set(-120, 220, 140);
    this.scene.add(sun);

    // Sea: a faceted plane whose vertices bob, with alternating vertex colors.
    const seaGeo = new THREE.PlaneGeometry(1000, 760, 34, 26);
    seaGeo.rotateX(-Math.PI / 2);
    const colors: number[] = [];
    const pos = seaGeo.attributes.position;
    const a = new THREE.Color('#1e52c8');
    const b = new THREE.Color('#2a6ae0');
    for (let i = 0; i < pos.count; i++) {
      const c = (i + Math.floor(i / 35)) % 2 ? a : b;
      colors.push(c.r, c.g, c.b);
    }
    seaGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.sea = new THREE.Mesh(seaGeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    this.sea.position.y = SEA_Y;
    this.seaBase = Float32Array.from(pos.array as Float32Array);
    this.scene.add(this.sea);

    // Foam where the platform has already crumbled.
    const foam = new THREE.Mesh(
      new THREE.CircleGeometry(START_R + 4, 32),
      new THREE.MeshBasicMaterial({ color: '#cfe6ff', transparent: true, opacity: 0.22, depthWrite: false }),
    );
    foam.rotation.x = -Math.PI / 2;
    foam.position.y = SEA_Y + 0.6;
    this.scene.add(foam);

    // Platform: candy-ring top, pink side, a pillar into the sea.
    const top = new THREE.MeshLambertMaterial({ map: this.ringTexture() });
    const side = new THREE.MeshLambertMaterial({ map: this.sideTexture() });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, PLATFORM_H, 28, 1), [side, top, side]);
    disc.position.y = -PLATFORM_H / 2;
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.4, 40, 12), new THREE.MeshLambertMaterial({ color: '#8a2a6a' }));
    pillar.position.y = -PLATFORM_H - 20;
    this.platform.add(disc, pillar);
    this.scene.add(this.platform);

    this.rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.025, 4, 48), new THREE.MeshBasicMaterial({ color: '#ff3b5c' }));
    this.rim.rotation.x = Math.PI / 2;
    this.rim.position.y = 0.4;
    this.scene.add(this.rim);

    this.marker = new THREE.Mesh(new THREE.ConeGeometry(3.4, 7, 4), new THREE.MeshBasicMaterial({ color: '#ffd23e' }));
    this.marker.rotation.x = Math.PI;
    this.scene.add(this.marker);
  }

  private texture(cv: HTMLCanvasElement, smooth: boolean): THREE.CanvasTexture {
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = smooth ? THREE.LinearFilter : THREE.NearestFilter;
    t.minFilter = smooth ? THREE.LinearFilter : THREE.NearestFilter;
    t.generateMipmaps = false;
    return t;
  }

  /** Small blurry textures are what make it read as N64. */
  private ringTexture(): THREE.Texture {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const c = cv.getContext('2d')!;
    const rings = ['#ff8ad8', '#fff0fa', '#ff8ad8', '#fff0fa', '#ffb8e8', '#fff0fa'];
    rings.forEach((col, k) => {
      c.fillStyle = col;
      c.beginPath();
      c.arc(32, 32, 32 - (k * 32) / rings.length, 0, Math.PI * 2);
      c.fill();
    });
    c.fillStyle = '#ffd23e';
    c.beginPath();
    c.arc(32, 32, 3, 0, Math.PI * 2);
    c.fill();
    return this.texture(cv, true);
  }

  private sideTexture(): THREE.Texture {
    const cv = document.createElement('canvas');
    cv.width = 32;
    cv.height = 8;
    const c = cv.getContext('2d')!;
    for (let x = 0; x < 32; x += 4) {
      c.fillStyle = (x / 4) % 2 ? '#c8408a' : '#e85aa8';
      c.fillRect(x, 0, 4, 8);
    }
    c.fillStyle = '#8a2a6a';
    c.fillRect(0, 6, 32, 2);
    const t = this.texture(cv, true);
    t.wrapS = THREE.RepeatWrapping;
    t.repeat.set(6, 1);
    return t;
  }

  /** Beach-ball texture in the character's colors (the stripes show the roll). */
  private ballTexture(character: number): THREE.Texture {
    const ch = CHARACTERS[character];
    const cv = document.createElement('canvas');
    cv.width = 32;
    cv.height = 16;
    const c = cv.getContext('2d')!;
    for (let x = 0; x < 32; x += 8) {
      c.fillStyle = (x / 8) % 2 ? ch.color : ch.light;
      c.fillRect(x, 0, 8, 16);
    }
    c.fillStyle = '#ffffff';
    c.fillRect(0, 7, 32, 2);
    c.fillStyle = ch.dark;
    c.fillRect(0, 0, 32, 2);
    c.fillRect(0, 14, 32, 2);
    return this.texture(cv, true);
  }

  private view(b: Ball): BallView {
    let v = this.views.get(b.id);
    if (v && v.character !== b.character) {
      this.scene.remove(v.group, v.shadow, v.splash);
      v = undefined;
    }
    if (!v) {
      const group = new THREE.Group();
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 12, 9), new THREE.MeshLambertMaterial({ map: this.ballTexture(b.character) }));
      sphere.position.y = BALL_R;
      const { obj: rider, kind } = characterInstance(b.character);
      rider.position.y = BALL_R * 2 - 1.5;
      group.add(sphere, rider);
      const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(BALL_R * 0.95, 14),
        new THREE.MeshBasicMaterial({ color: '#280028', transparent: true, opacity: 0.35, depthWrite: false }),
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.25;
      const splash = new THREE.Mesh(new THREE.TorusGeometry(1, 0.12, 4, 20), new THREE.MeshBasicMaterial({ color: '#e8f4ff', transparent: true }));
      splash.rotation.x = Math.PI / 2;
      splash.position.y = SEA_Y + 1;
      this.scene.add(group, shadow, splash);
      v = { group, sphere, shadow, rider, riderKind: kind, heading: 0, splash, character: b.character, lastX: b.x, lastY: b.y };
      this.views.set(b.id, v);
    }
    return v;
  }

  render(st: BubbleState, time: number, localId: PlayerId): void {
    // Waves.
    const pos = this.sea.geometry.attributes.position;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < pos.count; i++) {
      const x = this.seaBase[i * 3];
      const z = this.seaBase[i * 3 + 2];
      arr[i * 3 + 1] = Math.sin(x * 0.035 + time * 1.4) * 2.2 + Math.cos(z * 0.045 + time * 1.1) * 1.8;
    }
    pos.needsUpdate = true;
    this.sea.geometry.computeVertexNormals();

    // Platform shrinks; the rim blinks.
    this.platform.scale.set(st.radius, 1, st.radius);
    this.rim.scale.set(st.radius - 0.5, st.radius - 0.5, 1);
    this.rim.material.color.set(Math.floor(time * 6) % 2 ? '#ff3b5c' : '#ffd23e');

    const seen = new Set<PlayerId>();
    this.marker.visible = false;
    for (const b of st.balls) {
      seen.add(b.id);
      const v = this.view(b);
      const show = b.status === 'alive' || b.status === 'falling';
      const blink = b.ghost > 0 && Math.floor(time * 16) % 2 === 0;
      v.group.visible = show && !blink;
      v.shadow.visible = false;
      v.splash.visible = false;
      if (!show) continue;
      const wx = b.x - CENTER.x;
      const wz = b.y - CENTER.y;
      v.group.position.set(wx, 0, wz);

      // Roll by the distance actually moved (a frozen clip doesn't spin).
      const mx = b.x - v.lastX;
      const mz = b.y - v.lastY;
      v.lastX = b.x;
      v.lastY = b.y;
      const dist = Math.hypot(mx, mz);
      if (dist > 0 && dist < 30) {
        const axis = new THREE.Vector3(mz, 0, -mx).normalize();
        v.sphere.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, dist / BALL_R));
      }
      v.sphere.material.emissive.set(b.charge > 0 ? '#ffffff' : '#000000');
      v.sphere.material.emissiveIntensity = b.charge > 0 ? 0.45 : 0;

      // Swap in the other cast once it's wanted (e.g. the N64 model finished loading).
      if (wantedKind(b.character) !== v.riderKind) {
        v.group.remove(v.rider);
        const next = characterInstance(b.character);
        next.obj.position.y = BALL_R * 2 - 1.5;
        v.group.add(next.obj);
        v.rider = next.obj;
        v.riderKind = next.kind;
      }
      // The rider turns (smoothly) to face where the ball is going; balancing = running on top.
      const speed = Math.hypot(b.vx, b.vy);
      if (speed > 8) {
        const want = Math.atan2(b.vx, b.vy);
        let d = want - v.heading;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        v.heading += d * 0.2;
      }
      v.rider.rotation.y = v.heading;
      (v.rider.userData.animate as ((t: number, s: number) => void) | undefined)?.(time + b.id * 0.37, dist > 0 ? speed : 0);
      v.rider.position.y = BALL_R * 2 - 1.5 + (v.rider.userData.hop ?? 0);

      if (b.status === 'falling') {
        // Sinks off the edge into the sea, with a splash ring.
        const k = 1 - Math.max(0, b.fall) / FALL_TIME;
        v.group.position.y = -k * (BALL_R * 2 + 30);
        v.rider.visible = k < 0.6;
        v.splash.visible = k > 0.35;
        v.splash.position.set(wx, SEA_Y + 1, wz);
        const s = 4 + (k - 0.35) * 30;
        v.splash.scale.set(s, s, 1);
        v.splash.material.opacity = 1 - k;
        continue;
      }
      v.rider.visible = true;
      const onPlatform = Math.hypot(wx, wz) < st.radius;
      v.shadow.visible = onPlatform && v.group.visible;
      v.shadow.position.set(wx + 2, 0.25, wz + 2);
      if (b.id === localId) {
        this.marker.visible = true;
        this.marker.position.set(wx, BALL_R * 2 + 30 + Math.sin(time * 5) * 1.5, wz);
        this.marker.rotation.y = time * 3;
      }
    }
    for (const [id, v] of this.views) {
      if (seen.has(id)) continue;
      this.scene.remove(v.group, v.shadow, v.splash);
      this.views.delete(id);
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** World point -> arena pixel. */
  project(x: number, y: number, z: number): [number, number] {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return [((v.x + 1) / 2) * ARENA_W, ((1 - v.y) / 2) * ARENA_H];
  }
}

let scene3d: Bubble3D | null | undefined;
/** The 3D scene, or null when WebGL isn't available (then the 2D renderer is used). */
export function bubble3dAvailable(): Bubble3D | null {
  if (scene3d === undefined) {
    try {
      scene3d = new Bubble3D();
    } catch (err) {
      console.warn('WebGL indisponível, usando o Bolha Social 2D', err);
      scene3d = null;
    }
  }
  return scene3d;
}

export const bubble3dRenderer: MinigameRenderer = {
  positions(raw) {
    const s = bubble3dAvailable();
    const st = raw as BubbleState;
    return st.balls
      .filter((b) => b.status === 'alive')
      .map((b) => {
        const [x, y] = s ? s.project(b.x - CENTER.x, BALL_R * 2 + 12, b.y - CENTER.y) : [b.x, b.y - 6];
        return [b.id, x, y];
      });
  },

  render(ctx, raw, time, localId) {
    const s = bubble3dAvailable()!;
    const st = raw as BubbleState;
    s.render(st, time, localId);
    ctx.drawImage(s.canvas, 0, 0, ARENA_W, ARENA_H);

    // Charge cooldown under your ball (2D, on top of the scene).
    const me = st.balls.find((b) => b.id === localId);
    if (me && me.status === 'alive' && me.chargeCd > 0) {
      const [x, y] = s.project(me.x - CENTER.x, 0, me.y - CENTER.y + BALL_R + 4);
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(Math.round(x - 7), Math.round(y), 14, 3);
      ctx.fillStyle = PAL.cyan;
      ctx.fillRect(Math.round(x - 6), Math.round(y + 1), Math.round(12 * (1 - me.chargeCd / CHARGE_COOLDOWN)), 1);
    }
  },
};
