import { SCREEN_H, SCREEN_W } from '@shared/arena';
import type { FeedSnapshot } from '@shared/feed';
import { CHARACTERS, type PlayerId } from '@shared/types';
import { drawCharacter } from '../core/cast';
import { PAL, outlinedText, panel, text } from '../core/draw';
import { menuWorld } from '../three/menuworld';
import { Showcase } from '../three/showcase';
import { soloMenu } from './menus';
import type { App, Screen } from './screen';
import { SelectScreen } from './select';
import { TitleScreen } from './title';

const CHOICES = ['REPETIR PARTIDA', 'OUTRO MINIGAME', 'MENU PRINCIPAL'] as const;

/** End of a minigames-mode match: the winner celebrates, then play again, pick another or leave. */
export class MinigameEndScreen implements Screen {
  private t = 0;
  private item = 0;
  private show3d: Showcase | null = null;

  constructor(private app: App, private snap: FeedSnapshot, private localId: PlayerId, private again?: () => Screen) {
    app.music.play('theme', 'menu');
    app.sfx.play('win');
  }

  update(dt: number): void {
    this.t += dt;
    const inp = this.app.input;
    if (inp.pressed('up')) {
      this.item = (this.item + CHOICES.length - 1) % CHOICES.length;
      this.app.sfx.play('menu');
    }
    if (inp.pressed('down')) {
      this.item = (this.item + 1) % CHOICES.length;
      this.app.sfx.play('menu');
    }
    if (inp.pressed('back')) this.app.go(soloMenu(this.app));
    if (!inp.pressed('action') || this.t < 0.4) return;
    const choice = CHOICES[this.item];
    this.app.sfx.play('confirm');
    if (choice === 'REPETIR PARTIDA' && this.again) {
      this.app.sfx.play('go');
      this.app.go(this.again());
    } else if (choice === 'MENU PRINCIPAL') {
      this.app.go(new TitleScreen(this.app));
    } else {
      // Same cast and settings, straight to the options to pick another minigame.
      this.app.go(new SelectScreen(this.app, undefined, 'minigame'));
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    const world = menuWorld();
    const winners = this.snap.winners.map((id) => this.snap.players.find((p) => p.info.id === id)!).filter(Boolean);
    const name = this.snap.clip?.name ?? '';
    if (world) {
      world.draw(ctx, this.t, 'options', { labels: CHOICES, selected: this.item, x: 286, y: 118 });
    } else {
      ctx.fillStyle = PAL.night;
      ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
      CHOICES.forEach((label, i) => {
        const sel = this.item === i;
        panel(ctx, 286 - 66, 118 + i * 20, 132, 15, sel ? PAL.pink : PAL.panel, sel ? PAL.white : PAL.panelLight);
        text(ctx, label, 286, 122 + i * 20, sel ? PAL.white : PAL.grey, 8, 'center');
      });
    }
    // Spotlight on the winner(s) on the left.
    ctx.fillStyle = 'rgba(16,6,36,0.55)';
    ctx.fillRect(0, 0, 196, SCREEN_H);
    outlinedText(ctx, name, 98, 14, PAL.cyan, 8);
    const me = winners.some((w) => w.info.id === this.localId);
    outlinedText(ctx, winners.length > 1 ? 'EMPATE!' : me ? 'VOCÊ VENCEU!' : 'VENCEU!', 98, 28, PAL.yellow, 16);
    const show = Showcase.enabled() ? (this.show3d ??= new Showcase()) : null;
    winners.forEach((w, i) => {
      const x = 98 + (i - (winners.length - 1) / 2) * 56;
      const hop = Math.abs(Math.sin(this.t * 6 + i)) * 6;
      if (show) show.add({ key: 500 + i, character: w.info.character, x, y: 150, height: 86 / Math.max(1, winners.length * 0.75), hop, heading: Math.sin(this.t * 2 + i) * 0.8, dance: true });
      else drawCharacter(ctx, w.info.character, x, 150 - hop, { size: 80, pose: 'win', frame: Math.floor(this.t * 6) % 2, time: this.t });
      outlinedText(ctx, w.info.id === this.localId ? 'VOCÊ' : CHARACTERS[w.info.character].name, x, 158, CHARACTERS[w.info.character].color, 8);
    });
    show?.flush(ctx, this.t);
    const mins = Math.floor(this.snap.matchTime / 60);
    const secs = Math.floor(this.snap.matchTime % 60).toString().padStart(2, '0');
    text(ctx, `${mins}:${secs} · ${this.snap.round > 1 ? `${this.snap.round} RODADAS` : 'SEM CORTES'}`, 98, 176, PAL.white, 8, 'center');
    outlinedText(ctx, 'E AGORA?', 286, 100, PAL.white, 8);
  }
}
