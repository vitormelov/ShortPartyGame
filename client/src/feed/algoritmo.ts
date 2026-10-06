import { SCREEN_W } from '@shared/arena';
import { FONT, RES } from '../core/draw';

/*
 * O Algoritmo: a monitor with a single eye that watches everything and decides who goes viral.
 * It's the host of the game (docs/guia-de-estilo.html): it drops in from the top with a short line
 * whenever something happens.
 */

const ROSA = '#ff2e88';
const ROSA_LIGHT = '#ff7ab4';
const ROSA_DARK = '#b8125e';
const ROSA_DEEP = '#6a0a3a';
const VERDE = '#c6ff3d';
const VERDE_DARK = '#7a9a10';
const ROXO = '#1b0b3a';
const ROXO_SCAN = '#24104a';
const CREME = '#fff4e0';
const INK = '#0a0614';

export type AlgoMood = 'normal' | 'smug' | 'wide';

/**
 * Draws the Algoritmo centered at (cx, cy) in game pixels. The design is 56x44 real pixels at k = 1
 * (28x22 game pixels); `look` (-1..1) aims the eye.
 */
export function drawAlgoritmo(ctx: CanvasRenderingContext2D, cx: number, cy: number, k: number, t: number, look: { x: number; y: number } = { x: 0, y: 0 }, mood: AlgoMood = 'normal'): void {
  const u = k / RES; // game pixels per design pixel
  const ox = Math.round((cx - 28 * u) * RES) / RES;
  const oy = Math.round((cy - 22 * u) * RES) / RES;
  const R = (x: number, y: number, w: number, h: number, col: string) => {
    ctx.fillStyle = col;
    ctx.fillRect(ox + x * u, oy + y * u, w * u, h * u);
  };
  // Antenna with a blinking tip.
  R(26, 0, 4, 7, INK);
  R(27, 1, 2, 6, VERDE_DARK);
  R(24, -2, 8, 4, INK);
  R(25, -1, 6, 2, Math.floor(t * 2) % 2 ? VERDE : VERDE_DARK);
  // Monitor body: outline, bevel lit from the top left.
  R(3, 5, 50, 34, INK);
  R(2, 6, 52, 32, INK);
  R(4, 6, 48, 32, ROSA_DARK);
  R(3, 7, 50, 30, ROSA_DARK);
  R(4, 6, 47, 31, ROSA);
  R(3, 7, 49, 29, ROSA);
  R(5, 6, 40, 1, ROSA_LIGHT);
  R(3, 8, 1, 20, ROSA_LIGHT);
  R(6, 37, 46, 1, ROSA_DEEP);
  R(52, 10, 1, 26, ROSA_DEEP);
  // Screen.
  R(7, 9, 42, 26, INK);
  R(8, 10, 40, 24, ROXO);
  for (let y = 11; y < 34; y += 3) R(8, y, 40, 1, ROXO_SCAN);
  // Glass reflection.
  R(9, 11, 6, 1, 'rgba(255,255,255,0.18)');
  R(9, 12, 1, 4, 'rgba(255,255,255,0.18)');
  // The eye.
  const ex = 28, ey = 22;
  const blink = (t % 3.4) < 0.12;
  if (blink) {
    R(15, ey, 26, 2, CREME);
  } else {
    R(17, 14, 22, 16, CREME);
    R(15, 16, 26, 12, CREME);
    R(16, 15, 24, 14, CREME);
    // shading on the eyeball's lower edge
    R(17, 28, 22, 1, '#e8d8c0');
    R(15, 26, 1, 2, '#e8d8c0');
    const ix = Math.round(ex + look.x * 6);
    const iy = Math.round(ey + look.y * 3);
    const big = mood === 'wide' ? 1 : 0;
    R(ix - 5 - big, iy - 4 - big, 10 + big * 2, 8 + big * 2, ROSA);
    R(ix - 4 - big, iy - 5 - big, 8 + big * 2, 10 + big * 2, ROSA);
    R(ix - 4, iy + 2, 8, 2, ROSA_DARK);
    R(ix - 2, iy - 2, 4, 4, INK);
    R(ix - 3, iy - 4, 2, 2, '#ffffff');
    R(ix + 2, iy + 1, 1, 1, '#ffffff');
    if (mood === 'smug') {
      // Heavy lid: it already knows how this ends.
      R(15, 14, 26, 6, ROXO);
      R(15, 20, 26, 1, ROSA_DARK);
      R(16, 21, 24, 1, '#e8d8c0');
    }
  }
  // Stand.
  R(22, 38, 12, 3, INK);
  R(23, 38, 10, 2, ROSA_DARK);
  R(17, 41, 22, 3, INK);
  R(18, 41, 20, 2, ROSA);
}

// ---------- the lines it says ----------

export type AlgoEvent = 'first' | 'return' | 'flop' | 'speed' | 'duel' | 'ad' | 'eliminated' | 'winner' | 'heat' | 'poll';

const LINES: Record<AlgoEvent, string[]> = {
  first: ['VAMOS VER SE VOCÊ PRENDE A ATENÇÃO.'],
  return: ['LEMBRA DESSE? EU LEMBRO.', 'VOLTANDO PRO QUE VOCÊ ESQUECEU.', 'CONTINUA DE ONDE PAROU.'],
  flop: ['ENTREGOU PRA 3 PESSOAS.', 'FLOPOU BONITO.', 'ISSO NÃO VAI PRO EXPLORAR.'],
  speed: ['NINGUÉM AGUENTA VER EM 1X.', 'ACELERA QUE TÁ CHATO.'],
  duel: ['DOIS ENTRAM. UM SAI COM ENGAJAMENTO.'],
  ad: ['PAUSA PARA OS NOSSOS PATROCINADORES.'],
  eliminated: ['CONTA SUSPENSA. AGORA VOCÊ É SÓ COMENTÁRIO.'],
  winner: ['PARABÉNS. VOCÊ É O CONTEÚDO AGORA.'],
  heat: ['ACELEREI. TUDO MAIS PERIGOSO.'],
  poll: ['A OPINIÃO DE VOCÊS NÃO IMPORTA. VOTEM.'],
};

const PRIORITY: Record<AlgoEvent, number> = { winner: 5, eliminated: 4, heat: 3, duel: 3, ad: 3, poll: 3, first: 2, flop: 2, return: 1, speed: 1 };
const MOOD: Record<AlgoEvent, AlgoMood> = { winner: 'wide', eliminated: 'smug', heat: 'wide', duel: 'wide', ad: 'normal', poll: 'smug', first: 'normal', flop: 'smug', return: 'smug', speed: 'normal' };

const SHOW = 2.4;
const DROP = 0.18;

/** Wraps a line into at most two rows of `max` characters. */
function wrap(line: string, max: number): string[] {
  const words = line.split(' ');
  const rows = [''];
  for (const w of words) {
    const cur = rows[rows.length - 1];
    if (!cur) rows[rows.length - 1] = w;
    else if (cur.length + 1 + w.length <= max) rows[rows.length - 1] = `${cur} ${w}`;
    else rows.push(w);
  }
  return rows.slice(0, 2);
}

/** The drop-in host: queue a line with `say`, then `update` and `render` every frame. */
export class Algoritmo {
  private line: string[] | null = null;
  private event: AlgoEvent | null = null;
  private t = 0;
  private time = 0;
  private picks = new Map<AlgoEvent, number>();

  /** `onSpeak` plays its voice. */
  constructor(private onSpeak?: () => void) {}

  say(event: AlgoEvent): void {
    if (this.event && this.t < SHOW - DROP && PRIORITY[event] < PRIORITY[this.event]) return;
    const options = LINES[event];
    const n = this.picks.get(event) ?? 0;
    this.picks.set(event, n + 1);
    this.line = wrap(options[n % options.length], 24);
    this.event = event;
    this.t = 0;
    this.onSpeak?.();
  }

  get speaking(): boolean {
    return this.line !== null;
  }

  update(dt: number): void {
    this.time += dt;
    if (!this.line) return;
    this.t += dt;
    if (this.t > SHOW) {
      this.line = null;
      this.event = null;
    }
  }

  /** Drops in under the HUD, at `top` (game pixels). */
  render(ctx: CanvasRenderingContext2D, top: number): void {
    if (!this.line || !this.event) return;
    const inK = Math.min(1, this.t / DROP);
    const outK = Math.min(1, Math.max(0, (SHOW - this.t) / DROP));
    const k = Math.min(inK, outK);
    const ease = 1 - (1 - k) ** 3;
    const h = 34;
    const w = 244;
    const x = Math.round((SCREEN_W - w) / 2);
    const y = Math.round(top - h + ease * (h + 6));
    // Card: cream like a speech bubble, with a pink edge and a drop shadow.
    ctx.fillStyle = 'rgba(10,6,20,0.45)';
    ctx.fillRect(x + 3, y + 3, w, h);
    ctx.fillStyle = INK;
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = CREME;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = ROSA;
    ctx.fillRect(x, y + h - 2, w, 2);
    ctx.fillStyle = '#f0e2cc';
    ctx.fillRect(x, y + h - 4, w, 2);
    // Little Algoritmo on the left, eye darting around.
    const look = { x: Math.sin(this.time * 2.3), y: Math.cos(this.time * 1.7) * 0.6 };
    drawAlgoritmo(ctx, x + 18, y + 15, 1, this.time, look, MOOD[this.event]);
    ctx.font = `8px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = ROSA_DARK;
    ctx.fillText('@ALGORITMO', x + 38, y + 3);
    ctx.fillStyle = INK;
    this.line.forEach((row, i) => ctx.fillText(row, x + 38, y + 13 + i * 9));
  }
}
