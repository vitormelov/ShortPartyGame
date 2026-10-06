import * as THREE from 'three';

/*
 * Skins for the N64 test models (local only): each slot's model is recolored by hue rules (on the
 * textures, the material colors and the vertex colors) and gets a few low-poly accessories, so the
 * cast looks like its own thing. Coordinates are in the normalized model space: feet at y = 0,
 * 22 units tall, facing +Z.
 */

type HSL = [number, number, number]; // h in degrees, s and l in 0..1

interface Rule {
  /** Hue range (degrees, may wrap past 360) and minimum saturation / lightness range to match. */
  hue?: [number, number];
  sat?: [number, number];
  light?: [number, number];
  /** New hue (absolute); saturation and lightness as multipliers (s, l) or absolute values (S, L). */
  h?: number;
  s?: number;
  l?: number;
  S?: number;
  L?: number;
}

export interface Skin {
  name: string;
  rules: Rule[];
  accessories?(root: THREE.Group): void;
}

function toHsl(r: number, g: number, b: number): HSL {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function toRgb(h: number, s: number, l: number): [number, number, number] {
  const c = new THREE.Color().setHSL((((h % 360) + 360) % 360) / 360, Math.max(0, Math.min(1, s)), Math.max(0, Math.min(1, l)));
  return [c.r, c.g, c.b];
}

function inHue(h: number, [a, b]: [number, number]): boolean {
  if (a <= b) return h >= a && h <= b;
  return h >= a || h <= b; // wraps past 360
}

/** Applies the first matching rule to an RGB color (0..1). */
function recolor(r: number, g: number, b: number, rules: Rule[]): [number, number, number] {
  const [h, s, l] = toHsl(r, g, b);
  for (const rule of rules) {
    if (rule.hue && !inHue(h, rule.hue)) continue;
    if (rule.sat && (s < rule.sat[0] || s > rule.sat[1])) continue;
    if (rule.light && (l < rule.light[0] || l > rule.light[1])) continue;
    const nh = rule.h ?? h;
    const ns = rule.S ?? s * (rule.s ?? 1);
    const nl = rule.L ?? l * (rule.l ?? 1);
    return toRgb(nh, ns, nl);
  }
  return [r, g, b];
}

/** Waits (up to a few seconds) for a texture's image to finish loading. */
function loaded(t: THREE.Texture): Promise<boolean> {
  return new Promise((done) => {
    const t0 = performance.now();
    const check = () => {
      const img = t.image as HTMLImageElement | HTMLCanvasElement | undefined;
      if (img && img.width > 0 && (!(img instanceof HTMLImageElement) || img.complete)) return done(true);
      if (performance.now() - t0 > 5000) return done(false);
      setTimeout(check, 40);
    };
    check();
  });
}

async function recolorTexture(t: THREE.Texture, rules: Rule[]): Promise<void> {
  if (!(await loaded(t))) return;
  const img = t.image as HTMLImageElement;
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  const c = cv.getContext('2d')!;
  c.drawImage(img, 0, 0);
  const data = c.getImageData(0, 0, cv.width, cv.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const [r, g, b] = recolor(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255, rules);
    px[i] = Math.round(r * 255);
    px[i + 1] = Math.round(g * 255);
    px[i + 2] = Math.round(b * 255);
  }
  c.putImageData(data, 0, 0);
  t.image = cv;
  t.needsUpdate = true;
}

/** Recolors a loaded model in place (textures, material colors, vertex colors). */
export async function applySkin(obj: THREE.Object3D, skin: Skin): Promise<void> {
  const textures = new Set<THREE.Texture>();
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshLambertMaterial[]) {
      if (mat.map) textures.add(mat.map);
      const [r, g, b] = recolor(mat.color.r, mat.color.g, mat.color.b, skin.rules);
      mat.color.setRGB(r, g, b);
    }
    const col = m.geometry.attributes.color as THREE.BufferAttribute | undefined;
    if (col) {
      for (let i = 0; i < col.count; i++) {
        const [r, g, b] = recolor(col.getX(i), col.getY(i), col.getZ(i), skin.rules);
        col.setXYZ(i, r, g, b);
      }
      col.needsUpdate = true;
    }
  });
  await Promise.all([...textures].map((t) => recolorTexture(t, skin.rules)));
}

// ---------- accessories ----------

const mat = (color: string, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, ...extra });

function topHat(y: number, z = 0, band = '#7a1030'): THREE.Group {
  const g = new THREE.Group();
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.4, 0.5, 14), mat('#14101a'));
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 3, 4.6, 14), mat('#14101a'));
  crown.position.y = 2.5;
  const ribbon = new THREE.Mesh(new THREE.CylinderGeometry(3.05, 3.05, 0.9, 14), mat(band));
  ribbon.position.y = 0.9;
  g.add(brim, crown, ribbon);
  g.position.set(0, y, z);
  g.rotation.z = -0.12;
  return g;
}

function monocle(x: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.22, 6, 16), mat('#ffd23e', { emissive: new THREE.Color('#3a2a00') }));
  const glass = new THREE.Mesh(new THREE.CircleGeometry(1.15, 14), new THREE.MeshLambertMaterial({ color: '#cfe8ff', transparent: true, opacity: 0.45 }));
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4.5, 4), mat('#ffd23e'));
  chain.position.set(0.9, -2.6, -0.2);
  chain.rotation.z = 0.35;
  g.add(ring, glass, chain);
  g.position.set(x, y, z);
  return g;
}

function cape(color: string, width: number, top: number, bottom: number, z: number): THREE.Mesh {
  const h = top - bottom;
  const geo = new THREE.PlaneGeometry(width, h, 4, 6);
  geo.translate(0, -h / 2, 0);
  const m = new THREE.Mesh(geo, mat(color, { side: THREE.DoubleSide }));
  m.position.set(0, top, z);
  m.rotation.x = 0.18;
  m.name = 'cape';
  return m;
}

function shades(y: number, z: number, w = 7): THREE.Group {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const lens = new THREE.Mesh(new THREE.BoxGeometry(w * 0.4, 1.5, 0.4), mat('#0a0614'));
    lens.position.x = s * w * 0.24;
    g.add(lens);
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(w, 0.35, 0.3), mat('#0a0614'));
  bridge.position.y = 0.5;
  g.add(bridge);
  g.position.set(0, y, z);
  return g;
}

function roundGlasses(y: number, z: number, spread = 1.7): THREE.Group {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.18, 6, 14), mat('#2a1a10'));
    ring.position.x = s * spread;
    g.add(ring);
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.25, 0.25), mat('#2a1a10'));
  g.add(bridge);
  g.position.set(0, y, z);
  return g;
}

function wizardHat(y: number): THREE.Group {
  const g = new THREE.Group();
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 0.5, 14), mat('#4a1a8a'));
  const cone = new THREE.Mesh(new THREE.ConeGeometry(3.2, 8, 12), mat('#6a3ab8'));
  cone.position.y = 4;
  cone.rotation.z = 0.2;
  const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.9), mat('#ffd23e', { emissive: new THREE.Color('#4a3a00') }));
  star.position.set(1, 3.4, 2.3);
  g.add(brim, cone, star);
  g.position.y = y;
  return g;
}

function headband(y: number, r: number, color = '#e83b3b'): THREE.Group {
  const g = new THREE.Group();
  const band = new THREE.Mesh(new THREE.TorusGeometry(r, 0.45, 6, 18), mat(color));
  band.rotation.x = Math.PI / 2;
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.6, 3, 0.25), mat(color));
  tail.position.set(0.8, -1.2, -r);
  tail.rotation.z = 0.4;
  g.add(band, tail);
  g.position.y = y;
  return g;
}

function backpack(): THREE.Group {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(5.5, 6, 3), mat('#3a4a5a'));
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 5, 8), mat('#3ee8ff', { emissive: new THREE.Color('#0a3a4a') }));
  tank.position.set(1.6, 0, -1.4);
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 4, 4), mat('#8a8aa0'));
  ant.position.set(-1.8, 4.5, 0);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 4), new THREE.MeshBasicMaterial({ color: '#ff3b5c' }));
  tip.position.set(-1.8, 6.5, 0);
  g.add(box, tank, ant, tip);
  g.position.set(0, 10.5, -3.6);
  return g;
}

function twinTails(y: number, x: number, color: string): THREE.Group {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const tail = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 6), mat(color));
    tail.scale.set(1, 2.6, 1);
    tail.position.set(s * x, y - 3, -0.6);
    tail.rotation.z = s * 0.25;
    const tie = new THREE.Mesh(new THREE.SphereGeometry(0.8, 6, 4), mat('#3ee8ff'));
    tie.position.set(s * (x - 0.4), y + 0.8, -0.4);
    g.add(tail, tie);
  }
  return g;
}

function microphone(x: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group();
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), mat('#c8c8d8'));
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.25, 3, 6), mat('#ff5ac8'));
  handle.position.y = -1.8;
  g.add(head, handle);
  g.position.set(x, y, z);
  g.rotation.z = -0.3;
  return g;
}

// ---------- the eight skins (by slot) ----------

/** Hues: red ~0, orange ~25, yellow ~50, green ~120, cyan ~185, blue ~225, purple ~275, pink ~320. */
export const SKINS: Skin[] = [
  // 0 · Mario → BARÃO: wine-red shirt and cap, white overalls, monocle and top hat.
  {
    name: 'BARÃO',
    rules: [
      { hue: [345, 15], sat: [0.45, 1], h: 340, s: 0.85, l: 0.75 },
      { hue: [200, 250], sat: [0.35, 1], h: 220, s: 0.12, l: 1.9 },
    ],
    accessories: (g) => g.add(topHat(21.6, -0.4), monocle(-1.9, 15.6, 4.6)),
  },
  // 1 · Donkey Kong → GORILÃO: black fur, grey face and chest, a red cape.
  {
    name: 'GORILÃO',
    rules: [
      { hue: [10, 45], sat: [0.25, 1], light: [0, 0.42], h: 250, s: 0.12, l: 0.42 },
      { hue: [10, 50], sat: [0.15, 1], light: [0.42, 1], h: 230, s: 0.06, l: 0.95 },
      { hue: [345, 10], sat: [0.5, 1], h: 0, s: 0.1, l: 0.35 },
    ],
    accessories: (g) => g.add(cape('#d81e2a', 15, 17, 4, -6.5)),
  },
  // 2 · Wario → ROQUEIRO: red overalls instead of purple, darker gold, shades.
  {
    name: 'ROQUEIRO',
    rules: [
      { hue: [255, 300], sat: [0.25, 1], h: 355, s: 1, l: 0.95 },
      { hue: [40, 65], sat: [0.4, 1], h: 45, s: 1, l: 0.92 },
    ],
    accessories: (g) => g.add(shades(15.8, 6.2, 8)),
  },
  // 3 · Yoshi → DINO NINJA: deep green, black saddle and shoes, a red headband.
  {
    name: 'DINO NINJA',
    rules: [
      { hue: [80, 160], sat: [0.3, 1], h: 140, s: 0.85, l: 0.62 },
      { hue: [345, 30], sat: [0.45, 1], light: [0, 0.75], h: 260, s: 0.15, l: 0.35 },
    ],
    accessories: (g) => g.add(headband(17.8, 3.6)),
  },
  // 4 · Luigi (Mystery Land) → CAÇA-FANTASMA: the sepia turned cyan, a ghost-trap backpack.
  {
    name: 'CAÇA-FANTASMA',
    rules: [{ sat: [0, 0.6], light: [0.12, 0.92], h: 188, S: 0.55 }],
    accessories: (g) => g.add(backpack()),
  },
  // 5 · Luigi → NERD: blue shirt, khaki overalls, round glasses.
  {
    name: 'NERD',
    rules: [
      { hue: [80, 165], sat: [0.3, 1], h: 218, s: 1, l: 1 },
      { hue: [200, 250], sat: [0.35, 1], h: 38, s: 0.5, l: 1.5 },
    ],
    accessories: (g) => g.add(roundGlasses(16, 4.6)),
  },
  // 6 · Mario (Mystery Land) → MAGO: the sepia turned purple, a pointy wizard hat.
  {
    name: 'MAGO',
    rules: [{ sat: [0, 0.6], light: [0.12, 0.92], h: 275, S: 0.5 }],
    accessories: (g) => g.add(wizardHat(21.2)),
  },
  // 7 · Peach → IDOL: pink twin-tail hair, a light-blue dress, a microphone.
  {
    name: 'IDOL',
    rules: [
      { hue: [35, 65], sat: [0.35, 1], h: 325, s: 0.9, l: 1.05 },
      { hue: [295, 345], sat: [0.3, 1], h: 192, s: 0.75, l: 1.15 },
    ],
    accessories: (g) => g.add(twinTails(18.5, 4.6, '#ff7ac8'), microphone(3.8, 11.5, 3.8)),
  },
];
