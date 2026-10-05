import type { PlayerInput } from '@shared/types';

type Button = 'up' | 'down' | 'left' | 'right' | 'action' | 'back';

const KEYMAP: Record<string, Button> = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'action',
  Enter: 'action',
  Escape: 'back',
  Backspace: 'back',
};

/** Keyboard (WASD/arrows + Space/Enter) and gamepad merged into one local player's controller. */
export class Input {
  private keys = new Set<Button>();
  /** Keys pressed since the last poll, so a tap shorter than one frame still registers. */
  private tapped = new Set<Button>();
  private pad = new Set<Button>();
  private prev = new Set<Button>();
  private now = new Set<Button>();
  private listeners: Array<() => void> = [];

  constructor() {
    window.addEventListener('keydown', (e) => {
      const b = KEYMAP[e.code];
      if (b) {
        this.keys.add(b);
        this.tapped.add(b);
        e.preventDefault();
      }
      this.listeners.forEach((l) => l());
    });
    window.addEventListener('keyup', (e) => {
      const b = KEYMAP[e.code];
      if (b) this.keys.delete(b);
    });
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Called once per user gesture (used to unlock audio). */
  onAnyKey(fn: () => void): void {
    this.listeners.push(fn);
  }

  /** Call once per frame before reading. */
  poll(): void {
    this.pad.clear();
    for (const gp of navigator.getGamepads?.() ?? []) {
      if (!gp) continue;
      const [ax = 0, ay = 0] = gp.axes;
      const btn = (i: number) => gp.buttons[i]?.pressed ?? false;
      if (ay < -0.5 || btn(12)) this.pad.add('up');
      if (ay > 0.5 || btn(13)) this.pad.add('down');
      if (ax < -0.5 || btn(14)) this.pad.add('left');
      if (ax > 0.5 || btn(15)) this.pad.add('right');
      if (btn(0) || btn(9)) this.pad.add('action');
      if (btn(1) || btn(8)) this.pad.add('back');
    }
    this.prev = this.now;
    this.now = new Set([...this.keys, ...this.pad, ...this.tapped]);
    this.tapped.clear();
  }

  down(b: Button): boolean {
    return this.now.has(b);
  }

  pressed(b: Button): boolean {
    return this.now.has(b) && !this.prev.has(b);
  }

  playerInput(): PlayerInput {
    const dx = (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0);
    const dy = (this.down('down') ? 1 : 0) - (this.down('up') ? 1 : 0);
    return { dx: dx as -1 | 0 | 1, dy: dy as -1 | 0 | 1, action: this.down('action') };
  }
}
