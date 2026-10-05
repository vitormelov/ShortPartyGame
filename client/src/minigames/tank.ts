import { ARENA_H, ARENA_W } from '@shared/arena';
import { CELL, COLS, CRATE, MAX_HP, ROWS, STEEL, type PowerUp, type Tank, type TankState } from '@shared/minigames/tank/logic';
import { CHARACTERS, type PlayerId } from '@shared/types';
import { PAL } from '../core/draw';
import { hash, localMarker, type MinigameRenderer } from './renderer';

function drawGround(ctx: CanvasRenderingContext2D, st: TankState): void {
  ctx.fillStyle = '#2a1e10';
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = c * CELL;
      const y = r * CELL;
      const kind = st.grid[r * COLS + c];
      if (kind === STEEL) {
        ctx.fillStyle = '#3a3a4a';
        ctx.fillRect(x, y, CELL, CELL);
        ctx.fillStyle = '#7a7a8e';
        ctx.fillRect(x, y, CELL - 1, CELL - 1);
        ctx.fillStyle = '#a8a8bc';
        ctx.fillRect(x, y, CELL - 1, 1);
        ctx.fillRect(x, y, 1, CELL - 1);
        ctx.fillStyle = '#4a4a5a';
        ctx.fillRect(x + 2, y + 2, 1, 1);
        ctx.fillRect(x + CELL - 4, y + 2, 1, 1);
        ctx.fillRect(x + 2, y + CELL - 4, 1, 1);
        ctx.fillRect(x + CELL - 4, y + CELL - 4, 1, 1);
        continue;
      }
      ctx.fillStyle = (r + c) % 2 ? '#c8a46a' : '#c09a5e';
      ctx.fillRect(x, y, CELL, CELL);
      if (hash(r * 37 + c) > 0.7) {
        ctx.fillStyle = '#a8844a';
        ctx.fillRect(x + Math.floor(hash(c * 11 + r) * 9), y + Math.floor(hash(c + r * 17) * 9), 2, 1);
      }
      if (kind === CRATE) {
        ctx.fillStyle = '#4a2a10';
        ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
        ctx.fillStyle = '#a8662a';
        ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
        ctx.fillStyle = '#6a3a14';
        for (let k = 0; k < CELL - 4; k++) {
          ctx.fillRect(x + 2 + k, y + 2 + k, 1, 1);
          ctx.fillRect(x + CELL - 3 - k, y + 2 + k, 1, 1);
        }
      }
    }
  }
}

function drawPowerUp(ctx: CanvasRenderingContext2D, p: PowerUp, time: number): void {
  const x = p.c * CELL;
  const y = p.r * CELL;
  ctx.fillStyle = Math.floor(time * 6) % 2 ? PAL.yellow : '#ff8a3a';
  ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
  ctx.fillStyle = '#ffffff';
  if (p.kind === 'triple') {
    ctx.fillRect(x + 5, y + 3, 2, 2);
    ctx.fillRect(x + 3, y + 7, 2, 2);
    ctx.fillRect(x + 7, y + 7, 2, 2);
  } else if (p.kind === 'bounce') {
    for (let k = 0; k < 6; k++) ctx.fillRect(x + 3 + k, y + 3 + (k < 3 ? k * 2 : (5 - k) * 2), 1, 1);
  } else {
    ctx.fillStyle = PAL.cyan;
    ctx.fillRect(x + 4, y + 3, 4, 5);
    ctx.fillRect(x + 5, y + 8, 2, 1);
  }
}

function drawTank(ctx: CanvasRenderingContext2D, t: Tank, time: number): void {
  if (t.status === 'out') return;
  const ch = CHARACTERS[t.character];
  if (t.status === 'dead') {
    if (t.deathAnim <= 0) return;
    // Burnt wreck while the explosion plays.
    ctx.fillStyle = '#2a2420';
    ctx.fillRect(Math.round(t.x - 5), Math.round(t.y - 4), 10, 8);
    ctx.fillStyle = '#4a3a30';
    ctx.fillRect(Math.round(t.x - 2), Math.round(t.y - 2), 4, 4);
    return;
  }
  if (t.ghost > 0 && Math.floor(time * 16) % 2 === 0) return;
  const flash = t.hitT > 0 && Math.floor(time * 24) % 2 === 0;
  const a = t.angle;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(Math.round(t.x - 5), Math.round(t.y + 3), 11, 3);
  ctx.save();
  ctx.translate(Math.round(t.x), Math.round(t.y));
  ctx.rotate(a);
  // treads (animated stripes)
  const phase = Math.floor(t.tread * 20) % 2;
  for (const side of [-1, 1]) {
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(-6, side < 0 ? -6 : 3, 12, 3);
    ctx.fillStyle = '#5a5a6a';
    for (let k = -5 + phase; k < 6; k += 2) ctx.fillRect(k, side < 0 ? -5 : 4, 1, 1);
  }
  // hull
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(-5, -4, 10, 8);
  ctx.fillStyle = flash ? '#ffffff' : ch.color;
  ctx.fillRect(-4, -3, 8, 6);
  ctx.fillStyle = flash ? '#ffffff' : ch.dark;
  ctx.fillRect(-4, 1, 8, 2);
  // barrel + turret
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(0, -1, 9, 3);
  ctx.fillStyle = '#c8c4d8';
  ctx.fillRect(1, 0, 7, 1);
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(-3, -3, 6, 6);
  ctx.fillStyle = flash ? '#ffffff' : ch.light;
  ctx.fillRect(-2, -2, 4, 4);
  ctx.restore();

  if (t.shield) {
    ctx.strokeStyle = Math.floor(time * 8) % 2 ? PAL.cyan : '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(Math.round(t.x), Math.round(t.y), 9, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Damaged: smoke puffs.
  if (t.hp < MAX_HP) {
    for (let k = 0; k < 3; k++) {
      const p = (time * 1.5 + k / 3) % 1;
      ctx.fillStyle = `rgba(80,80,90,${0.7 - p * 0.7})`;
      ctx.fillRect(Math.round(t.x - 2 + k * 2 + Math.sin(time * 3 + k) * 2), Math.round(t.y - 6 - p * 10), 3, 3);
    }
  }
}

export const tankRenderer: MinigameRenderer = {
  positions(raw) {
    return (raw as TankState).tanks.filter((t) => t.status === 'alive').map((t) => [t.id, t.x, t.y - 2]);
  },

  render(ctx, raw, time, localId: PlayerId) {
    const st = raw as TankState;
    drawGround(ctx, st);
    for (const p of st.powerups) drawPowerUp(ctx, p, time);
    const tanks = [...st.tanks].sort((a, b) => a.y - b.y);
    for (const t of tanks) drawTank(ctx, t, time);

    for (const s of st.shells) {
      const sp = Math.hypot(s.vx, s.vy) || 1;
      const ux = s.vx / sp;
      const uy = s.vy / sp;
      // smoke trail
      for (let k = 1; k <= 4; k++) {
        ctx.fillStyle = `rgba(230,225,215,${0.5 - k * 0.1})`;
        ctx.fillRect(Math.round(s.x - ux * k * 3) - 1, Math.round(s.y - uy * k * 3) - 1, 2, 2);
      }
      ctx.save();
      ctx.translate(Math.round(s.x), Math.round(s.y));
      ctx.rotate(Math.atan2(uy, ux));
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(-3, -2, 6, 4);
      ctx.fillStyle = '#8a8478';
      ctx.fillRect(-2, -1, 3, 2);
      ctx.fillStyle = '#e8c86a';
      ctx.fillRect(1, -1, 2, 2);
      ctx.restore();
    }

    for (const b of st.booms) {
      const k = b.t / 0.5;
      const r = (b.big ? 16 : 6) * (0.4 + k);
      ctx.fillStyle = `rgba(255,${Math.round(200 - k * 150)},40,${1 - k})`;
      ctx.beginPath();
      ctx.arc(Math.round(b.x), Math.round(b.y), r, 0, Math.PI * 2);
      ctx.fill();
      if (b.big && k < 0.5) {
        ctx.fillStyle = `rgba(255,255,220,${1 - k * 2})`;
        ctx.beginPath();
        ctx.arc(Math.round(b.x), Math.round(b.y), r * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const me = st.tanks.find((t) => t.id === localId);
    if (me && me.status === 'alive') {
      localMarker(ctx, me.x, me.y - 10, time);
      // HP pips + cooldown
      for (let k = 0; k < MAX_HP; k++) {
        ctx.fillStyle = PAL.ink;
        ctx.fillRect(Math.round(me.x - 6 + k * 7), Math.round(me.y + 7), 5, 3);
        ctx.fillStyle = k < me.hp ? PAL.green : '#3a2a50';
        ctx.fillRect(Math.round(me.x - 5 + k * 7), Math.round(me.y + 8), 3, 1);
      }
    }
  },
};
