import { SCREEN_H, SCREEN_W } from '@shared/arena';
import { MINIGAMES } from '@shared/minigames';
import { CHARACTERS, DEFAULT_CONFIG, MIN_PLAYERS, type BotDifficulty, type MatchConfig, type MatchMode, type PlayerInfo } from '@shared/types';
import { drawCharacter, drawPortrait } from '../core/cast';
import { menuWorld } from '../three/menuworld';
import { Showcase } from '../three/showcase';
import { BRAND, PAL, heart, outlinedText, panel, text } from '../core/draw';
import { tiny } from '../feed/hud';
import { LocalTransport } from '../net/LocalTransport';
import { GameScreen } from './game';
import type { App, Screen } from './screen';
import { createRoomMenu, soloMenu } from './menus';

/*
 * Character select in the Mario Kart 64 style: a grid of faces, the player's "1P" cursor, the
 * picked character big on the left. Then the host drops bots onto the characters that are left
 * (Space cycles FÁCIL → MÉDIO → DIFÍCIL → none), and below are the match options.
 */

export type Mode = 'solo' | 'multi';
type Phase = 'pick' | 'bots' | 'options';

const DIFF_LABEL: Record<BotDifficulty, string> = { easy: 'FÁCIL', medium: 'MÉDIO', hard: 'DIFÍCIL' };
const DIFF_COLOR: Record<BotDifficulty, string> = { easy: PAL.green, medium: PAL.yellow, hard: PAL.red };
const NEXT_DIFF: Record<string, BotDifficulty | null> = { none: 'easy', easy: 'medium', medium: 'hard', hard: null };

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
  mode: Mode;
  /** Modo padrão (the feed) or modo minigames (one minigame, elimination). */
  matchMode: MatchMode;
  /** The local player's character, once picked. */
  me: number | null;
  /** Bot difficulty on each character (null = not playing). */
  bots: Array<BotDifficulty | null>;
  lives: number;
  clip: number;
  ret: number;
  speed: number;
  ads: number;
  /** Modo minigames: index into MINIGAMES. */
  game: number;
  tutorials: boolean;
}

let saved: Setup | null = null;

function defaultSetup(mode: Mode, matchMode: MatchMode): Setup {
  return {
    mode,
    matchMode,
    me: null,
    bots: CHARACTERS.map(() => null),
    lives: DEFAULT_CONFIG.lives,
    clip: 3,
    ret: 1,
    speed: 1,
    ads: 1,
    game: 0,
    tutorials: DEFAULT_CONFIG.tutorials,
  };
}

// Grid of faces.
const COLS = 4;
const CARD_W = 54;
const CARD_H = 44;
const GRID_X = 152;
const GRID_Y = 26;
const cardX = (i: number) => GRID_X + (i % COLS) * (CARD_W + 4);
const cardY = (i: number) => GRID_Y + Math.floor(i / COLS) * (CARD_H + 4);

// Options rows per mode (the last one is INICIAR).
const FEED_ROWS = ['VIDAS', 'CLIPE', 'RETORNO', 'ACELERAR', 'ANÚNCIOS', 'TUTORIAL', 'INICIAR'] as const;
const MINIGAME_ROWS = ['MINIGAME', 'TUTORIAL', 'INICIAR'] as const;
type OptionRow = (typeof FEED_ROWS)[number] | (typeof MINIGAME_ROWS)[number];

/** Room codes: no 0/O or 1/I, so they're easy to read out loud. */
export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 4;

/** A random room code for CRIAR SALA (connecting needs the online server, coming in phase 2). */
function roomCode(): string {
  return Array.from({ length: ROOM_CODE_LENGTH }, () => ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)]).join('');
}

export class SelectScreen implements Screen {
  private setup: Setup;
  private phase: Phase;
  private cursor = 0;
  private row = 0;
  private t = 0;
  private show3d: Showcase | null = null;
  private show: Showcase | null = null;
  private warn = 0;
  /** Seconds since the player locked in their character (victory pose + flash). */
  private picked = 99;
  private code = roomCode();

  constructor(private app: App, mode?: Mode, matchMode: MatchMode = 'feed') {
    app.music.rate = 1;
    app.music.tension = 0;
    app.music.heat = 0;
    app.music.setMuffled(false);
    app.music.play('theme', 'menu');
    if (saved && (!mode || mode === saved.mode) && saved.matchMode === matchMode) {
      // Revanche: same cast, straight to the options with INICIAR selected.
      this.setup = saved;
      this.phase = saved.me === null ? 'pick' : 'options';
      this.cursor = saved.me ?? 0;
    } else {
      this.setup = defaultSetup(mode ?? 'solo', matchMode);
      this.phase = 'pick';
    }
    this.row = this.startRow;
  }

  private get rows(): readonly OptionRow[] {
    return this.setup.matchMode === 'minigame' ? MINIGAME_ROWS : FEED_ROWS;
  }

  private get startRow(): number {
    return this.rows.length - 1;
  }

  /** ESC from the character grid: back to the menu this came from. */
  private leave(): void {
    this.app.go(this.setup.mode === 'multi' ? createRoomMenu(this.app) : soloMenu(this.app));
  }

  private get botCount(): number {
    return this.setup.bots.filter((b) => b !== null).length;
  }

  private get total(): number {
    return this.botCount + (this.setup.me === null ? 0 : 1);
  }

  update(dt: number): void {
    this.t += dt;
    this.picked += dt;
    this.warn = Math.max(0, this.warn - dt);
    const inp = this.app.input;
    const s = this.setup;
    const move = () => this.app.sfx.play('menu');
    const lr = (inp.pressed('right') ? 1 : 0) - (inp.pressed('left') ? 1 : 0);
    const ud = (inp.pressed('down') ? 1 : 0) - (inp.pressed('up') ? 1 : 0);

    if (this.phase === 'pick' || this.phase === 'bots') {
      const col = this.cursor % COLS;
      const row = Math.floor(this.cursor / COLS);
      if (lr) {
        this.cursor = row * COLS + ((col + lr + COLS) % COLS);
        move();
      }
      if (ud) {
        if (this.phase === 'bots' && ud > 0 && row === 1) {
          this.phase = 'options';
          this.row = 0;
          move();
        } else if (row + ud >= 0 && row + ud <= 1) {
          this.cursor += ud * COLS;
          move();
        }
      }
    }

    switch (this.phase) {
      case 'pick':
        if (inp.pressed('action')) {
          const c = this.cursor;
          s.me = c;
          s.bots[c] = null;
          // First time here: fill every other character with a MÉDIO bot; the host trims from there.
          if (this.botCount === 0) s.bots = s.bots.map((_, i) => (i === c ? null : 'medium'));
          this.phase = 'bots';
          this.picked = 0;
          this.cursor = (c + 1) % CHARACTERS.length;
          this.app.sfx.play('confirm');
          this.app.sfx.voice(c, 6);
        } else if (inp.pressed('back')) {
          this.leave();
        }
        break;
      case 'bots':
        if (inp.pressed('action')) {
          if (this.cursor === s.me) {
            // Own card: go back and pick someone else.
            this.phase = 'pick';
            move();
          } else {
            const cur = s.bots[this.cursor];
            s.bots[this.cursor] = NEXT_DIFF[cur ?? 'none'];
            this.app.sfx.play(s.bots[this.cursor] ? 'confirm' : 'menu');
            if (s.bots[this.cursor] && !cur) this.app.sfx.voice(this.cursor, 3);
          }
        } else if (inp.pressed('back')) {
          this.phase = 'pick';
          this.cursor = s.me ?? 0;
          move();
        }
        break;
      case 'options': {
        if (ud < 0 && this.row === 0) {
          this.phase = 'bots';
          this.cursor = 4 + Math.min(3, this.cursor % COLS);
          move();
          break;
        }
        if (ud) {
          this.row = Math.max(0, Math.min(this.startRow, this.row + ud));
          move();
        }
        const name = this.rows[this.row];
        if (lr) {
          if (name === 'VIDAS') s.lives = Math.max(1, Math.min(9, s.lives + lr));
          else if (name === 'CLIPE') s.clip = (s.clip + lr + CLIP_OPTIONS.length) % CLIP_OPTIONS.length;
          else if (name === 'RETORNO') s.ret = (s.ret + lr + RETURN_OPTIONS.length) % RETURN_OPTIONS.length;
          else if (name === 'ACELERAR') s.speed = (s.speed + lr + SPEED_OPTIONS.length) % SPEED_OPTIONS.length;
          else if (name === 'ANÚNCIOS') s.ads = (s.ads + lr + AD_OPTIONS.length) % AD_OPTIONS.length;
          else if (name === 'MINIGAME') s.game = (s.game + lr + MINIGAMES.length) % MINIGAMES.length;
          else if (name === 'TUTORIAL') s.tutorials = !s.tutorials;
          if (name !== 'INICIAR') move();
        }
        if (inp.pressed('action')) {
          if (name === 'INICIAR') this.start();
          else if (name === 'TUTORIAL') {
            s.tutorials = !s.tutorials;
            move();
          }
        } else if (inp.pressed('back')) {
          this.phase = 'bots';
          move();
        }
        break;
      }
    }
  }

  private start(): void {
    const s = this.setup;
    if (s.me === null) {
      this.phase = 'pick';
      return;
    }
    if (this.total < MIN_PLAYERS) {
      this.warn = 1.5;
      this.app.sfx.play('lifeLost');
      return;
    }
    saved = s;

    const players: PlayerInfo[] = [{ id: 0, name: 'VOCÊ', character: s.me, isBot: false, difficulty: 'medium' }];
    s.bots.forEach((d, c) => {
      if (d) players.push({ id: players.length, name: CHARACTERS[c].name, character: c, isBot: true, difficulty: d });
    });
    const clip = CLIP_OPTIONS[s.clip];
    const minigames = s.matchMode === 'minigame';
    const config: MatchConfig = {
      ...DEFAULT_CONFIG,
      mode: s.matchMode,
      lives: s.lives,
      clipMin: clip.min,
      clipMax: clip.max,
      returnChance: RETURN_OPTIONS[s.ret].value,
      speedChance: SPEED_OPTIONS[s.speed].value,
      adChance: AD_OPTIONS[s.ads].value,
      onlyGame: minigames ? MINIGAMES[s.game % MINIGAMES.length].id : null,
      tutorials: s.tutorials,
    };
    this.app.sfx.play('go');
    // REPETIR PARTIDA (minigames mode) starts the same match again.
    const launch = (): Screen => new GameScreen(this.app, new LocalTransport(players, config, 0), launch);
    this.app.go(launch());
  }

  // ---------- drawing ----------

  render(ctx: CanvasRenderingContext2D): void {
    const s = this.setup;
    this.background(ctx);

    outlinedText(ctx, 'QUEM VAI POSTAR?', 237, 6, PAL.yellow, 16);
    if (s.mode === 'multi') {
      panel(ctx, 6, 5, 84, 15, PAL.ink, BRAND.ciano);
      tiny(ctx, 'SENHA', 11, 7, BRAND.ciano, 'left', null);
      text(ctx, this.code, 30, 8, PAL.white);
      tiny(ctx, s.matchMode === 'minigame' ? 'MODO MINIGAMES' : 'MODO PADRÃO', 11, 14, PAL.grey, 'left', null);
    } else {
      panel(ctx, 6, 5, 84, 15, PAL.ink, PAL.panelLight);
      tiny(ctx, 'SOLO', 48, 7, PAL.white, 'center', null);
      tiny(ctx, s.matchMode === 'minigame' ? 'MODO MINIGAMES' : 'MODO PADRÃO', 48, 13, BRAND.ciano, 'center', null);
    }

    this.show = Showcase.enabled() ? (this.show3d ??= new Showcase()) : null;
    this.showcase(ctx);
    for (let i = 0; i < CHARACTERS.length; i++) this.card(ctx, i);
    if (this.show) {
      this.show.flush(ctx, this.t);
      for (let i = 0; i < CHARACTERS.length; i++) this.cardTags(ctx, i);
    }

    // What the cursor does right now.
    const hint =
      this.phase === 'pick'
        ? 'ESPAÇO: ESCOLHER   ESC: VOLTAR'
        : this.phase === 'bots'
          ? 'ESPAÇO: BOT/DIFICULDADE   S: OPÇÕES'
          : 'A/D: ALTERAR   ESC: BOTS';
    tiny(ctx, hint, GRID_X + (CARD_W * 4 + 12) / 2, GRID_Y + CARD_H * 2 + 8, PAL.grey, 'center', null);
    const bots = `${this.botCount} BOT${this.botCount === 1 ? '' : 'S'}  ·  ${this.total}/8 JOGADORES`;
    tiny(ctx, bots, GRID_X + (CARD_W * 4 + 12) / 2, GRID_Y + CARD_H * 2 + 14, this.total >= MIN_PLAYERS ? BRAND.ciano : PAL.red, 'center', null);

    this.options(ctx);
  }

  private background(ctx: CanvasRenderingContext2D): void {
    const world = menuWorld();
    if (world) {
      // The island behind, dimmed so the cards and options read well.
      world.draw(ctx, this.t, 'select');
      ctx.fillStyle = 'rgba(16,6,36,0.62)';
      ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
      return;
    }
    ctx.fillStyle = PAL.night;
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    // Diagonal stripes drifting, like the N64 menus.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, SCREEN_W, SCREEN_H);
    ctx.clip();
    ctx.fillStyle = '#22104a';
    const off = (this.t * 10) % 24;
    for (let x = -SCREEN_H; x < SCREEN_W + 24; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x + off, 0);
      ctx.lineTo(x + off + 12, 0);
      ctx.lineTo(x + off + 12 + SCREEN_H, SCREEN_H);
      ctx.lineTo(x + off + SCREEN_H, SCREEN_H);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /** The big character on the left: whoever the cursor is on while picking, then your pick. */
  private showcase(ctx: CanvasRenderingContext2D): void {
    const s = this.setup;
    const x = 6;
    const y = 24;
    const w = 138;
    const h = 98;
    const c = this.phase === 'pick' ? this.cursor : (s.me ?? this.cursor);
    const ch = CHARACTERS[c];
    panel(ctx, x, y, w, h, '#160830', ch.color);
    // Spotlight on a little stage.
    const g = ctx.createRadialGradient(x + w / 2, y + 74, 2, x + w / 2, y + 74, 60);
    g.addColorStop(0, `${ch.color}55`);
    g.addColorStop(1, 'rgba(22,8,48,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    ctx.fillStyle = '#2a1450';
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + 78, 30, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ch.color;
    ctx.fillRect(x + w / 2 - 30, y + 78, 60, 1);
    const locked = this.phase !== 'pick' && s.me !== null;
    const celebrate = locked && this.picked < 1.6;
    if (this.show) {
      // The big 3D model on its little stage: turning slowly, spinning and hopping when picked.
      this.show.add({
        key: 100 + c,
        character: c,
        x: x + w / 2,
        y: y + 80,
        height: 66,
        heading: celebrate ? this.picked * 14 : Math.sin(this.t * 1.1) * 0.7,
        hop: celebrate ? Math.abs(Math.sin(this.picked * 9)) * 8 : 0,
        dance: celebrate,
      });
      this.show.flush(ctx, this.t);
    } else {
      drawCharacter(ctx, c, x + w / 2, y + 80, {
        size: 74,
        pose: celebrate ? 'win' : 'idle',
        frame: Math.floor(this.t * (celebrate ? 6 : 2)) % 2,
        time: this.t,
        sy: celebrate && this.picked < 0.15 ? 0.85 : 1,
        sx: celebrate && this.picked < 0.15 ? 1.12 : 1,
      });
    }
    if (celebrate && this.picked < 0.2) {
      ctx.fillStyle = `rgba(255,244,224,${1 - this.picked / 0.2})`;
      ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    }
    outlinedText(ctx, ch.name, x + w / 2, y + 84, ch.color, 8);
    if (locked) {
      panel(ctx, x + 4, y + 4, 18, 11, BRAND.rosa, PAL.white);
      text(ctx, '1P', x + 13, y + 6, PAL.white, 8, 'center', null);
    }
  }

  private card(ctx: CanvasRenderingContext2D, i: number): void {
    const s = this.setup;
    const x = cardX(i);
    const y = cardY(i);
    const ch = CHARACTERS[i];
    const mine = s.me === i;
    const bot = s.bots[i];
    const onCursor = (this.phase === 'pick' || this.phase === 'bots') && this.cursor === i;
    const dim = this.phase !== 'pick' && !mine && !bot;
    panel(ctx, x, y, CARD_W, CARD_H, mine ? '#3a1a6a' : dim ? '#140828' : PAL.panel, mine ? ch.color : PAL.panelLight);
    // Color strip like the N64 nameplates.
    ctx.fillStyle = dim ? '#3a2a50' : ch.color;
    ctx.fillRect(x + 1, y + CARD_H - 9, CARD_W - 2, 8);
    const face = this.phase === 'pick' && onCursor ? 'win' : 'idle';
    if (this.show && !dim) {
      // Little 3D figure in the card; the one under the cursor cheers.
      this.show.add({ character: i, x: x + CARD_W / 2, y: y + CARD_H - 9, height: 33, hop: face === 'win' ? Math.abs(Math.sin(this.t * 8)) * 3 : 0, dance: face === 'win' });
    } else drawPortrait(ctx, i, x + (CARD_W - 32) / 2, y + 2, 2, dim, face, this.t);
    tiny(ctx, ch.name, x + CARD_W / 2, y + CARD_H - 7, dim ? PAL.grey : PAL.ink, 'center', null);
    // With 3D figures the tags go on after the figures are drawn (cardTags), so heads don't cover them.
    if (!this.show) this.cardTags(ctx, i);
  }

  /** 1P / CPU + difficulty tags and the cursor frame on a card. */
  private cardTags(ctx: CanvasRenderingContext2D, i: number): void {
    const s = this.setup;
    const x = cardX(i);
    const y = cardY(i);
    const mine = s.me === i;
    const bot = s.bots[i];
    const onCursor = (this.phase === 'pick' || this.phase === 'bots') && this.cursor === i;
    if (mine) {
      panel(ctx, x + 2, y + 2, 13, 8, BRAND.rosa, PAL.white);
      tiny(ctx, '1P', x + 8.5, y + 4, PAL.white, 'center', null);
    } else if (bot) {
      panel(ctx, x + 2, y + 2, 15, 8, PAL.ink, DIFF_COLOR[bot]);
      tiny(ctx, 'CPU', x + 9.5, y + 4, DIFF_COLOR[bot], 'center', null);
      panel(ctx, x + CARD_W - 31, y + 2, 29, 8, PAL.ink, DIFF_COLOR[bot]);
      tiny(ctx, DIFF_LABEL[bot], x + CARD_W - 16.5, y + 4, DIFF_COLOR[bot], 'center', null);
    }
    if (onCursor) {
      // The blinking 1P / CPU cursor frame.
      const col = this.phase === 'pick' ? BRAND.rosa : PAL.yellow;
      const on = Math.floor(this.t * 6) % 2 === 0;
      ctx.strokeStyle = on ? col : PAL.white;
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 1, y - 1, CARD_W + 2, CARD_H + 2);
      const tag = this.phase === 'pick' ? '1P' : 'CPU';
      panel(ctx, x + CARD_W / 2 - 9, y - 6, 18, 8, col, PAL.white);
      tiny(ctx, tag, x + CARD_W / 2, y - 4, PAL.ink, 'center', null);
    }
  }

  private options(ctx: CanvasRenderingContext2D): void {
    const s = this.setup;
    const active = this.phase === 'options';
    const y0 = 136;
    const minigames = s.matchMode === 'minigame';
    panel(ctx, 6, y0, 372, 74, active ? PAL.panel : '#1a0c34', active ? PAL.panelLight : '#2a1450');
    tiny(ctx, minigames ? 'MODO MINIGAMES: UM SÓ, ATÉ SOBRAR UM' : 'OPÇÕES DA PARTIDA', 12, y0 + 3, active ? BRAND.ciano : PAL.grey, 'left', null);
    const def = MINIGAMES[s.game % MINIGAMES.length];
    const values: Record<string, string> = {
      VIDAS: `${s.lives}`,
      CLIPE: CLIP_OPTIONS[s.clip].label,
      RETORNO: RETURN_OPTIONS[s.ret].label,
      ACELERAR: SPEED_OPTIONS[s.speed].label,
      ANÚNCIOS: AD_OPTIONS[s.ads].label,
      MINIGAME: def.name,
      TUTORIAL: s.tutorials ? 'LIGADO' : 'DESLIGADO',
    };
    this.rows.slice(0, this.startRow).forEach((name, i) => {
      // Feed: two columns of options. Minigames: one wide row per option.
      const col = minigames ? 0 : i < 4 ? 0 : 1;
      const x = col === 0 ? 14 : 190;
      const y = y0 + 12 + (minigames ? i * 26 : (i % 4) * 15);
      const w = minigames ? 360 : 172;
      const sel = active && this.row === i;
      if (sel) {
        ctx.fillStyle = '#3a1a6a';
        ctx.fillRect(x - 4, y - 3, w, 13);
      }
      text(ctx, name, x, y, sel ? PAL.yellow : active ? PAL.white : PAL.grey);
      const v = values[name];
      text(ctx, sel ? `< ${v} >` : v, minigames ? x + 210 : x + 118, y, sel ? PAL.yellow : active ? BRAND.ciano : PAL.grey, 8, 'center');
      if (name === 'VIDAS') heart(ctx, x + 148, y);
      if (name === 'MINIGAME') tiny(ctx, def.hint, x, y + 12, PAL.grey, 'left', null);
    });

    // INICIAR.
    const sel = active && this.row === this.startRow;
    const blink = sel && Math.floor(this.t * 4) % 2 === 0;
    const bx = 286;
    const by = y0 + 52;
    panel(ctx, bx, by, 86, 18, blink ? BRAND.rosa : sel ? '#c8206a' : PAL.panel, sel ? PAL.white : PAL.panelLight);
    text(ctx, 'INICIAR', bx + 43, by + 5, sel ? PAL.white : PAL.grey, 8, 'center');
    if (this.warn > 0) tiny(ctx, `MÍNIMO ${MIN_PLAYERS} JOGADORES: ADICIONE BOTS`, bx - 4, by + 7, PAL.red, 'right', null);
    else if (s.mode === 'multi') tiny(ctx, 'ONLINE EM BREVE: POR ENQUANTO JOGA AQUI COM BOTS', bx - 4, by + 7, PAL.pink, 'right', null);
    else if (minigames) tiny(ctx, '1 VIDA · SEM CORTES · ÚLTIMO VIVO VENCE', bx - 4, by + 7, PAL.pink, 'right', null);
  }

}

