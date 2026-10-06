import { SCREEN_H, SCREEN_W } from '@shared/arena';
import { BRAND, PAL, outlinedText, panel, text } from '../core/draw';
import { menuWorld } from '../three/menuworld';
import { multiMenu } from './menus';
import { ROOM_ALPHABET, ROOM_CODE_LENGTH } from './select';
import type { App, Screen } from './screen';

/** Letters typed on the keyboard, collected for whichever JoinScreen is open. */
let typed: string[] = [];
let listening = false;
function listen(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('keydown', (e) => {
    if (e.key.length === 1) typed.push(e.key.toUpperCase());
    else if (e.key === 'Backspace') typed.push('\b');
    else if (e.key === 'Escape') typed.push('\x1b');
  });
}

/**
 * ENTRAR EM SALA: type the room code a friend got from CRIAR SALA. Joining needs the online
 * server (phase 2), so for now it explains that instead of connecting.
 */
export class JoinScreen implements Screen {
  private t = 0;
  private code = '';
  private status: 'typing' | 'searching' | 'offline' = 'typing';
  private statusT = 0;

  constructor(private app: App) {
    listen();
    typed = [];
  }

  update(dt: number): void {
    this.t += dt;
    this.statusT += dt;
    const keys = typed;
    typed = [];
    if (this.status === 'searching' && this.statusT > 1.4) {
      this.status = 'offline';
      this.app.sfx.play('lifeLost');
    }
    for (const k of keys) {
      if (this.status !== 'typing') this.status = 'typing';
      if (k === '\x1b') continue;
      if (k === '\b') this.code = this.code.slice(0, -1);
      else if (ROOM_ALPHABET.includes(k) && this.code.length < ROOM_CODE_LENGTH) {
        this.code += k;
        this.app.sfx.play('click');
      }
    }
    const inp = this.app.input;
    // Backspace is also "back": it only leaves when there's nothing left to erase (Esc always leaves).
    if (keys.includes('\x1b') || (inp.pressed('back') && this.code.length === 0 && !keys.includes('\b'))) {
      this.app.sfx.play('menu');
      this.app.go(multiMenu(this.app));
      return;
    }
    if (inp.pressed('action') && this.status === 'typing' && this.code.length === ROOM_CODE_LENGTH) {
      this.status = 'searching';
      this.statusT = 0;
      this.app.sfx.play('confirm');
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    const world = menuWorld();
    if (world) {
      world.draw(ctx, this.t, 'options');
      ctx.fillStyle = 'rgba(16,6,36,0.5)';
      ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    } else {
      ctx.fillStyle = PAL.night;
      ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    }
    outlinedText(ctx, 'ENTRAR EM SALA', SCREEN_W / 2, 26, PAL.yellow, 16);
    text(ctx, 'DIGITE A SENHA DA SALA DO SEU AMIGO', SCREEN_W / 2, 50, PAL.white, 8, 'center');
    // One box per character.
    const box = 30;
    const gap = 8;
    const x0 = SCREEN_W / 2 - (ROOM_CODE_LENGTH * box + (ROOM_CODE_LENGTH - 1) * gap) / 2;
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      const x = x0 + i * (box + gap);
      const current = i === this.code.length && this.status === 'typing';
      panel(ctx, x, 72, box, 36, PAL.ink, current ? (Math.floor(this.t * 4) % 2 ? PAL.yellow : PAL.panelLight) : BRAND.ciano);
      if (this.code[i]) outlinedText(ctx, this.code[i], x + box / 2, 82, PAL.white, 16);
    }
    if (this.status === 'searching') {
      text(ctx, `PROCURANDO A SALA ${this.code}${'.'.repeat(1 + (Math.floor(this.t * 3) % 3))}`, SCREEN_W / 2, 126, PAL.cyan, 8, 'center');
    } else if (this.status === 'offline') {
      panel(ctx, 16, 120, SCREEN_W - 32, 40, 'rgba(10,6,20,0.85)', PAL.red);
      text(ctx, 'NÃO DEU PARA CONECTAR', SCREEN_W / 2, 127, PAL.red, 8, 'center');
      text(ctx, 'O SERVIDOR ONLINE AINDA NÃO ESTÁ NO AR', SCREEN_W / 2, 139, PAL.white, 8, 'center');
      text(ctx, '(CHEGA NA PRÓXIMA FASE)', SCREEN_W / 2, 149, PAL.grey, 8, 'center');
    } else if (this.code.length === ROOM_CODE_LENGTH) {
      text(ctx, 'ESPAÇO OU ENTER: ENTRAR', SCREEN_W / 2, 126, PAL.green, 8, 'center');
    }
    panel(ctx, 0, SCREEN_H - 14, SCREEN_W, 14, 'rgba(10,6,20,0.75)', 'rgba(10,6,20,0)');
    text(ctx, 'DIGITE AS LETRAS  BACKSPACE APAGA', 4, SCREEN_H - 10, PAL.white);
    text(ctx, 'ESC VOLTA', SCREEN_W - 4, SCREEN_H - 10, PAL.grey, 8, 'right');
  }
}
