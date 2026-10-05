import { SCREEN_H, SCREEN_W } from '@shared/arena';
import { CHARACTERS } from '@shared/types';
import { PAL, heart, outlinedText, portrait, text } from '../core/draw';
import type { App, Screen } from './screen';
import { SelectScreen } from './select';

const CARDS = [
  { name: 'KART RUSH', color: '#e83b3b' },
  { name: 'BOMB FEED', color: '#3bc84a' },
  { name: 'METEOR FEED', color: '#f2862e' },
  { name: 'LANTERNA', color: '#9a5af2' },
  { name: 'LASER GRID', color: '#2ed8e8' },
  { name: 'ELEVADOR', color: '#c89a1e' },
  { name: 'LASER BEAM', color: '#c83a9a' },
  { name: 'MIMIC ME', color: '#3bc84a' },
  { name: 'TERMOS', color: '#8a2a30' },
  { name: 'BOLHA SOCIAL', color: '#c8468a' },
  { name: 'CANCELAMENTO', color: '#2a7ab8' },
  { name: 'HATERS', color: '#a82a3a' },
  { name: 'FLAME WAR', color: '#a8844a' },
  { name: 'CORDA QUENTE', color: '#c84a1e' },
  { name: 'FILTRO CERTO', color: '#2ab8c8' },
  { name: 'NÃO OLHE', color: '#c82a2a' },
  { name: 'DANCINHA', color: '#c83a9a' },
  { name: 'PONG', color: '#3bc84a' },
  { name: 'ENQUETE', color: '#c84aa8' },
  { name: 'ANÚNCIO', color: '#3b6ee8' },
];

export class TitleScreen implements Screen {
  private t = 0;

  constructor(private app: App) {}

  update(dt: number): void {
    this.t += dt;
    if (this.app.input.pressed('action')) {
      this.app.sfx.play('confirm');
      this.app.go(new SelectScreen(this.app));
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = PAL.night;
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    for (let y = 0; y < SCREEN_H; y += 6) {
      ctx.fillStyle = (y / 6) % 2 ? '#1a0f32' : PAL.night;
      ctx.fillRect(0, y, SCREEN_W, 3);
    }

    // Phone with a feed that swipes every second.
    const px = 252;
    const py = 22;
    const pw = 96;
    const ph = 172;
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(px - 5, py - 9, pw + 10, ph + 18);
    ctx.fillStyle = '#3a2766';
    ctx.fillRect(px - 4, py - 8, pw + 8, ph + 16);
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(px + pw / 2 - 10, py - 5, 20, 2);

    const step = Math.floor(this.t);
    const frac = this.t - step;
    const swipe = frac < 0.2 ? 1 - (1 - frac / 0.2) ** 3 : 1;
    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, pw, ph);
    ctx.clip();
    for (let k = 0; k < 2; k++) {
      const card = CARDS[(step + k - 1 + CARDS.length) % CARDS.length];
      const oy = py + (k - swipe) * ph;
      ctx.fillStyle = card.color;
      ctx.fillRect(px, oy, pw, ph);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (let y = 0; y < ph; y += 8) ctx.fillRect(px, oy + y, pw, 4);
      portrait(ctx, (step + k) % CHARACTERS.length, px + pw / 2 - 16, oy + 50, 2);
      text(ctx, card.name, px + pw / 2, oy + 96, PAL.white, 8, 'center');
      heart(ctx, px + pw - 14, oy + 120);
      text(ctx, `${(((step + k) * 37) % 90) + 9}K`, px + pw - 2, oy + 129, PAL.white, 8, 'right');
    }
    ctx.restore();
    ctx.fillStyle = PAL.white;
    ctx.fillRect(px + 4, py + 4, Math.floor((pw - 8) * frac), 2);

    // Logo.
    const bob = Math.round(Math.sin(this.t * 3) * 2);
    outlinedText(ctx, 'SHORT', 122, 44 + bob, PAL.pink, 32);
    outlinedText(ctx, 'PARTY', 122, 82 - bob, PAL.yellow, 32);
    text(ctx, 'O PARTY GAME', 122, 126, PAL.cyan, 8, 'center');
    text(ctx, 'DE 5 SEGUNDOS', 122, 138, PAL.cyan, 8, 'center');

    if (Math.floor(this.t * 2) % 2 === 0) text(ctx, 'PRESSIONE ESPAÇO', 122, 172, PAL.white, 8, 'center');
    text(ctx, 'FASE 1 - LOCAL COM BOTS', 4, SCREEN_H - 10, PAL.grey);
  }
}
