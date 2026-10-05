import type { PlayerId } from '@shared/types';

export interface MinigameRenderer {
  /** Draws the minigame in arena-local coordinates (the caller translates below the HUD). */
  render(ctx: CanvasRenderingContext2D, state: unknown, time: number, localId: PlayerId): void;
}

/** Deterministic hash noise for decorative details (stars, dithering) without storing anything. */
export function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Small pointer above the local player. */
export function localMarker(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void {
  const bob = Math.floor(time * 4) % 2;
  x = Math.round(x);
  y = Math.round(y) - bob;
  ctx.fillStyle = '#0a0614';
  ctx.fillRect(x - 3, y - 4, 7, 3);
  ctx.fillRect(x - 2, y - 1, 5, 1);
  ctx.fillRect(x - 1, y, 3, 1);
  ctx.fillStyle = '#ffd23e';
  ctx.fillRect(x - 2, y - 3, 5, 1);
  ctx.fillRect(x - 1, y - 2, 3, 1);
  ctx.fillRect(x, y - 1, 1, 1);
}
