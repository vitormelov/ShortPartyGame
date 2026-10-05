import { ARENA_H, ARENA_W } from '@shared/arena';
import { CMD_STILL, DEATH_ANIM, POSE_ACTION, POSE_NONE, RAFT_Y, type MimicPlayer, type MimicState } from '@shared/minigames/mimic/logic';
import { CHARACTERS, type PlayerId } from '@shared/types';
import { PAL, outlinedText, panel, sprite, text } from '../core/draw';
import { BLOB } from './meteor';
import { hash, type MinigameRenderer } from './renderer';

const POOL_Y = 132;
const SIGN = { x: ARENA_W / 2 + 22, y: 14, w: 74, h: 50 };

/** Pixel arrow centered at (cx, cy); dir 0 up, 1 right, 2 down, 3 left. */
export function arrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, dir: number, s: number, color: string): void {
  ctx.save();
  ctx.translate(Math.round(cx), Math.round(cy));
  ctx.rotate((dir * Math.PI) / 2);
  ctx.fillStyle = color;
  for (let i = 0; i < 3 * s; i++) ctx.fillRect(-i, -3 * s + i, i * 2 + 1, 1);
  ctx.fillRect(-s, 0, s * 2 + 1, 3 * s);
  ctx.restore();
}

function drawStage(ctx: CanvasRenderingContext2D, time: number): void {
  // Sunset sky.
  const bands = ['#2a1450', '#4a1a6a', '#7a2a7a', '#b83a7a', '#e8607a', '#ff9a6a'];
  const bh = POOL_Y / bands.length;
  bands.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(0, Math.floor(i * bh), ARENA_W, Math.ceil(bh));
  });
  // Palm silhouettes.
  ctx.fillStyle = '#1a0a2a';
  for (const px of [24, 352]) {
    ctx.fillRect(px, 60, 4, POOL_Y - 60);
    for (let k = -14; k <= 14; k += 2) ctx.fillRect(px + k, 58 + Math.abs(k) / 3, 2, 2);
  }
  // Stage.
  ctx.fillStyle = '#1a0e2e';
  ctx.fillRect(ARENA_W / 2 - 70, 92, 140, 10);
  ctx.fillStyle = '#ff5ac8';
  ctx.fillRect(ARENA_W / 2 - 70, 92, 140, 1);
  // Ring light behind the influencer.
  ctx.strokeStyle = Math.floor(time * 3) % 2 ? '#fff4e0' : '#ffe0b0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(ARENA_W / 2 - 24, 62, 22, 0, Math.PI * 2);
  ctx.stroke();
}

function drawInfluencer(ctx: CanvasRenderingContext2D, st: MimicState, time: number): void {
  const x = ARENA_W / 2 - 24;
  const y = 92;
  const bob = Math.floor(time * 4) % 2;
  // legs + body
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(x - 6, y - 10, 4, 10);
  ctx.fillRect(x + 2, y - 10, 4, 10);
  ctx.fillRect(x - 8, y - 26 - bob, 16, 17);
  ctx.fillStyle = '#ff5ac8';
  ctx.fillRect(x - 7, y - 25 - bob, 14, 15);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x - 3, y - 22 - bob, 6, 2);
  // head
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(x - 7, y - 40 - bob, 14, 14);
  ctx.fillStyle = '#ffc89a';
  ctx.fillRect(x - 6, y - 39 - bob, 12, 12);
  ctx.fillStyle = '#ffd23e';
  ctx.fillRect(x - 7, y - 41 - bob, 14, 4);
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(x - 6, y - 35 - bob, 12, 3); // sunglasses
  ctx.fillStyle = '#c83a3a';
  ctx.fillRect(x - 2, y - 30 - bob, 4, 1);
  // Arm pointing at the shown command.
  const showing = st.phase !== 'wait' && st.command < 4;
  const dir = showing ? st.command : 2;
  const v = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ][dir];
  const sx = x + 8;
  const sy = y - 22 - bob;
  ctx.fillStyle = '#ffc89a';
  for (let k = 0; k < 12; k++) ctx.fillRect(Math.round(sx + v[0] * k) - 1, Math.round(sy + v[1] * k) - 1, 3, 3);
  // Phone in the other hand.
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(x - 14, y - 22 - bob, 5, 8);
  ctx.fillStyle = '#3ee8ff';
  ctx.fillRect(x - 13, y - 21 - bob, 3, 5);
}

function drawSign(ctx: CanvasRenderingContext2D, st: MimicState, time: number): void {
  const opp = st.opposite && st.phase !== 'wait';
  panel(ctx, SIGN.x, SIGN.y, SIGN.w, SIGN.h, opp ? '#ffe0e4' : '#fff4e0', opp ? PAL.red : PAL.ink);
  const cx = SIGN.x + SIGN.w / 2;
  const cy = SIGN.y + SIGN.h / 2;
  if (st.phase === 'wait') {
    text(ctx, '...', cx, cy - 4, PAL.grey, 8, 'center', null);
    return;
  }
  if (st.command === CMD_STILL) {
    outlinedText(ctx, 'PARADO', cx, cy - 6, PAL.ink, 8, 'center', '#fff4e0');
    text(ctx, 'NÃO APERTE', cx, cy + 6, PAL.grey, 8, 'center', null);
  } else if (st.command === POSE_ACTION) {
    panel(ctx, cx - 30, cy - 8, 60, 16, PAL.ink, PAL.grey);
    text(ctx, 'ESPAÇO', cx, cy - 4, PAL.white, 8, 'center', null);
  } else {
    arrow(ctx, cx, cy, st.command, 5, opp ? PAL.red : '#2a4ae8');
  }
  if (opp && Math.floor(time * 8) % 2 === 0) outlinedText(ctx, 'CONTRÁRIO!', cx, SIGN.y + SIGN.h + 4, PAL.red, 8, 'center');
  if (st.phase === 'show') {
    const left = Math.max(0, 1 - st.phaseTime / st.window);
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(SIGN.x, SIGN.y + SIGN.h + 1, SIGN.w, 3);
    ctx.fillStyle = left < 0.3 ? PAL.red : PAL.green;
    ctx.fillRect(SIGN.x, SIGN.y + SIGN.h + 1, Math.round(SIGN.w * left), 3);
  }
}

function drawPool(ctx: CanvasRenderingContext2D, time: number): void {
  for (let y = POOL_Y; y < ARENA_H; y += 4) {
    ctx.fillStyle = ((y - POOL_Y) / 4) % 2 ? '#1e6ae8' : '#2a7af2';
    ctx.fillRect(0, y, ARENA_W, 4);
  }
  ctx.fillStyle = '#8ac8ff';
  for (let i = 0; i < 30; i++) {
    const x = Math.floor((hash(i) * ARENA_W + time * 14 * (i % 2 ? 1 : -1)) % ARENA_W);
    const y = POOL_Y + 4 + Math.floor(hash(i + 50) * (ARENA_H - POOL_Y - 6));
    ctx.fillRect((x + ARENA_W) % ARENA_W, y, 4, 1);
  }
  ctx.fillStyle = '#e8d8b0';
  ctx.fillRect(0, POOL_Y - 3, ARENA_W, 3);
}

function drawPlayer(ctx: CanvasRenderingContext2D, p: MimicPlayer, st: MimicState, time: number): void {
  if (p.status === 'out') return;
  const ch = CHARACTERS[p.character];
  // raft
  ctx.fillStyle = '#6a3a1a';
  ctx.fillRect(p.x - 12, RAFT_Y, 24, 5);
  ctx.fillStyle = '#9a5a2a';
  ctx.fillRect(p.x - 12, RAFT_Y, 24, 1);
  if (p.status === 'dead') {
    if (p.deathAnim <= 0) return;
    // Sinking + splash.
    const k = 1 - p.deathAnim / DEATH_ANIM;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, ARENA_W, RAFT_Y + 8);
    ctx.clip();
    sprite(ctx, BLOB, p.x - 5, RAFT_Y - 10 + k * 22, { k: PAL.ink, c: ch.color, L: ch.light, K: ch.dark, w: '#ffffff' });
    ctx.restore();
    ctx.fillStyle = '#c8e8ff';
    for (let i = 0; i < 8; i++) {
      const a = Math.PI + (i / 7) * Math.PI;
      ctx.fillRect(Math.round(p.x + Math.cos(a) * k * 14), Math.round(RAFT_Y + 4 + Math.sin(a) * k * 12), 2, 2);
    }
    return;
  }
  if (p.ghost > 0 && Math.floor(time * 16) % 2 === 0) return;
  const hop = p.pose !== POSE_NONE ? 1 : 0;
  sprite(ctx, BLOB, p.x - 5, RAFT_Y - 10 - hop, { k: PAL.ink, c: ch.color, L: ch.light, K: ch.dark, w: '#ffffff' });

  // What this player is holding, so everyone can copy (or be fooled).
  const by = RAFT_Y - 22;
  if (p.pose !== POSE_NONE) {
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(p.x - 6, by - 6, 13, 13);
    ctx.fillStyle = '#fff4e0';
    ctx.fillRect(p.x - 5, by - 5, 11, 11);
    if (p.pose === POSE_ACTION) text(ctx, '!', p.x - 3, by - 3, PAL.ink, 8, 'left', null);
    else arrow(ctx, p.x, by + 1, p.pose, 1, ch.dark);
  }
  if (st.phase === 'result' && p.last === 'ok') {
    ctx.fillStyle = PAL.green;
    ctx.fillRect(p.x - 3, by - 14, 2, 2);
    ctx.fillRect(p.x - 1, by - 12, 2, 2);
    ctx.fillRect(p.x + 1, by - 14, 2, 2);
    ctx.fillRect(p.x + 3, by - 16, 2, 2);
  }
}

export const mimicRenderer: MinigameRenderer = {
  render(ctx, raw, time, localId: PlayerId) {
    const st = raw as MimicState;
    drawStage(ctx, time);
    drawPool(ctx, time);
    drawInfluencer(ctx, st, time);
    drawSign(ctx, st, time);
    for (const p of st.players) drawPlayer(ctx, p, st, time);
    const me = st.players.find((p) => p.id === localId);
    if (me && me.status !== 'out') text(ctx, 'VOCÊ', me.x, RAFT_Y + 8, PAL.yellow, 8, 'center');
  },
};
