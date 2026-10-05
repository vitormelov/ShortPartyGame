import { SCREEN_H, SCREEN_W } from '@shared/arena';
import { CHARACTERS, DEFAULT_CONFIG, MAX_PLAYERS, MIN_PLAYERS, type BotDifficulty, type MatchConfig, type PlayerInfo } from '@shared/types';
import { PAL, heart, outlinedText, panel, portrait, text } from '../core/draw';
import { LocalTransport } from '../net/LocalTransport';
import { GameScreen } from './game';
import type { App, Screen } from './screen';

type SlotKind = 'you' | 'bot' | 'empty';

interface Slot {
  kind: SlotKind;
  character: number;
  difficulty: BotDifficulty;
}

const DIFF_LABEL: Record<BotDifficulty, string> = { easy: 'FÁCIL', medium: 'MÉDIO', hard: 'DIFÍCIL' };
const DIFF_COLOR: Record<BotDifficulty, string> = { easy: PAL.green, medium: PAL.yellow, hard: PAL.red };
const CLIP_OPTIONS = [
  { label: '5s', min: 5, max: 5 },
  { label: '7s', min: 7, max: 7 },
  { label: '10s', min: 10, max: 10 },
  { label: '5-8s', min: 5, max: 8 },
  { label: '5-10s', min: 5, max: 10 },
];
const RETURN_OPTIONS = [
  { label: 'BAIXO', value: 0.25 },
  { label: 'MÉDIO', value: 0.45 },
  { label: 'ALTO', value: 0.65 },
];
const AD_OPTIONS = [
  { label: 'NUNCA', value: 0 },
  { label: 'ÀS VEZES', value: 0.12 },
  { label: 'MUITO', value: 0.25 },
];
const SPEED_OPTIONS = [
  { label: 'NUNCA', value: 0 },
  { label: 'ÀS VEZES', value: 0.2 },
  { label: 'MUITO', value: 0.45 },
];

/** Settings survive between matches (revanche). */
interface Setup {
  slots: Slot[];
  lives: number;
  clip: number;
  ret: number;
  speed: number;
  ads: number;
}

let saved: Setup | null = null;

function defaultSetup(): Setup {
  const diffs: BotDifficulty[] = ['medium', 'easy', 'hard', 'medium', 'easy', 'medium', 'hard'];
  return {
    slots: [
      { kind: 'you', character: 0, difficulty: 'medium' },
      ...diffs.map((d, i): Slot => ({ kind: 'bot', character: i + 1, difficulty: d })),
    ],
    lives: DEFAULT_CONFIG.lives,
    clip: 3,
    ret: 1,
    speed: 1,
    ads: 1,
  };
}

// Cursor rows: 0 = slots 0-3, 1 = slots 4-7, 2 = lives, 3 = clip, 4 = return, 5 = speed, 6 = ads, 7 = start
const ROW_START = 7;

export class SelectScreen implements Screen {
  private setup: Setup;
  private row = ROW_START;
  private col = 0;
  private t = 0;
  private warn = 0;

  constructor(private app: App) {
    this.setup = saved ?? defaultSetup();
  }

  private get count(): number {
    return this.setup.slots.filter((s) => s.kind !== 'empty').length;
  }

  private freeCharacter(from: number, exclude: number): number {
    const used = new Set(this.setup.slots.filter((s, i) => s.kind !== 'empty' && i !== exclude).map((s) => s.character));
    for (let k = 1; k <= CHARACTERS.length; k++) {
      const c = (from + k) % CHARACTERS.length;
      if (!used.has(c)) return c;
    }
    return from;
  }

  update(dt: number): void {
    this.t += dt;
    this.warn = Math.max(0, this.warn - dt);
    const inp = this.app.input;
    const s = this.setup;
    const move = () => this.app.sfx.play('menu');

    if (inp.pressed('up') && this.row > 0) {
      this.row--;
      move();
    }
    if (inp.pressed('down') && this.row < ROW_START) {
      this.row++;
      move();
    }
    const lr = (inp.pressed('right') ? 1 : 0) - (inp.pressed('left') ? 1 : 0);

    if (this.row <= 1) {
      if (lr) {
        this.col = (this.col + lr + 4) % 4;
        move();
      }
      if (inp.pressed('action')) {
        const i = this.row * 4 + this.col;
        const slot = s.slots[i];
        if (slot.kind === 'you') {
          slot.character = this.freeCharacter(slot.character, i);
        } else if (slot.kind === 'empty') {
          s.slots[i] = { kind: 'bot', character: this.freeCharacter(i, i), difficulty: 'easy' };
        } else if (slot.difficulty === 'easy') {
          slot.difficulty = 'medium';
        } else if (slot.difficulty === 'medium') {
          slot.difficulty = 'hard';
        } else {
          slot.kind = 'empty';
        }
        this.app.sfx.play('confirm');
      }
    } else if (this.row === 2 && lr) {
      s.lives = Math.max(1, Math.min(9, s.lives + lr));
      move();
    } else if (this.row === 3 && lr) {
      s.clip = (s.clip + lr + CLIP_OPTIONS.length) % CLIP_OPTIONS.length;
      move();
    } else if (this.row === 4 && lr) {
      s.ret = (s.ret + lr + RETURN_OPTIONS.length) % RETURN_OPTIONS.length;
      move();
    } else if (this.row === 5 && lr) {
      s.speed = (s.speed + lr + SPEED_OPTIONS.length) % SPEED_OPTIONS.length;
      move();
    } else if (this.row === 6 && lr) {
      s.ads = (s.ads + lr + AD_OPTIONS.length) % AD_OPTIONS.length;
      move();
    } else if (this.row === ROW_START && inp.pressed('action')) {
      this.start();
    }
  }

  private start(): void {
    const s = this.setup;
    // Auto-fill with bots up to the minimum.
    for (let i = 0; i < MAX_PLAYERS && this.count < MIN_PLAYERS; i++) {
      if (s.slots[i].kind === 'empty') s.slots[i] = { kind: 'bot', character: this.freeCharacter(i, i), difficulty: 'medium' };
    }
    saved = s;

    const players: PlayerInfo[] = [];
    let localId = 0;
    for (const slot of s.slots) {
      if (slot.kind === 'empty') continue;
      const id = players.length;
      if (slot.kind === 'you') localId = id;
      const ch = CHARACTERS[slot.character];
      players.push({
        id,
        name: slot.kind === 'you' ? 'VOCÊ' : ch.name,
        character: slot.character,
        isBot: slot.kind === 'bot',
        difficulty: slot.difficulty,
      });
    }
    const clip = CLIP_OPTIONS[s.clip];
    const config: MatchConfig = {
      ...DEFAULT_CONFIG,
      lives: s.lives,
      clipMin: clip.min,
      clipMax: clip.max,
      returnChance: RETURN_OPTIONS[s.ret].value,
      speedChance: SPEED_OPTIONS[s.speed].value,
      adChance: AD_OPTIONS[s.ads].value,
    };
    this.app.sfx.play('go');
    this.app.go(new GameScreen(this.app, new LocalTransport(players, config, localId)));
  }

  render(ctx: CanvasRenderingContext2D): void {
    const s = this.setup;
    ctx.fillStyle = PAL.night;
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    for (let y = 0; y < SCREEN_H; y += 6) {
      ctx.fillStyle = (y / 6) % 2 ? '#1a0f32' : PAL.night;
      ctx.fillRect(0, y, SCREEN_W, 3);
    }
    outlinedText(ctx, 'MONTE O FEED', SCREEN_W / 2, 6, PAL.yellow, 16);
    text(ctx, `${this.count}/8 JOGADORES`, SCREEN_W / 2, 23, this.count >= MIN_PLAYERS ? PAL.cyan : PAL.red, 8, 'center');

    for (let i = 0; i < MAX_PLAYERS; i++) {
      const slot = s.slots[i];
      const r = Math.floor(i / 4);
      const c = i % 4;
      const x = 12 + c * 92;
      const y = 34 + r * 59;
      const selected = this.row === r && this.col === c;
      const ch = CHARACTERS[slot.character];
      const fill = slot.kind === 'empty' ? '#1a1030' : slot.kind === 'you' ? '#2e1d55' : PAL.panel;
      panel(ctx, x, y, 84, 56, fill, selected ? (Math.floor(this.t * 6) % 2 ? PAL.yellow : PAL.white) : slot.kind === 'you' ? ch.color : PAL.panelLight);
      if (slot.kind === 'empty') {
        text(ctx, '+ BOT', x + 42, y + 24, PAL.grey, 8, 'center');
        continue;
      }
      portrait(ctx, slot.character, x + 26, y + 4, 2);
      text(ctx, slot.kind === 'you' ? 'VOCÊ' : ch.name, x + 42, y + 38, slot.kind === 'you' ? PAL.yellow : PAL.white, 8, 'center');
      text(ctx, slot.kind === 'you' ? ch.name : DIFF_LABEL[slot.difficulty], x + 42, y + 47, slot.kind === 'you' ? ch.color : DIFF_COLOR[slot.difficulty], 8, 'center');
      text(ctx, slot.kind === 'you' ? 'P1' : 'BOT', x + 4, y + 4, slot.kind === 'you' ? PAL.yellow : PAL.grey);
    }

    const opt = (row: number, label: string, value: string, y: number) => {
      const sel = this.row === row;
      text(ctx, label, 16, y, sel ? PAL.yellow : PAL.white);
      text(ctx, sel ? `< ${value} >` : value, 140, y, sel ? PAL.yellow : PAL.cyan, 8, 'center');
    };
    opt(2, 'VIDAS', `${s.lives}`, 153);
    heart(ctx, 172, 153);
    opt(3, 'CLIPE', CLIP_OPTIONS[s.clip].label, 164);
    opt(4, 'RETORNO', RETURN_OPTIONS[s.ret].label, 175);
    opt(5, 'ACELERAR', SPEED_OPTIONS[s.speed].label, 186);
    opt(6, 'ANÚNCIOS', AD_OPTIONS[s.ads].label, 197);

    const sel = this.row === ROW_START;
    const blink = sel && Math.floor(this.t * 4) % 2 === 0;
    panel(ctx, 236, 160, 136, 32, blink ? PAL.pink : sel ? '#c83a8a' : PAL.panel, sel ? PAL.white : PAL.panelLight);
    outlinedText(ctx, 'INICIAR', 304, 169, sel ? PAL.white : PAL.grey, 16);

    const hint = this.row <= 1 ? 'ESPAÇO: TROCAR' : this.row === ROW_START ? 'ESPAÇO: COMEÇAR' : 'A/D: ALTERAR';
    text(ctx, hint, 304, 196, PAL.grey, 8, 'center');
  }
}
