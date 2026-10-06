import { SCREEN_H, SCREEN_W } from '@shared/arena';
import { DEFAULT_CONFIG, type MatchConfig } from '@shared/types';
import { Sfx } from './core/audio';
import { FONT, RES } from './core/draw';
import { Input } from './core/input';
import { Music } from './core/music';
import { loadSettings } from './core/settings';
import type { App, Screen } from './screens/screen';
import { TitleScreen } from './screens/title';
import { preloadCharacters } from './three/characters3d';

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
/** Device pixels per game pixel. Game logic and drawing stay in game pixels (384x216). */
let scale = RES;

/**
 * Fills the window with the largest 16:9 picture, letterboxed. The canvas is sized in device pixels
 * (1920x1080 on a 1080p screen, so each game pixel is exactly 5x5) and everything is drawn through a
 * scale transform, so pixels stay crisp instead of being stretched by CSS.
 */
function fit(): void {
  const dpr = window.devicePixelRatio || 1;
  const s = Math.min((window.innerWidth * dpr) / SCREEN_W, (window.innerHeight * dpr) / SCREEN_H);
  // Always fill: on a 1080p screen this is exactly 5. Other sizes get a fractional scale.
  scale = s;
  canvas.width = Math.round(SCREEN_W * scale);
  canvas.height = Math.round(SCREEN_H * scale);
  canvas.style.width = `${canvas.width / dpr}px`;
  canvas.style.height = `${canvas.height / dpr}px`;
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener('resize', fit);
fit();

class Game implements App {
  readonly input = new Input();
  readonly sfx = new Sfx();
  readonly music = new Music(() => this.sfx.output());
  private screen: Screen;

  constructor() {
    this.sfx.setVolume(loadSettings().volume / 10);
    this.input.onAnyKey(() => this.sfx.unlock());
    this.screen = new TitleScreen(this);
  }

  go(screen: Screen): void {
    this.screen = screen;
  }

  frame(dt: number): void {
    this.input.poll();
    this.screen.update(dt);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    try {
      this.screen.render(ctx);
      ctx.restore();
    } catch (err) {
      // A render that throws mid save()/clip() would leave the canvas clipped forever:
      // resetting the size wipes all context state.
      canvas.width = canvas.width;
      ctx.imageSmoothingEnabled = false;
      console.error(err);
    }
  }
}

async function boot(): Promise<void> {
  try {
    await document.fonts.load(`8px ${FONT}`);
  } catch {
    // Fall back to monospace if the font can't load.
  }
  preloadCharacters();
  const game = new Game();
  let last = performance.now();
  const loop = (now: number) => {
    // The first rAF timestamp can be slightly earlier than the performance.now() above.
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
    last = now;
    game.frame(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  if (import.meta.env.DEV) {
    // Lets automated tests step frames when the tab isn't animating.
    (window as unknown as { __sp: unknown }).__sp = {
      frame: (dt: number) => game.frame(dt),
      game,
      /** Starts a test match with 7 bots: n = 0 the modo padrão, n > 0 the modo minigames with MINIGAMES[n - 1]. */
      start: async (n: number, cfg: Partial<MatchConfig> = {}) => {
        const { SelectScreen } = await import('./screens/select');
        const sel = new SelectScreen(game, 'solo', n > 0 ? 'minigame' : 'feed') as unknown as { setup: { me: number; bots: unknown[]; game: number; tutorials: boolean }; start(): void };
        sel.setup.me = 0;
        sel.setup.bots = sel.setup.bots.map((_, i) => (i === 0 ? null : (['easy', 'medium', 'hard'] as const)[i % 3]));
        sel.setup.game = Math.max(0, n - 1);
        sel.setup.tutorials = false;
        game.go(sel as unknown as Screen);
        const saved = { ...DEFAULT_CONFIG };
        Object.assign(DEFAULT_CONFIG, cfg);
        sel.start();
        Object.assign(DEFAULT_CONFIG, saved);
      },
    };
  }
}

void boot();
