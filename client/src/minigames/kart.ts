import { ARENA_H, ARENA_W } from '@shared/arena';
import type { Kart, KartState } from '@shared/minigames/kart/logic';
import { LAPS, TRACK_HALF_W, TRACK_LENGTH, TRACK_POINTS, pointOnTrack } from '@shared/minigames/kart/track';
import { CHARACTERS, type PlayerId } from '@shared/types';
import { PAL, text } from '../core/draw';
import { hash, localMarker, type MinigameRenderer } from './renderer';

const FALL_TIME = 0.6;

function trackPath(ctx: CanvasRenderingContext2D, dx = 0, dy = 0): void {
  ctx.beginPath();
  TRACK_POINTS.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x + dx, y + dy) : ctx.lineTo(x + dx, y + dy)));
  ctx.closePath();
}

function drawBackground(ctx: CanvasRenderingContext2D, time: number): void {
  // Banded "rainbow road" void, SNES style.
  const bands = ['#0e0820', '#120a2a', '#170d34', '#1c103e', '#22134a'];
  const bh = ARENA_H / bands.length;
  bands.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(0, Math.floor(i * bh), ARENA_W, Math.ceil(bh));
  });
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(hash(i) * ARENA_W);
    const y = Math.floor(hash(i + 500) * ARENA_H);
    const tw = Math.sin(time * 3 + i) > 0.6;
    ctx.fillStyle = tw ? '#ffffff' : i % 3 === 0 ? '#ff9ad8' : '#7a70c8';
    ctx.fillRect(x, y, 1, 1);
  }
}

function drawTrack(ctx: CanvasRenderingContext2D): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Drop shadow under the floating track.
  trackPath(ctx, 0, 4);
  ctx.strokeStyle = '#06030e';
  ctx.lineWidth = TRACK_HALF_W * 2 + 6;
  ctx.stroke();

  // Curbs: white with red dashes.
  trackPath(ctx);
  ctx.strokeStyle = '#fff4e0';
  ctx.lineWidth = TRACK_HALF_W * 2 + 5;
  ctx.stroke();
  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = '#e83b3b';
  ctx.stroke();
  ctx.setLineDash([]);

  // Asphalt.
  trackPath(ctx);
  ctx.strokeStyle = '#4e4866';
  ctx.lineWidth = TRACK_HALF_W * 2;
  ctx.stroke();
  trackPath(ctx);
  ctx.strokeStyle = '#575172';
  ctx.lineWidth = TRACK_HALF_W * 2 - 8;
  ctx.stroke();

  // Center dashes.
  trackPath(ctx);
  ctx.setLineDash([3, 6]);
  ctx.strokeStyle = '#8a84a8';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([]);

  // Checkered start line.
  const start = pointOnTrack(0);
  ctx.save();
  ctx.translate(start.x, start.y);
  ctx.rotate(start.angle);
  for (let i = -TRACK_HALF_W; i < TRACK_HALF_W; i += 2) {
    for (let j = 0; j < 4; j += 2) {
      ctx.fillStyle = ((i + j) / 2) % 2 === 0 ? '#ffffff' : '#0a0614';
      ctx.fillRect(j - 2, i, 2, 2);
    }
  }
  ctx.restore();
}

function drawKart(ctx: CanvasRenderingContext2D, k: Kart, time: number): void {
  const ch = CHARACTERS[k.character];
  let scale = 1;
  if (k.status === 'falling') scale = Math.max(0.1, k.fall / FALL_TIME);
  if (k.ghost > 0 && Math.floor(time * 16) % 2 === 0) return;

  // Drift sparks behind the kart.
  if (k.drifting && k.status === 'race') {
    for (let i = 0; i < 3; i++) {
      const back = 6 + i * 2;
      const side = (i % 2 === 0 ? 1 : -1) * 3;
      const sx = k.x - Math.cos(k.angle) * back - Math.sin(k.angle) * side;
      const sy = k.y - Math.sin(k.angle) * back + Math.cos(k.angle) * side;
      ctx.fillStyle = Math.floor(time * 20 + i) % 2 ? '#ffd23e' : '#3ee8ff';
      ctx.fillRect(Math.round(sx), Math.round(sy), 1, 1);
    }
  }

  ctx.save();
  ctx.translate(Math.round(k.x), Math.round(k.y));
  if (k.status === 'race' || k.status === 'done') {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(-4, 2, 9, 3);
  }
  ctx.rotate(k.angle + (k.status === 'falling' ? (FALL_TIME - k.fall) * 12 : 0));
  ctx.scale(scale, scale);
  // wheels
  ctx.fillStyle = '#0a0614';
  ctx.fillRect(-5, -4, 3, 2);
  ctx.fillRect(2, -4, 3, 2);
  ctx.fillRect(-5, 2, 3, 2);
  ctx.fillRect(2, 2, 3, 2);
  // body
  ctx.fillStyle = '#0a0614';
  ctx.fillRect(-5, -3, 11, 6);
  ctx.fillStyle = ch.color;
  ctx.fillRect(-4, -2, 9, 4);
  ctx.fillStyle = ch.light;
  ctx.fillRect(2, -2, 3, 1);
  ctx.fillStyle = ch.dark;
  ctx.fillRect(-4, 1, 9, 1);
  // driver
  ctx.fillStyle = '#0a0614';
  ctx.fillRect(-3, -2, 4, 4);
  ctx.fillStyle = '#fff4e0';
  ctx.fillRect(-2, -1, 2, 2);
  ctx.restore();
}

export const kartRenderer: MinigameRenderer = {
  positions(raw) {
    return (raw as KartState).karts.filter((k) => k.status === 'race' || k.status === 'done').map((k) => [k.id, k.x, k.y]);
  },

  render(ctx, raw, time, localId: PlayerId) {
    const st = raw as KartState;
    drawBackground(ctx, time);
    drawTrack(ctx);

    const visible = st.karts.filter((k) => k.status !== 'out' && k.status !== 'dead');
    visible.sort((a, b) => a.y - b.y);
    for (const k of visible) drawKart(ctx, k, time);

    const me = st.karts.find((k) => k.id === localId);
    if (me && (me.status === 'race' || me.status === 'done')) localMarker(ctx, me.x, me.y - 6, time);

    // Race HUD for the local player.
    const progress = (k: Kart) => (k.status === 'done' ? 1e6 - k.place : k.lap * TRACK_LENGTH + k.s);
    const order = st.karts.filter((k) => k.status !== 'out').sort((a, b) => progress(b) - progress(a));
    if (me && me.status !== 'out') {
      const lap = Math.max(1, Math.min(LAPS, me.lap));
      const pos = order.indexOf(me) + 1;
      text(ctx, `VOLTA ${lap}/${LAPS}`, 4, 4, PAL.yellow);
      text(ctx, `${pos}º`, 4, 14, pos === 1 ? PAL.green : PAL.white);
    }
    for (const k of st.karts) {
      if (k.status === 'done') text(ctx, `${k.place}º`, k.x - 6, k.y - 14, k.place === 1 ? PAL.yellow : PAL.white);
    }
  },
};
