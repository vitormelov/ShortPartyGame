import { ARENA_H, ARENA_W } from '@shared/arena';
import { MAX_HP, type Asteroid, type Ship, type ShipState } from '@shared/minigames/tank/logic';
import { CHARACTERS, type PlayerId } from '@shared/types';
import { rampHex } from '../core/cast';
import { BRAND, PAL, RES } from '../core/draw';
import { hash, localMarker, type MinigameRenderer } from './renderer';

/*
 * FLAME WAR in space: ships and asteroids are baked once into hi-res canvases (shaded pixel art,
 * light from the top left, colored outlines) and rotated at draw time, Saturn style.
 */

// ---------- baking helpers ----------

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return [cv, cv.getContext('2d')!];
}

/** Hard alpha (no anti-aliasing) plus a 1px outline in `outline` around the shape. */
function crisp(cv: HTMLCanvasElement, outline: string): void {
  const c = cv.getContext('2d')!;
  const img = c.getImageData(0, 0, cv.width, cv.height);
  const d = img.data;
  const { width: w, height: h } = cv;
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    solid[i] = d[i * 4 + 3] > 110 ? 1 : 0;
    d[i * 4 + 3] = solid[i] ? 255 : 0;
  }
  const n = parseInt(outline.slice(1), 16);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (solid[i]) continue;
      const near = (x > 0 && solid[i - 1]) || (x < w - 1 && solid[i + 1]) || (y > 0 && solid[i - w]) || (y < h - 1 && solid[i + w]);
      if (!near) continue;
      d[i * 4] = (n >> 16) & 255;
      d[i * 4 + 1] = (n >> 8) & 255;
      d[i * 4 + 2] = n & 255;
      d[i * 4 + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
}

function poly(c: CanvasRenderingContext2D, pts: number[], col: string): void {
  c.fillStyle = col;
  c.beginPath();
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.closePath();
  c.fill();
}

// ---------- ships ----------

const SHIP_W = 36; // real pixels, nose pointing right
const SHIP_H = 28;
const shipCache = new Map<string, HTMLCanvasElement>();

function bakeShip(character: number, flash: boolean): HTMLCanvasElement {
  const ch = CHARACTERS[character];
  const hull = rampHex(ch.color);
  const metal = rampHex('#9a94b8');
  const [cv, c] = canvas(SHIP_W, SHIP_H);
  const col = (s: string) => (flash ? '#ffffff' : s);
  // Wings (behind the hull): swept back, darker on the shadow side.
  poly(c, [21, 11, 12, 2, 7, 2, 9, 11], col(hull[2]));
  poly(c, [21, 17, 12, 26, 7, 26, 9, 17], col(hull[1]));
  poly(c, [12, 2, 7, 2, 7, 4, 13, 4], col(hull[4])); // lit leading edge
  poly(c, [12, 26, 7, 26, 7, 24, 13, 24], col(hull[3]));
  // Engine block.
  c.fillStyle = col(metal[2]);
  c.fillRect(4, 10, 5, 8);
  c.fillStyle = col(metal[4]);
  c.fillRect(4, 10, 5, 2);
  c.fillStyle = col(metal[1]);
  c.fillRect(4, 16, 5, 2);
  // Hull: lit on top, shadowed underneath.
  poly(c, [31, 14, 23, 9, 9, 9, 7, 14, 9, 19, 23, 19], col(hull[3]));
  poly(c, [31, 14, 23, 9, 9, 9, 7, 12, 22, 12], col(hull[4]));
  poly(c, [23, 9, 10, 9, 9, 10, 22, 10], col(hull[5]));
  poly(c, [31, 14, 9, 17, 9, 19, 23, 19], col(hull[2]));
  // Cockpit glass with a highlight.
  if (!flash) {
    poly(c, [25, 14, 22, 11.5, 17, 11.5, 16, 14, 17, 16.5, 22, 16.5], '#1a6a8a');
    poly(c, [24, 13, 22, 11.5, 17, 11.5, 17, 13], BRAND.ciano);
    c.fillStyle = '#ffffff';
    c.fillRect(19, 12, 2, 1);
  }
  crisp(cv, flash ? '#ffffff' : hull[0]);
  return cv;
}

function shipSprite(character: number, flash: boolean): HTMLCanvasElement {
  const key = `${character}|${flash}`;
  let cv = shipCache.get(key);
  if (!cv) shipCache.set(key, (cv = bakeShip(character, flash)));
  return cv;
}

function drawShip(ctx: CanvasRenderingContext2D, s: Ship, time: number): void {
  if (s.status === 'out') return;
  if (s.status === 'dead') {
    if (s.deathAnim <= 0) return;
    // Debris flying apart while the explosion plays.
    const k = 1 - s.deathAnim / 0.6;
    const hull = CHARACTERS[s.character].color;
    for (let i = 0; i < 6; i++) {
      const a = i * 1.7 + s.id;
      ctx.fillStyle = i % 2 ? hull : '#9a94b8';
      ctx.fillRect(s.x + Math.cos(a) * k * 18 - 1, s.y + Math.sin(a) * k * 18 - 1, 2, 1.5);
    }
    return;
  }
  if (s.ghost > 0 && Math.floor(time * 16) % 2 === 0) return;
  const flash = s.hitT > 0 && Math.floor(time * 24) % 2 === 0;
  const w = SHIP_W / RES;
  const h = SHIP_H / RES;
  ctx.save();
  ctx.translate(Math.round(s.x * RES) / RES, Math.round(s.y * RES) / RES);
  ctx.rotate(s.angle);
  // Engine flame (flickers; bigger when thrusting forward).
  if (s.thrust !== 0) {
    const len = (s.thrust > 0 ? 5 : 2.5) + (Math.floor(time * 30) % 2);
    ctx.fillStyle = BRAND.rosa;
    ctx.fillRect(-w / 2 + 2 - len, -1.5, len, 3);
    ctx.fillStyle = PAL.yellow;
    ctx.fillRect(-w / 2 + 2 - len * 0.6, -1, len * 0.6, 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-w / 2 + 2 - len * 0.25, -0.5, len * 0.25, 1);
  }
  ctx.drawImage(shipSprite(s.character, flash), -w / 2, -h / 2, w, h);
  ctx.restore();

  // Damaged: sparks and smoke.
  if (s.hp < MAX_HP) {
    for (let k = 0; k < 3; k++) {
      const p = (time * 1.6 + k / 3) % 1;
      ctx.fillStyle = `rgba(150,140,180,${0.6 - p * 0.6})`;
      ctx.fillRect(s.x - 1 + Math.sin(time * 3 + k) * 2, s.y - 4 - p * 9, 2, 2);
    }
    if (Math.floor(time * 12) % 3 === 0) {
      ctx.fillStyle = PAL.yellow;
      ctx.fillRect(s.x + hash(Math.floor(time * 12)) * 6 - 3, s.y + hash(Math.floor(time * 12) + 9) * 4 - 2, 1, 1);
    }
  }
}

// ---------- asteroids ----------

const ROCK = ['#1e1030', '#3a2648', '#5a3e62', '#7a5a7a', '#a08294', '#c8aab4'];
const rockCache = new Map<number, HTMLCanvasElement>();

/** A lumpy rock: irregular outline, sphere shading lit from the top left, a few craters. */
function bakeRock(a: Asteroid): HTMLCanvasElement {
  const R = a.r * RES;
  const size = Math.ceil(R * 2.6) + 4;
  const [cv, c] = canvas(size, size);
  const cx = size / 2;
  const cy = size / 2;
  const bumps = Array.from({ length: 9 }, (_, i) => hash(a.seed + i * 13.7));
  const radius = (ang: number) => {
    const t = ((ang / (Math.PI * 2)) * 9 + 9) % 9;
    const i = Math.floor(t);
    const f = t - i;
    const e = f * f * (3 - 2 * f);
    return R * (0.86 + 0.22 * (bumps[i] * (1 - e) + bumps[(i + 1) % 9] * e));
  };
  const craters = Array.from({ length: 2 + Math.floor(hash(a.seed + 99) * 3) }, (_, i) => {
    const ang = hash(a.seed + i * 7.1) * Math.PI * 2;
    const d = hash(a.seed + i * 3.3) * R * 0.55;
    return { x: cx + Math.cos(ang) * d, y: cy + Math.sin(ang) * d, r: R * (0.14 + hash(a.seed + i * 5.9) * 0.14) };
  });
  const img = c.createImageData(size, size);
  const px = img.data;
  const L = [-0.55, -0.6, 0.58];
  const rgb = ROCK.map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
  const inside = (x: number, y: number) => Math.hypot(x - cx, y - cy) < radius(Math.atan2(y - cy, x - cx));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = x + 0.5;
      const fy = y + 0.5;
      let tone = -1;
      if (inside(fx, fy)) {
        const ang = Math.atan2(fy - cy, fx - cx);
        const rr = radius(ang);
        const d = Math.hypot(fx - cx, fy - cy) / rr;
        let nx = Math.cos(ang) * d;
        let ny = Math.sin(ang) * d;
        let nz = Math.sqrt(Math.max(0, 1 - d * d));
        for (const cr of craters) {
          const dd = Math.hypot(fx - cr.x, fy - cr.y);
          if (dd < cr.r) {
            // Inside a crater the normal flips: lit on the far (bottom-right) wall.
            nx = -(fx - cr.x) / cr.r;
            ny = -(fy - cr.y) / cr.r;
            nz = 0.5;
          }
        }
        const lit = nx * L[0] + ny * L[1] + nz * L[2];
        tone = lit > 0.8 ? 5 : lit > 0.5 ? 4 : lit > 0.15 ? 3 : lit > -0.2 ? 2 : 1;
        // A little dithered grit.
        if (hash(x * 31.7 + y * 17.3 + a.seed) > 0.93) tone = Math.max(1, tone - 1);
      } else if (inside(fx + 1, fy) || inside(fx - 1, fy) || inside(fx, fy + 1) || inside(fx, fy - 1)) {
        tone = 0;
      }
      if (tone < 0) continue;
      const i = (y * size + x) * 4;
      [px[i], px[i + 1], px[i + 2]] = rgb[tone];
      px[i + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  return cv;
}

function drawRock(ctx: CanvasRenderingContext2D, a: Asteroid): void {
  let cv = rockCache.get(a.seed);
  if (!cv) rockCache.set(a.seed, (cv = bakeRock(a)));
  const s = cv.width / RES;
  // Soft shadow cast down-right, so the rocks read as cover.
  ctx.fillStyle = 'rgba(8,2,20,0.35)';
  ctx.beginPath();
  ctx.ellipse(a.x + 3, a.y + 3, a.r, a.r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.drawImage(cv, Math.round((a.x - s / 2) * RES) / RES, Math.round((a.y - s / 2) * RES) / RES, s, s);
}

// ---------- space ----------

function drawSpace(ctx: CanvasRenderingContext2D, time: number): void {
  ctx.fillStyle = BRAND.roxo;
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);
  // Nebula glows in the brand colors.
  const glow = (x: number, y: number, r: number, col: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, col);
    g.addColorStop(1, 'rgba(27,11,58,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  glow(70, 40, 110, 'rgba(255,46,136,0.16)');
  glow(320, 170, 120, 'rgba(62,232,255,0.12)');
  // Stars: three depths, slowly drifting, some twinkling.
  for (let i = 0; i < 90; i++) {
    const depth = 1 + (i % 3);
    const x = (hash(i) * ARENA_W - time * depth * 2 + ARENA_W * 10) % ARENA_W;
    const y = hash(i + 50) * ARENA_H;
    const tw = hash(i + 200) > 0.8 && Math.floor(time * 3 + i) % 4 === 0;
    ctx.fillStyle = depth === 3 ? (tw ? BRAND.ciano : BRAND.creme) : depth === 2 ? '#9a8cc0' : '#5a4a8a';
    const sz = depth === 3 ? 1 : 0.5;
    ctx.fillRect(Math.round(x * RES) / RES, Math.round(y * RES) / RES, sz, sz);
  }
}

export const tankRenderer: MinigameRenderer = {
  positions(raw) {
    return (raw as ShipState).ships.filter((s) => s.status === 'alive').map((s) => [s.id, s.x, s.y - 2]);
  },

  render(ctx, raw, time, localId: PlayerId) {
    const st = raw as ShipState;
    drawSpace(ctx, time);
    for (const a of st.asteroids) drawRock(ctx, a);
    for (const s of st.ships) drawShip(ctx, s, time);

    // Lasers: a bright streak in the shooter's color with a glow.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const o of st.shots) {
      const sp = Math.hypot(o.vx, o.vy) || 1;
      const ux = o.vx / sp;
      const uy = o.vy / sp;
      const ship = st.ships.find((s) => s.id === o.owner);
      const col = ship ? CHARACTERS[ship.character].color : PAL.white;
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(o.x - ux * 8, o.y - uy * 8);
      ctx.lineTo(o.x, o.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(o.x - ux * 6, o.y - uy * 6);
      ctx.lineTo(o.x, o.y);
      ctx.stroke();
    }
    ctx.restore();

    for (const b of st.booms) {
      const k = b.t / 0.5;
      const r = (b.big ? 16 : 5) * (0.4 + k);
      ctx.fillStyle = b.big ? `rgba(255,${Math.round(200 - k * 150)},80,${1 - k})` : `rgba(62,232,255,${1 - k})`;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (b.big && k < 0.5) {
        ctx.fillStyle = `rgba(255,244,224,${1 - k * 2})`;
        ctx.beginPath();
        ctx.arc(b.x, b.y, r * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const me = st.ships.find((s) => s.id === localId);
    if (me && me.status === 'alive') {
      localMarker(ctx, me.x, me.y - 10, time);
      // Armor pips.
      for (let k = 0; k < MAX_HP; k++) {
        ctx.fillStyle = PAL.ink;
        ctx.fillRect(Math.round(me.x - 6 + k * 7), Math.round(me.y + 8), 5, 3);
        ctx.fillStyle = k < me.hp ? PAL.green : '#3a2a50';
        ctx.fillRect(Math.round(me.x - 5 + k * 7), Math.round(me.y + 9), 3, 1);
      }
    }
  },
};
