import { ARENA_H, ARENA_W } from '@shared/arena';
import { BEAM_HALF, DASH_COOLDOWN, DEATH_ANIM, FIELD, FIRE_TIME, type Beam, type BeamPlayer, type BeamState } from '@shared/minigames/beam/logic';
import { CHARACTERS, type PlayerId } from '@shared/types';
import { PAL, sprite } from '../core/draw';
import { BLOB } from './meteor';
import { localMarker, type MinigameRenderer } from './renderer';

function drawBackground(ctx: CanvasRenderingContext2D, time: number): void {
  ctx.fillStyle = '#05030c';
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);
  ctx.fillStyle = '#0e0a1e';
  ctx.fillRect(FIELD.x, FIELD.y, FIELD.w, FIELD.h);
  ctx.fillStyle = '#18122e';
  for (let x = FIELD.x; x < FIELD.x + FIELD.w; x += 16) ctx.fillRect(x, FIELD.y, 1, FIELD.h);
  for (let y = FIELD.y; y < FIELD.y + FIELD.h; y += 16) ctx.fillRect(FIELD.x, y, FIELD.w, 1);
  // Emitter nodes all around the border.
  const pulse = Math.floor(time * 6) % 2;
  for (let x = FIELD.x; x <= FIELD.x + FIELD.w; x += 16) {
    for (const y of [FIELD.y - 3, FIELD.y + FIELD.h]) {
      ctx.fillStyle = '#3a2a5a';
      ctx.fillRect(x - 2, y, 5, 3);
      ctx.fillStyle = pulse ? '#ff5ac8' : '#8a3a7a';
      ctx.fillRect(x, y + 1, 1, 1);
    }
  }
  for (let y = FIELD.y; y <= FIELD.y + FIELD.h; y += 16) {
    for (const x of [FIELD.x - 3, FIELD.x + FIELD.w]) {
      ctx.fillStyle = '#3a2a5a';
      ctx.fillRect(x, y - 2, 3, 5);
      ctx.fillStyle = pulse ? '#ff5ac8' : '#8a3a7a';
      ctx.fillRect(x + 1, y, 1, 1);
    }
  }
}

function linePath(ctx: CanvasRenderingContext2D, b: Beam): void {
  const dx = Math.cos(b.a) * 500;
  const dy = Math.sin(b.a) * 500;
  ctx.beginPath();
  ctx.moveTo(b.x - dx, b.y - dy);
  ctx.lineTo(b.x + dx, b.y + dy);
}

function drawBeam(ctx: CanvasRenderingContext2D, b: Beam, time: number): void {
  if (b.warn > 0) {
    // Telegraph: a thin line that blinks faster and gets brighter as it's about to fire.
    const p = 1 - b.warn / b.warnTotal;
    const rate = 8 + p * 24;
    const bright = Math.floor(time * rate) % 2 === 0;
    ctx.globalAlpha = bright ? 0.4 + p * 0.6 : 0.2 + p * 0.25;
    ctx.strokeStyle = p > 0.7 ? '#ffffff' : '#ff3b5c';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    linePath(ctx, b);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    return;
  }
  const fade = Math.min(1, b.fire / (FIRE_TIME * 0.4));
  for (const [color, width] of [
    ['rgba(255,90,200,0.3)', BEAM_HALF * 2 + 6],
    ['#ff5ac8', BEAM_HALF * 2],
    ['#ffffff', 2],
  ] as const) {
    ctx.globalAlpha = fade;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    linePath(ctx, b);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawPlayer(ctx: CanvasRenderingContext2D, p: BeamPlayer, time: number): void {
  if (p.status === 'out' || (p.status === 'dead' && p.deathAnim <= 0)) return;
  if (p.ghost > 0 && Math.floor(time * 16) % 2 === 0) return;
  const ch = CHARACTERS[p.character];
  const dead = p.status === 'dead';
  const flash = dead && Math.floor(time * 20) % 2 === 0;
  const colors = flash
    ? { k: '#ffffff', c: '#ff5ac8', L: '#ffffff', K: '#ff5ac8', w: '#ffffff' }
    : { k: PAL.ink, c: ch.color, L: ch.light, K: ch.dark, w: '#ffffff' };
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(Math.round(p.x - 4), Math.round(p.y + 2), 8, 3);
  if (dead) {
    const s = Math.max(0.1, p.deathAnim / DEATH_ANIM);
    ctx.save();
    ctx.translate(Math.round(p.x), Math.round(p.y));
    ctx.scale(s, s);
    sprite(ctx, BLOB, -5, -8, colors);
    ctx.restore();
    return;
  }
  if (p.dashT > 0) {
    ctx.globalAlpha = 0.4;
    sprite(ctx, BLOB, p.x - 5 - p.fx * 7, p.y - 8 - p.fy * 7, colors);
    ctx.globalAlpha = 1;
  }
  const bob = p.walk > 0 && Math.floor(p.walk * 10) % 2 ? 1 : 0;
  sprite(ctx, BLOB, p.x - 5, p.y - 8 - bob, colors);
}

export const beamRenderer: MinigameRenderer = {
  positions(raw) {
    return (raw as BeamState).players.filter((p) => p.status === 'alive').map((p) => [p.id, p.x, p.y - 3]);
  },

  render(ctx, raw, time, localId: PlayerId) {
    const st = raw as BeamState;
    drawBackground(ctx, time);

    ctx.save();
    ctx.beginPath();
    ctx.rect(FIELD.x, FIELD.y, FIELD.w, FIELD.h);
    ctx.clip();
    for (const b of st.beams) if (b.warn > 0) drawBeam(ctx, b, time);
    ctx.restore();

    const players = [...st.players].sort((a, b) => a.y - b.y);
    for (const p of players) drawPlayer(ctx, p, time);

    ctx.save();
    ctx.beginPath();
    ctx.rect(FIELD.x, FIELD.y, FIELD.w, FIELD.h);
    ctx.clip();
    for (const b of st.beams) if (b.warn <= 0) drawBeam(ctx, b, time);
    ctx.restore();

    for (const bolt of st.bolts) {
      const tx = bolt.x - bolt.vx * 0.04;
      const ty = bolt.y - bolt.vy * 0.04;
      ctx.strokeStyle = '#ffd23e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(bolt.x, bolt.y);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(Math.round(bolt.x) - 1, Math.round(bolt.y) - 1, 2, 2);
    }

    const me = st.players.find((p) => p.id === localId);
    if (me && me.status === 'alive') {
      localMarker(ctx, me.x, me.y - 11, time);
      if (me.dashCd > 0) {
        ctx.fillStyle = PAL.ink;
        ctx.fillRect(Math.round(me.x - 5), Math.round(me.y + 5), 10, 2);
        ctx.fillStyle = PAL.cyan;
        ctx.fillRect(Math.round(me.x - 5), Math.round(me.y + 5), Math.round(10 * (1 - me.dashCd / DASH_COOLDOWN)), 2);
      }
    }
  },
};
