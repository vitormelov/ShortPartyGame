import { SCREEN_H, SCREEN_W } from '@shared/arena';
import { Sfx } from './core/audio';
import { FONT } from './core/draw';
import { Input } from './core/input';
import type { App, Screen } from './screens/screen';
import { TitleScreen } from './screens/title';

const canvas = document.getElementById('screen') as HTMLCanvasElement;
canvas.width = SCREEN_W;
canvas.height = SCREEN_H;
const ctx = canvas.getContext('2d')!;
ctx.imageSmoothingEnabled = false;

function fit(): void {
  const s = Math.min(window.innerWidth / SCREEN_W, window.innerHeight / SCREEN_H);
  const scale = s >= 1 ? Math.floor(s) : s; // integer scaling keeps pixels square
  canvas.style.width = `${SCREEN_W * scale}px`;
  canvas.style.height = `${SCREEN_H * scale}px`;
}
window.addEventListener('resize', fit);
fit();

class Game implements App {
  readonly input = new Input();
  readonly sfx = new Sfx();
  private screen: Screen;

  constructor() {
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
    (window as unknown as { __sp: unknown }).__sp = { frame: (dt: number) => game.frame(dt), game };
  }
}

void boot();
