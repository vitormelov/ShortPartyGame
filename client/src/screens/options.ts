import { SCREEN_H, SCREEN_W } from '@shared/arena';
import { PAL, outlinedText, panel, text } from '../core/draw';
import { loadSettings, saveSettings } from '../core/settings';
import { menuWorld } from '../three/menuworld';
import type { App, Screen } from './screen';
import { TitleScreen } from './title';

const ROWS = ['VOLUME', 'TELA CHEIA', 'VISUAL 3D', 'PERSONAGENS 3D', 'VOLTAR'] as const;

/** OPÇÕES: sound volume, fullscreen, 3D on/off and which 3D cast. */
export class OptionsScreen implements Screen {
  private t = 0;
  private row = 0;
  private settings = loadSettings();

  constructor(private app: App) {
    app.music.play('theme', 'menu');
  }

  update(dt: number): void {
    this.t += dt;
    const inp = this.app.input;
    if (inp.pressed('up') && this.row > 0) {
      this.row--;
      this.app.sfx.play('menu');
    }
    if (inp.pressed('down') && this.row < ROWS.length - 1) {
      this.row++;
      this.app.sfx.play('menu');
    }
    const lr = (inp.pressed('right') ? 1 : 0) - (inp.pressed('left') ? 1 : 0);
    const row = ROWS[this.row];
    if (row === 'VOLUME' && lr) {
      this.settings.volume = Math.max(0, Math.min(10, this.settings.volume + lr));
      this.app.sfx.setVolume(this.settings.volume / 10);
      saveSettings(this.settings);
      this.app.sfx.play('like');
    } else if (row === 'TELA CHEIA' && (lr || inp.pressed('action'))) {
      if (document.fullscreenElement) void document.exitFullscreen?.();
      else void document.documentElement.requestFullscreen?.().catch(() => {});
      this.app.sfx.play('confirm');
    } else if (row === 'VISUAL 3D' && (lr || inp.pressed('action'))) {
      this.settings.visual3d = !this.settings.visual3d;
      saveSettings(this.settings);
      this.app.sfx.play('confirm');
    } else if (row === 'PERSONAGENS 3D' && (lr || inp.pressed('action'))) {
      this.settings.cast3d = this.settings.cast3d === 'trupe' ? 'emoji' : 'trupe';
      saveSettings(this.settings);
      this.app.sfx.play('confirm');
    } else if ((row === 'VOLTAR' && inp.pressed('action')) || inp.pressed('back')) {
      this.app.sfx.play('menu');
      this.app.go(new TitleScreen(this.app));
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    const world = menuWorld();
    if (world) {
      world.draw(ctx, this.t, 'options');
      ctx.fillStyle = 'rgba(16,6,36,0.45)';
      ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    }
    else {
      ctx.fillStyle = PAL.night;
      ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
      for (let y = 0; y < SCREEN_H; y += 6) {
        ctx.fillStyle = (y / 6) % 2 ? '#22104a' : PAL.night;
        ctx.fillRect(0, y, SCREEN_W, 3);
      }
    }
    outlinedText(ctx, 'OPÇÕES', SCREEN_W / 2, 24, PAL.yellow, 16);
    panel(ctx, 72, 46, 240, 132, PAL.panel, PAL.panelLight);
    ROWS.forEach((label, i) => {
      const y = 56 + i * 25;
      const sel = this.row === i;
      if (sel) {
        ctx.fillStyle = '#3a1a6a';
        ctx.fillRect(76, y - 6, 232, 20);
      }
      text(ctx, sel && Math.floor(this.t * 4) % 2 ? `> ${label}` : `  ${label}`, 84, y, sel ? PAL.yellow : PAL.white);
      if (label === 'VOLUME') {
        for (let k = 0; k < 10; k++) {
          ctx.fillStyle = k < this.settings.volume ? PAL.green : '#3a2a50';
          ctx.fillRect(208 + k * 9, y + 6 - Math.floor(k / 2), 6, 2 + Math.floor(k / 2));
        }
      } else if (label === 'TELA CHEIA') {
        text(ctx, document.fullscreenElement ? 'LIGADA' : 'DESLIGADA', 296, y, PAL.cyan, 8, 'right');
      } else if (label === 'VISUAL 3D') {
        text(ctx, this.settings.visual3d ? 'LIGADO' : 'DESLIGADO', 296, y, PAL.cyan, 8, 'right');
        text(ctx, 'ESTILO NINTENDO 64', 100, y + 10, PAL.grey, 8);
      } else if (label === 'PERSONAGENS 3D') {
        text(ctx, this.settings.cast3d === 'trupe' ? 'A TRUPE' : 'EMOJIS', 296, y, PAL.cyan, 8, 'right');
        text(ctx, this.settings.cast3d === 'trupe' ? 'O ELENCO DO SHORTPARTY' : 'O ELENCO ANTIGO', 100, y + 10, PAL.grey, 8);
      }
    });
    text(ctx, 'W/S ESCOLHE   A/D ALTERA   ESC VOLTA', SCREEN_W / 2, 184, PAL.grey, 8, 'center');
  }
}
