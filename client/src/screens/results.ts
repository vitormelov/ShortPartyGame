import { SCREEN_H, SCREEN_W } from '@shared/arena';
import type { FeedPlayer, FeedSnapshot } from '@shared/feed';
import { CHARACTERS, type PlayerId } from '@shared/types';
import { PAL, outlinedText, panel, portrait, text } from '../core/draw';
import type { App, Screen } from './screen';
import { SelectScreen } from './select';
import { TitleScreen } from './title';

interface Award {
  title: string;
  player: FeedPlayer;
  detail: string[];
}

export class ResultsScreen implements Screen {
  private t = 0;
  private awards: Award[] = [];

  constructor(private app: App, private snap: FeedSnapshot, private localId: PlayerId) {
    const ps = snap.players;
    const byFlops = [...ps].sort((a, b) => b.stats.flops - a.stats.flops)[0];
    if (byFlops && byFlops.stats.flops > 0) this.awards.push({ title: 'REI DO FLOP', player: byFlops, detail: [`${byFlops.stats.flops} MORTES`, 'NO RETORNO'] });
    const fastest = [...ps].sort((a, b) => a.stats.fastestFlop - b.stats.fastestFlop)[0];
    if (fastest && fastest.stats.fastestFlop < Infinity)
      this.awards.push({ title: 'MEMÓRIA PEIXE', player: fastest, detail: [`MORREU EM ${fastest.stats.fastestFlop.toFixed(2)}s`, 'APÓS VOLTAR'] });
    const viral = [...ps].sort((a, b) => b.stats.bonusLives - a.stats.bonusLives)[0];
    if (viral && viral.stats.bonusLives > 0) this.awards.push({ title: 'VIRALIZOU', player: viral, detail: [`+${viral.stats.bonusLives} VIDA EXTRA`] });
  }

  update(dt: number): void {
    this.t += dt;
    if (this.t < 0.5) return;
    if (this.app.input.pressed('action')) {
      this.app.sfx.play('confirm');
      this.app.go(new SelectScreen(this.app));
    } else if (this.app.input.pressed('back')) {
      this.app.go(new TitleScreen(this.app));
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = PAL.night;
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    outlinedText(ctx, 'MAIS CURTIDOS', SCREEN_W / 2, 6, PAL.yellow, 16);
    const mins = Math.floor(this.snap.matchTime / 60);
    const secs = Math.floor(this.snap.matchTime % 60).toString().padStart(2, '0');
    text(ctx, `${this.snap.clipCount} CLIPES EM ${mins}:${secs}`, SCREEN_W / 2, 24, PAL.cyan, 8, 'center');

    this.snap.ranking.forEach((id, i) => {
      const p = this.snap.players.find((pp) => pp.info.id === id);
      if (!p) return;
      const y = 38 + i * 20;
      const mine = id === this.localId;
      panel(ctx, 8, y, 216, 18, mine ? '#2e1d55' : PAL.panel, i === 0 ? PAL.yellow : PAL.panelLight);
      text(ctx, `${i + 1}º`, 13, y + 6, i === 0 ? PAL.yellow : PAL.white);
      portrait(ctx, p.info.character, 38, y + 2, 1, i !== 0);
      text(ctx, p.info.name, 60, y + 6, CHARACTERS[p.info.character].color);
      text(ctx, `MORTES ${p.stats.deaths}`, 218, y + 6, PAL.grey, 8, 'right');
    });

    panel(ctx, 236, 38, 140, 162, PAL.panel, PAL.panelLight);
    text(ctx, 'PRÊMIOS', 306, 44, PAL.pink, 8, 'center');
    this.awards.forEach((a, i) => {
      const y = 56 + i * 48;
      text(ctx, a.title, 242, y, PAL.yellow);
      portrait(ctx, a.player.info.character, 242, y + 9, 1);
      text(ctx, a.player.info.name, 262, y + 13, CHARACTERS[a.player.info.character].color);
      a.detail.forEach((line, j) => text(ctx, line, 242, y + 27 + j * 9, PAL.grey));
    });

    if (this.t > 0.5 && Math.floor(this.t * 2) % 2 === 0) text(ctx, 'ESPAÇO: REVANCHE   ESC: MENU', SCREEN_W / 2, SCREEN_H - 12, PAL.white, 8, 'center');
  }
}
