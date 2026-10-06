import { ARENA_H, ARENA_W } from '@shared/arena';
import { COLS, DEATH_ANIM, FILTERS, RISE_TIME, ROWS, SINK_TIME, TILE_H, TILE_W, GRID, type FPlayer, type FilterState } from '@shared/minigames/filter/logic';
import { type PlayerId } from '@shared/types';
import { PAL, outlinedText, panel } from '../core/draw';
import { hash, localMarker, type MinigameRenderer } from './renderer';
import { drawCharacter } from '../core/cast';

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function drawWater(ctx: CanvasRenderingContext2D, time: number): void {
  for (let y = 0; y < ARENA_H; y += 4) {
    const wave = Math.floor(Math.sin(y * 0.25 + time * 2) * 2);
    ctx.fillStyle = (y / 4) % 2 ? '#123a7a' : '#16468e';
    ctx.fillRect(wave - 2, y, ARENA_W + 4, 4);
  }
  for (let i = 0; i < 50; i++) {
    const x = Math.floor((hash(i) * ARENA_W + time * 10) % ARENA_W);
    const y = Math.floor(hash(i + 90) * ARENA_H);
    ctx.fillStyle = '#4a8ad8';
    ctx.fillRect(x, y, 3, 1);
  }
}

function drawTiles(ctx: CanvasRenderingContext2D, st: FilterState, time: number): void {
  // Sink progress of the wrong tiles: 0 = up, 1 = under water.
  let sink = 0;
  if (st.phase === 'sink') sink = Math.min(1, st.phaseTime / 0.25);
  else if (st.phase === 'rise') sink = 1 - st.phaseTime / RISE_TIME;
  const shakeOn = st.phase === 'call' && st.callTime - st.phaseTime < 0.45;
  for (let i = 0; i < COLS * ROWS; i++) {
    const safe = st.tiles[i] === st.target;
    const color = FILTERS[st.tiles[i]][1];
    let x = GRID.x + (i % COLS) * TILE_W + 1;
    let y = GRID.y + Math.floor(i / COLS) * TILE_H + 1;
    let w = TILE_W - 2;
    let h = TILE_H - 2;
    if (!safe && sink > 0) {
      ctx.globalAlpha = 1 - sink * 0.8;
      const s = sink * 4;
      x += s;
      y += s;
      w -= s * 2;
      h -= s * 2;
    }
    if (!safe && shakeOn) x += Math.floor(time * 30) % 2 ? 1 : -1;
    ctx.fillStyle = shade(color, 0.45);
    ctx.fillRect(Math.round(x), Math.round(y + 3), Math.round(w), Math.round(h));
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h - 1));
    ctx.fillStyle = shade(color, 1.3);
    ctx.fillRect(Math.round(x + 2), Math.round(y + 2), Math.round(w - 4), 1);
    ctx.globalAlpha = 1;
  }
  // Ripples where the tiles went under.
  if (st.phase === 'sink' && st.phaseTime < SINK_TIME) {
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (let i = 0; i < COLS * ROWS; i++) {
      if (st.tiles[i] === st.target) continue;
      const cx = GRID.x + (i % COLS) * TILE_W + TILE_W / 2;
      const cy = GRID.y + Math.floor(i / COLS) * TILE_H + TILE_H / 2;
      const r = 4 + st.phaseTime * 14;
      ctx.fillRect(Math.round(cx - r), Math.round(cy), Math.round(r * 2), 1);
    }
  }
}

function drawPlayer(ctx: CanvasRenderingContext2D, p: FPlayer, time: number): void {
  if (p.status === 'out' || (p.status === 'dead' && p.deathAnim <= 0)) return;
  if (p.ghost > 0 && Math.floor(time * 16) % 2 === 0) return;
  if (p.status === 'dead') {
    // Sinking with a splash.
    const s = p.deathAnim / DEATH_ANIM;
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x - 8, p.y - 16, 16, 18);
    ctx.clip();
    drawCharacter(ctx, p.character, p.x, p.y + 2 + (1 - s) * 16, { pose: 'lose', time });
    ctx.restore();
    ctx.fillStyle = '#ffffff';
    const r = 3 + (1 - s) * 7;
    ctx.fillRect(Math.round(p.x - r), Math.round(p.y + 1), Math.round(r * 2), 1);
    ctx.fillRect(Math.round(p.x - 1), Math.round(p.y - 4 - (1 - s) * 6), 2, 2);
    return;
  }
  const bob = p.walk > 0 && Math.floor(p.walk * 10) % 2 ? 1 : 0;
  ctx.fillStyle = 'rgba(20,6,46,0.35)';
  ctx.fillRect(Math.round(p.x - 4), Math.round(p.y + 1), 8, 3);
  drawCharacter(ctx, p.character, p.x, p.y + 2, { frame: bob, time });
}

export const filterRenderer: MinigameRenderer = {
  positions(raw) {
    return (raw as FilterState).players.filter((p) => p.status === 'alive').map((p) => [p.id, p.x, p.y - 4]);
  },

  render(ctx, raw, time, localId: PlayerId) {
    const st = raw as FilterState;
    drawWater(ctx, time);
    drawTiles(ctx, st, time);
    const order = [...st.players].sort((a, b) => a.y - b.y);
    for (const p of order) drawPlayer(ctx, p, time);
    const me = st.players.find((p) => p.id === localId);
    if (me && me.status === 'alive') localMarker(ctx, me.x, me.y - 11, time);

    // The influencer's call: filter name on its color, with a draining timer.
    const [name, color] = FILTERS[st.target];
    if (st.phase !== 'rise') {
      const w = 120;
      panel(ctx, ARENA_W / 2 - w / 2, 2, w, 22, 'rgba(10,6,20,0.9)', color);
      outlinedText(ctx, `#${name}`, ARENA_W / 2, 6, color, 8);
      if (st.phase === 'call') {
        const left = Math.max(0, 1 - st.phaseTime / st.callTime);
        ctx.fillStyle = PAL.ink;
        ctx.fillRect(ARENA_W / 2 - w / 2 + 4, 17, w - 8, 3);
        ctx.fillStyle = left < 0.3 ? PAL.red : color;
        ctx.fillRect(ARENA_W / 2 - w / 2 + 4, 17, Math.round((w - 8) * left), 3);
      } else {
        outlinedText(ctx, 'AFUNDOU!', ARENA_W / 2, 15, PAL.white, 8);
      }
    }
  },
};
