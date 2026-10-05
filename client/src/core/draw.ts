import { CHARACTERS } from '@shared/types';

export const FONT = '"Press Start 2P", monospace';

export const PAL = {
  ink: '#0a0614',
  night: '#160c2a',
  panel: '#24163f',
  panelLight: '#3a2766',
  white: '#fff4e0',
  grey: '#8a80a8',
  red: '#ff3b5c',
  pink: '#ff5ac8',
  yellow: '#ffd23e',
  cyan: '#3ee8ff',
  green: '#5cf26a',
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

/** Little round mascot used for player portraits (16x16). */
const FACE = [
  '.....kkkkkk.....',
  '...kkccccccKk...',
  '..kccccccccccKk.',
  '.kccLLccccccccKk',
  '.kcLLccccccccccK',
  'kccLcckwwkkwwccK',
  'kcccckwwwkwwwkcK',
  'kcccckwbbkwbbkcK',
  'kcccckwbbkwbbkcK',
  'kccccckkkkkkkccK',
  'kccccccccccccccK',
  '.kcccckkkkkkcccK',
  '.kccccckddkcccK.',
  '..kKcccckkccKKk.',
  '...kkKKKKKKKkk..',
  '.....kkkkkk.....',
];

export function portrait(ctx: CanvasRenderingContext2D, character: number, x: number, y: number, scale = 1, dead = false): void {
  const ch = CHARACTERS[character];
  const colors = dead
    ? { k: PAL.ink, c: '#4a4060', K: '#2a2040', L: '#6a6080', w: '#8a80a8', b: '#8a80a8', d: '#2a2040' }
    : { k: PAL.ink, c: ch.color, K: ch.dark, L: ch.light, w: '#ffffff', b: PAL.ink, d: '#ff6a8a' };
  sprite(ctx, FACE, x, y, colors, scale);
}

export function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string = PAL.panel, border: string = PAL.panelLight): void {
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = border;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fill;
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
}
