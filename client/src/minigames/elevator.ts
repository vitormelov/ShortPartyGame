import { ARENA_H, ARENA_W } from '@shared/arena';
import { DEATH_ANIM, FLOOR_Y, PLAT_H, ROW_GAP, floorOf, type EPlayer, type ElevatorState, type Platform } from '@shared/minigames/elevator/logic';
import { CHARACTERS, type PlayerId } from '@shared/types';
import { PAL, sprite, text } from '../core/draw';
import { BLOB } from './meteor';
import { hash, localMarker, type MinigameRenderer } from './renderer';

function drawShaft(ctx: CanvasRenderingContext2D, camY: number): void {
  ctx.fillStyle = '#141a2e';
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);
  // Parallax wall panels.
  const off = Math.floor(camY * 0.5);
  for (let y = -((off % 24) + 24); y < ARENA_H; y += 24) {
    for (let x = 0; x < ARENA_W; x += 32) {
      const row = Math.floor((y + off) / 24);
      ctx.fillStyle = (row + x / 32) % 2 ? '#1a223a' : '#182036';
      ctx.fillRect(x + 1, y + 1, 30, 22);
      ctx.fillStyle = '#222c48';
      ctx.fillRect(x + 1, y + 1, 30, 1);
    }
  }
  // Pipes on both sides.
  for (const x of [6, ARENA_W - 10]) {
    ctx.fillStyle = '#2a3452';
    ctx.fillRect(x, 0, 4, ARENA_H);
    ctx.fillStyle = '#3a4668';
    ctx.fillRect(x, 0, 1, ARENA_H);
  }
  // Floor labels every 5 floors.
  for (let f = Math.max(0, floorOf(camY + ARENA_H) - 5); f <= floorOf(camY) + 5; f++) {
    if (f % 5 !== 0) continue;
    const y = FLOOR_Y - f * ROW_GAP - camY;
    if (y < -10 || y > ARENA_H) continue;
    ctx.fillStyle = 'rgba(255,210,62,0.12)';
    ctx.fillRect(0, Math.round(y) - 1, ARENA_W, 1);
    text(ctx, `${f}º ANDAR`, 14, y - 11, 'rgba(255,210,62,0.5)', 8, 'left', null);
  }
}

function drawPlatform(ctx: CanvasRenderingContext2D, pl: Platform, camY: number): void {
  const y = Math.round(pl.y - camY);
  if (y < -8 || y > ARENA_H + 8) return;
  const draw = (x: number) => {
    const w = Math.round(pl.w);
    x = Math.round(x);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x + 2, y + PLAT_H, w, 3);
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(x - 1, y - 1, w + 2, PLAT_H + 2);
    if (pl.vx !== 0) {
      for (let k = 0; k < w; k += 6) {
        ctx.fillStyle = (k / 6) % 2 ? '#0a0614' : '#ffd23e';
        ctx.fillRect(x + k, y, Math.min(6, w - k), PLAT_H);
      }
    } else {
      ctx.fillStyle = '#8a8aa8';
      ctx.fillRect(x, y, w, PLAT_H);
      ctx.fillStyle = '#c8c8e0';
      ctx.fillRect(x, y, w, 1);
      ctx.fillStyle = '#4a4a68';
      for (let k = 3; k < w - 2; k += 10) ctx.fillRect(x + k, y + 2, 1, 1);
    }
  };
  draw(pl.x);
  if (pl.x + pl.w > ARENA_W) draw(pl.x - ARENA_W);
}

function drawLava(ctx: CanvasRenderingContext2D, lavaY: number, camY: number, time: number): void {
  const top = lavaY - camY;
  if (top > ARENA_H) return;
  for (let x = 0; x < ARENA_W; x += 2) {
    const wave = Math.round(Math.sin(x * 0.08 + time * 4) * 2 + Math.sin(x * 0.03 - time * 2) * 1.5);
    const y = Math.round(top + wave);
    ctx.fillStyle = '#ffd23e';
    ctx.fillRect(x, y, 2, 2);
    ctx.fillStyle = '#ff6a1e';
    ctx.fillRect(x, y + 2, 2, 5);
    ctx.fillStyle = '#c8261e';
    ctx.fillRect(x, y + 7, 2, ARENA_H - y);
  }
  for (let i = 0; i < 12; i++) {
    const x = Math.floor(hash(i) * ARENA_W);
    const phase = (time * 0.8 + hash(i + 40)) % 1;
    const y = Math.round(top + 6 + (1 - phase) * 10);
    ctx.fillStyle = phase > 0.8 ? '#ffd23e' : '#ff9a1e';
    ctx.fillRect(x, y, 2, 2);
  }
  // heat shimmer above the lava
  ctx.fillStyle = 'rgba(255,106,30,0.12)';
  ctx.fillRect(0, Math.round(top) - 16, ARENA_W, 16);
}

function drawPlayer(ctx: CanvasRenderingContext2D, p: EPlayer, camY: number, time: number): void {
  if (p.status === 'out' || (p.status === 'dead' && p.deathAnim <= 0)) return;
  if (p.ghost > 0 && Math.floor(time * 16) % 2 === 0) return;
  const ch = CHARACTERS[p.character];
  const dead = p.status === 'dead';
  const flash = dead && Math.floor(time * 20) % 2 === 0;
  const colors = flash
    ? { k: '#ffffff', c: '#ff6a1e', L: '#ffd23e', K: '#c8261e', w: '#ffffff' }
    : { k: PAL.ink, c: ch.color, L: ch.light, K: ch.dark, w: '#ffffff' };
  const y = p.y - camY;
  const draw = (x: number) => {
    if (dead) {
      const s = Math.max(0.1, p.deathAnim / DEATH_ANIM);
      ctx.save();
      ctx.translate(Math.round(x), Math.round(y));
      ctx.scale(1, s);
      sprite(ctx, BLOB, -5, -10, colors);
      ctx.restore();
      return;
    }
    sprite(ctx, BLOB, x - 5, y - 10, colors, 1, p.facing < 0);
  };
  draw(p.x);
  if (p.x > ARENA_W - 6) draw(p.x - ARENA_W);
  if (p.x < 6) draw(p.x + ARENA_W);

  // Above the top of the screen: show where they are.
  if (y < 2 && !dead) {
    ctx.fillStyle = ch.color;
    ctx.fillRect(Math.round(p.x) - 2, 1, 5, 2);
    ctx.fillRect(Math.round(p.x) - 1, 0, 3, 1);
  }
}

export const elevatorRenderer: MinigameRenderer = {
  positions(raw) {
    const st = raw as ElevatorState;
    return st.players.filter((p) => p.status === 'alive').map((p) => [p.id, p.x, p.y - st.camY - 5]);
  },

  render(ctx, raw, time, localId: PlayerId) {
    const st = raw as ElevatorState;
    drawShaft(ctx, st.camY);
    for (const pl of st.platforms) drawPlatform(ctx, pl, st.camY);
    const others = st.players.filter((p) => p.id !== localId);
    for (const p of others) drawPlayer(ctx, p, st.camY, time);
    const me = st.players.find((p) => p.id === localId);
    if (me) drawPlayer(ctx, me, st.camY, time);
    drawLava(ctx, st.lavaY, st.camY, time);

    if (me && me.status === 'alive') {
      if (me.y - st.camY > 8) localMarker(ctx, me.x, me.y - st.camY - 13, time);
      text(ctx, `${floorOf(me.y)}º ANDAR`, 4, 4, PAL.yellow);
      if (st.lavaY - me.y < 40 && Math.floor(time * 8) % 2 === 0) text(ctx, 'SOBE!', 4, 14, PAL.red);
    }
  },
};
