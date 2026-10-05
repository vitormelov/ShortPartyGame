import { ARENA_H, ARENA_W } from '@shared/arena';
import { BRICK, COLS, PU_BOMB, PU_NONE, ROWS, WALL, type BPlayer, type BombState } from '@shared/minigames/bomb/logic';
import { CHARACTERS, type PlayerId } from '@shared/types';
import { PAL, sprite, text } from '../core/draw';
import { localMarker, type MinigameRenderer } from './renderer';

const T = 15;
const OX = Math.floor((ARENA_W - COLS * T) / 2);
const OY = Math.floor((ARENA_H - ROWS * T) / 2);

const BOMBER = [
  '...kkkkkk...',
  '..kwwwwwwk..',
  '.kwwwwwwwwk.',
  '.kwkkkkkkwk.',
  '.kwsbssbswk.',
  '.kwsssssswk.',
  '..kkkkkkkk..',
  '.kcccccccck.',
  'kwkccLLcckwk',
  '.kkccccccKk.',
  '..kKKKKKKk..',
  '..kKk..kKk..',
  '.kKKk..kKKk.',
  '.kkkk..kkkk.',
];

const BOMBER_WALK = [...BOMBER.slice(0, 11), '..kKk.kKk...', '.kKKk.kKKk..', '.kkkk.kkkk..'];

function drawTile(ctx: CanvasRenderingContext2D, kind: number, x: number, y: number): void {
  if (kind === WALL) {
    ctx.fillStyle = '#3a3658';
    ctx.fillRect(x, y, T, T);
    ctx.fillStyle = '#8a86b0';
    ctx.fillRect(x, y, T - 1, T - 1);
    ctx.fillStyle = '#c8c4e8';
    ctx.fillRect(x, y, T - 1, 2);
    ctx.fillRect(x, y, 2, T - 1);
    ctx.fillStyle = '#5a5680';
    ctx.fillRect(x + 4, y + 4, T - 8, T - 8);
  } else if (kind === BRICK) {
    ctx.fillStyle = '#6a2e14';
    ctx.fillRect(x, y, T, T);
    ctx.fillStyle = '#c8682e';
    for (let row = 0; row < 3; row++) {
      const off = row % 2 === 0 ? 0 : 4;
      for (let bx = -off; bx < T; bx += 8) {
        const sx = Math.max(x, x + bx);
        const ex = Math.min(x + T, x + bx + 7);
        ctx.fillRect(sx, y + row * 5, ex - sx, 4);
      }
    }
    ctx.fillStyle = '#e89a5a';
    ctx.fillRect(x, y, T - 1, 1);
  } else {
    ctx.fillStyle = ((x - OX) / T + (y - OY) / T) % 2 === 0 ? '#3c9a44' : '#36903e';
    ctx.fillRect(x, y, T, T);
  }
}

function drawPowerup(ctx: CanvasRenderingContext2D, kind: number, x: number, y: number, time: number): void {
  ctx.fillStyle = Math.floor(time * 6) % 2 ? '#ffd23e' : '#ff5ac8';
  ctx.fillRect(x + 2, y + 2, T - 4, T - 4);
  ctx.fillStyle = '#24163f';
  ctx.fillRect(x + 3, y + 3, T - 6, T - 6);
  if (kind === PU_BOMB) {
    ctx.fillStyle = '#0a0614';
    ctx.fillRect(x + 5, y + 6, 5, 5);
    ctx.fillStyle = '#fff4e0';
    ctx.fillRect(x + 6, y + 7, 1, 1);
    ctx.fillStyle = '#ffd23e';
    ctx.fillRect(x + 9, y + 4, 1, 2);
  } else {
    ctx.fillStyle = '#ff6a1e';
    ctx.fillRect(x + 5, y + 6, 5, 5);
    ctx.fillRect(x + 6, y + 4, 3, 2);
    ctx.fillStyle = '#ffe85a';
    ctx.fillRect(x + 6, y + 8, 3, 3);
  }
}

function drawPlayer(ctx: CanvasRenderingContext2D, p: BPlayer, time: number): void {
  if (p.status === 'out' || (p.status === 'dead' && p.deathAnim <= 0)) return;
  if (p.ghost > 0 && Math.floor(time * 16) % 2 === 0) return;
  const ch = CHARACTERS[p.character];
  const px = OX + p.x * T - 6;
  const py = OY + p.y * T - 11;
  const dying = p.status === 'dead';
  const flash = dying && Math.floor(time * 20) % 2 === 0;
  const back = p.facing === 1;
  const colors: Record<string, string> = flash
    ? { k: '#ffffff', w: '#ffffff', s: '#ffffff', b: '#ffffff', c: '#ffffff', L: '#ffffff', K: '#ffffff' }
    : {
        k: PAL.ink,
        w: '#f4f0ff',
        s: back ? '#f4f0ff' : '#ffc89a',
        b: back ? '#f4f0ff' : PAL.ink,
        c: ch.color,
        L: ch.light,
        K: ch.dark,
      };
  const walking = p.walk > 0 && Math.floor(p.walk * 8) % 2 === 1;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(Math.round(px + 2), Math.round(py + 12), 8, 3);
  const rows = walking ? BOMBER_WALK : BOMBER;
  if (dying) {
    const s = p.deathAnim / 0.6;
    ctx.save();
    ctx.translate(Math.round(px + 6), Math.round(py + 14));
    ctx.scale(1 + (1 - s) * 0.6, s);
    sprite(ctx, rows, -6, -14, colors, 1, p.facing === 2);
    ctx.restore();
    return;
  }
  sprite(ctx, rows, px, py, colors, 1, p.facing === 2);
}

export const bombRenderer: MinigameRenderer = {
  render(ctx, raw, time, localId: PlayerId) {
    const st = raw as BombState;

    ctx.fillStyle = '#1a3a22';
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);
    for (let y = 0; y < ARENA_H; y += 4) {
      ctx.fillStyle = y % 8 === 0 ? '#1e4428' : '#183620';
      ctx.fillRect(0, y, ARENA_W, 2);
    }

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        const x = OX + c * T;
        const y = OY + r * T;
        drawTile(ctx, st.grid[i], x, y);
        // Shadow cast by the block above.
        if (st.grid[i] === 0 && r > 0 && st.grid[i - COLS] !== 0) {
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          ctx.fillRect(x, y, T, 3);
        }
        if (st.grid[i] === 0 && st.powerups[i] !== PU_NONE) drawPowerup(ctx, st.powerups[i], x, y, time);
      }
    }

    for (const b of st.bombs) {
      const x = OX + b.c * T + T / 2;
      const y = OY + b.r * T + T / 2;
      const pulse = Math.sin(time * (b.fuse < 0.8 ? 30 : 10)) > 0 ? 1 : 0;
      const rad = 5 + pulse;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(Math.round(x - 4), Math.round(y + 4), 9, 3);
      ctx.fillStyle = b.fuse < 0.8 && pulse ? '#ff3b5c' : b.ad ? '#c8268a' : '#0a0614';
      ctx.beginPath();
      ctx.arc(Math.round(x), Math.round(y + 1), rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = b.ad ? '#ffaaee' : '#4a4466';
      ctx.fillRect(Math.round(x - 3), Math.round(y - 2), 2, 2);
      if (b.ad) text(ctx, 'AD', x - 7, y - 16, PAL.pink);
      ctx.fillStyle = '#8a6a3a';
      ctx.fillRect(Math.round(x + 2), Math.round(y - 6), 1, 3);
      ctx.fillStyle = Math.floor(time * 24) % 2 ? '#ffd23e' : '#ff6a1e';
      ctx.fillRect(Math.round(x + 2), Math.round(y - 8), 2, 2);
    }

    for (let i = 0; i < st.flames.length; i++) {
      const f = st.flames[i];
      if (f <= 0) continue;
      const x = OX + (i % COLS) * T;
      const y = OY + Math.floor(i / COLS) * T;
      const inset = Math.floor((1 - f / 0.5) * 4);
      ctx.fillStyle = '#ff3b1e';
      ctx.fillRect(x + inset, y + inset, T - inset * 2, T - inset * 2);
      ctx.fillStyle = '#ff9a1e';
      ctx.fillRect(x + inset + 2, y + inset + 2, T - inset * 2 - 4, T - inset * 2 - 4);
      ctx.fillStyle = '#fff07a';
      ctx.fillRect(x + inset + 4, y + inset + 4, Math.max(1, T - inset * 2 - 8), Math.max(1, T - inset * 2 - 8));
    }

    const players = [...st.players].sort((a, b) => a.y - b.y);
    for (const p of players) drawPlayer(ctx, p, time);

    const me = st.players.find((p) => p.id === localId);
    if (me && me.status === 'alive') {
      localMarker(ctx, OX + me.x * T, OY + me.y * T - 12, time);
      // Side panel with the local player's power-ups.
      text(ctx, 'BOMBA', 2, 70, PAL.white);
      text(ctx, `x${me.maxBombs}`, 10, 80, PAL.yellow);
      text(ctx, 'FOGO', 6, 100, PAL.white);
      text(ctx, `x${me.range}`, 10, 110, PAL.yellow);
    }
  },
};
