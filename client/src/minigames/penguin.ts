import { ARENA_H, ARENA_W } from '@shared/arena';
import { FALL_TIME, FLOE, SHOVE_COOLDOWN, type Penguin, type PenguinState, type Skater } from '@shared/minigames/penguin/logic';
import { type PlayerId } from '@shared/types';
import { PAL, sprite } from '../core/draw';
import { hash, localMarker, type MinigameRenderer } from './renderer';
import { drawCharacter } from '../core/cast';

const PENGUIN = [
  '....kkkk....',
  '...kkbbkk...',
  '..kkkekkkk..',
  '..kkkkkkyyy.',
  '..kkkkkkk...',
  '.kkwwwwkk...',
  '.kkwwwwwkk..',
  '.kkwwwwwkk..',
  '..kwwwwwk...',
  '..kkwwwkk...',
  '...yy.yy....',
];
const PENGUIN_COLORS = { k: '#14141e', w: '#f4f4ff', e: '#ffffff', y: '#ffa01e', b: '#ff3b5c' };

function drawWater(ctx: CanvasRenderingContext2D, time: number): void {
  for (let y = 0; y < ARENA_H; y += 4) {
    ctx.fillStyle = (y / 4) % 2 ? '#0e3a5a' : '#104266';
    ctx.fillRect(0, y, ARENA_W, 4);
  }
  ctx.fillStyle = '#4a8ab8';
  for (let i = 0; i < 40; i++) {
    const x = Math.floor((hash(i) * ARENA_W + time * 8) % ARENA_W);
    const y = Math.floor(hash(i + 70) * ARENA_H);
    ctx.fillRect(x, y, 4, 1);
  }
  // Little ice chunks drifting.
  ctx.fillStyle = '#c8e8f8';
  for (let i = 0; i < 8; i++) {
    const x = Math.floor((hash(i + 300) * ARENA_W + time * 5) % ARENA_W);
    const y = Math.floor(hash(i + 400) * ARENA_H);
    if (x > FLOE.x - 10 && x < FLOE.x + FLOE.w + 10 && y > FLOE.y - 10 && y < FLOE.y + FLOE.h + 10) continue;
    ctx.fillRect(x, y, 5, 3);
  }
}

function drawFloe(ctx: CanvasRenderingContext2D): void {
  const { x, y, w, h } = FLOE;
  // Thick icy side (3D) + rounded-ish corners.
  ctx.fillStyle = '#5aa8d8';
  ctx.fillRect(x + 2, y + 4, w - 4, h);
  ctx.fillStyle = '#9ad8ff';
  ctx.fillRect(x + 2, y, w - 4, h);
  ctx.fillRect(x, y + 2, w, h - 4);
  ctx.fillStyle = '#eaf6ff';
  ctx.fillRect(x + 3, y + 1, w - 6, h - 4);
  ctx.fillRect(x + 1, y + 3, w - 2, h - 8);
  // Cracks and snow sparkle.
  ctx.fillStyle = '#c8e4f4';
  for (let i = 0; i < 14; i++) {
    let cx = x + 10 + hash(i + 10) * (w - 20);
    let cy = y + 10 + hash(i + 30) * (h - 20);
    for (let k = 0; k < 6; k++) {
      ctx.fillRect(Math.round(cx), Math.round(cy), 2, 1);
      cx += 2;
      cy += hash(i * 7 + k) > 0.5 ? 1 : -1;
    }
  }
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 30; i++) ctx.fillRect(Math.round(x + hash(i + 500) * w), Math.round(y + hash(i + 600) * h), 1, 1);
}

function drawPenguin(ctx: CanvasRenderingContext2D, p: Penguin, time: number): void {
  const flip = p.vx < 0 || (p.vx === 0 && p.id % 2 === 1);
  const bob = Math.floor(time * 10 + p.id) % 2;
  ctx.fillStyle = 'rgba(20,6,46,0.25)';
  ctx.fillRect(Math.round(p.x - 5), Math.round(p.y + 4), 10, 2);
  sprite(ctx, PENGUIN, p.x - 6, p.y - 7 - bob, PENGUIN_COLORS, 1, flip);
}

function drawSkater(ctx: CanvasRenderingContext2D, s: Skater, time: number): void {
  if (s.status === 'out' || s.status === 'dead') return;
  if (s.ghost > 0 && Math.floor(time * 16) % 2 === 0) return;
  if (s.status === 'falling') {
    const k = 1 - s.fall / FALL_TIME;
    ctx.strokeStyle = `rgba(220,240,255,${1 - k})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(Math.round(s.x), Math.round(s.y), 3 + k * 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    ctx.rect(s.x - 8, s.y - 20, 16, 20);
    ctx.clip();
    drawCharacter(ctx, s.character, s.x, s.y + 2 + k * 14, { flip: s.facing < 0, pose: 'lose', time });
    ctx.restore();
    return;
  }
  ctx.fillStyle = 'rgba(40,80,120,0.3)';
  ctx.fillRect(Math.round(s.x - 4), Math.round(s.y + 2), 8, 3);
  if (s.shove > 0) {
    ctx.globalAlpha = 0.4;
    drawCharacter(ctx, s.character, s.x - s.vx * 0.05, s.y + 2 - s.vy * 0.05, { flip: s.facing < 0, time });
    ctx.globalAlpha = 1;
  }
  // Skid marks when sliding fast.
  if (Math.hypot(s.vx, s.vy) > 60) {
    ctx.fillStyle = '#c8e4f4';
    ctx.fillRect(Math.round(s.x - s.vx * 0.08) - 1, Math.round(s.y + 3 - s.vy * 0.08), 2, 1);
  }
  drawCharacter(ctx, s.character, s.x, s.y + 2, { flip: s.facing < 0, time });
}

export const penguinRenderer: MinigameRenderer = {
  positions(raw) {
    return (raw as PenguinState).skaters.filter((s) => s.status === 'alive').map((s) => [s.id, s.x, s.y - 3]);
  },

  render(ctx, raw, time, localId: PlayerId) {
    const st = raw as PenguinState;
    drawWater(ctx, time);
    for (const s of st.skaters) if (s.status === 'falling') drawSkater(ctx, s, time);
    drawFloe(ctx);
    // Depth sort skaters and penguins together.
    const things: Array<{ y: number; draw: () => void }> = [
      ...st.skaters.filter((s) => s.status === 'alive').map((s) => ({ y: s.y, draw: () => drawSkater(ctx, s, time) })),
      ...st.penguins.map((p) => ({ y: p.y, draw: () => drawPenguin(ctx, p, time) })),
    ];
    things.sort((a, b) => a.y - b.y).forEach((t) => t.draw());

    const me = st.skaters.find((s) => s.id === localId);
    if (me && me.status === 'alive') {
      localMarker(ctx, me.x, me.y - 11, time);
      if (me.shoveCd > 0) {
        ctx.fillStyle = PAL.ink;
        ctx.fillRect(Math.round(me.x - 5), Math.round(me.y + 6), 10, 2);
        ctx.fillStyle = PAL.cyan;
        ctx.fillRect(Math.round(me.x - 5), Math.round(me.y + 6), Math.round(10 * (1 - me.shoveCd / SHOVE_COOLDOWN)), 2);
      }
    }
  },
};
