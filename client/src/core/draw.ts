import { drawPortrait } from './cast';

export const FONT = '"Press Start 2P", monospace';

/** Real canvas pixels per game pixel (2 = the 32-bit look: 768x432 backing store for a 384x216 game). */
export const RES = 2;

/** UI palette, built on the brand colors (BRAND below): Roxo Feed backgrounds, Creme text, no pure black or white. */
export const PAL = {
  ink: '#0a0614',
  night: '#1b0b3a', // Roxo Feed
  panel: '#2a1450',
  panelLight: '#4a2a80',
  white: '#fff4e0', // Creme Tela
  grey: '#9a8cc0',
  red: '#ff2e88', // Rosa Viral doubles as danger
  pink: '#ff5ac8',
  yellow: '#ffd23e',
  cyan: '#3ee8ff', // Ciano Notificação
  green: '#c6ff3d', // Verde Like
};

/** Brand colors from the style guide (docs/guia-de-estilo.html). */
export const BRAND = {
  rosa: '#ff2e88', // Rosa Viral: highlights, likes, the Algoritmo, danger
  verde: '#c6ff3d', // Verde Like: success, extra life, VIRALIZOU, action buttons
  roxo: '#1b0b3a', // Roxo Feed: the background of everything (never pure black)
  ciano: '#3ee8ff', // Ciano Notificação: notifications, returns, app UI
  creme: '#fff4e0', // Creme Tela: text and speech bubbles (never pure white)
};

type Align = 'left' | 'center' | 'right';

/** Pixel text with a 1px drop shadow. Size should be a multiple of 8 for crisp glyphs. */
export function text(
  ctx: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  color: string = PAL.white,
  size = 8,
  align: Align = 'left',
  shadow: string | null = PAL.ink,
): void {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  x = Math.round(x);
  y = Math.round(y);
  if (shadow) {
    ctx.fillStyle = shadow;
    ctx.fillText(str, x + 1, y + 1);
  }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

/** Text with a full 1px outline (for titles over busy backgrounds). */
export function outlinedText(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, color: string, size = 16, align: Align = 'center', outline = PAL.ink): void {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  x = Math.round(x);
  y = Math.round(y);
  ctx.fillStyle = outline;
  for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1], [2, 2], [-1, -1], [1, -1], [-1, 1]]) ctx.fillText(str, x + ox, y + oy);
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

/**
 * Draws a pixel sprite from rows of characters. Each char maps to a color in `colors`;
 * '.' (or any unmapped char) is transparent.
 */
export function sprite(ctx: CanvasRenderingContext2D, rows: readonly string[], x: number, y: number, colors: Record<string, string>, scale = 1, flip = false): void {
  x = Math.round(x);
  y = Math.round(y);
  const w = rows[0].length;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      const col = colors[row[c]];
      if (!col) continue;
      ctx.fillStyle = col;
      const cx = flip ? w - 1 - c : c;
      ctx.fillRect(x + cx * scale, y + r * scale, scale, scale);
    }
  }
}

export const HEART = ['.kk.kk.', 'krrkrrk', 'krwrrrk', 'krrrrrk', '.krrrk.', '..krk..', '...k...'];

export function heart(ctx: CanvasRenderingContext2D, x: number, y: number, full = true): void {
  sprite(ctx, HEART, x, y, full ? { k: PAL.ink, r: PAL.red, w: '#ffc0c8' } : { k: PAL.ink, r: '#4a3a5e', w: '#5a4a6e' });
}

/** Head-and-shoulders portrait of a player's influencer, (16 * scale) game pixels square. */
export function portrait(ctx: CanvasRenderingContext2D, character: number, x: number, y: number, scale = 1, dead = false): void {
  drawPortrait(ctx, character, x, y, scale, dead);
}

export function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string = PAL.panel, border: string = PAL.panelLight): void {
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = border;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fill;
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
}
