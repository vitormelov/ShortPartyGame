import { ARENA_H, ARENA_W } from '@shared/arena';
import { GROUND_Y, HAND_H, ROPE_LEFT, ROPE_RIGHT, jumpHeight, ropeHeight, type Jumper, type RopeState } from '@shared/minigames/rope/logic';
import { CHARACTERS, type PlayerId } from '@shared/types';
import { PAL, outlinedText, sprite, text } from '../core/draw';
import { BLOB } from './meteor';
import { hash, localMarker, type MinigameRenderer } from './renderer';

/** Big angry hater that turns the rope (12x12 sprite drawn at 2x). */
const TURNER = [
  '...kkkkkk...',
  '..kccccccK..',
  '.kccccccccK.',
  'kcbbccccbbcK',
  'kccwbccbwccK',
  'kccwkcckwccK',
  'kccccccccccK',
  'kcccckkkcccK',
  'kccckcccckcK',
  '.kccccccccK.',
  '..kKKKKKKk..',
  '...kkkkkk...',
];

function drawBackground(ctx: CanvasRenderingContext2D, time: number): void {
  // Night sky with a lava glow on the horizon.
  const bands = ['#120a24', '#1a0c2a', '#2a0e2a', '#4a142a', '#7a1e24'];
  bands.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(0, i * 24, ARENA_W, 24);
  });
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = Math.sin(time * 2 + i) > 0.5 ? '#ffffff' : '#6a5a8a';
    ctx.fillRect(Math.floor(hash(i) * ARENA_W), Math.floor(hash(i + 20) * 70), 1, 1);
  }
  // Rising embers.
  for (let i = 0; i < 18; i++) {
    const x = Math.floor(hash(i + 50) * ARENA_W);
    const y = ARENA_H - ((time * 20 + hash(i + 80) * 200) % 200);
    ctx.fillStyle = i % 2 ? '#ff9a1e' : '#ffd23e';
    ctx.fillRect(x + Math.round(Math.sin(time * 2 + i) * 3), Math.round(y), 1, 2);
  }
  // Stage.
  ctx.fillStyle = '#2a1a14';
  ctx.fillRect(0, GROUND_Y, ARENA_W, ARENA_H - GROUND_Y);
  ctx.fillStyle = '#4a2e20';
  ctx.fillRect(0, GROUND_Y, ARENA_W, 3);
  for (let x = 0; x < ARENA_W; x += 16) {
    ctx.fillStyle = '#3a2418';
    ctx.fillRect(x, GROUND_Y + 3, 1, ARENA_H - GROUND_Y - 3);
  }
}

/** The rope: a quadratic curve between the turners' hands with its middle at the current height. */
function drawRope(ctx: CanvasRenderingContext2D, st: RopeState, time: number, front: boolean): void {
  const hy = GROUND_Y - HAND_H;
  const midY = GROUND_Y - ropeHeight(st.angle);
  const cy = 2 * midY - hy; // control point so the curve passes through midY
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(ROPE_LEFT, hy);
    ctx.quadraticCurveTo(ARENA_W / 2, cy, ROPE_RIGHT, hy);
  };
  ctx.globalAlpha = front ? 1 : 0.55;
  ctx.lineCap = 'round';
  path();
  ctx.strokeStyle = 'rgba(255,90,30,0.35)';
  ctx.lineWidth = 7;
  ctx.stroke();
  path();
  ctx.strokeStyle = '#ff6a1e';
  ctx.lineWidth = 3;
  ctx.stroke();
  path();
  ctx.strokeStyle = Math.floor(time * 20) % 2 ? '#ffe07a' : '#fff4c0';
  ctx.lineWidth = 1;
  ctx.stroke();
  // Flames licking off the rope.
  for (let k = 1; k < 12; k++) {
    const t = k / 12;
    const x = (1 - t) * (1 - t) * ROPE_LEFT + 2 * (1 - t) * t * (ARENA_W / 2) + t * t * ROPE_RIGHT;
    const y = (1 - t) * (1 - t) * hy + 2 * (1 - t) * t * cy + t * t * hy;
    const f = hash(k * 7 + Math.floor(time * 12));
    ctx.fillStyle = f > 0.5 ? '#ffd23e' : '#ff6a1e';
    ctx.fillRect(Math.round(x), Math.round(y - 2 - f * 4), 2, 2);
  }
  ctx.globalAlpha = 1;
}

function drawJumper(ctx: CanvasRenderingContext2D, j: Jumper, time: number): void {
  if (j.status === 'out') return;
  const ch = CHARACTERS[j.character];
  const colors = { k: PAL.ink, c: ch.color, L: ch.light, K: ch.dark, w: '#ffffff' };
  if (j.status === 'dead') {
    if (j.deathAnim <= 0) return;
    // Tripped: flat on the floor with stars, a little scorched.
    ctx.save();
    ctx.translate(Math.round(j.x), GROUND_Y - 4);
    ctx.rotate(Math.PI / 2);
    sprite(ctx, BLOB, -5, -8, { k: PAL.ink, c: '#5a3a2a', L: '#8a5a3a', K: '#3a2418', w: '#ffffff' });
    ctx.restore();
    for (let k = 0; k < 3; k++) {
      const a = time * 6 + (k * Math.PI * 2) / 3;
      ctx.fillStyle = PAL.yellow;
      ctx.fillRect(Math.round(j.x + Math.cos(a) * 8), Math.round(GROUND_Y - 16 + Math.sin(a) * 3), 2, 2);
    }
    return;
  }
  if (j.ghost > 0 && Math.floor(time * 16) % 2 === 0) return;
  const h = jumpHeight(j);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  const sw = h > 4 ? 6 : 9;
  ctx.fillRect(Math.round(j.x - sw / 2), GROUND_Y - 1, sw, 2);
  sprite(ctx, BLOB, j.x - 5, GROUND_Y - 10 - h, colors);
}

export const ropeRenderer: MinigameRenderer = {
  positions(raw) {
    return (raw as RopeState).jumpers.filter((j) => j.status === 'alive').map((j) => [j.id, j.x, GROUND_Y - 6 - jumpHeight(j)]);
  },

  render(ctx, raw, time, localId: PlayerId) {
    const st = raw as RopeState;
    drawBackground(ctx, time);

    // Turners at both ends.
    for (const [x, flip] of [
      [ROPE_LEFT - 14, false],
      [ROPE_RIGHT + 14, true],
    ] as const) {
      sprite(ctx, TURNER, x - 12, GROUND_Y - 24, { k: PAL.ink, c: '#e83b3b', K: '#8a1a2a', b: '#1a0a14', w: '#ffffff' }, 2, flip);
    }

    // The rope is behind the players on the way up (angle in (PI, 2PI)), in front on the way down.
    const a = ((st.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const front = a < Math.PI;
    if (!front) drawRope(ctx, st, time, false);
    const order = [...st.jumpers].sort((p, q) => p.x - q.x);
    for (const j of order) drawJumper(ctx, j, time);
    if (front) drawRope(ctx, st, time, true);

    const me = st.jumpers.find((j) => j.id === localId);
    if (me && me.status === 'alive') {
      localMarker(ctx, me.x, GROUND_Y - 14 - jumpHeight(me), time);
      text(ctx, `PULOS: ${me.jumps}`, 6, 6, PAL.yellow);
    }
    if (st.paceMsgT > 0 && Math.floor(time * 8) % 2 === 0) outlinedText(ctx, st.paceMsg, ARENA_W / 2, 20, st.paceMsg === 'ACELEROU!' ? PAL.red : PAL.cyan, 16);
  },
};
