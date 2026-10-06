import { ARENA_H, HUD_H, SCREEN_H, SCREEN_W } from '@shared/arena';
import type { FeedSnapshot } from '@shared/feed';
import { CHARACTERS, type PlayerId } from '@shared/types';
import { drawPortrait } from '../core/cast';
import { BRAND, FONT, PAL, sprite, text } from '../core/draw';
import { hash } from '../minigames/renderer';

const MINI_HEART = ['.r.r.', 'rrrrr', 'rrrrr', '.rrr.', '..r..'];

/** Tiny 4px pixel text (8 real pixels): only possible since the 32-bit resolution. */
export function tiny(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, color: string, align: CanvasTextAlign = 'left', shadow: string | null = PAL.ink): void {
  ctx.font = `4px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  if (shadow) {
    ctx.fillStyle = shadow;
    ctx.fillText(str, x + 0.5, y + 0.5);
  }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

/** Phone status bar: real clock, signal and a battery that drains over the match. */
function statusBar(ctx: CanvasRenderingContext2D, snap: FeedSnapshot, time: number): void {
  const now = new Date();
  tiny(ctx, `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`, 3, 0.5, PAL.white, 'left', null);
  // Battery: full at the start, nearly dead around six minutes in.
  const batt = Math.max(0.03, 1 - snap.matchTime / 380);
  const low = batt < 0.2;
  const bx = SCREEN_W - 13;
  ctx.fillStyle = PAL.white;
  ctx.fillRect(bx, 0.5, 10, 4);
  ctx.fillRect(bx + 10, 1.5, 1, 2);
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(bx + 0.5, 1, 9, 3);
  ctx.fillStyle = low ? (Math.floor(time * 3) % 2 ? BRAND.rosa : '#5a1030') : BRAND.verde;
  ctx.fillRect(bx + 0.5, 1, Math.max(0.5, Math.round(9 * batt * 2) / 2), 3);
  tiny(ctx, `${Math.round(batt * 100)}%`, bx - 1.5, 0.5, low ? BRAND.rosa : PAL.white, 'right', null);
  // Signal bars + 5G.
  const sx = bx - 32;
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i < 3 ? PAL.white : '#5a4a7a';
    ctx.fillRect(sx + i * 1.5, 4 - i, 1, 1 + i);
  }
  tiny(ctx, '5G', sx + 7, 0.5, PAL.white, 'left', null);
  tiny(ctx, 'SHORTPARTY', SCREEN_W / 2, 0.5, PAL.grey, 'center', null);
}

/** Top strip: the phone's status bar over every player's lives. */
export function drawTopHud(ctx: CanvasRenderingContext2D, snap: FeedSnapshot, localId: PlayerId, flashes: Map<PlayerId, number>, time: number): void {
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(0, 0, SCREEN_W, HUD_H);
  statusBar(ctx, snap, time);

  const n = snap.players.length;
  const chipW = Math.floor(SCREEN_W / n);
  const cy = 5; // chips row
  snap.players.forEach((p, i) => {
    const x = i * chipW;
    const flash = (flashes.get(p.info.id) ?? 0) > 0 && Math.floor(time * 16) % 2 === 0;
    if (p.info.id === localId) {
      ctx.fillStyle = '#3a1a6a';
      ctx.fillRect(x, cy, chipW - 1, 7);
    }
    if (flash) {
      ctx.fillStyle = PAL.red;
      ctx.fillRect(x, cy, chipW - 1, 7);
    }
    // Tiny face of the influencer.
    drawPortrait(ctx, p.info.character, x + 1, cy, 7 / 16, p.eliminated);

    if (p.eliminated) {
      ctx.fillStyle = PAL.grey;
      for (let k = 0; k < 6; k++) {
        ctx.fillRect(x + 12 + k, cy + k + 0.5 - k * 0.5, 1, 1);
        ctx.fillRect(x + 17 - k, cy + k + 0.5 - k * 0.5, 1, 1);
      }
      return;
    }
    const space = chipW - 12;
    if (snap.shields.includes(p.info.id)) {
      // shield won on an X1 bet
      ctx.fillStyle = PAL.cyan;
      ctx.fillRect(x + chipW - 13, cy, 5, 4);
      ctx.fillRect(x + chipW - 12, cy + 4, 3, 2);
    }
    if (p.info.id === snap.spotlight) {
      // tiny star on the chip of whoever is in the spotlight
      ctx.fillStyle = PAL.yellow;
      ctx.fillRect(x + chipW - 6, cy, 1, 5);
      ctx.fillRect(x + chipW - 8, cy + 2, 5, 1);
    }
    if (snap.maxLives * 6 <= space && p.lives <= snap.maxLives) {
      for (let h = 0; h < snap.maxLives; h++) {
        const full = h < p.lives;
        sprite(ctx, MINI_HEART, x + 11 + h * 6, cy + 1, { r: full ? BRAND.rosa : '#3a2a50' });
      }
    } else {
      sprite(ctx, MINI_HEART, x + 11, cy + 1, { r: BRAND.rosa });
      text(ctx, `${p.lives}`, x + 18, cy, PAL.white, 8, 'left', null);
    }
  });
}

/** Clip progress along the bottom edge, like the video apps. */
export function drawProgressBar(ctx: CanvasRenderingContext2D, snap: FeedSnapshot, time: number): void {
  const progress = snap.phase === 'play' ? Math.min(1, snap.clipTime / snap.clipDuration) : 0;
  const y = SCREEN_H - 1.5;
  const px = Math.round(SCREEN_W * progress * 2) / 2;
  ctx.fillStyle = 'rgba(58,39,102,0.85)';
  ctx.fillRect(0, y, SCREEN_W, 1.5);
  ctx.fillStyle = progress > 0.8 && Math.floor(time * 8) % 2 ? PAL.white : BRAND.rosa;
  ctx.fillRect(0, y, px, 1.5);
  if (progress > 0) {
    ctx.fillStyle = PAL.white;
    ctx.fillRect(px - 1, y - 0.5, 2, 2);
  }
}

const HASHTAGS: Record<string, string> = {
  kart: '#corrida #treta #saiudapista',
  bomb: '#bomba #explodiu #fail',
  meteor: '#meteoro #fimdomundo #corre',
  lantern: '#terror #shadowban #medo',
  laser: '#laser #pula #parkour',
  elevator: '#subindo #lava #elevador',
  beam: '#bullethell #desvia #foco',
  mimic: '#imita #challenge #trend',
  book: '#termosdeuso #aceito #ninguemle',
  bubble: '#bolha #empurra #mar',
  penguin: '#cancelado #pinguim #gelo',
  count: '#haters #conta #matematica',
  tank: '#flamewar #ratio #espaco',
  rope: '#corda #pula #fogo',
  filter: '#filtro #vintage #neon',
  look: '#naoolhe #olhar #sorte',
  dance: '#dancinha #trend #cringe',
  paddle: '#pong #raquete #gol',
  poll: '#enquete #vota #opiniao',
  ad: '#publi #patrocinado #pula',
  memoTell: '#publi #decora #codigo',
  memoDo: '#compra #frete #golpe',
};

/** What the right-hand buttons react to: a death pops the heart and bumps the counts. */
export interface SocialFx {
  /** Seconds since the last death (large when none). */
  sinceDeath: number;
  /** Deaths so far in this clip; each one is worth more likes. */
  bonus: number;
}

function formatCount(n: number): string {
  if (n >= 10000) return `${Math.floor(n / 1000)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.', ',')}K`;
  return `${n}`;
}

function heartIcon(ctx: CanvasRenderingContext2D, x: number, y: number, col: string, scale: number): void {
  ctx.save();
  ctx.translate(x + 5, y + 4);
  ctx.scale(scale, scale);
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(-5, -4.5, 10, 6);
  ctx.fillRect(-4, 1.5, 8, 2);
  ctx.fillRect(-2.5, 3.5, 5, 1.5);
  ctx.fillRect(-1, 5, 2, 1);
  ctx.fillStyle = col;
  ctx.fillRect(-4, -4, 3, 1);
  ctx.fillRect(1, -4, 3, 1);
  ctx.fillRect(-4.5, -3, 9, 4);
  ctx.fillRect(-3.5, 1, 7, 1.5);
  ctx.fillRect(-2, 2.5, 4, 1.5);
  ctx.fillRect(-0.5, 4, 1, 1);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillRect(-3.5, -3, 1.5, 1.5);
  ctx.restore();
}

/** The fake app chrome over the clip: reacting buttons on the right, caption and song at the bottom left. */
export function drawSocialOverlay(ctx: CanvasRenderingContext2D, snap: FeedSnapshot, time: number, fx: SocialFx = { sinceDeath: 99, bonus: 0 }): void {
  const clip = snap.clip;
  if (!clip) return;
  const seed = clip.instanceId * 13 + clip.shown;
  const likes = Math.floor(2000 + hash(seed) * 90000 + time * 40) + fx.bonus * 1300;
  const comments = Math.floor(100 + hash(seed + 1) * 4000) + fx.bonus * 90;
  const shares = Math.floor(50 + hash(seed + 2) * 2000) + fx.bonus * 40;
  const x = SCREEN_W - 17;
  const base = HUD_H + ARENA_H - 90;
  const pop = fx.sinceDeath < 0.35 ? 1 + Math.sin((fx.sinceDeath / 0.35) * Math.PI) * 0.5 : 1;
  const hot = fx.sinceDeath < 0.6;

  // Creator avatar with the follow "+".
  const creator = snap.players[(clip.instanceId + clip.shown) % snap.players.length];
  ctx.fillStyle = PAL.white;
  ctx.fillRect(x - 1.5, base - 24.5, 13, 13);
  drawPortrait(ctx, creator.info.character, x - 1, base - 24, 12 / 16);
  ctx.fillStyle = BRAND.rosa;
  ctx.fillRect(x + 2.5, base - 13.5, 5, 5);
  ctx.fillStyle = PAL.white;
  ctx.fillRect(x + 4.5, base - 13, 1, 4);
  ctx.fillRect(x + 3, base - 11.5, 4, 1);

  heartIcon(ctx, x, base + 2, hot ? '#ff6aa8' : BRAND.rosa, pop);
  tiny(ctx, formatCount(likes), x + 5, base + 11, hot ? BRAND.verde : PAL.white, 'center');
  if (hot) {
    // little hearts flying off the button
    const k = fx.sinceDeath / 0.6;
    ctx.globalAlpha = 1 - k;
    ctx.fillStyle = BRAND.rosa;
    for (let i = 0; i < 4; i++) ctx.fillRect(x + 4 + Math.sin(i * 2.1) * 8 * k, base + 2 - k * 16 - i * 3, 2, 2);
    ctx.globalAlpha = 1;
  }

  // comment bubble
  const cy = base + 22;
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(x, cy, 10, 8);
  ctx.fillRect(x + 1, cy + 8, 3, 2);
  ctx.fillStyle = PAL.white;
  ctx.fillRect(x + 1, cy + 1, 8, 6);
  ctx.fillRect(x + 2, cy + 7, 1, 1.5);
  ctx.fillStyle = PAL.ink;
  for (let i = 0; i < 3; i++) ctx.fillRect(x + 2.5 + i * 2, cy + 3.5, 1, 1);
  tiny(ctx, formatCount(comments), x + 5, cy + 12, PAL.white, 'center');

  // share arrow
  const sy = base + 40;
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(x, sy, 11, 8);
  ctx.fillStyle = PAL.white;
  ctx.fillRect(x + 1, sy + 3.5, 6, 2);
  ctx.fillRect(x + 1, sy + 5.5, 2, 1.5);
  ctx.fillRect(x + 6, sy + 1, 1, 7);
  ctx.fillRect(x + 7, sy + 2, 1, 5);
  ctx.fillRect(x + 8, sy + 3, 1, 3);
  ctx.fillRect(x + 9, sy + 4, 1, 1);
  tiny(ctx, formatCount(shares), x + 5, sy + 11, PAL.white, 'center');

  // Spinning record of the "trending sound".
  const dx = x + 5;
  const dy = base + 64;
  ctx.save();
  ctx.translate(dx, dy);
  ctx.rotate(time * 3);
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(-6, -6, 12, 12);
  ctx.fillStyle = '#2a1f45';
  ctx.fillRect(-5, -5, 10, 10);
  ctx.fillStyle = '#3a2d5c';
  ctx.fillRect(-5, -1, 10, 1);
  ctx.fillStyle = BRAND.ciano;
  ctx.fillRect(-2, -2, 4, 4);
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(-0.5, -0.5, 1, 1);
  ctx.restore();
  // notes drifting out of it
  for (let i = 0; i < 2; i++) {
    const k = (time * 0.6 + i * 0.5) % 1;
    ctx.globalAlpha = 1 - k;
    ctx.fillStyle = PAL.white;
    ctx.fillRect(dx - 6 - k * 8, dy - 4 - k * 10, 1, 3);
    ctx.fillRect(dx - 7 - k * 8, dy - 1 - k * 10, 2, 1.5);
    ctx.globalAlpha = 1;
  }

  // Caption: handle, follow button, hashtags and the song ticker.
  const y = HUD_H + ARENA_H - 25;
  const w = 168;
  const g = ctx.createLinearGradient(0, y - 4, 0, y + 23);
  g.addColorStop(0, 'rgba(10,6,20,0)');
  g.addColorStop(0.35, 'rgba(10,6,20,0.7)');
  g.addColorStop(1, 'rgba(10,6,20,0.85)');
  ctx.fillStyle = g;
  ctx.fillRect(0, y - 4, w, 27);
  text(ctx, clip.handle, 4, y, PAL.white);
  const hw = clip.handle.length * 8 + 8;
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(hw - 0.5, y - 0.5, 27, 9);
  ctx.fillStyle = BRAND.verde;
  ctx.fillRect(hw, y, 26, 8);
  tiny(ctx, 'SEGUIR', hw + 13, y + 2, PAL.ink, 'center', null);
  tiny(ctx, HASHTAGS[clip.defId] ?? '#shortparty #fyp', 4, y + 10, BRAND.ciano);
  // The song ticker scrolls smoothly in half-pixel steps.
  ctx.save();
  ctx.beginPath();
  ctx.rect(10, y + 15, w - 14, 6);
  ctx.clip();
  const tick = 'SOM EM ALTA · MC ALGORITMO - DESLIZA PRA CIMA · ';
  const tw = tick.length * 4;
  const off = Math.round(((time * 14) % tw) * 2) / 2;
  tiny(ctx, tick + tick, 10 - off, y + 16, '#b8acd8');
  ctx.restore();
  // ♫
  ctx.fillStyle = PAL.white;
  ctx.fillRect(4.5, y + 16, 1, 3.5);
  ctx.fillRect(4.5, y + 16, 3, 1);
  ctx.fillRect(7, y + 16, 1, 3);
  ctx.fillRect(3.5, y + 19, 2, 1.5);
  ctx.fillRect(6, y + 18.5, 2, 1.5);
}

// ---------- fake comments rising over the clip ----------

const AMBIENT = ['PRIMEIRO', 'ISSO É FAKE', 'QUAL O NOME DA MÚSICA', 'CRINGE DEMAIS', 'ALGUÉM EM 2026?', 'TO VENDO NO BANHEIRO', 'O ALGORITMO ME TROUXE', 'SEGUE DE VOLTA', 'MEU DEUS KKKKK', 'PARTE 2 PFV'];
const LIFE = 3.2;
const GAP = 0.4; // seconds between comments (~9px apart)

interface Rising {
  text: string;
  color: string;
  t: number;
  x: number;
}

/** Comments from fake viewers drifting up the right side; some react to what just happened. */
export class FakeComments {
  private items: Rising[] = [];
  private next = 1;
  private n = 0;

  /** A reaction to something that just happened (a death, a return...). */
  react(text: string, color: string): void {
    this.n++;
    // Queue behind the previous one so they never overlap (t < 0 = not shown yet).
    const last = this.items[this.items.length - 1];
    const t = last ? Math.min(0, last.t - GAP) : 0;
    this.items.push({ text, color, t, x: (this.n % 3) * 6 });
    if (this.items.length > 5) this.items.shift();
  }

  update(dt: number, playing: boolean): void {
    this.items.forEach((c) => (c.t += dt));
    this.items = this.items.filter((c) => c.t < LIFE);
    if (!playing) return;
    this.next -= dt;
    if (this.next <= 0) {
      this.next = 1.4 + hash(this.n * 3.1) * 1.6;
      this.react(AMBIENT[Math.floor(hash(this.n * 7.7) * AMBIENT.length)], CHARACTERS[this.n % CHARACTERS.length].color);
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    for (const c of this.items) {
      if (c.t < 0) continue;
      const k = c.t / LIFE;
      const y = Math.round((HUD_H + ARENA_H - 36 - k * 70) * 2) / 2;
      ctx.globalAlpha = k < 0.1 ? k * 10 : k > 0.75 ? (1 - k) / 0.25 : 1;
      const w = c.text.length * 4 + 10;
      const x = SCREEN_W - 24 - w - c.x;
      ctx.fillStyle = 'rgba(10,6,20,0.72)';
      ctx.fillRect(x, y, w, 7);
      ctx.fillStyle = c.color;
      ctx.fillRect(x + 1.5, y + 1.5, 4, 4);
      tiny(ctx, c.text, x + 7, y + 1.5, PAL.white, 'left', null);
      ctx.globalAlpha = 1;
    }
  }
}
