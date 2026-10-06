import { SCREEN_H, SCREEN_W } from '@shared/arena';
import type { FeedPlayer, FeedSnapshot } from '@shared/feed';
import { CHARACTERS, type PlayerId } from '@shared/types';
import { drawPortrait } from '../core/cast';
import { Showcase } from '../three/showcase';
import { PAL, outlinedText, panel, text } from '../core/draw';
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
  private show3d: Showcase | null = null;
  private awards: Award[] = [];

  constructor(private app: App, private snap: FeedSnapshot, private localId: PlayerId) {
    app.music.rate = 1;
    app.music.tension = 0;
    app.music.setMuffled(false);
    app.music.play('theme', 'menu');
    const ps = snap.players;
    const byFlops = [...ps].sort((a, b) => b.stats.flops - a.stats.flops)[0];
    if (byFlops && byFlops.stats.flops > 0) this.awards.push({ title: 'REI DO FLOP', player: byFlops, detail: [`${byFlops.stats.flops} MORTES`, 'NO RETORNO'] });
    const hater = [...ps].sort((a, b) => b.stats.assists - a.stats.assists)[0];
    if (hater && hater.stats.assists > 0) this.awards.push({ title: 'HATER DO ANO', player: hater, detail: [`${hater.stats.assists} ASSISTÊNCIAS`, 'NOS COMENTÁRIOS'] });
    const viral = [...ps].sort((a, b) => b.stats.bonusLives - a.stats.bonusLives)[0];
    if (viral && viral.stats.bonusLives > 0) this.awards.push({ title: 'VIRALIZOU', player: viral, detail: [`+${viral.stats.bonusLives} VIDA EXTRA`] });
    const fastest = [...ps].sort((a, b) => a.stats.fastestFlop - b.stats.fastestFlop)[0];
    if (fastest && fastest.stats.fastestFlop < Infinity)
      this.awards.push({ title: 'MEMÓRIA PEIXE', player: fastest, detail: [`MORREU EM ${fastest.stats.fastestFlop.toFixed(2)}s`, 'APÓS VOLTAR'] });
    this.awards = this.awards.slice(0, 3); // only room for three
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
    const show = Showcase.enabled() ? (this.show3d ??= new Showcase()) : null;
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
      panel(ctx, 8, y, 216, 18, mine ? '#3a1a6a' : PAL.panel, i === 0 ? PAL.yellow : PAL.panelLight);
      text(ctx, `${i + 1}º`, 13, y + 6, i === 0 ? PAL.yellow : PAL.white);
      // The winner celebrates; everyone else hangs their head.
      if (show) show.add({ key: 300 + i, character: p.info.character, x: 46, y: y + 17, height: 18, hop: i === 0 ? Math.abs(Math.sin(this.t * 7)) * 2 : 0, heading: i === 0 ? this.t * 3 : 0, tilt: i === 0 ? 0 : 0.35, dance: i === 0 });
      else drawPortrait(ctx, p.info.character, 38, y + 1, 1, i !== 0, i === 0 ? 'win' : 'lose', this.t);
      text(ctx, p.info.name, 60, y + 6, CHARACTERS[p.info.character].color);
      text(ctx, `MORTES ${p.stats.deaths}`, 218, y + 6, PAL.grey, 8, 'right');
    });

    panel(ctx, 236, 38, 140, 162, PAL.panel, PAL.panelLight);
    text(ctx, 'PRÊMIOS', 306, 44, PAL.pink, 8, 'center');
    this.awards.forEach((a, i) => {
      const y = 56 + i * 48;
      text(ctx, a.title, 242, y, PAL.yellow);
      if (show) show.add({ key: 400 + i, character: a.player.info.character, x: 250, y: y + 25, height: 18 });
      else drawPortrait(ctx, a.player.info.character, 242, y + 9, 1, false, 'idle', this.t);
      text(ctx, a.player.info.name, 262, y + 13, CHARACTERS[a.player.info.character].color);
      a.detail.forEach((line, j) => text(ctx, line, 242, y + 27 + j * 9, PAL.grey));
    });

    show?.flush(ctx, this.t);
    if (this.t > 0.5 && Math.floor(this.t * 2) % 2 === 0) text(ctx, 'ESPAÇO: REVANCHE   ESC: MENU', SCREEN_W / 2, SCREEN_H - 12, PAL.white, 8, 'center');
  }
}
