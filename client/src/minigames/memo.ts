import { ARENA_H, ARENA_W } from '@shared/arena';
import type { MemoState, MemoViewer } from '@shared/minigames/memo/logic';
import type { PlayerId } from '@shared/types';
import { PAL, outlinedText, panel, portrait, text } from '../core/draw';
import { ADS, drawProduct } from './ad';
import { arrow } from './mimic';
import type { MinigameRenderer } from './renderer';

const SLOT = 26;
const GAP = 6;

function background(ctx: CanvasRenderingContext2D, st: MemoState, time: number, tag: string): void {
  const ad = ADS[st.adIndex % ADS.length];
  for (let y = 0; y < ARENA_H; y += 8) {
    ctx.fillStyle = (y / 8) % 2 ? ad.bg[0] : ad.bg[1];
    ctx.fillRect(0, y, ARENA_W, 8);
  }
  for (let i = 0; i < 10; i++) {
    if ((Math.floor(time * 5) + i) % 3) continue;
    ctx.fillStyle = '#ffffff';
    const x = (i * 71) % ARENA_W;
    const y = 20 + ((i * 37) % 120);
    ctx.fillRect(x, y - 2, 1, 5);
    ctx.fillRect(x - 2, y, 5, 1);
  }
  panel(ctx, 4, 4, tag.length * 8 + 12, 12, PAL.ink, PAL.yellow);
  text(ctx, tag, 10, 6, PAL.yellow);
}

function timerBar(ctx: CanvasRenderingContext2D, y: number, left: number): void {
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(60, y, ARENA_W - 120, 4);
  ctx.fillStyle = left < 0.3 ? PAL.red : PAL.white;
  ctx.fillRect(60, y, Math.round((ARENA_W - 120) * left), 4);
}

/** A row of slots centered at cx; `fill(i)` returns what to draw in slot i. */
function slots(
  ctx: CanvasRenderingContext2D,
  cx: number,
  y: number,
  n: number,
  fill: (i: number) => { dir: number | null; color: string; bg: string; border: string; cross?: boolean },
): void {
  const total = n * SLOT + (n - 1) * GAP;
  const x0 = Math.round(cx - total / 2);
  for (let i = 0; i < n; i++) {
    const f = fill(i);
    const x = x0 + i * (SLOT + GAP);
    panel(ctx, x, y, SLOT, SLOT, f.bg, f.border);
    if (f.cross) {
      ctx.fillStyle = PAL.red;
      for (let k = 0; k < 14; k++) {
        ctx.fillRect(x + 6 + k, y + 6 + k, 2, 2);
        ctx.fillRect(x + SLOT - 8 - k, y + 6 + k, 2, 2);
      }
    } else if (f.dir !== null) {
      arrow(ctx, x + SLOT / 2, y + SLOT / 2, f.dir, 3, f.color);
    }
  }
}

function drawTell(ctx: CanvasRenderingContext2D, st: MemoState, time: number): void {
  const ad = ADS[st.adIndex % ADS.length];
  background(ctx, st, time, 'ANÚNCIO');
  drawProduct(ctx, ad.product, 46, 70, time);
  outlinedText(ctx, ad.lines[0], 232, 22, PAL.white, 8);
  panel(ctx, 92, 36, 280, 104, 'rgba(10,6,20,0.85)', PAL.yellow);
  text(ctx, 'PARA COMPRAR, DECORE O CÓDIGO:', 232, 44, PAL.yellow, 8, 'center');
  slots(ctx, 232, 64, st.sequence.length, (i) => ({ dir: st.sequence[i], color: '#2a4ae8', bg: '#fff4e0', border: PAL.ink }));
  text(ctx, `${st.sequence.length} MOVIMENTOS (WASD)`, 232, 100, PAL.white, 8, 'center');
  if (Math.floor(time * 4) % 2 === 0) text(ctx, 'NÃO ESQUEÇA!', 232, 120, PAL.pink, 8, 'center');
  timerBar(ctx, ARENA_H - 30, Math.max(0, 1 - st.time / st.window));
}

function viewerRow(ctx: CanvasRenderingContext2D, viewers: MemoViewer[], len: number, localId: PlayerId, y: number): void {
  const n = viewers.length;
  const w = 40;
  const x0 = Math.floor((ARENA_W - n * w) / 2);
  viewers.forEach((v, i) => {
    if (v.status === 'out') return;
    const x = x0 + i * w;
    portrait(ctx, v.character, x + 12, y, 1, v.status === 'fail');
    if (v.status === 'ok') text(ctx, 'OK', x + 20, y + 18, PAL.green, 8, 'center');
    else if (v.status === 'fail') text(ctx, 'X', x + 20, y + 18, PAL.red, 8, 'center');
    else {
      // progress pips: how many moves typed (not which)
      for (let k = 0; k < len; k++) {
        ctx.fillStyle = k < v.typed.length ? PAL.white : 'rgba(255,255,255,0.3)';
        ctx.fillRect(x + 20 - len * 2 + k * 4, y + 19, 3, 3);
      }
    }
    if (v.id === localId) {
      ctx.fillStyle = PAL.yellow;
      ctx.fillRect(x + 16, y - 4, 8, 2);
    }
  });
}

function drawDo(ctx: CanvasRenderingContext2D, st: MemoState, time: number, localId: PlayerId): void {
  const ad = ADS[(st.adIndex + 2) % ADS.length];
  background(ctx, st, time, 'COMPRA');
  // Checkout window.
  panel(ctx, 40, 20, 304, 120, '#f4f0fc', PAL.ink);
  ctx.fillStyle = '#2a4ae8';
  ctx.fillRect(41, 21, 302, 14);
  text(ctx, 'FINALIZAR COMPRA', 192, 24, PAL.white, 8, 'center', null);
  drawProduct(ctx, ad.product, 74, 48, time);
  text(ctx, ad.lines[0], 112, 46, PAL.ink, 8, 'left', null);
  text(ctx, 'R$ 99,90', 112, 58, PAL.red, 8, 'left', null);
  text(ctx, 'DIGITE O CÓDIGO DO ANÚNCIO:', 112, 72, '#5a5070', 8, 'left', null);

  const me = st.viewers.find((v) => v.id === localId);
  const n = st.sequence.length;
  const reveal = st.phase === 'result';
  slots(ctx, 192, 86, n, (i) => {
    const typed = me?.typed[i];
    if (typed !== undefined) {
      const right = typed === st.sequence[i];
      return right
        ? { dir: typed, color: '#1a8a3a', bg: '#d8ffd8', border: PAL.green }
        : { dir: null, color: PAL.red, bg: '#ffd8dc', border: PAL.red, cross: true };
    }
    if (reveal) return { dir: st.sequence[i], color: '#9a6a0a', bg: '#fff4c0', border: PAL.yellow };
    return { dir: null, color: PAL.ink, bg: '#e8e4f4', border: '#8a80a8' };
  });

  if (st.phase === 'show') {
    if (me?.status === 'fail' && Math.floor(time * 6) % 2 === 0) outlinedText(ctx, 'CÓDIGO INVÁLIDO!', 192, 122, PAL.red, 8, 'center', '#f4f0fc');
    else if (me?.status === 'ok') outlinedText(ctx, 'COMPRA APROVADA!', 192, 122, PAL.green, 8, 'center', '#f4f0fc');
    timerBar(ctx, 146, Math.max(0, 1 - st.time / st.window));
  } else if (me && (me.status === 'ok' || me.status === 'fail')) {
    outlinedText(ctx, me.status === 'ok' ? 'COMPRA APROVADA!' : 'ESQUECEU! -1', 192, 122, me.status === 'ok' ? PAL.green : PAL.red, 8, 'center', '#f4f0fc');
  }
  viewerRow(ctx, st.viewers, n, localId, 156);
}

export const memoRenderer: MinigameRenderer = {
  render(ctx, raw, time, localId: PlayerId) {
    const st = raw as MemoState;
    if (st.mode === 'tell') drawTell(ctx, st, time);
    else drawDo(ctx, st, time, localId);
  },
};
