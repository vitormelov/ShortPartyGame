import { ARENA_H, ARENA_W } from '@shared/arena';
import { DEATH_ANIM, HIT_WIN, TRAVEL, type DanceState, type Dancer, type Lane } from '@shared/minigames/dance/logic';
import type { Dir } from '@shared/minigames/look/logic';
import { type PlayerId } from '@shared/types';
import { BRAND, PAL, outlinedText, text } from '../core/draw';
import { arrow } from './look';
import { hash, type MinigameRenderer } from './renderer';
import { drawCharacter } from '../core/cast';

const LANE_DIR: Dir[] = [3, 0, 2, 1]; // A W S D -> left up down right
const LANE_COLOR = ['#ff5ac8', '#3ee8ff', '#5cf26a', '#ffd23e'];
const HW_X = 14;
const LANE_W = 28;
const HIT_Y = 150;
const TOP_Y = 16;
const STAGE_X = 150;

function noteY(st: DanceState, t: number): number {
  return HIT_Y - ((t - st.songT) / TRAVEL) * (HIT_Y - TOP_Y);
}

function drawStage(ctx: CanvasRenderingContext2D, st: DanceState): void {
  ctx.fillStyle = BRAND.roxo;
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);
  // Disco floor flashing on the beat.
  const beat = Math.floor(st.beat);
  const pulse = 1 - (st.beat % 1);
  const colors = ['#3a1a5a', '#1a2a5a', '#5a1a3a', '#1a4a4a'];
  for (let y = 60; y < ARENA_H; y += 16) {
    for (let x = STAGE_X; x < ARENA_W; x += 24) {
      const k = (x / 24 + y / 16 + beat) % 4;
      ctx.fillStyle = colors[Math.floor(k)];
      ctx.fillRect(x, y, 23, 15);
    }
  }
  ctx.fillStyle = `rgba(255,255,255,${(pulse * 0.08).toFixed(3)})`;
  ctx.fillRect(STAGE_X, 60, ARENA_W - STAGE_X, ARENA_H - 60);
  // Spotlights and a disco ball.
  const bx = STAGE_X + (ARENA_W - STAGE_X) / 2;
  ctx.fillStyle = '#8a80a8';
  ctx.fillRect(bx, 0, 1, 10);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + st.songT;
    ctx.fillStyle = hash(i + beat) > 0.5 ? '#ffffff' : '#c8c0e0';
    ctx.fillRect(Math.round(bx - 1 + Math.cos(a) * 4), Math.round(16 + Math.sin(a) * 4), 2, 2);
  }
  for (let i = 0; i < 30; i++) {
    ctx.fillStyle = (i + beat) % 3 === 0 ? '#ffffff' : '#4a3a7a';
    ctx.fillRect(STAGE_X + Math.floor(hash(i) * (ARENA_W - STAGE_X)), Math.floor(hash(i + 30) * 56), 1, 1);
  }
}

function drawHighway(ctx: CanvasRenderingContext2D, st: DanceState, me: Dancer | undefined, time: number): void {
  ctx.fillStyle = 'rgba(10,6,20,0.92)';
  ctx.fillRect(HW_X - 4, 0, LANE_W * 4 + 8, ARENA_H);
  for (let l = 0; l < 4; l++) {
    ctx.fillStyle = l % 2 ? '#1a1030' : '#160c28';
    ctx.fillRect(HW_X + l * LANE_W, 0, LANE_W, ARENA_H);
  }
  // Beat lines scrolling down.
  const spb = 60 / st.bpm;
  const firstBeat = Math.ceil(st.beat);
  for (let k = 0; k < 6; k++) {
    const t = st.songT + (firstBeat + k - st.beat) * spb;
    const y = noteY(st, t);
    if (y < TOP_Y) break;
    ctx.fillStyle = '#2a1e4a';
    ctx.fillRect(HW_X, Math.round(y), LANE_W * 4, 1);
  }
  // Receptors (light up while you hold the key).
  for (let l = 0 as Lane; l < 4; l = (l + 1) as Lane) {
    const held = !!me && ((l === 0 && me.prevDx < 0) || (l === 3 && me.prevDx > 0) || (l === 1 && me.prevDy < 0) || (l === 2 && me.prevDy > 0));
    const cx = HW_X + l * LANE_W + LANE_W / 2;
    arrow(ctx, cx + 1, HIT_Y + 1, LANE_DIR[l], 8, PAL.ink);
    arrow(ctx, cx, HIT_Y, LANE_DIR[l], 8, held ? LANE_COLOR[l] : '#4a3a6a');
  }
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(HW_X, HIT_Y - Math.round((HIT_WIN / TRAVEL) * (HIT_Y - TOP_Y)), LANE_W * 4, 1);
  ctx.fillRect(HW_X, HIT_Y + Math.round((HIT_WIN / TRAVEL) * (HIT_Y - TOP_Y)), LANE_W * 4, 1);
  // Notes.
  for (const n of st.notes) {
    const mine = !!me && n.hitBy.includes(me.id);
    if (mine) continue;
    const y = noteY(st, n.t);
    if (y < TOP_Y - 10 || y > ARENA_H + 10) continue;
    const cx = HW_X + n.lane * LANE_W + LANE_W / 2;
    const missed = n.judged;
    arrow(ctx, cx + 1, y + 1, LANE_DIR[n.lane], 8, PAL.ink);
    arrow(ctx, cx, y, LANE_DIR[n.lane], 8, missed ? '#5a4a6a' : LANE_COLOR[n.lane]);
  }
  // Hit sparks on your recent hits.
  if (me && me.judge === 'hit' && me.judgeT > 0 && me.lastLane !== -1) {
    const cx = HW_X + me.lastLane * LANE_W + LANE_W / 2;
    const r = 6 + (0.35 - me.judgeT) * 40;
    ctx.fillStyle = LANE_COLOR[me.lastLane];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + time;
      ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(HIT_Y + Math.sin(a) * r), 2, 2);
    }
  }
}

function drawDancer(ctx: CanvasRenderingContext2D, d: Dancer, x: number, y: number, st: DanceState, time: number, mine: boolean): void {
  if (d.status === 'out') return;
  ctx.fillStyle = 'rgba(20,6,46,0.4)';
  ctx.fillRect(x - 8, y + 1, 16, 3);
  if (d.status === 'dead') {
    // Face-planted, dying of cringe.
    drawCharacter(ctx, d.character, x, y + 2, { dead: true, pose: 'lose', size: 26, sx: 1.25, sy: 0.55 });
    ctx.fillStyle = '#3ee8ff';
    ctx.fillRect(x + 9, y - 16 + Math.floor((DEATH_ANIM - d.deathAnim) * 10) % 6, 2, 3);
    if (Math.floor(time * 6) % 2) text(ctx, 'CRINGE', x, y - 30, PAL.red, 8, 'center');
    return;
  }
  if (d.ghost > 0 && Math.floor(time * 16) % 2 === 0) return;
  // Bounce on the beat; pose from the last arrow hit.
  const ph = st.beat % 1;
  const bounce = ph < 0.3 ? 2 : 0;
  const posing = d.judge === 'hit' && d.judgeT > 0 ? d.lastLane : -1;
  const squat = posing === 2 ? 4 : 0;
  const lean = posing === 0 ? -3 : posing === 3 ? 3 : 0;
  const bx = x - 10 + lean;
  const by = y - 20 - bounce + squat + (posing === 1 ? -4 : 0);
  // Arms up on ↑, a squat on ↓, leaning on ← and →, and a two-step on the beat.
  drawCharacter(ctx, d.character, x + lean, y - bounce + (posing === 1 ? -4 : 0), {
    size: 26,
    time,
    pose: posing === 1 ? 'jump' : posing >= 0 ? 'win' : 'idle',
    frame: Math.floor(st.beat) % 2,
    flip: posing === 0,
    sx: squat ? 1.15 : 1,
    sy: squat ? 0.8 : bounce ? 1.06 : 1,
  });
  if (d.judge === 'miss' && d.judgeT > 0) {
    ctx.fillStyle = '#3ee8ff';
    ctx.fillRect(bx + 18, by + 2, 2, 3);
  }
  // Cringe bar.
  const w = 18;
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(x - w / 2 - 1, y - 30, w + 2, 4);
  ctx.fillStyle = d.cringe > 0.66 ? PAL.red : d.cringe > 0.33 ? PAL.yellow : PAL.green;
  ctx.fillRect(x - w / 2, y - 29, Math.round(w * d.cringe), 2);
  if (mine) {
    ctx.fillStyle = PAL.yellow;
    ctx.fillRect(x - 3, y - 36 - (Math.floor(time * 4) % 2), 7, 2);
    ctx.fillRect(x - 1, y - 34 - (Math.floor(time * 4) % 2), 3, 2);
  }
}

function dancerPos(i: number, n: number): [number, number] {
  const perRow = Math.ceil(n / 2);
  const row = i < perRow ? 0 : 1;
  const k = row ? i - perRow : i;
  const count = row ? n - perRow : perRow;
  const w = ARENA_W - STAGE_X - 44;
  const x = STAGE_X + 10 + ((k + 0.5) * w) / count + (row ? 10 : -10);
  return [Math.round(x), row ? 178 : 120];
}

export const danceRenderer: MinigameRenderer = {
  positions(raw) {
    const st = raw as DanceState;
    return st.dancers.flatMap((d, i) => (d.status === 'alive' ? [[d.id, ...dancerPos(i, st.dancers.length)] as [PlayerId, number, number]] : [])).map(([id, x, y]) => [id, x, y - 12]);
  },

  render(ctx, raw, time, localId: PlayerId) {
    const st = raw as DanceState;
    const me = st.dancers.find((d) => d.id === localId && d.status !== 'out');
    drawStage(ctx, st);
    st.dancers.forEach((d, i) => {
      const [x, y] = dancerPos(i, st.dancers.length);
      drawDancer(ctx, d, x, y, st, time, d.id === localId);
    });
    drawHighway(ctx, st, me, time);

    outlinedText(ctx, `${Math.round(st.bpm)} BPM`, STAGE_X + (ARENA_W - STAGE_X) / 2, 30, Math.floor(st.beat) % 2 ? PAL.pink : PAL.cyan, 8);
    if (me && me.status === 'alive') {
      if (me.judgeT > 0 && me.judge) {
        const [msg, color] = me.judge === 'hit' ? ['PERFEITO!', PAL.green] : me.judge === 'miss' ? ['ERROU!', PAL.red] : ['CRINGE!', PAL.yellow];
        outlinedText(ctx, msg, HW_X + LANE_W * 2, 70, color, 8);
      }
      if (me.combo >= 5) outlinedText(ctx, `${me.combo} COMBO`, HW_X + LANE_W * 2, 84, PAL.white, 8);
      // Your cringe meter across the top of the highway.
      const w = LANE_W * 4;
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(HW_X - 1, 3, w + 2, 8);
      ctx.fillStyle = me.cringe > 0.66 ? PAL.red : me.cringe > 0.33 ? PAL.yellow : PAL.green;
      ctx.fillRect(HW_X, 4, Math.round(w * me.cringe), 6);
      text(ctx, 'CRINGE', HW_X + w + 8, 3, me.cringe > 0.66 && Math.floor(time * 8) % 2 ? PAL.red : PAL.grey, 8);
    }
  },
};
