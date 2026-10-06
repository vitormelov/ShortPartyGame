import { ARENA_H, ARENA_W } from '@shared/arena';
import { BALL_R, CENTER, CHARGE_COOLDOWN, FALL_TIME, START_R, type Ball, type BubbleState } from '@shared/minigames/bubble/logic';
import { CHARACTERS, type PlayerId } from '@shared/types';
import { PAL } from '../core/draw';
import { hash, localMarker, type MinigameRenderer } from './renderer';
import { drawCharacter } from '../core/cast';

function drawSea(ctx: CanvasRenderingContext2D, time: number): void {
  for (let y = 0; y < ARENA_H; y += 4) {
    ctx.fillStyle = (y / 4) % 2 ? '#1a4ab8' : '#1e52c8';
    ctx.fillRect(0, y, ARENA_W, 4);
  }
  ctx.fillStyle = '#6aa8ff';
  for (let i = 0; i < 50; i++) {
    const x = Math.floor((hash(i) * ARENA_W + time * 10) % ARENA_W);
    const y = Math.floor(hash(i + 90) * ARENA_H);
    ctx.fillRect(x, y, 5, 1);
    ctx.fillRect(x + 1, y - 1, 3, 1);
  }
}

function drawPlatform(ctx: CanvasRenderingContext2D, radius: number, time: number): void {
  // Foam where the platform has already crumbled.
  ctx.fillStyle = 'rgba(200,230,255,0.25)';
  ctx.beginPath();
  ctx.arc(CENTER.x, CENTER.y, START_R + 2, 0, Math.PI * 2);
  ctx.fill();
  // Side of the platform (it's floating).
  ctx.fillStyle = '#8a2a6a';
  ctx.beginPath();
  ctx.arc(CENTER.x, CENTER.y + 5, radius, 0, Math.PI * 2);
  ctx.fill();
  // Concentric candy rings.
  const rings = ['#ff8ad8', '#fff0fa', '#ff8ad8', '#fff0fa', '#ffb8e8', '#fff0fa'];
  for (let k = 0; k < rings.length; k++) {
    const r = radius - (k * radius) / rings.length;
    if (r <= 0) break;
    ctx.fillStyle = rings[k];
    ctx.beginPath();
    ctx.arc(CENTER.x, CENTER.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Danger rim blinks.
  ctx.strokeStyle = Math.floor(time * 6) % 2 ? '#ff3b5c' : '#ffd23e';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(CENTER.x, CENTER.y, radius - 1, 0, Math.PI * 2);
  ctx.stroke();
}

function drawBall(ctx: CanvasRenderingContext2D, b: Ball, time: number): void {
  if (b.status === 'out' || b.status === 'dead') return;
  if (b.ghost > 0 && Math.floor(time * 16) % 2 === 0) return;
  const ch = CHARACTERS[b.character];
  let scale = 1;
  if (b.status === 'falling') scale = Math.max(0.1, b.fall / FALL_TIME);
  const x = Math.round(b.x);
  const y = Math.round(b.y);

  if (b.status === 'falling') {
    // splash ring growing on the water
    const k = 1 - scale;
    ctx.strokeStyle = `rgba(220,240,255,${1 - k})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, 4 + k * 16, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.fillStyle = 'rgba(40,0,40,0.3)';
    ctx.beginPath();
    ctx.ellipse(x + 2, y + 6, BALL_R, BALL_R * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Charge streak.
  if (b.charge > 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    for (let k = 1; k <= 3; k++) ctx.fillRect(Math.round(x - b.vx * 0.02 * k) - 1, Math.round(y - b.vy * 0.02 * k) - 1, 3, 3);
  }

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = PAL.ink;
  ctx.beginPath();
  ctx.arc(0, 0, BALL_R + 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ch.color;
  ctx.beginPath();
  ctx.arc(0, 0, BALL_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ch.dark;
  ctx.beginPath();
  ctx.arc(2, 2, BALL_R - 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ch.color;
  ctx.beginPath();
  ctx.arc(0, 0, BALL_R - 3, 0, Math.PI * 2);
  ctx.fill();
  // Rolling dots move along the direction of travel.
  const sp = Math.hypot(b.vx, b.vy) || 1;
  const ux = b.vx / sp;
  const uy = b.vy / sp;
  for (const phase of [0, Math.PI]) {
    const s = Math.sin(b.roll / BALL_R + phase);
    if (Math.cos(b.roll / BALL_R + phase) < 0) continue; // on the far side
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(Math.round(ux * s * 6) - 1, Math.round(uy * s * 6) - 1, 3, 3);
  }
  ctx.fillStyle = ch.light;
  ctx.fillRect(-5, -6, 3, 2);
  ctx.restore();

  // The rider on top.
  if (b.status === 'alive') {
    drawCharacter(ctx, b.character, x, y - BALL_R + 2, { time });
  }
}

export const bubbleRenderer: MinigameRenderer = {
  positions(raw) {
    return (raw as BubbleState).balls.filter((b) => b.status === 'alive').map((b) => [b.id, b.x, b.y - 6]);
  },

  render(ctx, raw, time, localId: PlayerId) {
    const st = raw as BubbleState;
    drawSea(ctx, time);
    // Fallen balls go under the platform edge, so draw them first.
    for (const b of st.balls) if (b.status === 'falling') drawBall(ctx, b, time);
    drawPlatform(ctx, st.radius, time);
    const alive = st.balls.filter((b) => b.status === 'alive').sort((a, b) => a.y - b.y);
    for (const b of alive) drawBall(ctx, b, time);

    const me = st.balls.find((b) => b.id === localId);
    if (me && me.status === 'alive') {
      localMarker(ctx, me.x, me.y - BALL_R - 11, time);
      if (me.chargeCd > 0) {
        ctx.fillStyle = PAL.ink;
        ctx.fillRect(Math.round(me.x - 6), Math.round(me.y + BALL_R + 3), 12, 2);
        ctx.fillStyle = PAL.cyan;
        ctx.fillRect(Math.round(me.x - 6), Math.round(me.y + BALL_R + 3), Math.round(12 * (1 - me.chargeCd / CHARGE_COOLDOWN)), 2);
      }
    }
  },
};
