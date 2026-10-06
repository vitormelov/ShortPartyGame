import { ARENA_H, ARENA_W } from '@shared/arena';
import { RESULT_TIME, TURN_TIME, type Dir, type LookState } from '@shared/minigames/look/logic';
import { type PlayerId } from '@shared/types';
import { BRAND, PAL, outlinedText, text } from '../core/draw';
import { hash, type MinigameRenderer } from './renderer';
import { drawCharacter } from '../core/cast';

export const DIR_VEC: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
export const KEY = ['W', 'D', 'S', 'A'];
const ROW_Y = 146;

/** Pixel arrow pointing in a direction, centered on (x, y). */
export function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, dir: Dir, size: number, color: string): void {
  const [vx, vy] = DIR_VEC[dir];
  ctx.fillStyle = color;
  for (let k = 0; k < size; k++) {
    // Rows of the head, widest at the base.
    const half = size - 1 - k;
    const along = k - Math.floor(size / 2);
    if (vx === 0) ctx.fillRect(Math.round(x - half), Math.round(y + along * vy), half * 2 + 1, 1);
    else ctx.fillRect(Math.round(x + along * vx), Math.round(y - half), 1, half * 2 + 1);
  }
  // Shaft.
  const t = Math.max(1, Math.floor(size / 3));
  if (vx === 0) ctx.fillRect(Math.round(x - t / 2), Math.round(vy < 0 ? y + size / 2 : y - size / 2 - size), t, size);
  else ctx.fillRect(Math.round(vx < 0 ? x + size / 2 : x - size / 2 - size), Math.round(y - t / 2), size, t);
}

/** The big hater head; pupils show where it's looking (-1 = straight at you). */
function drawHater(ctx: CanvasRenderingContext2D, x: number, y: number, look: Dir | -1, time: number, angry: boolean): void {
  const s = 4;
  const bob = Math.floor(time * 3) % 2;
  y += bob;
  // Head.
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(x - 13 * s / 2, y - 2, 13 * s, 12 * s + 4);
  ctx.fillRect(x - 15 * s / 2, y + 2 * s, 15 * s, 8 * s);
  ctx.fillStyle = angry ? '#ff3b3b' : '#e83b3b';
  ctx.fillRect(x - 12 * s / 2, y, 12 * s, 12 * s);
  ctx.fillRect(x - 14 * s / 2, y + 2 * s, 14 * s, 8 * s);
  ctx.fillStyle = '#8a1a2a';
  ctx.fillRect(x - 12 * s / 2, y + 11 * s, 12 * s, s);
  // Horns.
  ctx.fillStyle = '#2a0a14';
  ctx.fillRect(x - 6 * s, y - 3 * s, 2 * s, 3 * s);
  ctx.fillRect(x + 4 * s, y - 3 * s, 2 * s, 3 * s);
  // Eyes.
  const [vx, vy] = look === -1 ? [0, 0] : DIR_VEC[look];
  for (const ex of [x - 3.5 * s, x + 3.5 * s]) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(Math.round(ex - 2 * s), y + 3 * s, 4 * s, 4 * s);
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(Math.round(ex - s + vx * s), Math.round(y + 4 * s + vy * s), 2 * s, 2 * s);
  }
  // Brows and mouth.
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(x - 6 * s, y + 2 * s, 4 * s, s);
  ctx.fillRect(x + 2 * s, y + 2 * s, 4 * s, s);
  ctx.fillRect(x - 3 * s, y + 9 * s, 6 * s, s);
  if (angry) ctx.fillRect(x - 2 * s, y + 8 * s, 4 * s, s);
}

export const lookRenderer: MinigameRenderer = {
  positions(raw) {
    const st = raw as LookState;
    const n = st.lookers.length;
    return st.lookers.filter((l) => l.status === 'alive').map((l) => [l.id, slotX(st.lookers.indexOf(l), n), ROW_Y - 6]);
  },

  render(ctx, raw, time, localId: PlayerId) {
    const st = raw as LookState;
    // Spotlit stage.
    ctx.fillStyle = BRAND.roxo;
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = '#2a1a44';
      ctx.fillRect(Math.floor(hash(i) * ARENA_W), Math.floor(hash(i + 40) * 120), 1, 1);
    }
    ctx.fillStyle = 'rgba(255,230,180,0.07)';
    ctx.beginPath();
    ctx.moveTo(ARENA_W / 2 - 20, 0);
    ctx.lineTo(ARENA_W / 2 + 20, 0);
    ctx.lineTo(ARENA_W / 2 + 70, 100);
    ctx.lineTo(ARENA_W / 2 - 70, 100);
    ctx.fill();
    ctx.fillStyle = '#24163f';
    ctx.fillRect(0, ROW_Y, ARENA_W, ARENA_H - ROW_Y);
    ctx.fillStyle = '#3a2766';
    ctx.fillRect(0, ROW_Y, ARENA_W, 2);

    // Hater: stares at you while you choose, spins its eyes, then commits.
    const hx = ARENA_W / 2;
    const hy = 40;
    let look: Dir | -1 = -1;
    if (st.phase === 'turn') look = st.phaseTime < TURN_TIME * 0.7 ? ((Math.floor(st.phaseTime * 14) % 4) as Dir) : st.haterDir;
    else if (st.phase === 'result') look = st.haterDir;
    drawHater(ctx, hx, hy, look, time, st.phase === 'result');
    if (st.phase === 'result') {
      const [vx, vy] = DIR_VEC[st.haterDir];
      const pulse = Math.floor(time * 8) % 2;
      arrow(ctx, hx + vx * 52, hy + 24 + vy * 40, st.haterDir, 9 + pulse, PAL.red);
    }

    const me = st.lookers.find((l) => l.id === localId);
    if (st.phase === 'choose') {
      const left = Math.max(0, Math.ceil(st.chooseTime - st.phaseTime));
      outlinedText(ctx, `${left}`, 40, 30, left <= 1 ? PAL.red : PAL.yellow, 32);
      outlinedText(ctx, 'NÃO OLHE!', ARENA_W - 64, 36, PAL.white, 8);
      if (me && me.status === 'alive') {
        text(ctx, me.choice === -1 ? 'ESCOLHA: WASD' : `VOCÊ: ${KEY[me.choice]}`, ARENA_W - 64, 52, me.choice === -1 ? PAL.grey : PAL.cyan, 8, 'center');
      }
    }

    // The row of players.
    const n = st.lookers.length;
    st.lookers.forEach((l, i) => {
      if (l.status === 'out') return;
      const x = slotX(i, n);
      const caught = l.result === 'caught';
      const flash = caught && Math.floor(time * 10) % 2 === 0;
      const hop = caught ? 0 : st.phase === 'result' && l.result === 'safe' ? Math.abs(Math.sin(time * 10)) * 3 : 0;
      ctx.fillStyle = 'rgba(20,6,46,0.4)';
      ctx.fillRect(x - 4, ROW_Y - 1, 8, 2);
      drawCharacter(ctx, l.character, x, ROW_Y - hop, { flash, time, pose: caught ? 'lose' : hop > 0 ? 'win' : 'idle' });
      const mine = l.id === localId;
      const ay = ROW_Y - 22;
      if (st.phase === 'choose') {
        if (mine && l.choice !== -1) arrow(ctx, x, ay, l.choice, 5, PAL.cyan);
        else if (!mine) text(ctx, l.choice === -1 ? '...' : '?', x + 1, ay - 4, l.choice === -1 ? PAL.grey : PAL.yellow, 8, 'center');
      } else if (l.choice !== -1) {
        arrow(ctx, x, ay, l.choice, 5, caught ? PAL.red : PAL.green);
        if (l.random) text(ctx, '?', x + 8, ay - 10, PAL.grey, 8, 'center');
        if (st.phase === 'result') text(ctx, caught ? '-1' : 'OK', x + 1, ROW_Y + 8, caught ? PAL.red : PAL.green, 8, 'center');
      }
      if (mine) {
        ctx.fillStyle = PAL.yellow;
        ctx.fillRect(x - 6, ROW_Y + 3, 13, 2);
      }
    });

    if (st.phase === 'result' && me && me.result) {
      const t = Math.min(1, st.phaseTime / (RESULT_TIME * 0.3));
      outlinedText(ctx, me.result === 'caught' ? 'TE PEGOU! -1' : 'ESCAPOU!', 64, 40 + (1 - t) * 6, me.result === 'caught' ? PAL.red : PAL.green, 8);
    }
  },
};

export function slotX(i: number, n: number): number {
  const span = Math.min(300, (n - 1) * 44);
  return Math.round(ARENA_W / 2 - span / 2 + (n > 1 ? (i * span) / (n - 1) : 0));
}
