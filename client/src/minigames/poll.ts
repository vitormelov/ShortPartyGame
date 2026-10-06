import { ARENA_H, ARENA_W } from '@shared/arena';
import { POLL_COLS, VOTE_TIME, type PollKind, type PollState } from '@shared/minigames/poll/logic';
import { CHARACTERS, type PlayerId } from '@shared/types';
import { PAL, outlinedText, panel, portrait, text } from '../core/draw';
import type { MinigameRenderer } from './renderer';

const QUESTIONS: Record<PollKind, [string, string]> = {
  gift: ['QUEM MERECE UM PRESENTE?', 'O MAIS VOTADO GANHA +1 VIDA'],
  spotlight: ['QUEM É O MAIS SEGUIDO?', 'VAI PRO HOLOFOTE NOS PRÓXIMOS CLIPES'],
  bet: ['QUEM VAI MORRER PRIMEIRO?', 'QUEM ACERTAR GANHA +1 VIDA'],
};

const CARD_W = 76;
const CARD_H = 50;
const GAP = 8;
const X0 = Math.round((ARENA_W - (POLL_COLS * CARD_W + (POLL_COLS - 1) * GAP)) / 2);
const Y0 = 44;
const ROW_GAP = 4;

function cardPos(i: number): [number, number] {
  return [X0 + (i % POLL_COLS) * (CARD_W + GAP), Y0 + Math.floor(i / POLL_COLS) * (CARD_H + ROW_GAP)];
}

function background(ctx: CanvasRenderingContext2D, time: number): void {
  const bands = ['#5a1a8a', '#7a2a9a', '#a03aa8', '#c84aa8', '#e85a9a', '#ff7a8a'];
  const bh = ARENA_H / bands.length;
  bands.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(0, Math.floor(i * bh), ARENA_W, Math.ceil(bh));
  });
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  for (let i = 0; i < 12; i++) {
    const x = (i * 53 + Math.floor(time * 20)) % ARENA_W;
    ctx.fillRect(x, (i * 29) % ARENA_H, 2, 2);
  }
}

export const pollRenderer: MinigameRenderer = {
  render(ctx, raw, time, localId: PlayerId) {
    drawPoll(ctx, raw as PollState, time, localId, true);
  },
};

/** Where a candidate's card is (the 3D version stands the characters in them). */
export function pollCard(i: number): [number, number, number, number] {
  return [...cardPos(i), CARD_W, CARD_H];
}

/** The whole poll; without `portraits` the cards are left for the 3D characters. */
export function drawPoll(ctx: CanvasRenderingContext2D, st: PollState, time: number, localId: PlayerId, portraits: boolean): void {
    background(ctx, time);

    // Story poll sticker.
    const [q, sub] = QUESTIONS[st.kind];
    panel(ctx, 42, 4, 300, 34, '#ffffff', PAL.ink);
    text(ctx, 'ENQUETE', 192, 7, '#a03aa8', 8, 'center', null);
    outlinedText(ctx, q, 192, 17, PAL.ink, 8, 'center', '#ffffff');
    text(ctx, sub, 192, 28, '#8a80a8', 8, 'center', null);

    const reveal = st.phase === 'reveal';
    const me = st.voters.find((v) => v.id === localId);
    st.candidates.forEach((c, i) => {
      const [x, y] = cardPos(i);
      const self = c.id === localId;
      const mine = me && me.cursor === i;
      const winner = reveal && st.winners.includes(c.id);
      const border = winner ? (Math.floor(time * 8) % 2 ? PAL.yellow : '#ffffff') : mine ? PAL.yellow : PAL.ink;
      panel(ctx, x, y, CARD_W, CARD_H, self ? '#c8b8d8' : '#fff4fa', border);
      if (mine && !reveal) {
        ctx.strokeStyle = PAL.yellow;
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 2, y - 2, CARD_W + 4, CARD_H + 4);
      }
      if (portraits) portrait(ctx, c.character, x + CARD_W / 2 - 16, y + 2, 2, self);
      text(ctx, self ? 'VOCÊ' : CHARACTERS[c.character].name, x + CARD_W / 2, y + 36, self ? '#8a80a8' : CHARACTERS[c.character].dark, 8, 'center', null);
      if (winner) {
        // crown
        ctx.fillStyle = PAL.yellow;
        ctx.fillRect(x + CARD_W / 2 - 8, y - 6, 16, 4);
        ctx.fillRect(x + CARD_W / 2 - 8, y - 9, 2, 3);
        ctx.fillRect(x + CARD_W / 2 - 1, y - 10, 2, 4);
        ctx.fillRect(x + CARD_W / 2 + 6, y - 9, 2, 3);
      }
      if (reveal) {
        const n = st.tally[i] ?? 0;
        panel(ctx, x + CARD_W - 18, y + 2, 16, 14, n > 0 ? PAL.pink : '#e8e0f0', PAL.ink);
        text(ctx, `${n}`, x + CARD_W - 10, y + 5, n > 0 ? PAL.white : '#8a80a8', 8, 'center', null);
      }
    });

    // Everyone's cursor, live: little squares in the voter's color beside the portrait
    // (up to 4 on the left, 4 on the right).
    const slots = new Map<number, number>();
    for (const v of st.voters) {
      if (v.cursor < 0 || v.status === 'out') continue;
      const k = slots.get(v.cursor) ?? 0;
      slots.set(v.cursor, k + 1);
      const [x, y] = cardPos(v.cursor);
      const side = k < 4 ? 0 : 1;
      const kk = k % 4;
      const mx = x + (side === 0 ? 3 : CARD_W - 21) + (kk % 2) * 9;
      const my = y + 4 + Math.floor(kk / 2) * 9;
      if (!v.locked && !reveal && Math.floor(time * 6) % 2 === 0) continue;
      ctx.fillStyle = v.locked || reveal ? '#ffffff' : PAL.ink;
      ctx.fillRect(mx - 1, my - 1, 8, 8);
      ctx.fillStyle = CHARACTERS[v.character].color;
      ctx.fillRect(mx, my, 6, 6);
    }

    if (!reveal) {
      const left = Math.max(0, 1 - st.time / VOTE_TIME);
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(40, ARENA_H - 30, ARENA_W - 80, 4);
      ctx.fillStyle = left < 0.3 ? PAL.red : PAL.white;
      ctx.fillRect(40, ARENA_H - 30, Math.round((ARENA_W - 80) * left), 4);
      if (me && me.cursor === -1 && Math.floor(time * 4) % 2 === 0) outlinedText(ctx, 'ESCOLHA ALGUÉM!', 192, ARENA_H - 44, PAL.yellow, 8);
      else if (me?.locked) outlinedText(ctx, 'VOTO CONFIRMADO', 192, ARENA_H - 44, PAL.green, 8);
    } else {
      const names = st.winners.map((id) => CHARACTERS[st.candidates.find((c) => c.id === id)!.character].name).join(', ');
      const msg = st.winners.length === 0 ? 'NINGUÉM VOTOU' : st.kind === 'gift' ? `${names} +1 VIDA!` : st.kind === 'spotlight' ? `${names} NO HOLOFOTE!` : 'APOSTAS FEITAS!';
      outlinedText(ctx, msg, 192, ARENA_H - 40, PAL.yellow, 8);
    }
}
