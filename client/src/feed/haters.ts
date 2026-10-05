import { ARENA_H, HUD_H, SCREEN_H, SCREEN_W } from '@shared/arena';
import type { FeedSnapshot } from '@shared/feed';
import { COMMENT_COST, HATER_MENU, MAX_CHARGE, type HaterComment, type HaterPanel } from '@shared/haters';
import { CHARACTERS, type PlayerId } from '@shared/types';
import { PAL, outlinedText, panel, text } from '../core/draw';
import { arrow } from '../minigames/mimic';

function nameOf(snap: FeedSnapshot, id: PlayerId): string {
  return snap.players.find((p) => p.info.id === id)?.info.name ?? '?';
}

/** White speech bubble with the author's color tab; (x, y) is the top-left in screen coords. */
function bubble(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, authorCharacter: number, pointer: boolean): void {
  const w = str.length * 8 + 14;
  x = Math.round(Math.max(2, Math.min(SCREEN_W - w - 2, x)));
  y = Math.round(Math.max(HUD_H + 2, Math.min(HUD_H + ARENA_H - 16, y)));
  panel(ctx, x, y, w, 13, '#ffffff', PAL.ink);
  ctx.fillStyle = CHARACTERS[authorCharacter].color;
  ctx.fillRect(x + 1, y + 1, 4, 11);
  text(ctx, str, x + 8, y + 3, PAL.ink, 8, 'left', null);
  if (pointer) {
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(x + w / 2 - 3, y + 13, 7, 2);
    ctx.fillRect(x + w / 2 - 1, y + 15, 3, 2);
  }
}

function drawComment(ctx: CanvasRenderingContext2D, snap: FeedSnapshot, c: HaterComment, pos: Map<PlayerId, [number, number]>, time: number): void {
  const fade = Math.min(1, (c.life - c.age) / 0.3);
  ctx.globalAlpha = fade;
  const at = c.target >= 0 ? pos.get(c.target) : undefined;
  if (c.kind === 'common') {
    // Floats up like a live-stream comment.
    const rise = (c.age / c.life) * 70;
    bubble(ctx, c.text, c.x, HUD_H + c.y + 30 - rise, c.authorCharacter, false);
  } else if (c.kind === 'tag') {
    const str = `@${nameOf(snap, c.target)} ${c.text}`;
    if (at) bubble(ctx, str, at[0] - (str.length * 8 + 14) / 2, HUD_H + at[1] - 30, c.authorCharacter, true);
    else bubble(ctx, str, c.x, HUD_H + c.y, c.authorCharacter, false);
  } else {
    // Fake tip: a big blinking arrow pointing the wrong way.
    const cx = at ? at[0] : SCREEN_W / 2;
    // Below the target (so it doesn't sit on a tagged comment), or above it when the target is
    // near the bottom, where the hater panel lives.
    const below = at && at[1] + 22 < ARENA_H - 48;
    const cy = HUD_H + (at ? (below ? at[1] + 22 : Math.max(24, at[1] - 50)) : ARENA_H / 2);
    const hot = Math.floor(time * 10) % 2 === 0;
    if (c.dir === 4) {
      panel(ctx, cx - 30, cy - 9, 60, 16, hot ? PAL.yellow : PAL.white, PAL.ink);
      text(ctx, 'ESPAÇO', cx, cy - 5, PAL.ink, 8, 'center', null);
    } else {
      arrow(ctx, cx + 1, cy + 1, c.dir, 4, PAL.ink);
      arrow(ctx, cx, cy, c.dir, 4, hot ? PAL.yellow : PAL.red);
    }
    outlinedText(ctx, c.text, cx, cy + 14, hot ? PAL.yellow : PAL.white, 8);
  }
  ctx.globalAlpha = 1;
}

export function drawComments(ctx: CanvasRenderingContext2D, snap: FeedSnapshot, positions: Array<[PlayerId, number, number]>, time: number): void {
  const pos = new Map(positions.map(([id, x, y]) => [id, [x, y] as [number, number]]));
  for (const c of snap.comments) drawComment(ctx, snap, c, pos, time);
}

/** Bottom panel for the local player in hater mode. */
export function drawHaterPanel(ctx: CanvasRenderingContext2D, snap: FeedSnapshot, h: HaterPanel, time: number): void {
  const w = 222;
  const x = SCREEN_W - w - 4;
  const y = SCREEN_H - 28;
  text(ctx, 'W/S COMENTÁRIO  A/D ALVO  ESPAÇO', x + w, y - 10, PAL.grey, 8, 'right');
  panel(ctx, x, y, w, 26, 'rgba(10,6,20,0.92)', PAL.pink);
  text(ctx, 'MODO HATER', x + 5, y + 3, PAL.pink);
  // Charge pips.
  for (let k = 0; k < MAX_CHARGE; k++) {
    const fill = Math.max(0, Math.min(1, h.charge - k));
    const px = x + w - 46 + k * 14;
    ctx.fillStyle = '#3a2a50';
    ctx.fillRect(px, y + 3, 11, 7);
    ctx.fillStyle = fill >= 1 ? PAL.red : '#a83a5a';
    ctx.fillRect(px, y + 3, Math.round(11 * fill), 7);
  }
  const opt = HATER_MENU[h.menu];
  const cost = COMMENT_COST[opt.kind];
  const can = h.charge >= cost;
  const color = !can ? PAL.grey : opt.kind === 'fake' ? PAL.yellow : opt.kind === 'tag' ? PAL.cyan : PAL.white;
  const alive = snap.players.filter((p) => !p.eliminated);
  const target = h.target >= 0 && alive[h.target] ? `@${alive[h.target].info.name}` : opt.kind === 'common' ? '' : '@TODOS';
  text(ctx, `${Math.floor(time * 3) % 2 ? '<' : ' '}${opt.text}${Math.floor(time * 3) % 2 ? '>' : ' '}`, x + 5, y + 14, color);
  if (target) text(ctx, target, x + w - 5, y + 14, PAL.cyan, 8, 'right');
  text(ctx, cost === 2 ? '2' : '1', x + w - 54, y + 3, PAL.grey, 8, 'right');
}
