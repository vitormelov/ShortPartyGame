import { SCREEN_H, SCREEN_W } from '@shared/arena';
import type { MatchMode } from '@shared/types';
import { PAL, outlinedText, panel, text } from '../core/draw';
import { menuWorld } from '../three/menuworld';
import { JoinScreen } from './join';
import type { App, Screen } from './screen';
import { SelectScreen } from './select';
import { TitleScreen } from './title';

/*
 * The menu tree after the title:
 *   JOGAR → SOLO → MODO PADRÃO / MODO MINIGAMES
 *         → MULTIPLAYER → CRIAR SALA (→ escolher o modo) / ENTRAR EM SALA
 */

interface Item {
  label: string;
  /** One line under the menu about what this choice does. */
  info: string;
  go: () => void;
}

/** A list of choices over the 3D island (2D panels when VISUAL 3D is off). */
export class MenuScreen implements Screen {
  private t = 0;
  private item = 0;

  constructor(private app: App, private heading: string, private items: Item[], private back: () => void) {}

  update(dt: number): void {
    this.t += dt;
    const inp = this.app.input;
    const n = this.items.length;
    if (inp.pressed('up')) {
      this.item = (this.item + n - 1) % n;
      this.app.sfx.play('menu');
    }
    if (inp.pressed('down')) {
      this.item = (this.item + 1) % n;
      this.app.sfx.play('menu');
    }
    if (inp.pressed('action')) {
      this.app.sfx.play('confirm');
      this.items[this.item].go();
    } else if (inp.pressed('back')) {
      this.app.sfx.play('menu');
      this.back();
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    const labels = this.items.map((i) => i.label);
    const world = menuWorld();
    const x = 112;
    const y = 136;
    if (world) {
      world.draw(ctx, this.t, 'title', { labels, selected: this.item, x, y: y + 8, logo: true });
    } else {
      ctx.fillStyle = PAL.night;
      ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
      outlinedText(ctx, 'SHORT', x, 34, PAL.pink, 32);
      outlinedText(ctx, 'PARTY', x, 70, PAL.yellow, 32);
      labels.forEach((label, i) => {
        const sel = this.item === i;
        panel(ctx, x - 66, y + 8 + i * 20, 132, 15, sel ? PAL.pink : PAL.panel, sel ? PAL.white : PAL.panelLight);
        text(ctx, label, x, y + 12 + i * 20, sel ? PAL.white : PAL.grey, 8, 'center');
      });
    }
    // Where you are in the menu tree, and what the highlighted choice does.
    outlinedText(ctx, this.heading, x, y - 6, PAL.cyan, 8);
    panel(ctx, 0, SCREEN_H - 14, SCREEN_W, 14, 'rgba(10,6,20,0.75)', 'rgba(10,6,20,0)');
    text(ctx, this.items[this.item].info, 4, SCREEN_H - 10, PAL.white);
    text(ctx, 'ESC VOLTA', SCREEN_W - 4, SCREEN_H - 10, PAL.grey, 8, 'right');
  }
}

export function playMenu(app: App): Screen {
  return new MenuScreen(
    app,
    'JOGAR',
    [
      { label: 'SOLO', info: 'VOCÊ CONTRA OS BOTS', go: () => app.go(soloMenu(app)) },
      { label: 'MULTIPLAYER', info: 'JOGUE COM OS AMIGOS ONLINE', go: () => app.go(multiMenu(app)) },
      { label: 'VOLTAR', info: 'VOLTA PARA A TELA INICIAL', go: () => app.go(new TitleScreen(app)) },
    ],
    () => app.go(new TitleScreen(app)),
  );
}

const MODE_ITEMS = (app: App, then: (mode: MatchMode) => Screen): Item[] => [
  { label: 'MODO PADRÃO', info: 'O FEED: CLIPES, RETORNOS E ANÚNCIOS', go: () => app.go(then('feed')) },
  { label: 'MODO MINIGAMES', info: 'UM MINIGAME SÓ, ATÉ SOBRAR UM', go: () => app.go(then('minigame')) },
];

export function soloMenu(app: App): Screen {
  return new MenuScreen(
    app,
    'SOLO',
    [...MODE_ITEMS(app, (mode) => new SelectScreen(app, 'solo', mode)), { label: 'VOLTAR', info: 'VOLTA PARA JOGAR', go: () => app.go(playMenu(app)) }],
    () => app.go(playMenu(app)),
  );
}

export function multiMenu(app: App): Screen {
  return new MenuScreen(
    app,
    'MULTIPLAYER',
    [
      { label: 'CRIAR SALA', info: 'GERA UMA SENHA PARA OS AMIGOS', go: () => app.go(createRoomMenu(app)) },
      { label: 'ENTRAR EM SALA', info: 'DIGITE A SENHA DE UM AMIGO', go: () => app.go(new JoinScreen(app)) },
      { label: 'VOLTAR', info: 'VOLTA PARA JOGAR', go: () => app.go(playMenu(app)) },
    ],
    () => app.go(playMenu(app)),
  );
}

export function createRoomMenu(app: App): Screen {
  return new MenuScreen(
    app,
    'CRIAR SALA: QUAL MODO?',
    [...MODE_ITEMS(app, (mode) => new SelectScreen(app, 'multi', mode)), { label: 'VOLTAR', info: 'VOLTA PARA MULTIPLAYER', go: () => app.go(multiMenu(app)) }],
    () => app.go(multiMenu(app)),
  );
}
