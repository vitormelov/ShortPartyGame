import { ARENA_H, ARENA_W } from '@shared/arena';
import { COUNT_TIME, REVEAL_STEP, RESULT_TIME, revealTime, type CountState, type CrowdKind } from '@shared/minigames/count/logic';
import type { PlayerId } from '@shared/types';
import { PAL, outlinedText, panel, portrait, sprite, text } from '../core/draw';
import type { MinigameRenderer } from './renderer';

const HATER = [
  '...kkkkk...',
  '.kkcccccKk.',
  'kccccccccKk',
  'kcbbcccbbck',
  'kccwbcbwcck',
  'kccwkckwcck',
  'kccccccccck',
  'kcccckkccck',
  '.kcckcckcK.',
  '..kkccckk..',
  '....kkk....',
];
const FAN = ['.kk...kk.', 'kppk.kppk', 'kpwppppk.', 'kppppppk.', '.kppppk..', '..kppk...', '...kk....'];

const HATER_COLORS: Record<Exclude<CrowdKind, 'fan'>, [string, string]> = {
  red: ['#e83b3b', '#8a1a2a'],
  blue: ['#3b6ee8', '#1a2a8a'],
  purple: ['#9a5af2', '#4a1a8a'],
};

const QUESTION: Record<CountState['question'], string> = {
  all: 'QUANTOS HATERS? (TODAS AS CORES)',
  red: 'QUANTOS HATERS VERMELHOS?',
  fans: 'QUANTOS HATERS? (NÃO CONTE OS FÃS)',
};

function drawThing(ctx: CanvasRenderingContext2D, kind: CrowdKind, x: number, y: number, bob: number): void {
  if (kind === 'fan') {
    sprite(ctx, FAN, x - 4, y - 4 - bob, { k: PAL.ink, p: '#ff8ad8', w: '#ffffff' });
    return;
  }
  const [c, K] = HATER_COLORS[kind];
  sprite(ctx, HATER, x - 5, y - 5 - bob, { k: PAL.ink, c, K, b: '#1a0a14', w: '#ffffff' });
}

function background(ctx: CanvasRenderingContext2D, time: number): void {
  ctx.fillStyle = '#100a20';
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);
  // Scrolling "comment section" lines.
  const off = Math.floor(time * 12) % 14;
  for (let y = -off; y < ARENA_H; y += 14) {
    ctx.fillStyle = '#1a1232';
    ctx.fillRect(16, y, 10, 10);
    ctx.fillRect(32, y + 2, 120 + ((y * 7) % 90), 2);
    ctx.fillRect(32, y + 6, 60 + ((y * 13) % 70), 2);
  }
}

export const countRenderer: MinigameRenderer = {
  render(ctx, raw, time, localId: PlayerId) {
    const st = raw as CountState;
    background(ctx, time);
    const me = st.counters.find((c) => c.id === localId);

    // The question is always on screen (works with tutorials off too).
    panel(ctx, 40, 4, ARENA_W - 80, 16, 'rgba(10,6,20,0.9)', PAL.pink);
    text(ctx, QUESTION[st.question], ARENA_W / 2, 8, st.question === 'all' ? PAL.cyan : PAL.yellow, 8, 'center');

    if (st.phase === 'count') {
      st.walkers.forEach((w, i) => drawThing(ctx, w.kind, w.x, w.y, Math.floor(time * 6 + i) % 2));
      // Timer.
      const left = Math.max(0, 1 - st.phaseTime / COUNT_TIME);
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(40, 22, ARENA_W - 80, 3);
      ctx.fillStyle = left < 0.25 ? PAL.red : PAL.white;
      ctx.fillRect(40, 22, Math.round((ARENA_W - 80) * left), 3);
      // Your counter (only yours is visible).
      if (me && me.status === 'alive') {
        panel(ctx, 192 - 46, ARENA_H - 50, 92, 46, PAL.ink, me.locked ? PAL.green : PAL.yellow);
        text(ctx, 'SEU PALPITE', 192, ARENA_H - 46, PAL.grey, 8, 'center');
        outlinedText(ctx, `${me.guess}`, 192, ARENA_H - 35, me.locked ? PAL.green : PAL.white, 16);
        text(ctx, me.locked ? 'CONFIRMADO' : 'W+ S-', 192, ARENA_H - 15, me.locked ? PAL.green : PAL.grey, 8, 'center');
      }
      const locked = st.counters.filter((c) => c.locked).length;
      if (locked) text(ctx, `${locked} CONFIRMARAM`, 60, ARENA_H - 30, PAL.grey, 8, 'center');
      return;
    }

    // Reveal: the counted ones line up one at a time, then everyone's guess.
    const targets = st.walkers.filter((w) => w.counts);
    const step = Math.min(REVEAL_STEP, 1.6 / Math.max(1, targets.length));
    const shown = Math.min(targets.length, Math.floor(st.phaseTime / step) + 1);
    const cols = 14;
    const x0 = 192 - (cols * 18) / 2 + 9;
    targets.slice(0, shown).forEach((w, i) => drawThing(ctx, w.kind, x0 + (i % cols) * 18, 60 + Math.floor(i / cols) * 18, 0));
    outlinedText(ctx, `${shown}`, 192, 24, PAL.yellow, 32);

    const resultsAt = revealTime(st.answer) - RESULT_TIME;
    if (st.phaseTime < resultsAt) return;
    const n = st.counters.length;
    const w = 40;
    const rx0 = Math.floor((ARENA_W - 24 - n * w) / 2);
    st.counters.forEach((c, i) => {
      if (c.status === 'out') return;
      const x = rx0 + i * w;
      const y = 104;
      portrait(ctx, c.character, x + 12, y, 1, c.result === 'fail');
      outlinedText(ctx, `${c.guess}`, x + 20, y + 19, PAL.white, 8);
      const [label, color] =
        c.result === 'best' ? ['+1', PAL.green] : c.result === 'exact' ? ['EXATO', PAL.yellow] : c.result === 'ok' ? ['OK', PAL.green] : ['-1', PAL.red];
      text(ctx, label, x + 20, y + 30, color, 8, 'center');
      if (c.id === localId) {
        ctx.fillStyle = PAL.yellow;
        ctx.fillRect(x + 16, y - 4, 8, 2);
      }
    });
    if (me && me.result) {
      const msg = me.result === 'best' ? 'CONTOU CERTINHO! +1' : me.result === 'exact' ? 'EXATO!' : me.result === 'ok' ? 'QUASE! SALVO' : `ERA ${st.answer}! -1`;
      outlinedText(ctx, msg, 192, 150, me.result === 'fail' ? PAL.red : PAL.green, 8);
    }
  },
};
