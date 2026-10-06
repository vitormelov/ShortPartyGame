import { CHARACTERS } from '@shared/types';
import { RES } from './draw';

/*
 * The cast in 32-bit style (Saturn / PS1 / CPS3 sprites).
 *
 * Every character is built from shaded shapes in a 64x64 "design" box (feet at y=62, centered on x=32).
 * The shapes are rasterized at whatever size is needed, so the same design gives the 14px in-game sprite,
 * the 16px portrait and the big poses on the menus. Each material gets a hue-shifted ramp, the light comes
 * from the top left, the outline takes a dark tone of the material it surrounds (no pure black), and the
 * right edge gets a rim light in the character's own color.
 */

export type Pose = 'idle' | 'win' | 'lose' | 'jump';
type Expr = 'normal' | 'happy' | 'sad' | 'shout';
type Arms = 'down' | 'up' | 'point' | 'flex' | 'hold' | 'selfie' | 'wave';

const W = 64;
const H = 64;
const FEET = 62;
const INK = '#0a0614';

// ---------- colors ----------

function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** Moves hue h by up to `by` degrees toward `target` along the short way round. */
function towards(h: number, target: number, by: number): number {
  const d = ((target - h + 540) % 360) - 180;
  return h + Math.sign(d) * Math.min(Math.abs(d), by);
}

type RGB = [number, number, number];
/** [outline, deep shadow, shadow, base, light, highlight]: shadows drift to purple, lights to yellow. */
function ramp(hex: string): RGB[] {
  const [h, s, l] = hexToHsl(hex);
  // Pale colors (white hair, cream pants) would turn neon in the shadows: keep their darks muted.
  const sd = Math.min(s, 0.25 + (1 - l) * 1.5);
  return [
    hslToRgb(towards(h, 265, 30), Math.min(1, sd * 0.9 + 0.1), l * 0.24),
    hslToRgb(towards(h, 265, 18), Math.min(1, sd * 0.95 + 0.05), l * 0.52),
    hslToRgb(towards(h, 265, 8), sd, l * 0.76),
    hslToRgb(h, s, l),
    hslToRgb(towards(h, 55, 8), s, l + (1 - l) * 0.32),
    hslToRgb(towards(h, 55, 14), s * 0.9, l + (1 - l) * 0.62),
  ];
}

/** The 6-tone ramp of a color as hex strings: [outline, deep shadow, shadow, base, light, highlight]. */
export function rampHex(hex: string): string[] {
  return rampOf(hex).map((c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`);
}

const rampCache = new Map<string, RGB[]>();
function rampOf(hex: string): RGB[] {
  let r = rampCache.get(hex);
  if (!r) rampCache.set(hex, (r = ramp(hex)));
  return r;
}

// ---------- rasterizer ----------

const L = [-0.5, -0.65, 0.57]; // light from the top left, toward the viewer

class Painter {
  readonly pw: number;
  readonly ph: number;
  private mat: Int16Array;
  private tone: Uint8Array;
  private mats: string[] = [];

  constructor(readonly s: number) {
    this.pw = Math.ceil(W * s);
    this.ph = Math.ceil(H * s);
    this.mat = new Int16Array(this.pw * this.ph).fill(-1);
    this.tone = new Uint8Array(this.pw * this.ph);
  }

  private matId(hex: string): number {
    let i = this.mats.indexOf(hex);
    if (i < 0) i = this.mats.push(hex) - 1;
    return i;
  }

  private put(px: number, py: number, m: number, nx: number, ny: number, nz: number): void {
    if (px < 0 || py < 0 || px >= this.pw || py >= this.ph) return;
    const d = nx * L[0] + ny * L[1] + nz * L[2];
    const t = d > 0.82 ? 5 : d > 0.55 ? 4 : d > 0.2 ? 3 : d > -0.15 ? 2 : 1;
    const i = py * this.pw + px;
    this.mat[i] = m;
    this.tone[i] = t;
  }

  /** Visits every output pixel whose center falls in the design-space box. */
  private each(x0: number, y0: number, x1: number, y1: number, fn: (x: number, y: number, px: number, py: number) => void): void {
    const s = this.s;
    for (let py = Math.max(0, Math.floor(y0 * s)); py <= Math.min(this.ph - 1, Math.ceil(y1 * s)); py++) {
      for (let px = Math.max(0, Math.floor(x0 * s)); px <= Math.min(this.pw - 1, Math.ceil(x1 * s)); px++) {
        fn((px + 0.5) / s, (py + 0.5) / s, px, py);
      }
    }
  }

  /** `soft` < 1 flattens the shading (faces would look bearded with full-strength shadows). */
  ellipse(cx: number, cy: number, rx: number, ry: number, hex: string, clip?: (x: number, y: number) => boolean, soft = 1): void {
    const m = this.matId(hex);
    this.each(cx - rx, cy - ry, cx + rx, cy + ry, (x, y, px, py) => {
      const nx = (x - cx) / rx, ny = (y - cy) / ry, r = nx * nx + ny * ny;
      if (r > 1 || (clip && !clip(x, y))) return;
      const fx = nx * soft, fy = ny * soft;
      this.put(px, py, m, fx, fy, Math.sqrt(Math.max(0, 1 - fx * fx - fy * fy)));
    });
  }

  /** A limb: a rounded tube from (x0,y0) to (x1,y1), shaded like a cylinder. */
  capsule(x0: number, y0: number, x1: number, y1: number, w0: number, w1: number, hex: string): void {
    const m = this.matId(hex);
    const len = Math.hypot(x1 - x0, y1 - y0) || 0.001;
    const dx = (x1 - x0) / len, dy = (y1 - y0) / len;
    const wm = Math.max(w0, w1);
    this.each(Math.min(x0, x1) - wm, Math.min(y0, y1) - wm, Math.max(x0, x1) + wm, Math.max(y0, y1) + wm, (x, y, px, py) => {
      const qx0 = x - x0, qy0 = y - y0;
      const k = Math.max(0, Math.min(1, (qx0 * dx + qy0 * dy) / len));
      const qx = qx0 - k * (x1 - x0), qy = qy0 - k * (y1 - y0);
      const w = w0 + (w1 - w0) * k;
      if (Math.hypot(qx, qy) > w) return;
      const side = (qx * -dy + qy * dx) / w;
      this.put(px, py, m, side * -dy, side * dx - 0.25 + k * 0.3, Math.sqrt(Math.max(0, 1 - side * side)));
    });
  }

  /** A box with bevelled edges (boxes, phones, the torso of a tank top). */
  box(x: number, y: number, w: number, h: number, hex: string, bevel = 2): void {
    const m = this.matId(hex);
    this.each(x, y, x + w - 0.01, y + h - 0.01, (px0, py0, px, py) => {
      const l = px0 - x, r = x + w - px0, t = py0 - y, b = y + h - py0;
      let nx = 0, ny = 0;
      if (l < bevel) nx = -0.7;
      else if (r < bevel) nx = 0.7;
      if (t < bevel) ny = -0.7;
      else if (b < bevel) ny = 0.7;
      this.put(px, py, m, nx, ny, Math.sqrt(Math.max(0.1, 1 - nx * nx - ny * ny)));
    });
  }

  /** Torso: a trapezoid with rounded shoulders, shaded as a cylinder. */
  torso(cx: number, y0: number, y1: number, top: number, bottom: number, hex: string): void {
    const m = this.matId(hex);
    this.each(cx - Math.max(top, bottom) - 3, y0, cx + Math.max(top, bottom) + 3, y1, (x, y, px, py) => {
      const k = (y - y0) / (y1 - y0);
      const shoulder = Math.min(1, (y - y0) / 3.2);
      const half = (top + (bottom - top) * k) * (0.72 + 0.28 * Math.sqrt(shoulder));
      const nx = (x - cx) / half;
      if (Math.abs(nx) > 1) return;
      this.put(px, py, m, nx, y - y0 < 3 ? -0.7 : (k - 0.5) * 0.6, Math.sqrt(Math.max(0.05, 1 - nx * nx)));
    });
  }

  /** Bakes the material buffer: shading, colored outline, inner edges and rim light. */
  resolve(rim: string | null): HTMLCanvasElement {
    const { pw, ph } = this;
    const out = new ImageData(pw, ph);
    const d = out.data;
    const ramps = this.mats.map(rampOf);
    const rimRgb = rim ? hslToRgb(...hexToHsl(rim)) : null;
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= pw || y >= ph ? -1 : this.mat[y * pw + x]);
    const fine = this.s >= 0.6; // inner edges only where there's room for them
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        const i = y * pw + x;
        const m = this.mat[i];
        let rgb: RGB | null = null;
        if (m < 0) {
          const nb = [at(x + 1, y), at(x - 1, y), at(x, y + 1), at(x, y - 1)].find((v) => v >= 0);
          if (nb !== undefined) rgb = ramps[nb][0];
        } else {
          let t = this.tone[i];
          const up = at(x, y - 1), lf = at(x - 1, y);
          if (fine && ((up >= 0 && up !== m) || (lf >= 0 && lf !== m))) t = Math.max(1, t - 2);
          rgb = ramps[m][t];
          if (rimRgb && at(x + 1, y) < 0 && at(x + 2, y) < 0 && y > 2) rgb = rimRgb;
        }
        if (!rgb) continue;
        d[i * 4] = rgb[0];
        d[i * 4 + 1] = rgb[1];
        d[i * 4 + 2] = rgb[2];
        d[i * 4 + 3] = 255;
      }
    }
    const cv = document.createElement('canvas');
    cv.width = pw;
    cv.height = ph;
    cv.getContext('2d')!.putImageData(out, 0, 0);
    return cv;
  }
}

/** Flat pixel details (eyes, mouths, logos) drawn after shading, in design units. */
class Decal {
  constructor(private c: CanvasRenderingContext2D, readonly s: number) {}
  get small(): boolean {
    return this.s < 0.6;
  }
  rect(x: number, y: number, w: number, h: number, col: string): void {
    const s = this.s;
    const px = Math.round(x * s), py = Math.round(y * s);
    this.c.fillStyle = col;
    this.c.fillRect(px, py, Math.max(1, Math.round((x + w) * s) - px), Math.max(1, Math.round((y + h) * s) - py));
  }
  glow(cx: number, cy: number, r: number, col: string): void {
    const g = this.c.createRadialGradient(cx * this.s, cy * this.s, 0, cx * this.s, cy * this.s, r * this.s);
    g.addColorStop(0, col);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    this.c.fillStyle = g;
    this.c.fillRect((cx - r) * this.s, (cy - r) * this.s, r * 2 * this.s, r * 2 * this.s);
  }
}

// ---------- the body every influencer shares ----------

interface Look {
  skin: string;
  top: string;
  pants: string;
  shoes: string;
  sleeves: 'long' | 'short' | 'none';
  wide?: boolean;
}

interface Ctx {
  p: Painter;
  pose: Pose;
  frame: number;
  v: number; // animation variant (e.g. the gamer's RGB hue)
  hy: number; // head offset
  by: number; // body offset (breathing / step)
}

const CX = 32;
const SH_L = 20; // shoulders
const SH_R = 44;

function legs(c: Ctx, look: Look): void {
  const { p } = c;
  const step = c.frame % 2 === 1;
  if (c.pose === 'jump') {
    p.capsule(27, 45, 26, 53, 3.4, 3, look.pants);
    p.capsule(37, 45, 38, 53, 3.4, 3, look.pants);
    p.ellipse(25.5, 56, 4.6, 2.6, look.shoes);
    p.ellipse(38.5, 56, 4.6, 2.6, look.shoes);
    return;
  }
  const ly = step ? -2 : 0;
  const ry = step ? 0 : 0;
  p.capsule(27, 45, 27, 56 + ly, 3.4, 3, look.pants);
  p.capsule(37, 45, 37, 56 + ry, 3.4, 3, look.pants);
  p.ellipse(26.5, 59 + ly, 5, 2.8, look.shoes);
  p.ellipse(38, 59 + ry, 5, 2.8, look.shoes);
}

function torso(c: Ctx, look: Look): void {
  const w = look.wide ? 2.2 : 0;
  c.p.torso(CX, 28 + c.by, 46, 8.5 + w, 12 + w, look.top);
}

/** Arms; returns the two hand positions (design units) so props can be placed in them. */
function arms(c: Ctx, look: Look, kind: Arms): { l: [number, number]; r: [number, number] } {
  const { p } = c;
  const sleeve = look.sleeves === 'none' ? look.skin : look.top;
  const fore = look.sleeves === 'long' ? look.top : look.skin;
  const y = 31 + c.by;
  const limb = (sx: number, ex: number, ey: number, hx: number, hy: number) => {
    p.capsule(sx, y, ex, ey, 3.2, 3, sleeve);
    p.capsule(ex, ey, hx, hy, 3, 2.6, fore);
    p.ellipse(hx, hy + (hy > ey ? 1.5 : -1.5), 2.8, 2.6, look.skin);
    return [hx, hy + (hy > ey ? 1.5 : -1.5)] as [number, number];
  };
  const down = (side: -1 | 1) => (side < 0 ? limb(SH_L, 18.5, 37 + c.by, 18, 43) : limb(SH_R, 45.5, 37 + c.by, 46, 43));
  switch (kind) {
    case 'up':
      return { l: limb(SH_L, 14, 25, 12, 17), r: limb(SH_R, 50, 25, 52, 17) };
    case 'point': {
      const l = down(-1);
      p.capsule(SH_R, y, 48, 24, 3.2, 3, sleeve);
      p.capsule(48, 24, 49, 17, 3, 2.6, fore);
      p.ellipse(49, 14.5, 2.6, 2.6, look.skin);
      p.capsule(49.5, 12, 49.5, 8, 1, 1, look.skin);
      return { l, r: [49, 14.5] };
    }
    case 'flex': {
      const side = (sx: number, ex: number) => {
        p.capsule(sx, y, ex, y - 2, 3.6, 3.4, sleeve);
        p.capsule(ex, y - 2, ex, y - 10, 3.4, 3, look.skin);
        p.ellipse(ex, y - 9, 3.6, 3.2, look.skin); // the biceps
        p.ellipse(ex, y - 12, 2.8, 2.6, look.skin);
      };
      side(SH_L, 12);
      side(SH_R, 52);
      return { l: [12, y - 12], r: [52, y - 12] };
    }
    case 'hold':
      return { l: down(-1), r: limb(SH_R, 46, 38 + c.by, 40, 39 + c.by) };
    case 'selfie':
      return { l: limb(SH_L, 15, 26, 14, 19), r: limb(SH_R, 51, 24, 54, 15) };
    case 'wave':
      return { l: limb(SH_L, 13, 24, 11, 15), r: down(1) };
    default:
      return { l: down(-1), r: down(1) };
  }
}

function head(c: Ctx, look: Look): void {
  const y = 16 + c.hy;
  c.p.ellipse(21.2, y + 2, 2.4, 3.2, look.skin);
  c.p.ellipse(42.8, y + 2, 2.4, 3.2, look.skin);
  c.p.ellipse(CX, y, 10.5, 11.5, look.skin, undefined, 0.6);
}

/** Eyes, cheeks and mouth. */
function face(d: Decal, hy: number, expr: Expr, opts: { eyes?: 'open' | 'closed' | 'none'; blush?: boolean } = {}): void {
  const y = hy;
  const eyes = opts.eyes ?? 'open';
  if (eyes === 'open') {
    if (d.small) {
      d.rect(26.5, 14.5 + y, 2.2, 3.5, INK);
      d.rect(35.3, 14.5 + y, 2.2, 3.5, INK);
    } else if (expr === 'sad') {
      d.rect(25, 17 + y, 4, 1, INK);
      d.rect(35, 17 + y, 4, 1, INK);
      d.rect(26, 18 + y, 2, 1, '#9ad8ff');
    } else {
      d.rect(25, 15 + y, 4, 3, '#ffffff');
      d.rect(35, 15 + y, 4, 3, '#ffffff');
      d.rect(26, 15 + y, 2.5, 3, '#2a1a3a');
      d.rect(36, 15 + y, 2.5, 3, '#2a1a3a');
      d.rect(26, 15 + y, 1, 1, '#ffffff');
      d.rect(36, 15 + y, 1, 1, '#ffffff');
    }
  } else if (eyes === 'closed') {
    d.rect(25, 17 + y, 4, 1, '#5a2a3a');
    d.rect(35, 17 + y, 4, 1, '#5a2a3a');
    if (!d.small) {
      d.rect(24, 16 + y, 1, 1, '#5a2a3a');
      d.rect(39, 16 + y, 1, 1, '#5a2a3a');
    }
  }
  if (opts.blush !== false && !d.small) {
    d.rect(23, 20 + y, 2.5, 1, '#ff9aa8');
    d.rect(38.5, 20 + y, 2.5, 1, '#ff9aa8');
  }
  if (d.small) {
    if (expr === 'shout' || expr === 'happy') d.rect(30, 21 + y, 4, 2.5, '#5a1a2a');
    else d.rect(30, 22 + y, 4, 1.5, '#5a1a2a');
    return;
  }
  switch (expr) {
    case 'happy':
      d.rect(28, 21 + y, 8, 1, '#5a2a22');
      d.rect(29, 22 + y, 6, 2, '#ffffff');
      d.rect(29, 24 + y, 6, 1, '#5a2a22');
      break;
    case 'shout':
      d.rect(29, 21 + y, 6, 5, '#5a1a2a');
      d.rect(30, 24 + y, 4, 2, '#ff6a7a');
      break;
    case 'sad':
      d.rect(29, 23 + y, 6, 1, '#5a2a22');
      d.rect(28, 24 + y, 1, 1, '#5a2a22');
      d.rect(35, 24 + y, 1, 1, '#5a2a22');
      break;
    default:
      d.rect(29, 22 + y, 6, 1, '#5a2a22');
      d.rect(28, 21 + y, 1, 1, '#5a2a22');
      d.rect(35, 21 + y, 1, 1, '#5a2a22');
  }
}

// ---------- the eight characters: emojis come to life ----------

interface Design {
  look: Look;
  /** Animation variants (baked separately); `variant(t)` picks one. */
  variants?: number;
  variant?(t: number): number;
  arms(pose: Pose): Arms;
  expr?(pose: Pose): Expr;
  behind?(c: Ctx): void; // shapes behind the body (long hair, halos)
  over(c: Ctx, hands: { l: [number, number]; r: [number, number] }): void; // hair, clothes, props
  decals(d: Decal, c: Ctx, hands: { l: [number, number]; r: [number, number] }): void;
  /** Some characters replace the default face. */
  ownFace?: boolean;
  headless?: boolean;
}

const DESIGNS: Design[] = [
  // PALHAÇO 🤡: white makeup, red nose, rainbow tufts, party hat and giant shoes.
  {
    look: { skin: '#fff0ec', top: '#ff5a5a', pants: '#3b7ef8', shoes: '#e83b3b', sleeves: 'long' },
    arms: (pose) => (pose === 'win' || pose === 'jump' ? 'up' : 'down'),
    over({ p, hy, by }) {
      const y = hy;
      p.ellipse(25, 61, 7, 3, '#e83b3b');
      p.ellipse(39, 61, 7, 3, '#e83b3b');
      p.ellipse(19.5, 13 + y, 4.5, 5.5, '#3ee8ff');
      p.ellipse(44.5, 13 + y, 4.5, 5.5, '#c6ff3d');
      p.ellipse(22, 7 + y, 4, 4, '#ff2e88');
      p.ellipse(42, 7 + y, 4, 4, '#ffd23e');
      // party hat
      for (let k = 0; k < 9; k++) p.box(CX - (9 - k) * 0.55, -3 + k + y, (9 - k) * 1.1, 1, '#ffd23e', 0);
      p.ellipse(CX, -3.5 + y, 1.6, 1.6, '#ff2e88');
      p.ellipse(CX, 19.5 + y, 3, 3, '#e83b3b'); // the nose
      p.ellipse(CX, 33 + by, 2, 2, '#ffd23e');
      p.ellipse(CX, 39 + by, 2, 2, '#ffd23e');
    },
    decals(d, { hy, pose }) {
      const y = hy;
      if (!d.small) {
        // blue diamonds over the eyes
        d.rect(26, 11 + y, 2, 1, '#3b7ef8');
        d.rect(25.5, 12 + y, 3, 1, '#3b7ef8');
        d.rect(36, 11 + y, 2, 1, '#3b7ef8');
        d.rect(35.5, 12 + y, 3, 1, '#3b7ef8');
      }
      face(d, y, 'normal', { eyes: pose === 'lose' ? 'closed' : 'open', blush: false });
      // huge painted smile (a frown when losing)
      if (pose === 'lose') {
        d.rect(27, 25 + y, 10, 1.5, '#e83b3b');
        d.rect(26, 26 + y, 2, 1.5, '#e83b3b');
        d.rect(36, 26 + y, 2, 1.5, '#e83b3b');
      } else {
        d.rect(26, 22 + y, 2, 1.5, '#e83b3b');
        d.rect(36, 22 + y, 2, 1.5, '#e83b3b');
        d.rect(27, 23.5 + y, 10, d.small ? 1.5 : 2.5, '#e83b3b');
        if (!d.small) d.rect(29, 24 + y, 6, 1, '#ffffff');
      }
    },
  },
  // FOGO 🔥: a body of flames that never stops flickering.
  {
    look: { skin: '#ffb02e', top: '#ff6a1e', pants: '#e83b1e', shoes: '#a8261e', sleeves: 'none' },
    arms: (pose) => (pose === 'win' || pose === 'jump' ? 'up' : 'down'),
    headless: true,
    variants: 3,
    variant: (t) => Math.floor(t * 9) % 3,
    behind({ p, hy, v, pose }) {
      const y = hy;
      const big = pose === 'win' ? 1.3 : pose === 'lose' ? 0.6 : 1;
      const sway = [0, 1.5, -1.5][v];
      // Tongues of fire licking up from the head.
      // (kept inside the design box: the top edge would flatten them)
      p.ellipse(22 + sway, 11 + y + (1 - big) * 4, 4.5, 8 * big, '#e83b1e');
      p.ellipse(42 - sway, 12 + y + (1 - big) * 4, 4, 7 * big, '#e83b1e');
      p.ellipse(CX - sway, 8 + y + (1 - big) * 5, 5, 8.5 * big, '#ff6a1e');
      p.ellipse(26.5 + sway, 9 + y + (1 - big) * 4, 3, 6.5 * big, '#ff8a1e');
      p.ellipse(37.5 - sway, 10 + y + (1 - big) * 4, 2.6, 6 * big, '#ff8a1e');
    },
    over({ p, hy, v }) {
      const y = hy;
      p.ellipse(CX, 17 + y, 11, 10.5, '#ff8a1e', undefined, 0.6);
      // the white-hot core the face sits on
      p.ellipse(CX + [0, 0.5, -0.5][v], 18 + y, 8, 7.5, '#ffd23e', undefined, 0.4);
    },
    decals(d, { hy, pose, v }) {
      d.glow(CX, 24, 30, 'rgba(255,140,40,0.12)');
      const y = hy;
      if (pose === 'lose') {
        d.rect(26, 17 + y, 4, 1, '#7a1a0a');
        d.rect(34, 17 + y, 4, 1, '#7a1a0a');
      } else {
        d.rect(26, 15 + y, 3, 4, '#5a0a0a');
        d.rect(35, 15 + y, 3, 4, '#5a0a0a');
        if (!d.small) {
          d.rect(26, 15 + y, 1, 1, '#ffffff');
          d.rect(35, 15 + y, 1, 1, '#ffffff');
        }
      }
      if (pose === 'win') d.rect(28, 21 + y, 8, 4, '#5a0a0a');
      else if (pose === 'lose') d.rect(29, 23 + y, 6, 1.5, '#7a1a0a');
      else {
        d.rect(27, 21 + y, 10, 1.5, '#5a0a0a');
        d.rect(29, 22.5 + y, 6, 1.5, '#5a0a0a');
      }
      // embers rising
      if (!d.small) for (let k = 0; k < 3; k++) d.rect(20 + k * 11 + v * 2, 2 + ((v + k) % 3) * 4, 1, 1, '#ffe85a');
    },
  },
  // RISADA 😂: the emoji that can't stop laughing, tears flying.
  {
    look: { skin: '#ffd23e', top: '#fff4e0', pants: '#3a5aa8', shoes: '#ffd23e', sleeves: 'short' },
    arms: (pose) => (pose === 'win' || pose === 'jump' ? 'up' : 'down'),
    headless: true,
    variants: 2,
    variant: (t) => Math.floor(t * 4) % 2,
    over({ p, hy }) {
      p.ellipse(CX, 15 + hy, 12.5, 12.5, '#ffd23e', undefined, 0.7);
    },
    decals(d, { hy, pose, v }) {
      const y = hy;
      // ^ ^ eyes squeezed shut
      const eye = (x: number) => {
        d.rect(x, 12 + y, 1.5, 1.5, '#6a3a0a');
        d.rect(x + 1.5, 10.5 + y, 2, 1.5, '#6a3a0a');
        d.rect(x + 3.5, 12 + y, 1.5, 1.5, '#6a3a0a');
      };
      eye(24.5);
      eye(34);
      if (pose === 'lose') {
        d.rect(27, 21 + y, 10, 1.5, '#6a3a0a');
      } else {
        d.rect(25, 18 + y, 14, 7, '#6a1a1a');
        d.rect(25, 18 + y, 14, 2, '#ffffff');
        if (!d.small) d.rect(28, 23 + y, 8, 2, '#ff6a7a');
      }
      // tears shooting out of both eyes
      const tx = v ? 2 : 0;
      d.rect(18 - tx, 13 + y + tx, 4, 2.5, '#3ee8ff');
      d.rect(42 + tx, 13 + y + tx, 4, 2.5, '#3ee8ff');
      if (!d.small) {
        d.rect(15 - tx, 15 + y + tx, 2, 2, '#9af0ff');
        d.rect(47 + tx, 15 + y + tx, 2, 2, '#9af0ff');
      }
    },
  },
  // OLHINHOS 👀: just two giant eyes in a hoodie, always side-eyeing.
  {
    look: { skin: '#d8a07a', top: '#3bc84a', pants: '#22223a', shoes: '#f4f4f8', sleeves: 'long' },
    arms: (pose) => (pose === 'win' || pose === 'jump' ? 'up' : 'down'),
    headless: true,
    variants: 3,
    variant: (t) => [0, 0, 1, 2, 2, 1][Math.floor(t * 1.5) % 6],
    behind({ p, by }) {
      p.ellipse(CX, 24 + by, 14, 9, '#2a9a3a'); // the hood
    },
    over({ p, hy }) {
      p.ellipse(25.5, 14 + hy, 7, 9.5, '#f4f0ff', undefined, 0.7);
      p.ellipse(38.5, 14 + hy, 7, 9.5, '#f4f0ff', undefined, 0.7);
    },
    decals(d, { hy, pose, v }) {
      const y = hy;
      const look = pose === 'lose' ? 0 : [-2.5, 0, 2.5][v];
      const py = pose === 'lose' ? 4 : pose === 'win' ? -2 : 0;
      d.rect(23.5 + look, 13 + y + py, 4, 5, '#1a1a2a');
      d.rect(36.5 + look, 13 + y + py, 4, 5, '#1a1a2a');
      if (!d.small) {
        d.rect(24 + look, 13.5 + y + py, 1.5, 1.5, '#ffffff');
        d.rect(37 + look, 13.5 + y + py, 1.5, 1.5, '#ffffff');
      }
      if (pose === 'lose') {
        d.rect(19, 9 + y, 13, 3, '#2a9a3a');
        d.rect(32, 9 + y, 13, 3, '#2a9a3a');
      }
    },
  },
  // CHAD 🗿: a stone moai head on a gym body. Never changes expression.
  {
    look: { skin: '#8a8aa8', top: '#3ee8ff', pants: '#22223a', shoes: '#f4f4f8', sleeves: 'none', wide: true },
    arms: (pose) => (pose === 'win' ? 'flex' : pose === 'jump' ? 'up' : 'down'),
    headless: true,
    over({ p, hy }) {
      const y = hy - 1;
      p.box(22, -1 + y, 20, 30, '#8a8aa8', 3);
      p.box(21, 9 + y, 22, 3.5, '#9a9ab8', 1.2); // brow
      p.box(29, 11 + y, 6, 11, '#9a9ab8', 1.5); // nose
      p.box(22, 23 + y, 20, 6, '#7a7a98', 1.5); // jaw
    },
    decals(d, { hy, pose }) {
      const y = hy - 1;
      d.rect(24, 12.5 + y, 5, 2, '#3a3a52');
      d.rect(35, 12.5 + y, 5, 2, '#3a3a52');
      if (!d.small) {
        d.rect(25, 13 + y, 2, 1, '#14141e');
        d.rect(36, 13 + y, 2, 1, '#14141e');
        d.rect(23, 4 + y, 1, 3, '#6a6a88'); // weathering
        d.rect(40, 18 + y, 1, 2, '#6a6a88');
      }
      d.rect(26, 25 + y, 12, 1.5, '#3a3a52');
      if (pose === 'lose' && !d.small) {
        // a crack, nothing more
        d.rect(30, 0 + y, 1, 3, '#2a2a3a');
        d.rect(31, 3 + y, 1, 3, '#2a2a3a');
        d.rect(30, 6 + y, 1, 2, '#2a2a3a');
      }
    },
  },
  // CHORÃO 😭: blue with sorrow, two waterfalls of tears.
  {
    look: { skin: '#9ac0ff', top: '#3b7ef8', pants: '#22223a', shoes: '#9ac0ff', sleeves: 'long' },
    arms: (pose) => (pose === 'jump' ? 'up' : pose === 'win' ? 'wave' : 'down'),
    headless: true,
    variants: 2,
    variant: (t) => Math.floor(t * 6) % 2,
    over({ p, hy }) {
      p.ellipse(CX, 15 + hy, 12.5, 12.5, '#9ac0ff', undefined, 0.7);
    },
    decals(d, { hy, pose, v }) {
      const y = hy;
      // eyes shut tight, brows up in despair
      d.rect(24, 14 + y, 6, 1.5, '#1a2a6a');
      d.rect(34, 14 + y, 6, 1.5, '#1a2a6a');
      if (!d.small) {
        d.rect(24, 10 + y, 2, 1, '#1a2a6a');
        d.rect(26, 9 + y, 3, 1, '#1a2a6a');
        d.rect(38, 10 + y, 2, 1, '#1a2a6a');
        d.rect(35, 9 + y, 3, 1, '#1a2a6a');
      }
      // wailing mouth
      if (pose === 'win') {
        d.rect(28, 20 + y, 8, 3, '#1a2a6a');
      } else {
        d.rect(27, 19 + y, 10, 6, '#1a1a4a');
        if (!d.small) d.rect(28, 23 + y, 8, 2, '#ff6a7a');
      }
      // rivers of tears down to the chin, flowing
      const cry = pose === 'win' ? 0.4 : 1;
      for (const x of [25, 37]) {
        d.rect(x, 15.5 + y, 2.5, 11 * cry, '#3ee8ff');
        if (!d.small) for (let k = 0; k < 3; k++) d.rect(x + 0.5, 16 + y + ((k * 4 + v * 2) % 10) * cry, 1, 1.5, '#e0fbff');
      }
    },
  },
  // CAVEIRA 💀: a skull in a purple hoodie. Laughs with the whole jaw.
  {
    look: { skin: '#f0ecf8', top: '#6a4aa8', pants: '#2a2040', shoes: '#f0ecf8', sleeves: 'long' },
    arms: (pose) => (pose === 'win' || pose === 'jump' ? 'up' : 'down'),
    headless: true,
    behind({ p, by }) {
      p.ellipse(CX, 24 + by, 14, 9, '#4a2a88'); // the hood
    },
    over({ p, hy, pose }) {
      const y = hy;
      p.ellipse(CX, 13 + y, 11.5, 11, '#f0ecf8', undefined, 0.7);
      const jaw = pose === 'win' ? 3 : pose === 'lose' ? 2 : 0;
      p.box(25, 20 + y + jaw, 14, 7, '#e0dcec', 2);
    },
    decals(d, { hy, pose }) {
      const y = hy;
      const jaw = pose === 'win' ? 3 : pose === 'lose' ? 2 : 0;
      // eye sockets with a little purple glow inside
      d.rect(24, 11 + y, 6, 6, '#1a0e2a');
      d.rect(34, 11 + y, 6, 6, '#1a0e2a');
      if (pose !== 'lose') {
        d.rect(26, 13 + y, 2, 2, '#b89aff');
        d.rect(36, 13 + y, 2, 2, '#b89aff');
      } else if (!d.small) {
        d.rect(25, 12 + y, 1, 1, '#b89aff');
        d.rect(28, 15 + y, 1, 1, '#b89aff');
      }
      d.rect(31, 18 + y, 2, 2, '#1a0e2a'); // nose
      // teeth
      d.rect(26, 21 + y + jaw, 12, d.small ? 1.5 : 3, '#1a0e2a');
      if (!d.small) for (let k = 0; k < 4; k++) d.rect(26.5 + k * 3, 21.5 + y + jaw, 2, 2, '#ffffff');
      if (jaw && !d.small) d.rect(25, 19.5 + y, 14, jaw, '#1a0e2a');
    },
  },
  // DIVA 💅: big pink hair, freshly painted nails, unbothered.
  {
    look: { skin: '#b8784a', top: '#ff2e88', pants: '#ff7ac8', shoes: '#ffd23e', sleeves: 'short' },
    arms: (pose) => (pose === 'win' ? 'selfie' : pose === 'jump' ? 'up' : 'hold'),
    behind({ p, hy }) {
      p.ellipse(CX, 15 + hy, 16, 15, '#ff5ac8');
    },
    over({ p, hy }) {
      const y = hy;
      p.ellipse(CX, 7 + y, 12.5, 7, '#ff5ac8', (_x, yy) => yy < 10 + y);
      p.ellipse(24, 8 + y, 5, 4, '#ff5ac8');
      p.box(23, 4 + y, 18, 3, '#1a1a2a', 1); // sunglasses up on the head
    },
    decals(d, { hy, pose }, hands) {
      const y = hy;
      if (!d.small) {
        d.rect(25, 7 + y + 1, 4, 1, '#6a6aa0');
        d.rect(35, 7 + y + 1, 4, 1, '#6a6aa0');
      }
      face(d, y, pose === 'lose' ? 'sad' : 'normal', { eyes: pose === 'win' ? 'closed' : 'open' });
      if (!d.small) {
        // lashes and lipstick
        d.rect(24, 14 + y, 2, 1, '#1a1a2a');
        d.rect(38, 14 + y, 2, 1, '#1a1a2a');
        d.rect(29, 21.5 + y, 6, 2, '#c8105a');
      }
      // the nails, sparkling
      const [hx, hyy] = hands.r;
      d.rect(hx - 2, hyy - 3, 1.2, 2, '#c6ff3d');
      d.rect(hx - 0.5, hyy - 3.5, 1.2, 2, '#c6ff3d');
      d.rect(hx + 1, hyy - 3, 1.2, 2, '#c6ff3d');
      if (!d.small) d.glow(hx, hyy - 4, 4, 'rgba(198,255,61,0.5)');
    },
  },
];

// ---------- baking and drawing ----------

function bake(character: number, pose: Pose, frame: number, v: number, s: number): HTMLCanvasElement {
  const ch = CHARACTERS[character] ?? CHARACTERS[0];
  const dsg = DESIGNS[character] ?? DESIGNS[0];
  const p = new Painter(s);
  const breathe = pose === 'idle' ? frame % 2 : 0;
  const c: Ctx = { p, pose, frame, v, hy: pose === 'lose' ? 3 : breathe, by: pose === 'lose' ? 1 : breathe };
  dsg.behind?.(c);
  legs(c, dsg.look);
  const kind = dsg.arms(pose);
  // Arms that hang go behind the torso edge; raised arms are drawn after it.
  let hands = { l: [0, 0] as [number, number], r: [0, 0] as [number, number] };
  if (kind === 'down') hands = arms(c, dsg.look, kind);
  torso(c, dsg.look);
  if (kind !== 'down') hands = arms(c, dsg.look, kind);
  if (!dsg.headless) head(c, dsg.look);
  dsg.over(c, hands);
  const cv = p.resolve(ch.color);
  const d = new Decal(cv.getContext('2d')!, s);
  dsg.decals(d, c, hands);
  return cv;
}

function tint(src: HTMLCanvasElement, mode: 'flash' | 'dead'): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = src.width;
  cv.height = src.height;
  const c = cv.getContext('2d')!;
  c.drawImage(src, 0, 0);
  const img = c.getImageData(0, 0, cv.width, cv.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    if (mode === 'flash') {
      d[i] = d[i + 1] = d[i + 2] = 255;
    } else {
      const g = (d[i] * 0.3 + d[i + 1] * 0.55 + d[i + 2] * 0.15) / 255;
      const [r, gg, b] = hslToRgb(258, 0.18, 0.12 + g * 0.42);
      d[i] = r;
      d[i + 1] = gg;
      d[i + 2] = b;
    }
  }
  c.putImageData(img, 0, 0);
  return cv;
}

const cache = new Map<string, HTMLCanvasElement>();

function baked(character: number, pose: Pose, frame: number, t: number, s: number, mode: 'normal' | 'flash' | 'dead'): HTMLCanvasElement {
  const dsg = DESIGNS[character] ?? DESIGNS[0];
  const v = dsg.variant ? dsg.variant(t) : 0;
  const f = frame % 2;
  const key = `${character}|${pose}|${f}|${v}|${s}|${mode}`;
  let cv = cache.get(key);
  if (!cv) {
    cv = mode === 'normal' ? bake(character, pose, f, v, s) : tint(baked(character, pose, f, t, s, 'normal'), mode);
    cache.set(key, cv);
  }
  return cv;
}

export interface CharOpts {
  pose?: Pose;
  /** 0/1: breathing or stepping frame. */
  frame?: number;
  /** Seconds, for animated details (RGB headset, blinking phone). */
  time?: number;
  flip?: boolean;
  flash?: boolean;
  dead?: boolean;
  /** Height in game pixels of the 64-unit design box (the body is a bit shorter). Default 14. */
  size?: number;
  /** Squash and stretch, applied from the feet. */
  sx?: number;
  sy?: number;
}

const air = new Map<string, { up: boolean; landed: number }>();

/**
 * Squash and stretch (about 20%): stretched while going up, squashed for a moment after landing.
 * `key` identifies the jumper across frames; `time` is the renderer's clock.
 */
export function squash(key: string, airborne: boolean, rising: boolean, time: number): { sx: number; sy: number } {
  let st = air.get(key);
  if (!st) air.set(key, (st = { up: airborne, landed: -9 }));
  if (st.up && !airborne) st.landed = time;
  st.up = airborne;
  if (airborne) return rising ? { sx: 0.84, sy: 1.18 } : { sx: 0.94, sy: 1.06 };
  const k = time - st.landed;
  if (k >= 0 && k < 0.12) return { sx: 1.22, sy: 0.8 };
  return { sx: 1, sy: 1 };
}

/** Draws a character standing with its feet at (x, y), in game pixels. */
export function drawCharacter(ctx: CanvasRenderingContext2D, character: number, x: number, y: number, o: CharOpts = {}): void {
  const size = o.size ?? 14;
  const s = Math.round(((size * RES) / H) * 1000) / 1000;
  const cv = baked(character, o.pose ?? 'idle', o.frame ?? 0, o.time ?? 0, s, o.flash ? 'flash' : o.dead ? 'dead' : 'normal');
  const w = cv.width / RES;
  const h = cv.height / RES;
  const fy = (FEET * s) / RES;
  const snap = (v: number) => Math.round(v * RES) / RES;
  const sx = o.sx ?? 1;
  const sy = o.sy ?? 1;
  if (sx === 1 && sy === 1 && !o.flip) {
    ctx.drawImage(cv, snap(x - w / 2), snap(y - fy), w, h);
    return;
  }
  ctx.save();
  ctx.translate(snap(x), snap(y));
  ctx.scale(o.flip ? -sx : sx, sy);
  ctx.drawImage(cv, -w / 2, -fy, w, h);
  ctx.restore();
}

/**
 * Head-and-shoulders portrait in a (16 * scale) square at (x, y), like the old 16x16 mascot face.
 */
export function drawPortrait(ctx: CanvasRenderingContext2D, character: number, x: number, y: number, scale = 1, dead = false, pose: Pose = 'idle', time = 0): void {
  const box = 16 * scale; // game pixels
  // The portrait crops design units 14..50 x 0..36.
  const s = Math.round(((box * RES) / 36) * 1000) / 1000;
  const cv = baked(character, pose, 0, time, s, dead ? 'dead' : 'normal');
  ctx.drawImage(cv, Math.round(14 * s), 0, Math.round(36 * s), Math.round(36 * s), x, y, box, box);
}
