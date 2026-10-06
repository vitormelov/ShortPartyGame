import type { Sfx } from '../core/audio';
import type { Music } from '../core/music';
import type { Input } from '../core/input';

export interface Screen {
  update(dt: number): void;
  render(ctx: CanvasRenderingContext2D): void;
}

export interface App {
  readonly input: Input;
  readonly sfx: Sfx;
  readonly music: Music;
  go(screen: Screen): void;
}
