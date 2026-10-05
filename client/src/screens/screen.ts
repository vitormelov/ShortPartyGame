import type { Sfx } from '../core/audio';
import type { Input } from '../core/input';

export interface Screen {
  update(dt: number): void;
  render(ctx: CanvasRenderingContext2D): void;
}

export interface App {
  readonly input: Input;
  readonly sfx: Sfx;
  go(screen: Screen): void;
}
