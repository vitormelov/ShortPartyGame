import { ARENA_H, ARENA_W } from '@shared/arena';
import {
  KEY_SPACE,
  PONG,
  QD_ROUND_END,
  SPIN_TIME,
  SWORD_MOVES,
  wheelAngle,
  type DuelKind,
  type DuelState,
} from '@shared/minigames/duel/logic';
import { CHARACTERS, type PlayerId } from '@shared/types';
import { PAL, outlinedText, panel, portrait, sprite, text } from '../core/draw';
import { BLOB } from './meteor';
import { arrow } from './mimic';
import { hash, type MinigameRenderer } from './renderer';

const KIND_NAME: Record<DuelKind, string> = { quickdraw: 'QUICK DRAW', sword: 'DUELO DE ESPADAS', pong: 'PONG' };
const KIND_HINT: Record<DuelKind, string> = {
  quickdraw: 'APERTE A TECLA QUE APARECER NO "JÁ!"',
  sword: 'NO "JÁ!" FAÇA A SEQUÊNCIA DE 8 TECLAS',
  pong: 'W/S MOVE A RAQUETE  1 PONTO',
};
const WHEEL = { x: ARENA_W / 2, y: 106, r: 78 };

const colorsOf = (character: number, flash = false) => {
  const ch = CHARACTERS[character];
  return flash
    ? { k: '#ffffff', c: '#ffffff', L: '#ffffff', K: '#ffffff', w: '#ffffff' }
    : { k: PAL.ink, c: ch.color, L: ch.light, K: ch.dark, w: '#ffffff' };
};

function nameOf(st: DuelState, idx: number): string {
  return CHARACTERS[st.candidates[idx].character].name;
}

function studio(ctx: CanvasRenderingContext2D, time: number): void {
  for (let y = 0; y < ARENA_H; y += 6) {
    ctx.fillStyle = (y / 6) % 2 ? '#1a0a2a' : '#200c34';
    ctx.fillRect(0, y, ARENA_W, 6);
  }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const [x, ph] of [
    [70, 0],
    [314, 2],
  ]) {
    const sx = x + Math.sin(time * 1.5 + ph) * 30;
    ctx.fillStyle = 'rgba(255,90,200,0.07)';
    ctx.beginPath();
    ctx.moveTo(x - 6, 0);
    ctx.lineTo(x + 6, 0);
    ctx.lineTo(sx + 36, ARENA_H);
    ctx.lineTo(sx - 36, ARENA_H);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  const live = Math.floor(time * 2) % 2 === 0;
  panel(ctx, 6, 6, 66, 13, live ? PAL.red : '#8a1a2a', PAL.ink);
  text(ctx, 'AO VIVO', 39, 9, PAL.white, 8, 'center', null);
}

/** Key cap: an arrow (0 W, 1 D, 2 S, 3 A) or the Space bar. */
function keyCap(ctx: CanvasRenderingContext2D, k: number, cx: number, cy: number, size: number, fill: string, border: string, ink: string): void {
  const w = k === KEY_SPACE ? size * 2.6 : size;
  panel(ctx, Math.round(cx - w / 2), Math.round(cy - size / 2), Math.round(w), size, fill, border);
  if (k === KEY_SPACE) text(ctx, 'ESPAÇO', cx, cy - 4, ink, 8, 'center', null);
  else arrow(ctx, cx, cy + 1, k, Math.max(1, Math.floor(size / 9)), ink);
}

// ---------- Roda a Roda ----------

function drawWheel(ctx: CanvasRenderingContext2D, st: DuelState, time: number): void {
  studio(ctx, time);
  const t = st.phaseTime;
  const rot = wheelAngle(st, t);
  const stopped = t >= SPIN_TIME;
  const { x, y, r } = WHEEL;

  // Frame + bulbs.
  ctx.fillStyle = PAL.ink;
  ctx.beginPath();
  ctx.arc(x, y, r + 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c8962e';
  ctx.beginPath();
  ctx.arc(x, y, r + 5, 0, Math.PI * 2);
  ctx.fill();
  for (let k = 0; k < 20; k++) {
    const a = (k / 20) * Math.PI * 2;
    const on = (k + Math.floor(time * (stopped ? 6 : 12))) % 2 === 0;
    ctx.fillStyle = on ? '#fff8c0' : '#8a5a1a';
    ctx.fillRect(Math.round(x + Math.cos(a) * (r + 3)) - 1, Math.round(y + Math.sin(a) * (r + 3)) - 1, 3, 3);
  }

  // Slices.
  for (const s of st.wheel) {
    const ch = CHARACTERS[st.candidates[s.candidate].character];
    const a0 = rot + s.start;
    const a1 = a0 + s.size;
    const chosen = stopped && (s.candidate === st.a || s.candidate === st.b);
    const flash = chosen && Math.floor(time * 8) % 2 === 0;
    ctx.fillStyle = flash ? '#ffffff' : ch.color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, r, a0, a1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = flash ? '#fff4c0' : ch.dark;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, r * 0.38, a0, a1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = PAL.ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r);
    ctx.stroke();
    const mid = (a0 + a1) / 2;
    portrait(ctx, st.candidates[s.candidate].character, x + Math.cos(mid) * r * 0.66 - 8, y + Math.sin(mid) * r * 0.66 - 8, 1);
  }

  // Hub.
  ctx.fillStyle = PAL.ink;
  ctx.beginPath();
  ctx.arc(x, y, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PAL.yellow;
  ctx.beginPath();
  ctx.arc(x, y, 13, 0, Math.PI * 2);
  ctx.fill();
  text(ctx, 'X1', x, y - 4, PAL.ink, 8, 'center', null);

  // The two pointers (top and bottom) pick both duelists at once.
  for (const [py, dir] of [
    [y - r - 9, 1],
    [y + r + 9, -1],
  ] as const) {
    // A triangle pointing at the wheel: wide base away from it, tip toward it.
    const tri = (pad: number, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x - 8 - pad, py - dir * pad);
      ctx.lineTo(x + 8 + pad, py - dir * pad);
      ctx.lineTo(x, py + dir * (11 + pad));
      ctx.closePath();
      ctx.fill();
    };
    tri(1.5, PAL.ink);
    tri(0, PAL.red);
  }

  outlinedText(ctx, 'X1!', 52, 70, PAL.yellow, 32);
  if (stopped) {
    outlinedText(ctx, nameOf(st, st.a), 52, 112, CHARACTERS[st.candidates[st.a].character].color, 8);
    text(ctx, 'VS', 52, 124, PAL.pink, 8, 'center');
    outlinedText(ctx, nameOf(st, st.b), 52, 136, CHARACTERS[st.candidates[st.b].character].color, 8);
  } else {
    text(ctx, 'GIRANDO...', 52, 120, PAL.white, 8, 'center');
  }
}

// ---------- Intro / bets ----------

function bets(ctx: CanvasRenderingContext2D, st: DuelState, localId: PlayerId): void {
  const sides: [number, number] = [0, 0];
  for (const b of st.bets) {
    if (b.pick === -1) continue;
    const x = b.pick === 0 ? 56 + sides[0] * 9 : ARENA_W - 64 - sides[1] * 9;
    sides[b.pick]++;
    ctx.fillStyle = b.id === localId ? '#ffffff' : PAL.ink;
    ctx.fillRect(x - 1, 172, 8, 8);
    ctx.fillStyle = CHARACTERS[b.character].color;
    ctx.fillRect(x, 173, 6, 6);
  }
  const me = st.bets.find((b) => b.id === localId);
  if (me) {
    const msg = me.pick === -1 ? 'APOSTE: A ESQUERDA  D DIREITA' : `APOSTOU EM ${nameOf(st, me.pick === 0 ? st.a : st.b)}`;
    outlinedText(ctx, msg, ARENA_W / 2, 158, me.pick === -1 ? PAL.yellow : PAL.green, 8);
  }
}

function drawIntro(ctx: CanvasRenderingContext2D, st: DuelState, time: number, localId: PlayerId): void {
  studio(ctx, time);
  outlinedText(ctx, KIND_NAME[st.kind], ARENA_W / 2, 16, PAL.yellow, 16);
  text(ctx, KIND_HINT[st.kind], ARENA_W / 2, 36, PAL.white, 8, 'center');
  for (const side of [0, 1] as const) {
    const idx = side === 0 ? st.a : st.b;
    const c = st.candidates[idx];
    const x = side === 0 ? 96 : ARENA_W - 96;
    portrait(ctx, c.character, x - 24, 56, 3);
    outlinedText(ctx, nameOf(st, idx), x, 110, CHARACTERS[c.character].color, 8);
    text(ctx, side === 0 ? '< A' : 'D >', x, 124, PAL.grey, 8, 'center');
  }
  outlinedText(ctx, 'VS', ARENA_W / 2, 76, PAL.pink, 16);
  const fighting = st.candidates[st.a].id === localId || st.candidates[st.b].id === localId;
  if (fighting) outlinedText(ctx, 'VOCÊ ESTÁ NO X1!', ARENA_W / 2, 144, PAL.red, 8);
  bets(ctx, st, localId);
}

// ---------- Quick Draw (cork pistols in a western town) ----------

function cowboy(ctx: CanvasRenderingContext2D, character: number, x: number, y: number, facing: 1 | -1, dazed: boolean, time: number): void {
  sprite(ctx, BLOB, x - 10, y - 20, colorsOf(character), 2, facing < 0);
  // hat
  ctx.fillStyle = '#3a2410';
  ctx.fillRect(x - 11, y - 22, 22, 3);
  ctx.fillRect(x - 6, y - 29, 12, 7);
  ctx.fillStyle = '#5a3a1a';
  ctx.fillRect(x - 6, y - 24, 12, 2);
  // cork pistol
  const gx = x + facing * 11;
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(facing > 0 ? gx : gx - 10, y - 9, 10, 4);
  ctx.fillRect(facing > 0 ? gx : gx - 3, y - 6, 3, 5);
  ctx.fillStyle = '#c84a3a';
  ctx.fillRect(facing > 0 ? gx + 1 : gx - 9, y - 8, 7, 2);
  if (dazed) {
    for (let k = 0; k < 3; k++) {
      const a = time * 6 + (k * Math.PI * 2) / 3;
      ctx.fillStyle = PAL.yellow;
      ctx.fillRect(Math.round(x + Math.cos(a) * 10), Math.round(y - 32 + Math.sin(a) * 3), 2, 2);
    }
  }
}

function drawQuickDraw(ctx: CanvasRenderingContext2D, st: DuelState, time: number): void {
  const bands = ['#ffb86a', '#ff9a4a', '#f27a3a', '#d85a3a', '#a83a4a'];
  bands.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(0, i * 22, ARENA_W, 22);
  });
  ctx.fillStyle = '#ffe07a';
  ctx.beginPath();
  ctx.arc(ARENA_W / 2, 104, 26, Math.PI, 0);
  ctx.fill();
  // Saloon and shop silhouettes.
  ctx.fillStyle = '#5a2a2a';
  ctx.fillRect(14, 60, 60, 50);
  ctx.fillRect(24, 50, 40, 10);
  ctx.fillRect(310, 66, 64, 44);
  ctx.fillStyle = '#3a1a1a';
  ctx.fillRect(30, 78, 10, 14);
  ctx.fillRect(48, 78, 10, 14);
  ctx.fillRect(326, 82, 10, 14);
  ctx.fillRect(348, 82, 10, 14);
  ctx.fillStyle = '#d8a060';
  ctx.fillRect(0, 110, ARENA_W, ARENA_H - 110);
  ctx.fillStyle = '#b88048';
  for (let i = 0; i < 24; i++) ctx.fillRect(Math.floor(hash(i) * ARENA_W), 114 + Math.floor(hash(i + 9) * 80), 3, 1);
  // tumbleweed
  const tw = ((time * 40) % (ARENA_W + 40)) - 20;
  ctx.strokeStyle = '#8a6a3a';
  ctx.beginPath();
  ctx.arc(tw, 150, 5, 0, Math.PI * 2);
  ctx.stroke();

  const q = st.qd;
  const decided = st.phase === 'result';
  const xs = [104, ARENA_W - 104];
  for (const side of [0, 1] as const) {
    const c = st.candidates[side === 0 ? st.a : st.b];
    const lostRound = (q.ended || decided) && q.roundWinner !== -1 && q.roundWinner !== side && q.roundTime > 0.25;
    const lostDuel = decided && st.winner !== side;
    cowboy(ctx, c.character, xs[side], 132, side === 0 ? 1 : -1, lostRound || lostDuel, time);
    text(ctx, CHARACTERS[c.character].name, xs[side], 140, CHARACTERS[c.character].color, 8, 'center');
    // Score pips (best of 3).
    for (let k = 0; k < 2; k++) {
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(xs[side] - 9 + k * 12, 152, 8, 8);
      ctx.fillStyle = k < q.score[side] ? PAL.yellow : '#7a5a3a';
      ctx.fillRect(xs[side] - 8 + k * 12, 153, 6, 6);
    }
  }

  if (q.ended || decided) {
    // The cork flies from the winner's pistol to the loser's face, then POP!
    const w = q.roundWinner;
    if (w !== -1) {
      const from = xs[w] + (w === 0 ? 22 : -22);
      const to = xs[w === 0 ? 1 : 0] + (w === 0 ? -6 : 6);
      const k = Math.min(1, q.roundTime / 0.25);
      if (k < 1) {
        const cx = from + (to - from) * k;
        ctx.fillStyle = PAL.ink;
        ctx.fillRect(Math.round(cx) - 5, 120, 10, 7);
        ctx.fillStyle = '#d8a86a';
        ctx.fillRect(Math.round(cx) - 4, 121, 8, 5);
        ctx.fillStyle = '#8a6a3a';
        ctx.fillRect(Math.round(cx) - 4, 121, 2, 5);
      } else if (q.roundTime < QD_ROUND_END) {
        outlinedText(ctx, 'POP!', to, 92, PAL.white, 16);
      }
      if (!decided) outlinedText(ctx, q.roundReason, ARENA_W / 2, 60, PAL.white, 8);
    }
    return;
  }
  outlinedText(ctx, `RODADA ${q.round}`, ARENA_W / 2, 6, PAL.ink, 8, 'center', '#ffe07a');
  const t = q.roundTime;
  const fake = q.fakes.find((f) => t >= f.at && t < f.at + 0.45);
  if (t >= q.goAt) {
    outlinedText(ctx, 'JÁ!', ARENA_W / 2, 20, PAL.red, 32);
    keyCap(ctx, q.key, ARENA_W / 2, 74, 26, '#fff4e0', PAL.ink, PAL.ink);
  } else if (fake) {
    outlinedText(ctx, fake.text, ARENA_W / 2, 30, PAL.yellow, 16);
  } else {
    outlinedText(ctx, '...', ARENA_W / 2, 30, PAL.white, 16);
  }
}

// ---------- Sword Swipe (on a pier, sea behind) ----------

function swordsman(ctx: CanvasRenderingContext2D, character: number, x: number, y: number, facing: 1 | -1, swing: number, flash: boolean): void {
  sprite(ctx, BLOB, x - 10, y - 20, colorsOf(character, flash), 2, facing < 0);
  // headband
  ctx.fillStyle = CHARACTERS[character].dark;
  ctx.fillRect(x - 9, y - 17, 18, 2);
  // sword: raised, then slashing down on each correct move
  const a = facing > 0 ? -Math.PI / 3 + swing * 1.4 : Math.PI + Math.PI / 3 - swing * 1.4;
  const hx = x + facing * 9;
  const hy = y - 8;
  ctx.strokeStyle = PAL.ink;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(hx + Math.cos(a) * 20, hy + Math.sin(a) * 20);
  ctx.stroke();
  ctx.strokeStyle = '#e8ecff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(hx + Math.cos(a) * 3, hy + Math.sin(a) * 3);
  ctx.lineTo(hx + Math.cos(a) * 19, hy + Math.sin(a) * 19);
  ctx.stroke();
  ctx.fillStyle = PAL.yellow;
  ctx.fillRect(Math.round(hx) - 2, Math.round(hy) - 1, 4, 3);
}

function drawSword(ctx: CanvasRenderingContext2D, st: DuelState, time: number): void {
  // Sky and sea.
  const sky = ['#5a8ae8', '#6a9af0', '#7aaaf4', '#8ab8f8'];
  sky.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(0, i * 18, ARENA_W, 18);
  });
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 4; i++) {
    const cx = (i * 107 + time * 6) % (ARENA_W + 60) - 30;
    ctx.fillRect(Math.round(cx), 16 + i * 9, 26, 4);
    ctx.fillRect(Math.round(cx) + 5, 13 + i * 9, 14, 3);
  }
  for (let y = 72; y < ARENA_H; y += 4) {
    ctx.fillStyle = ((y - 72) / 4) % 2 ? '#1e5ac8' : '#2468d8';
    ctx.fillRect(0, y, ARENA_W, 4);
  }
  ctx.fillStyle = '#8ac8ff';
  for (let i = 0; i < 30; i++) {
    const x = Math.floor((hash(i) * ARENA_W + time * 12 * (i % 2 ? 1 : -1) + ARENA_W) % ARENA_W);
    ctx.fillRect(x, 76 + Math.floor(hash(i + 40) * 120), 5, 1);
  }
  // The pier.
  const pierY = 132;
  ctx.fillStyle = '#4a2a14';
  ctx.fillRect(40, pierY, ARENA_W - 80, 10);
  for (let x = 40; x < ARENA_W - 40; x += 10) {
    ctx.fillStyle = (x / 10) % 2 ? '#a8703a' : '#9a6432';
    ctx.fillRect(x, pierY, 9, 7);
  }
  for (const px of [52, 120, 192, 264, 332]) {
    ctx.fillStyle = '#3a2010';
    ctx.fillRect(px - 2, pierY + 10, 4, 40);
  }

  const s = st.sword;
  const t = st.phaseTime;
  const decided = st.phase === 'result';
  const go = st.phase === 'duel' ? t >= s.goAt : true;
  for (const side of [0, 1] as const) {
    const c = st.candidates[side === 0 ? st.a : st.b];
    let x = side === 0 ? 120 : ARENA_W - 120;
    let y = pierY;
    if (decided && st.winner === side) {
      // The winner dashes across with the final cut.
      const k = Math.min(1, t / 0.25);
      x += (side === 0 ? 1 : -1) * k * 110;
    } else if (decided) {
      // The loser is knocked into the sea.
      const k = Math.min(1, Math.max(0, (t - 0.2) / 0.6));
      x += (side === 0 ? -1 : 1) * k * 20;
      y += k * k * 70;
    }
    const swing = s.progress[side] % 2;
    if (y < ARENA_H + 20) swordsman(ctx, c.character, x, y, side === 0 ? 1 : -1, swing, s.failed[side] && Math.floor(time * 16) % 2 === 0);
    if (decided && st.winner !== side && t > 0.75) {
      // splash
      const k = Math.min(1, (t - 0.75) / 0.6);
      ctx.strokeStyle = `rgba(220,240,255,${1 - k})`;
      ctx.beginPath();
      ctx.arc(x, pierY + 58, 4 + k * 18, 0, Math.PI * 2);
      ctx.stroke();
    }
    text(ctx, CHARACTERS[c.character].name, side === 0 ? 120 : ARENA_W - 120, pierY + 14, CHARACTERS[c.character].color, 8, 'center');

    // Move sequence above each fighter.
    if (go) {
      const cell = 17;
      const x0 = (side === 0 ? 120 : ARENA_W - 120) - (SWORD_MOVES * cell) / 2 + cell / 2;
      for (let k = 0; k < SWORD_MOVES; k++) {
        const done = k < s.progress[side];
        const current = k === s.progress[side] && !decided;
        const failedHere = s.failed[side] && k === s.progress[side];
        const fill = failedHere ? '#ffb0b8' : done ? '#8af08a' : current ? '#fff4c0' : '#e8e4f4';
        const border = failedHere ? PAL.red : current ? PAL.yellow : PAL.ink;
        keyCap(ctx, s.seq[k], x0 + k * cell, 48 + (current ? -3 : 0), 15, fill, border, done ? '#1a6a2a' : PAL.ink);
      }
    }
  }
  if (st.phase === 'duel' && !go) outlinedText(ctx, 'PREPARAR...', ARENA_W / 2, 20, PAL.white, 16);
  else if (st.phase === 'duel' && t - s.goAt < 0.6) outlinedText(ctx, 'JÁ!', ARENA_W / 2, 10, PAL.red, 32);
}

// ---------- Pong ----------

function drawPong(ctx: CanvasRenderingContext2D, st: DuelState): void {
  ctx.fillStyle = '#05050e';
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);
  ctx.fillStyle = '#c8c4d8';
  ctx.fillRect(0, PONG.top - 2, ARENA_W, 2);
  ctx.fillRect(0, PONG.bottom, ARENA_W, 2);
  for (let y = PONG.top; y < PONG.bottom; y += 10) ctx.fillRect(ARENA_W / 2 - 1, y, 2, 5);
  const p = st.pong;
  for (const side of [0, 1] as const) {
    const c = st.candidates[side === 0 ? st.a : st.b];
    const ch = CHARACTERS[c.character];
    const x = side === 0 ? PONG.ax : PONG.bx;
    const y = side === 0 ? p.pa : p.pb;
    ctx.fillStyle = ch.color;
    ctx.fillRect(Math.round(x - (side === 0 ? 4 : 0)), Math.round(y - PONG.half), 4, PONG.half * 2);
    text(ctx, ch.name, side === 0 ? 40 : ARENA_W - 40, 16, ch.color, 8, side === 0 ? 'left' : 'right');
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(Math.round(p.x - PONG.ballR), Math.round(p.y - PONG.ballR), PONG.ballR * 2, PONG.ballR * 2);
  if (st.phase === 'duel' && st.phaseTime < 0.6) outlinedText(ctx, 'SAQUE!', ARENA_W / 2, ARENA_H / 2 - 20, PAL.yellow, 16);
}

export const duelRenderer: MinigameRenderer = {
  render(ctx, raw, time, localId: PlayerId) {
    const st = raw as DuelState;
    if (st.phase === 'roulette') return drawWheel(ctx, st, time);
    if (st.phase === 'intro') return drawIntro(ctx, st, time, localId);

    if (st.kind === 'quickdraw') drawQuickDraw(ctx, st, time);
    else if (st.kind === 'sword') drawSword(ctx, st, time);
    else drawPong(ctx, st);
    if (st.phase === 'duel' && st.phaseTime < 1) bets(ctx, st, localId);

    if (st.phase === 'result' && st.winner !== -1) {
      const wIdx = st.winner === 0 ? st.a : st.b;
      const w = st.candidates[wIdx];
      ctx.fillStyle = 'rgba(10,6,20,0.7)';
      ctx.fillRect(0, 160, ARENA_W, 40);
      outlinedText(ctx, `${nameOf(st, wIdx)} VENCEU O X1!`, ARENA_W / 2, 164, CHARACTERS[w.character].color, 8);
      text(ctx, st.reason, ARENA_W / 2, 176, PAL.white, 8, 'center');
      const right = st.bets.filter((b) => b.pick === st.winner).length;
      text(ctx, right ? `${right} DA TORCIDA GANHARAM ESCUDO` : 'NINGUÉM DA TORCIDA ACERTOU', ARENA_W / 2, 188, PAL.cyan, 8, 'center');
    }
  },
};
