import { ARENA_H, ARENA_W } from '@shared/arena';
import { DEATH_ANIM, FURNITURE, GLOW_R, LIGHT_HALF, LIGHT_LEN, ROOM, inLight, type LPlayer, type LanternState } from '@shared/minigames/lantern/logic';
import { CHARACTERS, type PlayerId } from '@shared/types';
import { PAL, sprite } from '../core/draw';
import { BLOB } from './meteor';
import { hash, localMarker, type MinigameRenderer } from './renderer';

const GHOST = [
  '....kkkk....',
  '..kkwwwwkk..',
  '.kwwwwwwwwk.',
  '.kwwwwwwwwk.',
  'kwwkkwwkkwwk',
  'kwwkkwwkkwwk',
  'kwwwwwwwwwwk',
  'kwwwwkkwwwwk',
  'kwwwkkkkwwwk',
  'kwwwwwwwwwwk',
  'kwwwwwwwwwwk',
  'kwkwwkwwkwwk',
  '.k.kk.kk.kk.',
];

let darkCanvas: HTMLCanvasElement | null = null;
function darkLayer(): CanvasRenderingContext2D {
  if (!darkCanvas) {
    darkCanvas = document.createElement('canvas');
    darkCanvas.width = ARENA_W;
    darkCanvas.height = ARENA_H;
  }
  return darkCanvas.getContext('2d')!;
}

function lightOn(p: LPlayer, time: number): boolean {
  if (!p.light || p.status !== 'alive') return false;
  // Low battery flickers.
  return !(p.battery < 0.2 && hash(Math.floor(time * 15) + p.id * 7) < 0.35);
}

function conePath(ctx: CanvasRenderingContext2D, p: LPlayer): void {
  const a = Math.atan2(p.fy, p.fx);
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.arc(p.x, p.y, LIGHT_LEN, a - LIGHT_HALF, a + LIGHT_HALF);
  ctx.closePath();
}

function drawRoom(ctx: CanvasRenderingContext2D): void {
  // Wallpaper.
  ctx.fillStyle = '#2a1430';
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);
  for (let x = 0; x < ARENA_W; x += 8) {
    ctx.fillStyle = '#3a1c40';
    ctx.fillRect(x, 0, 2, ARENA_H);
  }
  // Wooden floor.
  for (let y = ROOM.y; y < ROOM.y + ROOM.h; y += 6) {
    const row = (y - ROOM.y) / 6;
    ctx.fillStyle = row % 2 ? '#5a3a24' : '#543620';
    ctx.fillRect(ROOM.x, y, ROOM.w, 6);
    ctx.fillStyle = '#3a2414';
    ctx.fillRect(ROOM.x, y + 5, ROOM.w, 1);
    for (let x = ROOM.x + ((row * 23) % 40); x < ROOM.x + ROOM.w; x += 40) ctx.fillRect(x, y, 1, 5);
  }
  // Rug in the middle.
  ctx.fillStyle = '#6a1a24';
  ctx.fillRect(130, 70, 124, 64);
  ctx.fillStyle = '#8a2a30';
  ctx.fillRect(134, 74, 116, 56);
  ctx.fillStyle = '#c8a03a';
  ctx.fillRect(138, 78, 108, 1);
  ctx.fillRect(138, 125, 108, 1);

  FURNITURE.forEach(([x, y, w, h], i) => {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(x + 2, y + h, w, 3);
    ctx.fillStyle = '#1a0e08';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = i === 2 ? '#141018' : '#6a4228';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = i === 2 ? '#2a2430' : '#8a5a36';
    ctx.fillRect(x, y, w, 3);
    if (i === 2) {
      // piano keys
      for (let k = 0; k < w - 4; k += 3) {
        ctx.fillStyle = '#e8e0d0';
        ctx.fillRect(x + 2 + k, y + h - 6, 2, 5);
      }
    }
    if (i === 3) {
      // coffin cross
      ctx.fillStyle = '#c8a03a';
      ctx.fillRect(x + w / 2 - 1, y + 6, 2, 14);
      ctx.fillRect(x + w / 2 - 5, y + 10, 10, 2);
    }
  });
}

function drawPlayer(ctx: CanvasRenderingContext2D, p: LPlayer, time: number): void {
  if (p.status === 'out' || (p.status === 'dead' && p.deathAnim <= 0)) return;
  if (p.ghost > 0 && Math.floor(time * 16) % 2 === 0) return;
  const ch = CHARACTERS[p.character];
  const dead = p.status === 'dead';
  const flash = dead && Math.floor(time * 20) % 2 === 0;
  const colors = flash
    ? { k: '#ffffff', c: '#ff3b5c', L: '#ff3b5c', K: '#ff3b5c', w: '#ffffff' }
    : { k: PAL.ink, c: ch.color, L: ch.light, K: ch.dark, w: '#ffffff' };
  const bob = p.walk > 0 && Math.floor(p.walk * 10) % 2 ? 1 : 0;
  if (dead) {
    const s = Math.max(0.1, p.deathAnim / DEATH_ANIM);
    ctx.save();
    ctx.translate(Math.round(p.x), Math.round(p.y));
    ctx.scale(s, s);
    sprite(ctx, BLOB, -5, -8, colors);
    ctx.restore();
    return;
  }
  sprite(ctx, BLOB, p.x - 5, p.y - 8 - bob, colors);
  // the flashlight itself
  ctx.fillStyle = '#c8c4e8';
  ctx.fillRect(Math.round(p.x + p.fx * 5) - 1, Math.round(p.y + p.fy * 5) - 1, 2, 2);
}

export const lanternRenderer: MinigameRenderer = {
  render(ctx, raw, time, localId: PlayerId) {
    const st = raw as LanternState;
    drawRoom(ctx);
    const players = [...st.players].sort((a, b) => a.y - b.y);
    for (const p of players) drawPlayer(ctx, p, time);

    // Darkness with holes cut by every light.
    const dk = darkLayer();
    dk.globalCompositeOperation = 'source-over';
    dk.clearRect(0, 0, ARENA_W, ARENA_H);
    dk.fillStyle = 'rgba(4,2,10,0.97)';
    dk.fillRect(0, 0, ARENA_W, ARENA_H);
    dk.globalCompositeOperation = 'destination-out';
    for (const p of st.players) {
      if (p.status === 'out' || (p.status === 'dead' && p.deathAnim <= 0)) continue;
      const glow = dk.createRadialGradient(p.x, p.y, 2, p.x, p.y, GLOW_R);
      glow.addColorStop(0, 'rgba(0,0,0,0.9)');
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      dk.fillStyle = glow;
      dk.beginPath();
      dk.arc(p.x, p.y, GLOW_R, 0, Math.PI * 2);
      dk.fill();
      if (lightOn(p, time)) {
        const g = dk.createRadialGradient(p.x, p.y, 4, p.x, p.y, LIGHT_LEN);
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(0.7, 'rgba(0,0,0,0.85)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        dk.fillStyle = g;
        conePath(dk, p);
        dk.fill();
      }
    }
    ctx.drawImage(darkCanvas!, 0, 0);

    // Warm tint inside the cones.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(80,60,20,0.25)';
    for (const p of st.players) {
      if (!lightOn(p, time)) continue;
      conePath(ctx, p);
      ctx.fill();
    }
    ctx.restore();

    for (const g of st.ghosts) {
      if (g.respawn > 0) {
        // banish puff
        if (g.respawn > 1.1) {
          const p = (1.5 - g.respawn) / 0.4;
          ctx.fillStyle = `rgba(200,220,255,${1 - p})`;
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            ctx.fillRect(Math.round(g.x + Math.cos(a) * p * 14), Math.round(g.y + Math.sin(a) * p * 14), 2, 2);
          }
        }
        continue;
      }
      const seen = st.players.some((p) => p.status === 'alive' && inLight(p, g.x, g.y));
      if (seen) {
        const burn = g.lit && Math.floor(time * 20) % 2 === 0;
        ctx.globalAlpha = 0.85;
        sprite(ctx, GHOST, g.x - 6, g.y - 8 + Math.round(Math.sin(time * 5 + g.id) * 1.5), {
          k: '#1a1a3a',
          w: burn ? '#ffb0b0' : '#e8f0ff',
        });
        ctx.globalAlpha = 1;
      } else {
        // In the dark you only see the eyes.
        ctx.fillStyle = `rgba(255,40,60,${0.3 + 0.2 * Math.sin(time * 3 + g.id)})`;
        ctx.fillRect(Math.round(g.x - 3), Math.round(g.y - 4), 2, 1);
        ctx.fillRect(Math.round(g.x + 1), Math.round(g.y - 4), 2, 1);
      }
    }

    const me = st.players.find((p) => p.id === localId);
    if (me && me.status === 'alive') {
      localMarker(ctx, me.x, me.y - 11, time);
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(Math.round(me.x - 6), Math.round(me.y + 5), 12, 3);
      ctx.fillStyle = me.battery < 0.2 ? PAL.red : me.battery < 0.5 ? PAL.yellow : PAL.green;
      ctx.fillRect(Math.round(me.x - 5), Math.round(me.y + 6), Math.round(10 * me.battery), 1);
    }
  },
};
