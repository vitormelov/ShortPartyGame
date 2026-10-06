import { SCREEN_H, SCREEN_W } from '@shared/arena';
import { CHARACTERS } from '@shared/types';
import { drawCharacter } from '../core/cast';
import { menuWorld } from '../three/menuworld';
import { Showcase } from '../three/showcase';
import { PAL, heart, outlinedText, panel, text } from '../core/draw';
import { drawAlgoritmo } from '../feed/algoritmo';
import type { App, Screen } from './screen';
import { OptionsScreen } from './options';
import { playMenu } from './menus';

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

const MENU = ['JOGAR', 'OPÇÕES'] as const;

export class TitleScreen implements Screen {
  private t = 0;
  private showcase: Showcase | null = null;
  private item = 0;

  constructor(private app: App) {
    app.music.rate = 1;
    app.music.tension = 0;
    app.music.play('theme', 'menu');
  }

  update(dt: number): void {
    this.t += dt;
    const inp = this.app.input;
    if (inp.pressed('up')) {
      this.item = (this.item + MENU.length - 1) % MENU.length;
      this.app.sfx.play('menu');
    }
    if (inp.pressed('down')) {
      this.item = (this.item + 1) % MENU.length;
      this.app.sfx.play('menu');
    }
    if (inp.pressed('action')) {
      const choice = MENU[this.item];
      if (choice === 'OPÇÕES') {
        this.app.sfx.play('confirm');
        this.app.go(new OptionsScreen(this.app));
      } else {
        this.app.sfx.play('jingle');
        this.app.go(playMenu(this.app));
      }
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    const world = menuWorld();
    if (world) {
      // 3D: the island with the cast, the logo sign and the menu slabs.
      world.draw(ctx, this.t, 'title', { labels: MENU, selected: this.item, logo: true });
      panel(ctx, 0, SCREEN_H - 14, 190, 14, 'rgba(10,6,20,0.7)', 'rgba(10,6,20,0)');
      text(ctx, 'W/S ESCOLHE  ESPAÇO CONFIRMA', 4, SCREEN_H - 10, PAL.white);
      return;
    }
    ctx.fillStyle = PAL.night;
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    for (let y = 0; y < SCREEN_H; y += 6) {
      ctx.fillStyle = (y / 6) % 2 ? '#22104a' : PAL.night;
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
    const show = Showcase.enabled() ? (this.showcase ??= new Showcase()) : null;
    for (let k = 0; k < 2; k++) {
      const card = CARDS[(step + k - 1 + CARDS.length) % CARDS.length];
      const oy = py + (k - swipe) * ph;
      ctx.fillStyle = card.color;
      ctx.fillRect(px, oy, pw, ph);
      ctx.fillStyle = 'rgba(20,6,46,0.25)';
      for (let y = 0; y < ph; y += 8) ctx.fillRect(px, oy + y, pw, 4);
      const who = (step + k) % CHARACTERS.length;
      if (show) show.add({ character: who, x: px + pw / 2, y: oy + 88, height: 44, hop: Math.abs(Math.sin(this.t * 5)) * 3, heading: Math.sin(this.t * 2) * 0.6, dance: true });
      else drawCharacter(ctx, who, px + pw / 2, oy + 90, { size: 48, pose: 'win', frame: Math.floor(this.t * 4) % 2, time: this.t });
      text(ctx, card.name, px + pw / 2, oy + 96, PAL.white, 8, 'center');
      heart(ctx, px + pw - 14, oy + 120);
      text(ctx, `${(((step + k) * 37) % 90) + 9}K`, px + pw - 2, oy + 129, PAL.white, 8, 'right');
    }
    show?.flush(ctx, this.t);
    ctx.restore();
    ctx.fillStyle = PAL.white;
    ctx.fillRect(px + 4, py + 4, Math.floor((pw - 8) * frac), 2);

    // Logo.
    const bob = Math.round(Math.sin(this.t * 3) * 2);
    outlinedText(ctx, 'SHORT', 112, 34 + bob, PAL.pink, 32);
    outlinedText(ctx, 'PARTY', 112, 70 - bob, PAL.yellow, 32);
    text(ctx, 'O PARTY GAME', 112, 110, PAL.cyan, 8, 'center');
    text(ctx, 'DE 5 SEGUNDOS', 112, 120, PAL.cyan, 8, 'center');

    // The Algoritmo, the host, keeping an eye on the feed.
    const ay = 64 + Math.round(Math.sin(this.t * 2) * 1.5);
    const frac2 = this.t % 1;
    const look = frac2 < 0.25 ? { x: 1, y: 0.6 } : { x: Math.sin(this.t * 1.3) * 0.6, y: 0.3 };
    drawAlgoritmo(ctx, 221, ay, 1.8, this.t, look, Math.floor(this.t / 3.2) % 3 === 2 ? 'smug' : 'normal');
    // Main menu.
    MENU.forEach((label, i) => {
      const sel = this.item === i;
      const y = 136 + i * 19;
      const w = 132;
      const x = 112 - w / 2 + (sel ? Math.round(Math.sin(this.t * 8)) : 0);
      panel(ctx, x, y, w, 15, sel ? (Math.floor(this.t * 4) % 2 ? PAL.pink : '#c8206a') : PAL.panel, sel ? PAL.white : PAL.panelLight);
      text(ctx, label, x + w / 2, y + 4, sel ? PAL.white : PAL.grey, 8, 'center');
      if (sel) {
        ctx.fillStyle = PAL.yellow;
        for (let k = 0; k < 4; k++) ctx.fillRect(x - 8 + k, y + 4 + k * 0.5, 1, 7 - k);
      }
    });
    text(ctx, 'W/S ESCOLHE  ESPAÇO CONFIRMA', 4, SCREEN_H - 10, PAL.grey);
  }
}
