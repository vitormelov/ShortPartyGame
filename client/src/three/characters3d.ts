import { CHARACTERS } from '@shared/types';
import * as THREE from 'three';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { settings } from '../core/settings';
import { SKINS, applySkin } from './skins';

/*
 * 3D characters, Nintendo 64 style. Every model stands with its feet at y = 0, faces +Z and is
 * CHAR_H world units tall.
 *
 * Two casts:
 * - PRÓPRIOS: the ShortParty emoji cast built from low-poly primitives with painted face textures.
 *   Always available, it's what ships.
 * - N64 (local test only): the Mario Party 2 models in client/public/characters/n64/, which are
 *   git-ignored and stripped from the build. When they're missing, the own cast is used.
 */

export const CHAR_H = 22;

// ---------- shared N64 look ----------

function n64Texture(t: THREE.Texture | null | undefined): void {
  if (!t) return;
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
}

function canvasTex(w: number, h: number, paint: (c: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  paint(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  n64Texture(t);
  return t;
}

const lambert = (color: THREE.ColorRepresentation, map?: THREE.Texture) => new THREE.MeshLambertMaterial({ color: map ? '#ffffff' : color, map });

// ---------- the own cast (low-poly emojis) ----------

/**
 * Face texture for a sphere head: a SphereGeometry's front (+Z) is at u = 0.25, so the face is
 * painted centered at x = w/4.
 */
function faceTexture(base: string, paint: (c: CanvasRenderingContext2D, cx: number, cy: number) => void): THREE.Texture {
  return canvasTex(128, 64, (c) => {
    c.fillStyle = base;
    c.fillRect(0, 0, 128, 64);
    paint(c, 32, 34);
  });
}

function eye(c: CanvasRenderingContext2D, x: number, y: number, r = 4, look = 0): void {
  c.fillStyle = '#ffffff';
  c.beginPath();
  c.ellipse(x, y, r * 0.8, r * 1.15, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#0a0614';
  c.beginPath();
  c.ellipse(x + look, y + 1, r * 0.45, r * 0.65, 0, 0, Math.PI * 2);
  c.fill();
}

function mouth(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, smile = true): void {
  c.fillStyle = '#3a0a14';
  c.beginPath();
  if (smile) c.ellipse(x, y, w, h, 0, 0, Math.PI);
  else c.ellipse(x, y + h, w, h, 0, Math.PI, Math.PI * 2);
  c.fill();
}

interface Rig {
  root: THREE.Group;
  head: THREE.Object3D;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  extra?: (t: number) => void;
}

/** Mario Party proportions: big head, small round body, white gloves, chunky shoes. */
function body(shirt: string, pants: string, shoes: string, opts: { skin?: string; wide?: number } = {}): Rig {
  const root = new THREE.Group();
  const w = opts.wide ?? 1;
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(3.6 * w, 4.4 * w, 7, 8), lambert(shirt));
  torso.position.y = 7.5;
  const belly = new THREE.Mesh(new THREE.SphereGeometry(4.4 * w, 8, 6), lambert(shirt));
  belly.scale.set(1, 0.6, 1);
  belly.position.y = 5.2;
  root.add(torso, belly);

  const leg = (x: number) => {
    const g = new THREE.Group();
    g.position.set(x, 4, 0);
    const l = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 3.4, 6), lambert(pants));
    l.position.y = -1.7;
    const shoe = new THREE.Mesh(new THREE.SphereGeometry(2.1, 7, 5), lambert(shoes));
    shoe.scale.set(1, 0.65, 1.45);
    shoe.position.set(0, -3.6, 0.8);
    g.add(l, shoe);
    root.add(g);
    return g;
  };
  const arm = (x: number) => {
    const g = new THREE.Group();
    g.position.set(x, 10, 0);
    const a = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 4, 6), lambert(opts.skin ?? shirt));
    a.position.y = -2;
    const glove = new THREE.Mesh(new THREE.SphereGeometry(1.7, 7, 5), lambert('#fff8f0'));
    glove.position.y = -4.4;
    g.add(a, glove);
    g.rotation.z = x > 0 ? 0.35 : -0.35;
    root.add(g);
    return g;
  };
  const head = new THREE.Group();
  head.position.y = 15.5;
  root.add(head);
  return { root, head, legL: leg(-1.8 * w), legR: leg(1.8 * w), armL: arm(-4.4 * w), armR: arm(4.4 * w) };
}

function sphereHead(r: number, tex: THREE.Texture): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 9), lambert('#fff', tex));
  return m;
}

const OWN: Array<() => Rig> = [
  // PALHAÇO 🤡
  () => {
    const rig = body('#e83b3b', '#ffd23e', '#3b6ee8', { wide: 1.05 });
    const head = sphereHead(6.5, faceTexture('#fff4f0', (c, x, y) => {
      eye(c, x - 7, y - 5); eye(c, x + 7, y - 5);
      c.fillStyle = '#3b6ee8'; c.fillRect(x - 10, y - 14, 6, 2); c.fillRect(x + 4, y - 14, 6, 2);
      c.fillStyle = '#e83b3b'; c.beginPath(); c.ellipse(x, y + 7, 11, 5, 0, 0, Math.PI); c.fill();
    }));
    const nose = new THREE.Mesh(new THREE.SphereGeometry(1.6, 7, 5), lambert('#ff2020'));
    nose.position.set(0, 0, 6.6);
    const hat = new THREE.Mesh(new THREE.ConeGeometry(3, 7, 7), lambert('#fff', canvasTex(32, 32, (c) => {
      for (let y = 0; y < 32; y += 8) { c.fillStyle = (y / 8) % 2 ? '#5cf26a' : '#ff5ac8'; c.fillRect(0, y, 32, 8); }
    })));
    hat.position.set(1.5, 8, 0);
    hat.rotation.z = -0.25;
    const tufts = ['#ff5ac8', '#ffd23e', '#3ee8ff'].flatMap((col, i) => [-1, 1].map((s) => {
      const t = new THREE.Mesh(new THREE.SphereGeometry(2, 6, 4), lambert(col));
      t.position.set(s * (6 + i * 0.6), 2 - i * 2.2, -1);
      return t;
    }));
    rig.head.add(head, nose, hat, ...tufts);
    return rig;
  },
  // FOGO 🔥
  () => {
    const rig = body('#ff8a1e', '#c8461e', '#6a2a0a');
    const flames: THREE.Mesh[] = [];
    const head = sphereHead(6, faceTexture('#ffb02e', (c, x, y) => {
      eye(c, x - 6, y - 3, 4); eye(c, x + 6, y - 3, 4);
      mouth(c, x, y + 6, 6, 4);
    }));
    rig.head.add(head);
    [['#ff6a1e', 7.5, 9, 0], ['#ffd23e', 5, 7, 0.4], ['#ff3b1e', 4, 6, -0.5]].forEach(([col, r, h, x], i) => {
      const f = new THREE.Mesh(new THREE.ConeGeometry(r as number, h as number, 7), lambert(col as string));
      f.position.set((x as number) * 6, 5 + i, -1 - i);
      flames.push(f);
      rig.head.add(f);
    });
    rig.extra = (t) => flames.forEach((f, i) => { f.scale.y = 1 + Math.sin(t * 14 + i * 2) * 0.18; f.rotation.z = Math.sin(t * 9 + i) * 0.12; });
    return rig;
  },
  // RISADA 😂
  () => {
    const rig = body('#ffd23e', '#3b6ee8', '#e83b3b');
    const head = sphereHead(6.8, faceTexture('#ffd23e', (c, x, y) => {
      c.strokeStyle = '#3a1a0a'; c.lineWidth = 2.5;
      c.beginPath(); c.arc(x - 7, y - 3, 3.5, Math.PI, 0); c.stroke();
      c.beginPath(); c.arc(x + 7, y - 3, 3.5, Math.PI, 0); c.stroke();
      mouth(c, x, y + 3, 10, 9);
      c.fillStyle = '#ff8aa0'; c.fillRect(x - 5, y + 8, 10, 3);
    }));
    const tears = [-1, 1].map((s) => {
      const t = new THREE.Mesh(new THREE.SphereGeometry(1.6, 6, 4), lambert('#5ab8ff'));
      t.scale.set(1, 1.4, 1);
      rig.head.add(t);
      return { t, s };
    });
    rig.head.add(head);
    rig.extra = (t) => tears.forEach(({ t: m, s }, i) => {
      const k = (t * 2.2 + i * 0.5) % 1;
      m.position.set(s * (6 + k * 6), 1 - k * 9 + Math.sin(k * Math.PI) * 4, 3);
    });
    return rig;
  },
  // OLHINHOS 👀
  () => {
    const rig = body('#2a9a3a', '#22223a', '#f4f4f8', { skin: '#2a9a3a' });
    const hood = new THREE.Mesh(new THREE.SphereGeometry(7, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.75), lambert('#2a9a3a'));
    hood.position.y = 0.5;
    rig.head.add(hood);
    const eyes = [-1, 1].map((s) => {
      const g = new THREE.Group();
      const w = new THREE.Mesh(new THREE.SphereGeometry(3.4, 10, 8), lambert('#ffffff'));
      w.scale.set(0.9, 1.25, 0.8);
      const p = new THREE.Mesh(new THREE.SphereGeometry(1.5, 8, 6), lambert('#0a0614'));
      p.position.set(0, 0, 2.6);
      g.add(w, p);
      g.position.set(s * 3, 0.5, 4);
      rig.head.add(g);
      return p;
    });
    rig.extra = (t) => { const look = [0, 0, -1, -1, 1, 1][Math.floor(t * 1.5) % 6]; eyes.forEach((p) => (p.position.x = look * 1.4)); };
    return rig;
  },
  // CHAD 🗿
  () => {
    const rig = body('#3ee8ff', '#22305e', '#f4f4f8', { skin: '#c88a5a', wide: 1.2 });
    const stone = lambert('#8a8a96');
    const head = new THREE.Mesh(new THREE.BoxGeometry(8, 12, 8), stone);
    head.position.y = 2;
    const brow = new THREE.Mesh(new THREE.BoxGeometry(8.6, 1.8, 2), lambert('#6a6a78'));
    brow.position.set(0, 4, 4);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(2.4, 5, 2.4), lambert('#7a7a86'));
    nose.position.set(0, 1, 4.6);
    const lips = new THREE.Mesh(new THREE.BoxGeometry(4.5, 1, 1), lambert('#4a4a56'));
    lips.position.set(0, -2.5, 4.2);
    const eyes = [-1, 1].map((s) => {
      const e = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 0.6), lambert('#3a3a46'));
      e.position.set(s * 2.4, 2.6, 4.1);
      return e;
    });
    rig.head.add(head, brow, nose, lips, ...eyes);
    return rig;
  },
  // CHORÃO 😭
  () => {
    const rig = body('#3b7ef8', '#22223a', '#f4f4f8');
    const head = sphereHead(6.6, faceTexture('#5aa0ff', (c, x, y) => {
      c.strokeStyle = '#0a1a4a'; c.lineWidth = 2.5;
      c.beginPath(); c.arc(x - 7, y - 4, 3.5, 0, Math.PI); c.stroke();
      c.beginPath(); c.arc(x + 7, y - 4, 3.5, 0, Math.PI); c.stroke();
      mouth(c, x, y + 4, 7, 5, false);
    }));
    const streams = [-1, 1].map((s) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.6, 9, 1.2), new THREE.MeshLambertMaterial({ color: '#8ad8ff', transparent: true, opacity: 0.85 }));
      m.position.set(s * 3.6, -4, 5.6);
      rig.head.add(m);
      return m;
    });
    rig.head.add(head);
    rig.extra = (t) => streams.forEach((m, i) => (m.scale.y = 1 + Math.sin(t * 16 + i) * 0.12));
    return rig;
  },
  // CAVEIRA 💀
  () => {
    const rig = body('#6a3ab8', '#2a1a4a', '#14141e');
    const head = sphereHead(6.4, faceTexture('#f0ecf8', (c, x, y) => {
      c.fillStyle = '#1a0a2a';
      c.beginPath(); c.ellipse(x - 6, y - 4, 4, 5, 0, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.ellipse(x + 6, y - 4, 4, 5, 0, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.moveTo(x, y + 1); c.lineTo(x - 2, y + 5); c.lineTo(x + 2, y + 5); c.fill();
    }));
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(7, 2.6, 5), lambert('#f0ecf8', canvasTex(32, 16, (c) => {
      c.fillStyle = '#f0ecf8'; c.fillRect(0, 0, 32, 16);
      c.fillStyle = '#1a0a2a'; for (let x = 2; x < 32; x += 5) c.fillRect(x, 0, 1, 16);
    })));
    jaw.position.set(0, -5.6, 2.5);
    const hood = new THREE.Mesh(new THREE.SphereGeometry(7.4, 10, 7, Math.PI * 0.85, Math.PI * 1.3, 0, Math.PI * 0.7), lambert('#6a3ab8'));
    rig.head.add(head, jaw, hood);
    rig.extra = (t) => (jaw.position.y = -5.6 - Math.abs(Math.sin(t * 7)) * 1.4);
    return rig;
  },
  // DIVA 💅
  () => {
    const rig = body('#ff5ac8', '#ff8ad8', '#ff2e88', { skin: '#d8906a' });
    const head = sphereHead(6, faceTexture('#d8906a', (c, x, y) => {
      eye(c, x - 6, y - 3, 3.6); eye(c, x + 6, y - 3, 3.6);
      c.fillStyle = '#0a0614'; c.fillRect(x - 10, y - 9, 7, 2); c.fillRect(x + 3, y - 9, 7, 2);
      c.fillStyle = '#d81a5a'; c.beginPath(); c.ellipse(x, y + 7, 4, 2, 0, 0, Math.PI * 2); c.fill();
    }));
    const hair = new THREE.Mesh(new THREE.SphereGeometry(8.4, 10, 8), lambert('#ff7ac8'));
    hair.position.set(0, 2.5, -2.6);
    const bun = new THREE.Mesh(new THREE.SphereGeometry(4, 8, 6), lambert('#ff7ac8'));
    bun.position.set(0, 9, -1);
    rig.head.add(hair, head, bun);
    return rig;
  },
];

function buildOwn(character: number): THREE.Object3D {
  const rig = (OWN[character] ?? OWN[0])();
  const root = rig.root;
  // Scale to CHAR_H (the rigs are built about 24 units tall).
  const box = new THREE.Box3().setFromObject(root);
  const h = box.max.y - box.min.y;
  const wrap = new THREE.Group();
  root.scale.setScalar(CHAR_H / h);
  root.position.y = (-box.min.y * CHAR_H) / h;
  wrap.add(root);
  wrap.userData.animate = (t: number, speed: number) => {
    const run = Math.min(1, speed / 60);
    const swing = Math.sin(t * 14) * 0.9 * run;
    rig.legL.rotation.x = swing;
    rig.legR.rotation.x = -swing;
    rig.armL.rotation.x = -swing * 0.8;
    rig.armR.rotation.x = swing * 0.8;
    rig.head.position.y = 15.5 + Math.abs(Math.sin(t * (run > 0.1 ? 14 : 3))) * (run > 0.1 ? 0.8 : 0.4);
    rig.extra?.(t);
  };
  return wrap;
}

// ---------- N64 test models ----------

interface N64Entry {
  dir: string;
  file: string;
  yaw?: number;
}

/** Slot -> model, matching each emoji's signature color. */
const N64: N64Entry[] = [
  { dir: 'mario', file: 'Mario.dae' },
  { dir: 'dk', file: 'dk.obj' },
  { dir: 'wario', file: 'wario.obj' },
  { dir: 'yoshi', file: 'Yoshi.dae' },
  { dir: 'luigi-ml', file: 'luigi.obj' },
  { dir: 'luigi', file: 'luigi.obj' },
  { dir: 'mario-ml', file: 'Mario - Mystery Land.dae' },
  { dir: 'peach', file: 'Peach.dae' },
];

const n64Loaded = new Map<number, THREE.Object3D | null>();
const n64Loading = new Set<number>();

async function loadN64(i: number): Promise<THREE.Object3D | null> {
  const e = N64[i];
  const base = `/characters/n64/${e.dir}/`;
  // A quick HEAD so a missing (published) model doesn't spam loader errors.
  const head = await fetch(base + e.file, { method: 'HEAD' }).catch(() => null);
  // (The dev server answers unknown paths with index.html, hence the text/html check.)
  if (!head || !head.ok || (head.headers.get('content-type') ?? '').includes('text/html')) return null;
  let obj: THREE.Object3D;
  if (e.file.endsWith('.obj')) {
    const mtlName = e.file.replace(/\.obj$/, '.mtl');
    const mtl = await new MTLLoader().setPath(base).loadAsync(mtlName);
    mtl.preload();
    obj = await new OBJLoader().setMaterials(mtl).setPath(base).loadAsync(e.file);
  } else {
    obj = (await new ColladaLoader().setPath(base).loadAsync(encodeURI(e.file))).scene;
  }
  // N64 look: Lambert, blurry textures, cut-out alpha, both sides (the rips have mixed winding).
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((src) => {
      const s = src as THREE.MeshStandardMaterial;
      n64Texture(s.map);
      return new THREE.MeshLambertMaterial({ map: s.map ?? null, color: s.map ? '#ffffff' : s.color ?? '#cccccc', alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: !!m.geometry.attributes.color });
    });
    m.material = Array.isArray(m.material) ? mats : mats[0];
  });
  // Our own look on top of the test model: recolored textures (see skins.ts).
  const skin = SKINS[i];
  if (skin) await applySkin(obj, skin);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const k = CHAR_H / size.y;
  const wrap = new THREE.Group();
  obj.scale.multiplyScalar(k);
  obj.position.set(-center.x * k, -box.min.y * k, -center.z * k);
  obj.rotation.y += e.yaw ?? 0;
  wrap.add(obj);
  // Accessories live in the normalized space (feet at 0, CHAR_H tall, facing +Z).
  skin?.accessories?.(wrap);
  return wrap;
}

function n64Model(character: number): THREE.Object3D | null {
  if (n64Loaded.has(character)) return n64Loaded.get(character) ?? null;
  if (!n64Loading.has(character)) {
    n64Loading.add(character);
    loadN64(character)
      .then((m) => n64Loaded.set(character, m))
      .catch((err) => {
        console.warn(`Modelo N64 ${N64[character]?.dir} não carregou`, err);
        n64Loaded.set(character, null);
      });
  }
  return null;
}

// ---------- public API ----------

export type CastKind = 'n64' | 'own';

/**
 * A fresh instance of a character for a scene, plus which cast it came from. While a N64 model is
 * still loading this returns the own model; check `wantedKind()` later to swap it in.
 */
export function characterInstance(character: number): { obj: THREE.Object3D; kind: CastKind } {
  if (settings().cast3d === 'n64') {
    const m = n64Model(character);
    if (m) {
      const obj = cloneSkinned(m);
      let cape: THREE.Object3D | null | undefined;
      obj.userData.animate = (t: number, speed: number) => {
        // The rips have no animations here: a hop while running, a breath while idle.
        const run = Math.min(1, speed / 60);
        // (Scenes add userData.hop to wherever they place the character.)
        obj.userData.hop = run > 0.1 ? Math.abs(Math.sin(t * 12)) * 1.6 : Math.sin(t * 3) * 0.25;
        // Capes flutter, more when running.
        cape ??= obj.getObjectByName('cape') ?? null;
        if (cape) cape.rotation.x = 0.18 + run * 0.5 + Math.sin(t * (run > 0.1 ? 14 : 4)) * (0.06 + run * 0.12);
      };
      return { obj, kind: 'n64' };
    }
  }
  return { obj: buildOwn(character), kind: 'own' };
}

/** Starts loading the N64 test models right away, so they're ready by the first 3D clip. */
export function preloadCharacters(): void {
  if (settings().cast3d !== 'n64') return;
  for (let i = 0; i < N64.length; i++) n64Model(i);
}

/** The cast a scene should be showing right now (N64 only once its model has loaded). */
export function wantedKind(character: number): CastKind {
  if (settings().cast3d !== 'n64') return 'own';
  return n64Model(character) ? 'n64' : 'own';
}

export function characterColor(character: number): string {
  return (CHARACTERS[character] ?? CHARACTERS[0]).color;
}
