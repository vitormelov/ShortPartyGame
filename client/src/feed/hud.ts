import { ARENA_H, HUD_H, SCREEN_W } from '@shared/arena';
import type { FeedSnapshot } from '@shared/feed';
import { CHARACTERS, type PlayerId } from '@shared/types';
import { PAL, heart, sprite, text } from '../core/draw';
import { hash } from '../minigames/renderer';

const MINI_HEART = ['.r.r.', 'rrrrr', 'rrrrr', '.rrr.', '..r..'];

/** Top strip: story-style progress bar + every player's lives. */
export function drawTopHud(ctx: CanvasRenderingContext2D, snap: FeedSnapshot, localId: PlayerId, flashes: Map<PlayerId, number>, time: number): void {
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(0, 0, SCREEN_W, HUD_H);

  // Story progress bar.
  let progress = 0;
  if (snap.phase === 'play') progress = Math.min(1, snap.clipTime / snap.clipDuration);
  ctx.fillStyle = '#4a3a6e';
  ctx.fillRect(1, 0, SCREEN_W - 2, 2);
  ctx.fillStyle = progress > 0.8 && Math.floor(time * 8) % 2 ? PAL.red : PAL.white;
  ctx.fillRect(1, 0, Math.floor((SCREEN_W - 2) * progress), 2);

  const n = snap.players.length;
  const chipW = Math.floor(SCREEN_W / n);
  snap.players.forEach((p, i) => {
    const x = i * chipW;
    const ch = CHARACTERS[p.info.character];
    const flash = (flashes.get(p.info.id) ?? 0) > 0 && Math.floor(time * 16) % 2 === 0;
    if (p.info.id === localId) {
      ctx.fillStyle = '#2e1d55';
      ctx.fillRect(x, 3, chipW - 1, 8);
    }
    if (flash) {
      ctx.fillStyle = PAL.red;
      ctx.fillRect(x, 3, chipW - 1, 8);
    }
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(x + 1, 3, 8, 8);
    ctx.fillStyle = p.eliminated ? '#4a4060' : ch.color;
    ctx.fillRect(x + 2, 4, 6, 6);
    ctx.fillStyle = p.eliminated ? '#2a2040' : ch.light;
    ctx.fillRect(x + 3, 5, 2, 1);

    if (p.eliminated) {
      ctx.fillStyle = PAL.grey;
      for (let k = 0; k < 6; k++) {
        ctx.fillRect(x + 12 + k, 4 + k, 1, 1);
        ctx.fillRect(x + 17 - k, 4 + k, 1, 1);
      }
      return;
    }
    const space = chipW - 12;
    if (snap.maxLives * 6 <= space) {
      for (let h = 0; h < snap.maxLives; h++) {
        const full = h < p.lives;
        sprite(ctx, MINI_HEART, x + 11 + h * 6, 5, { r: full ? PAL.red : '#3a2a50' });
      }
    } else {
      sprite(ctx, MINI_HEART, x + 11, 5, { r: PAL.red });
      text(ctx, `${p.lives}`, x + 18, 4, PAL.white, 8, 'left', null);
    }
  });
}

function formatCount(n: number): string {
  if (n >= 1000) return `${Math.floor(n / 1000)}K`;
  return `${n}`;
}

/** The fake social media chrome over the clip: like/comment/share column and the handle. */
export function drawSocialOverlay(ctx: CanvasRenderingContext2D, snap: FeedSnapshot, time: number): void {
  const clip = snap.clip;
  if (!clip) return;
  const seed = clip.instanceId * 13 + clip.shown;
  const likes = Math.floor(2000 + hash(seed) * 90000 + time * 40);
  const comments = Math.floor(100 + hash(seed + 1) * 4000);
  const shares = Math.floor(50 + hash(seed + 2) * 2000);
  const x = SCREEN_W - 20;
  const base = HUD_H + ARENA_H - 92;

  ctx.globalAlpha = 0.9;
  heart(ctx, x + 1, base);
  text(ctx, formatCount(likes), x + 4, base + 9, PAL.white, 8, 'center');

  // comment bubble
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(x, base + 24, 9, 7);
  ctx.fillRect(x + 1, base + 31, 2, 2);
  ctx.fillStyle = PAL.white;
  ctx.fillRect(x + 1, base + 25, 7, 5);
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(x + 2, base + 27, 1, 1);
  ctx.fillRect(x + 4, base + 27, 1, 1);
  ctx.fillRect(x + 6, base + 27, 1, 1);
  text(ctx, formatCount(comments), x + 4, base + 35, PAL.white, 8, 'center');

  // share arrow
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(x, base + 50, 10, 7);
  ctx.fillStyle = PAL.white;
  ctx.fillRect(x + 1, base + 53, 6, 2);
  ctx.fillRect(x + 6, base + 51, 1, 5);
  ctx.fillRect(x + 7, base + 52, 1, 3);
  ctx.fillRect(x + 8, base + 53, 1, 1);
  text(ctx, formatCount(shares), x + 4, base + 61, PAL.white, 8, 'center');
  ctx.globalAlpha = 1;

  const y = HUD_H + ARENA_H - 20;
  ctx.fillStyle = 'rgba(10,6,20,0.6)';
  ctx.fillRect(0, y - 3, 152, 23);
  text(ctx, clip.handle, 4, y, PAL.white);
  const marquee = 'som original - shortparty - ';
  const offset = Math.floor(time * 6) % marquee.length;
  text(ctx, (marquee + marquee).slice(offset, offset + 18), 4, y + 10, PAL.grey);
}
