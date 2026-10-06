import { ARENA_H, ARENA_W } from '@shared/arena';
import {
  CENTER,
  DEATH_ANIM,
  EMITTER_R,
  FIELD,
  FLIP_WARNING,
  GAP,
  JUMP_COOLDOWN,
  JUMP_TIME,
  WALL_THICK,
  type LaserPlayer,
  type LaserState,
  type LaserWall,
} from '@shared/minigames/laser/logic';
import { type PlayerId } from '@shared/types';
import { BRAND, PAL } from '../core/draw';
import { localMarker, type MinigameRenderer } from './renderer';
import { drawCharacter, squash } from '../core/cast';

function jumpHeight(p: LaserPlayer): number {
  if (p.jump <= 0) return 0;
  return Math.round(Math.sin(Math.PI * (1 - p.jump / JUMP_TIME)) * 9);
}

function drawFloor(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = BRAND.roxo;
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);
  ctx.fillStyle = '#1a1830';
  ctx.fillRect(FIELD.x - 3, FIELD.y - 3, FIELD.w + 6, FIELD.h + 6);
  for (let y = 0; y < FIELD.h; y += 12) {
    for (let x = 0; x < FIELD.w; x += 12) {
      ctx.fillStyle = ((x + y) / 12) % 2 ? '#24223e' : '#211f3a';
      ctx.fillRect(FIELD.x + x, FIELD.y + y, 12, 12);
      ctx.fillStyle = '#2e2c4e';
      ctx.fillRect(FIELD.x + x, FIELD.y + y, 12, 1);
    }
  }
  // warning stripes on the rails
  for (let x = FIELD.x - 3; x < FIELD.x + FIELD.w + 3; x += 8) {
    ctx.fillStyle = '#ffd23e';
    ctx.fillRect(x, FIELD.y - 3, 4, 2);
    ctx.fillRect(x, FIELD.y + FIELD.h + 1, 4, 2);
  }
}

function drawEmitter(ctx: CanvasRenderingContext2D, st: LaserState, time: number): void {
  const warn = st.flipTimer < FLIP_WARNING && Math.floor(time * 16) % 2 === 0;
  ctx.fillStyle = PAL.ink;
  ctx.beginPath();
  ctx.arc(CENTER.x, CENTER.y, EMITTER_R + 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = warn ? '#ff3b5c' : '#5a5680';
  ctx.beginPath();
  ctx.arc(CENTER.x, CENTER.y, EMITTER_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = warn ? '#ffd23e' : '#ff3b5c';
  ctx.beginPath();
  ctx.arc(CENTER.x, CENTER.y, 4, 0, Math.PI * 2);
  ctx.fill();
  // rotation direction arrow
  const a = st.beamAngle + Math.sign(st.beamSpeed) * 0.9;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(Math.round(CENTER.x + Math.cos(a) * 7) - 1, Math.round(CENTER.y + Math.sin(a) * 7) - 1, 2, 2);
}

function drawBeams(ctx: CanvasRenderingContext2D, st: LaserState, time: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(FIELD.x, FIELD.y, FIELD.w, FIELD.h);
  ctx.clip();
  const step = (Math.PI * 2) / st.beams;
  for (let k = 0; k < st.beams; k++) {
    const a = st.beamAngle + k * step;
    const x0 = CENTER.x + Math.cos(a) * EMITTER_R;
    const y0 = CENTER.y + Math.sin(a) * EMITTER_R;
    const x1 = CENTER.x + Math.cos(a) * 400;
    const y1 = CENTER.y + Math.sin(a) * 400;
    for (const [color, width] of [
      ['rgba(255,40,80,0.25)', 6],
      ['#ff3b5c', 2.5],
      [Math.floor(time * 30) % 2 ? '#ffffff' : '#ffc0d0', 1],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawWall(ctx: CanvasRenderingContext2D, w: LaserWall, time: number): void {
  const length = w.vertical ? FIELD.h : FIELD.w;
  // Solid segments between the gaps.
  const segments: Array<[number, number]> = [];
  let start = 0;
  for (const g of [...w.gaps].sort((a, b) => a - b)) {
    segments.push([start, g]);
    start = g + GAP;
  }
  segments.push([start, length]);
  const flicker = Math.floor(time * 24) % 2 === 0;
  for (const [a, b] of segments) {
    if (b <= a) continue;
    const rect = (pad: number): [number, number, number, number] =>
      w.vertical
        ? [w.pos - WALL_THICK / 2 - pad, FIELD.y + a, WALL_THICK + pad * 2, b - a]
        : [FIELD.x + a, w.pos - WALL_THICK / 2 - pad, b - a, WALL_THICK + pad * 2];
    ctx.fillStyle = 'rgba(62,232,255,0.25)';
    ctx.fillRect(...rect(3));
    ctx.fillStyle = '#3ee8ff';
    ctx.fillRect(...rect(0));
    ctx.fillStyle = flicker ? '#ffffff' : '#aaf6ff';
    ctx.fillRect(...rect(-2));
    // emitter posts at each end of the segment
    ctx.fillStyle = '#c8c4e8';
    for (const end of [a, b]) {
      if (end <= 0 || end >= length) continue;
      if (w.vertical) ctx.fillRect(Math.round(w.pos - 4), Math.round(FIELD.y + end - 2), 8, 4);
      else ctx.fillRect(Math.round(FIELD.x + end - 2), Math.round(w.pos - 4), 4, 8);
    }
  }
}

function drawPlayer(ctx: CanvasRenderingContext2D, p: LaserPlayer, time: number): void {
  if (p.status === 'out' || (p.status === 'dead' && p.deathAnim <= 0)) return;
  if (p.ghost > 0 && Math.floor(time * 16) % 2 === 0) return;
  const dead = p.status === 'dead';
  const flash = dead && Math.floor(time * 20) % 2 === 0;
  const h = jumpHeight(p);
  ctx.fillStyle = 'rgba(20,6,46,0.45)';
  const sw = h > 0 ? 6 : 8;
  ctx.fillRect(Math.round(p.x - sw / 2), Math.round(p.y + 2), sw, 3);
  if (dead) {
    const s = Math.max(0.1, p.deathAnim / DEATH_ANIM);
    ctx.save();
    ctx.translate(Math.round(p.x), Math.round(p.y));
    ctx.scale(s, 1 + (1 - s));
    drawCharacter(ctx, p.character, 0, 2, { flash, pose: 'lose', time });
    ctx.restore();
    return;
  }
  const bob = p.walk > 0 && Math.floor(p.walk * 10) % 2 ? 1 : 0;
  const ss = squash(`laser${p.id}`, p.jump > 0, p.jump > JUMP_TIME / 2, time);
  drawCharacter(ctx, p.character, p.x, p.y + 2 - h, { frame: bob, pose: h > 0 ? 'jump' : 'idle', time, ...ss });
}

export const laserRenderer: MinigameRenderer = {
  positions(raw) {
    return (raw as LaserState).players.filter((p) => p.status === 'alive').map((p) => [p.id, p.x, p.y - 3]);
  },

  render(ctx, raw, time, localId: PlayerId) {
    const st = raw as LaserState;
    drawFloor(ctx);
    drawBeams(ctx, st, time);
    drawEmitter(ctx, st, time);
    const players = [...st.players].sort((a, b) => a.y - b.y);
    for (const p of players) drawPlayer(ctx, p, time);
    // Walls are tall: drawn over the players.
    for (const w of st.walls) drawWall(ctx, w, time);

    const me = st.players.find((p) => p.id === localId);
    if (me && me.status === 'alive') {
      localMarker(ctx, me.x, me.y - 11 - jumpHeight(me), time);
      if (me.jumpCd > 0) {
        ctx.fillStyle = PAL.ink;
        ctx.fillRect(Math.round(me.x - 5), Math.round(me.y + 5), 10, 2);
        ctx.fillStyle = PAL.cyan;
        ctx.fillRect(Math.round(me.x - 5), Math.round(me.y + 5), Math.round(10 * (1 - me.jumpCd / JUMP_COOLDOWN)), 2);
      }
    }
  },
};
