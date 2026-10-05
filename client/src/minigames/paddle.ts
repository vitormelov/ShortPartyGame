import { ARENA_H, ARENA_W } from '@shared/arena';
import { BALL_R, CX, CY, type PaddleState } from '@shared/minigames/paddle/logic';
import { CHARACTERS, type PlayerId } from '@shared/types';
import { PAL, outlinedText, portrait } from '../core/draw';
import { hash, type MinigameRenderer } from './renderer';

/** Rotation that puts the local player's side at the bottom (kept for positions()). */
let viewRot = 0;

function rotFor(st: PaddleState, localId: PlayerId): number {
  const p = st.paddlers.find((p) => p.id === localId && p.status !== 'out');
  if (!p) return 0;
  const s = st.sides[p.side];
  return Math.PI / 2 - Math.atan2(-s.ny, -s.nx);
}

function view(x: number, y: number): [number, number] {
  const c = Math.cos(viewRot);
  const s = Math.sin(viewRot);
  const dx = x - CX;
  const dy = y - CY;
  return [CX + dx * c - dy * s, CY + dx * s + dy * c];
}

function line(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, color: string, width: number): void {
  const [x1, y1] = view(ax, ay);
  const [x2, y2] = view(bx, by);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

export const paddleRenderer: MinigameRenderer = {
  positions(raw) {
    const st = raw as PaddleState;
    return st.paddlers
      .filter((p) => p.status === 'alive')
      .map((p) => {
        const s = st.sides[p.side];
        const t = 0.5 + p.u / 2;
        const [x, y] = view(s.ax + (s.bx - s.ax) * t + s.nx * 4, s.ay + (s.by - s.ay) * t + s.ny * 4);
        return [p.id, x, y];
      });
  },

  render(ctx, raw, time, localId: PlayerId) {
    const st = raw as PaddleState;
    viewRot = rotFor(st, localId);

    // Neon void.
    ctx.fillStyle = '#0a0618';
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);
    for (let i = 0; i < 50; i++) {
      ctx.fillStyle = Math.sin(time * 2 + i) > 0.6 ? '#ffffff' : '#3a2a6a';
      ctx.fillRect(Math.floor(hash(i) * ARENA_W), Math.floor(hash(i + 50) * ARENA_H), 1, 1);
    }

    // Floor.
    ctx.fillStyle = '#1a1036';
    ctx.beginPath();
    st.sides.forEach((s, i) => {
      const [x, y] = view(s.ax, s.ay);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = '#24184a';
    ctx.lineWidth = 1;
    for (let r = 20; r < 130; r += 20) {
      ctx.beginPath();
      ctx.arc(CX, CY, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    ctx.lineCap = 'round';

    // Faded portraits just inside each owned side (the arena fills the height, so not outside).
    ctx.globalAlpha = 0.45;
    st.sides.forEach((s, i) => {
      const p = st.paddlers.find((q) => q.side === i);
      if (!p || p.status === 'out') return;
      const [x, y] = view((s.ax + s.bx) / 2 + s.nx * 20, (s.ay + s.by) / 2 + s.ny * 20);
      portrait(ctx, p.character, Math.round(x - 8), Math.round(y - 8), 1, p.status === 'dead');
    });
    ctx.globalAlpha = 1;

    // Sides: owner color = goal you defend; grey = wall.
    st.sides.forEach((s, i) => {
      const p = st.paddlers.find((q) => q.side === i);
      const guarded = p && p.status === 'alive' && p.ghost <= 0;
      const ch = p ? CHARACTERS[p.character] : null;
      let color = '#4a4068';
      if (guarded && ch) color = ch.dark;
      else if (p && p.status === 'alive' && ch) color = Math.floor(time * 10) % 2 ? ch.dark : '#4a4068';
      if (p && p.flash > 0 && Math.floor(time * 20) % 2) color = '#ffffff';
      line(ctx, s.ax, s.ay, s.bx, s.by, color, guarded ? 2 : 4);
    });

    // Paddles.
    for (const p of st.paddlers) {
      if (p.status !== 'alive') continue;
      const s = st.sides[p.side];
      const tx = (s.bx - s.ax) / s.len;
      const ty = (s.by - s.ay) / s.len;
      const c = s.len / 2 + (p.u * s.len) / 2;
      const push = 4 + (p.smashT > 0 ? 4 : 0);
      const mx = s.ax + tx * c + s.nx * push;
      const my = s.ay + ty * c + s.ny * push;
      const h = st.paddleLen / 2;
      const ch = CHARACTERS[p.character];
      if (p.ghost > 0 && Math.floor(time * 16) % 2 === 0) continue;
      line(ctx, mx - tx * h, my - ty * h, mx + tx * h, my + ty * h, PAL.ink, 6);
      line(ctx, mx - tx * h, my - ty * h, mx + tx * h, my + ty * h, p.id === localId ? '#ffffff' : ch.color, 4);
      line(ctx, mx - tx * (h - 2), my - ty * (h - 2), mx + tx * (h - 2), my + ty * (h - 2), ch.light, 1);
    }
    ctx.lineCap = 'butt';


    // Balls (with a trail); waiting serves blink at the center.
    for (const b of st.balls) {
      if (b.serve > 0) {
        if (Math.floor(time * 8) % 2) continue;
        ctx.fillStyle = PAL.yellow;
        ctx.fillRect(CX - BALL_R, CY - BALL_R, BALL_R * 2, BALL_R * 2);
        continue;
      }
      const sp = Math.hypot(b.vx, b.vy);
      for (let k = 3; k >= 1; k--) {
        const [x, y] = view(b.x - (b.vx / sp) * k * 4, b.y - (b.vy / sp) * k * 4);
        ctx.fillStyle = `rgba(255,${sp > 200 ? 90 : 220},${sp > 200 ? 60 : 255},${0.5 - k * 0.12})`;
        ctx.fillRect(Math.round(x - 2), Math.round(y - 2), 4, 4);
      }
      const [x, y] = view(b.x, b.y);
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(Math.round(x - BALL_R - 1), Math.round(y - BALL_R - 1), BALL_R * 2 + 2, BALL_R * 2 + 2);
      ctx.fillStyle = sp > 200 ? '#ffb07a' : '#ffffff';
      ctx.fillRect(Math.round(x - BALL_R), Math.round(y - BALL_R), BALL_R * 2, BALL_R * 2);
    }

    const me = st.paddlers.find((p) => p.id === localId);
    if (me && me.status === 'alive' && me.ghost <= 0 && st.time < 2.5 && Math.floor(time * 4) % 2) outlinedText(ctx, 'SEU LADO', CX, ARENA_H - 14, PAL.yellow, 8);
  },
};
