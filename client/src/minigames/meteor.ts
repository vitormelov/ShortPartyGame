import { ARENA_H, ARENA_W } from '@shared/arena';
import { CRATER_TIME, DEATH_ANIM, FIELD, type MPlayer, type MeteorState } from '@shared/minigames/meteor/logic';
import { CHARACTERS, type PlayerId } from '@shared/types';
import { PAL, sprite } from '../core/draw';
import { hash, localMarker, type MinigameRenderer } from './renderer';

export const BLOB = [
  '...kkkk...',
  '.kkccccKk.',
  '.kcLccccKk',
  'kcLccccccK',
  'kccwkcwkcK',
  'kccwkcwkcK',
  'kcccccccKK',
  '.kccccccK.',
  '..kKKKKk..',
  '...kkkk...',
];

function drawGround(ctx: CanvasRenderingContext2D, time: number): void {
  // Lava all around the field.
  for (let y = 0; y < ARENA_H; y += 4) {
    const wave = Math.floor(Math.sin(y * 0.3 + time * 3) * 2);
    ctx.fillStyle = (y / 4) % 2 ? '#c8261e' : '#e8501e';
    ctx.fillRect(wave, y, ARENA_W, 4);
  }
  for (let i = 0; i < 40; i++) {
    const x = Math.floor(hash(i) * ARENA_W);
    const y = Math.floor((hash(i + 70) * ARENA_H + time * 12) % ARENA_H);
    ctx.fillStyle = '#ffd23e';
    ctx.fillRect(x, y, 2, 1);
  }
  // Rock plateau.
  ctx.fillStyle = '#1a0e0a';
  ctx.fillRect(FIELD.x - 3, FIELD.y - 1, FIELD.w + 6, FIELD.h + 6);
  ctx.fillStyle = '#4a3428';
  ctx.fillRect(FIELD.x - 2, FIELD.y - 2, FIELD.w + 4, FIELD.h + 4);
  for (let y = 0; y < FIELD.h; y += 8) {
    for (let x = 0; x < FIELD.w; x += 8) {
      ctx.fillStyle = ((x + y) / 8) % 2 ? '#5e4434' : '#58402f';
      ctx.fillRect(FIELD.x + x, FIELD.y + y, 8, 8);
    }
  }
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = '#3e2a20';
    ctx.fillRect(FIELD.x + Math.floor(hash(i + 200) * FIELD.w), FIELD.y + Math.floor(hash(i + 400) * FIELD.h), 2, 1);
  }
  ctx.fillStyle = '#7a5a44';
  ctx.fillRect(FIELD.x - 2, FIELD.y - 2, FIELD.w + 4, 1);
}

function drawPlayer(ctx: CanvasRenderingContext2D, p: MPlayer, time: number): void {
  if (p.status === 'out' || (p.status === 'dead' && p.deathAnim <= 0)) return;
  if (p.ghost > 0 && Math.floor(time * 16) % 2 === 0) return;
  const ch = CHARACTERS[p.character];
  const flash = p.status === 'dead' && Math.floor(time * 20) % 2 === 0;
  const colors = flash
    ? { k: '#ffffff', c: '#ffffff', L: '#ffffff', K: '#ffffff', w: '#ffffff' }
    : { k: PAL.ink, c: ch.color, L: ch.light, K: ch.dark, w: '#ffffff' };
  const bob = p.walk > 0 && Math.floor(p.walk * 10) % 2 ? 1 : 0;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(Math.round(p.x - 4), Math.round(p.y + 2), 8, 3);
  if (p.dashT > 0) {
    ctx.globalAlpha = 0.4;
    sprite(ctx, BLOB, p.x - 5 - p.fx * 6, p.y - 8 - p.fy * 6, colors);
    ctx.globalAlpha = 1;
  }
  if (p.status === 'dead') {
    const s = Math.max(0.1, p.deathAnim / DEATH_ANIM);
    ctx.save();
    ctx.translate(Math.round(p.x), Math.round(p.y));
    ctx.scale(1 + (1 - s), s);
    sprite(ctx, BLOB, -5, -8, colors);
    ctx.restore();
    return;
  }
  sprite(ctx, BLOB, p.x - 5, p.y - 8 - bob, colors);
}

export const meteorRenderer: MinigameRenderer = {
  render(ctx, raw, time, localId: PlayerId) {
    const st = raw as MeteorState;
    drawGround(ctx, time);

    for (const c of st.craters) {
      const f = c.t / CRATER_TIME;
      ctx.fillStyle = '#1a0e0a';
      ctx.beginPath();
      ctx.arc(Math.round(c.x), Math.round(c.y), c.r + 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = Math.floor(time * 10) % 2 ? '#ff6a1e' : '#e83b1e';
      ctx.beginPath();
      ctx.arc(Math.round(c.x), Math.round(c.y), Math.max(1, c.r * (0.4 + 0.6 * f)), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffd23e';
      ctx.beginPath();
      ctx.arc(Math.round(c.x), Math.round(c.y), Math.max(1, c.r * 0.35 * f), 0, Math.PI * 2);
      ctx.fill();
    }

    // Shadows: grow and darken as impact nears; red ring in the last half second.
    for (const m of st.meteors) {
      const p = 1 - m.t / m.warn;
      ctx.fillStyle = `rgba(10,6,20,${0.2 + p * 0.45})`;
      ctx.beginPath();
      ctx.ellipse(Math.round(m.x), Math.round(m.y), m.r * (0.4 + 0.6 * p), m.r * (0.3 + 0.5 * p), 0, 0, Math.PI * 2);
      ctx.fill();
      if (m.t < 0.5 && Math.floor(time * 16) % 2 === 0) {
        ctx.strokeStyle = '#ff3b5c';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(Math.round(m.x), Math.round(m.y), m.r, m.r * 0.8, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    const players = [...st.players].sort((a, b) => a.y - b.y);
    for (const p of players) drawPlayer(ctx, p, time);

    // Falling rocks on top of everything.
    for (const m of st.meteors) {
      if (m.t > 0.7) continue;
      const h = m.t * 220;
      const x = m.x + h * 0.4;
      const y = m.y - h;
      const rr = Math.max(3, m.r * 0.55);
      for (let k = 1; k <= 4; k++) {
        const size = Math.max(1, Math.round(rr * (1 - k / 5)));
        ctx.fillStyle = k % 2 ? '#ff9a1e' : '#ffd23e';
        ctx.fillRect(Math.round(x + k * 2 - size / 2), Math.round(y - k * 5 - size / 2), size, size);
      }
      ctx.fillStyle = '#2a1a14';
      ctx.beginPath();
      ctx.arc(Math.round(x), Math.round(y), rr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#6a4a3a';
      ctx.fillRect(Math.round(x - rr / 2), Math.round(y - rr / 2), Math.ceil(rr / 2), Math.ceil(rr / 3));
    }

    const me = st.players.find((p) => p.id === localId);
    if (me && me.status === 'alive') {
      localMarker(ctx, me.x, me.y - 11, time);
      // Dash cooldown pip under the player.
      if (me.dashCd > 0) {
        ctx.fillStyle = PAL.ink;
        ctx.fillRect(Math.round(me.x - 5), Math.round(me.y + 5), 10, 2);
        ctx.fillStyle = PAL.cyan;
        ctx.fillRect(Math.round(me.x - 5), Math.round(me.y + 5), Math.round(10 * (1 - me.dashCd / 1.4)), 2);
      }
    }
  },
};
