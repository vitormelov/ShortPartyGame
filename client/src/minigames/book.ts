import { ARENA_H, ARENA_W } from '@shared/arena';
import { DEATH_ANIM, FIELD, SHOVE_COOLDOWN, SLAM_TIME, TURN_TIME, type BookPlayer, type BookState, type Hole } from '@shared/minigames/book/logic';
import { type PlayerId } from '@shared/types';
import { PAL, outlinedText, text } from '../core/draw';
import { hash, localMarker, type MinigameRenderer } from './renderer';
import { drawCharacter } from '../core/cast';

function drawTable(ctx: CanvasRenderingContext2D): void {
  for (let y = 0; y < ARENA_H; y += 6) {
    ctx.fillStyle = (y / 6) % 2 ? '#3a2414' : '#36200f';
    ctx.fillRect(0, y, ARENA_W, 6);
    ctx.fillStyle = '#2a1608';
    ctx.fillRect(0, y + 5, ARENA_W, 1);
  }
  // Book cover peeking out + spine on the left.
  ctx.fillStyle = '#6a1a24';
  ctx.fillRect(FIELD.x - 10, FIELD.y - 5, FIELD.w + 16, FIELD.h + 10);
  ctx.fillStyle = '#8a2a30';
  ctx.fillRect(FIELD.x - 10, FIELD.y - 5, 6, FIELD.h + 10);
}

/** Fake legal text: rows of grey bars. */
function textLines(ctx: CanvasRenderingContext2D, color: string, seed: number, fromY: number): void {
  ctx.fillStyle = color;
  let row = 0;
  for (let y = fromY; y < FIELD.y + FIELD.h - 8; y += 7) {
    let x = FIELD.x + 12;
    let w = 0;
    for (let k = 0; x < FIELD.x + FIELD.w - 14; k++) {
      w = 6 + Math.floor(hash(seed * 97 + row * 31 + k) * 22);
      w = Math.min(w, FIELD.x + FIELD.w - 14 - x);
      ctx.fillRect(x, y, w, 2);
      x += w + 3;
    }
    row++;
  }
}

function drawFloorPage(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#efe4c8';
  ctx.fillRect(FIELD.x, FIELD.y, FIELD.w, FIELD.h);
  textLines(ctx, '#ddd0b0', 1, FIELD.y + 10);
  ctx.fillStyle = '#d8c8a0';
  ctx.fillRect(FIELD.x, FIELD.y, 3, FIELD.h);
}

function holesPath(ctx: CanvasRenderingContext2D, holes: Hole[]): void {
  ctx.beginPath();
  ctx.rect(FIELD.x, FIELD.y, FIELD.w, FIELD.h);
  for (const h of holes) ctx.rect(h.x, h.y, h.w, h.h);
}

/** The slamming page itself (holes cut out), optionally squashed horizontally while turning. */
function drawPage(ctx: CanvasRenderingContext2D, st: BookState, scaleX: number, back: boolean): void {
  ctx.save();
  ctx.translate(FIELD.x, 0);
  ctx.scale(scaleX, 1);
  ctx.translate(-FIELD.x, 0);
  holesPath(ctx, st.holes);
  ctx.fillStyle = back ? '#c8b890' : '#fffaf0';
  ctx.fill('evenodd');
  ctx.save();
  holesPath(ctx, st.holes);
  ctx.clip('evenodd');
  if (!back) {
    outlinedText(ctx, 'TERMOS DE USO', FIELD.x + FIELD.w / 2, FIELD.y + 6, '#3a2a5a', 8, 'center', '#fffaf0');
    textLines(ctx, '#9a90b0', st.page + 3, FIELD.y + 20);
    text(ctx, `CLÁUSULA ${st.page}`, FIELD.x + FIELD.w - 6, FIELD.y + FIELD.h - 10, '#9a90b0', 8, 'right', null);
  }
  ctx.restore();
  // hole edges
  ctx.strokeStyle = '#8a7a5a';
  ctx.lineWidth = 1;
  for (const h of st.holes) ctx.strokeRect(h.x + 0.5, h.y + 0.5, h.w - 1, h.h - 1);
  ctx.restore();
}

function drawPlayer(ctx: CanvasRenderingContext2D, p: BookPlayer, time: number): void {
  if (p.status === 'out') return;
  if (p.status === 'dead') {
    if (p.deathAnim <= 0) return;
    // Pancake.
    ctx.save();
    ctx.globalAlpha = Math.min(1, p.deathAnim / (DEATH_ANIM * 0.5));
    ctx.translate(Math.round(p.x), Math.round(p.y));
    ctx.scale(1.6, 0.3);
    drawCharacter(ctx, p.character, 0, 4, { pose: 'lose', time });
    ctx.restore();
    return;
  }
  if (p.ghost > 0 && Math.floor(time * 16) % 2 === 0) return;
  ctx.fillStyle = 'rgba(20,6,46,0.25)';
  ctx.fillRect(Math.round(p.x - 4), Math.round(p.y + 2), 8, 3);
  if (p.shoveT > 0) {
    ctx.globalAlpha = 0.4;
    drawCharacter(ctx, p.character, p.x - p.fx * 6, p.y + 2 - p.fy * 6, { time });
    ctx.globalAlpha = 1;
  }
  const bob = p.walk > 0 && Math.floor(p.walk * 10) % 2 ? 1 : 0;
  drawCharacter(ctx, p.character, p.x, p.y + 2, { frame: bob, flip: p.fx < 0, time });
}

export const bookRenderer: MinigameRenderer = {
  positions(raw) {
    return (raw as BookState).players.filter((p) => p.status === 'alive').map((p) => [p.id, p.x, p.y - 3]);
  },

  render(ctx, raw, time, localId: PlayerId) {
    const st = raw as BookState;
    drawTable(ctx);
    drawFloorPage(ctx);

    if (st.phase === 'preview') {
      // The page hovering above: its shadow darkens, the holes stay lit.
      const p = Math.min(1, st.phaseTime / st.previewTime);
      holesPath(ctx, st.holes);
      ctx.fillStyle = `rgba(20,10,30,${0.12 + p * 0.5})`;
      ctx.fill('evenodd');
      const blink = Math.floor(time * (6 + p * 20)) % 2 === 0;
      ctx.strokeStyle = p > 0.7 && blink ? PAL.red : PAL.yellow;
      ctx.setLineDash([3, 2]);
      for (const h of st.holes) ctx.strokeRect(h.x + 0.5, h.y + 0.5, h.w - 1, h.h - 1);
      ctx.setLineDash([]);
    }

    const players = [...st.players].sort((a, b) => a.y - b.y);
    for (const p of players) drawPlayer(ctx, p, time);

    if (st.phase === 'slam') {
      const k = Math.min(1, st.phaseTime / 0.08);
      ctx.save();
      const s = 1.06 - 0.06 * k;
      ctx.translate(FIELD.x + FIELD.w / 2, FIELD.y + FIELD.h / 2);
      ctx.scale(s, s);
      ctx.translate(-(FIELD.x + FIELD.w / 2), -(FIELD.y + FIELD.h / 2));
      drawPage(ctx, st, 1, false);
      ctx.restore();
      // dust puffs along the edges
      if (st.phaseTime < SLAM_TIME * 0.6) {
        const d = st.phaseTime * 40;
        ctx.fillStyle = 'rgba(255,250,240,0.7)';
        for (let i = 0; i < 16; i++) {
          const x = FIELD.x + hash(i) * FIELD.w;
          ctx.fillRect(Math.round(x), Math.round(FIELD.y - 2 - d), 3, 2);
          ctx.fillRect(Math.round(x), Math.round(FIELD.y + FIELD.h + d), 3, 2);
        }
      }
    } else if (st.phase === 'turn') {
      // The page flips over the spine on the left.
      const k = Math.min(1, st.phaseTime / TURN_TIME);
      const sx = Math.cos(k * Math.PI);
      drawPage(ctx, st, Math.abs(sx), sx < 0);
    }

    const me = st.players.find((p) => p.id === localId);
    if (me && me.status === 'alive') {
      localMarker(ctx, me.x, me.y - 11, time);
      if (me.shoveCd > 0) {
        ctx.fillStyle = PAL.ink;
        ctx.fillRect(Math.round(me.x - 5), Math.round(me.y + 5), 10, 2);
        ctx.fillStyle = PAL.cyan;
        ctx.fillRect(Math.round(me.x - 5), Math.round(me.y + 5), Math.round(10 * (1 - me.shoveCd / SHOVE_COOLDOWN)), 2);
      }
    }
    text(ctx, `PÁG. ${st.page}`, 4, 4, PAL.yellow);
  },
};
