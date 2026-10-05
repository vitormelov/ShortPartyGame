import { ARENA_H, ARENA_W } from '../../arena';
import type { Minigame, MinigameDef } from '../../minigame';
import { Rng } from '../../rng';
import type { BotDifficulty, GameEvent, PlayerId, PlayerInfo, PlayerInput, TickInput } from '../../types';
import { NEUTRAL_INPUT } from '../../types';

/**
 * Vertical climb. World y grows downward. The screen auto-scrolls up at a steady pace that
 * speeds up over time, and the lava rises with its bottom edge: keep up or burn.
 */

export const FLOOR_Y = 180;
export const ROW_GAP = 30;
export const PLAT_H = 4;
const GRAVITY = 760;
const JUMP_V = 315;
const MOVE = 120;
const COYOTE = 0.08;
const SCROLL_START = 0.5; // seconds before the screen starts climbing
const SCROLL_BASE = 28; // px/s: about a floor per second from the start
const SCROLL_MAX = 42;
const LAVA_DEPTH = 12; // lava surface sits this far above the bottom of the screen
const GHOST_TIME = 1.2;
export const DEATH_ANIM = 0.6;
const TIME_CAP = 50;

export interface Platform {
  id: number;
  x: number; // left edge (wraps horizontally)
  y: number; // top surface
  w: number;
  vx: number; // moving platforms slide sideways
}

export interface EPlayer {
  id: PlayerId;
  character: number;
  x: number;
  y: number; // feet
  vx: number;
  vy: number;
  grounded: boolean;
  onPlat: number; // platform id, -1 if none
  coyote: number;
  facing: 1 | -1;
  status: 'alive' | 'dead' | 'out';
  ghost: number;
  deathAnim: number;
  best: number; // highest floor reached
}

export interface ElevatorState {
  players: EPlayer[];
  platforms: Platform[];
  camY: number; // world y at the top of the screen
  lavaY: number;
  genTop: number; // y of the highest generated row
  time: number;
  nextId: number;
}

export function floorOf(y: number): number {
  return Math.max(0, Math.round((FLOOR_Y - y) / ROW_GAP));
}

/** Horizontal distance with wrap-around. */
export function wrapDx(from: number, to: number): number {
  let d = to - from;
  if (d > ARENA_W / 2) d -= ARENA_W;
  if (d < -ARENA_W / 2) d += ARENA_W;
  return d;
}

interface BotMemory {
  timer: number;
  target: number; // platform id
  input: PlayerInput;
}

const BOT_CADENCE: Record<BotDifficulty, number> = { easy: 0.08, medium: 0.06, hard: 0.03 };
const BOT_JUMP_WINDOW: Record<BotDifficulty, number> = { easy: 22, medium: 26, hard: 30 };

class ElevadorSocial implements Minigame<ElevatorState> {
  readonly defId = 'elevator';
  readonly state: ElevatorState;
  private events: GameEvent[] = [];
  private rng: Rng;
  private botMem = new Map<PlayerId, BotMemory>();

  constructor(players: PlayerInfo[], seed: number) {
    this.rng = new Rng(seed);
    this.state = {
      players: players.map((p, i) => ({
        id: p.id,
        character: p.character,
        x: 40 + (i * (ARENA_W - 80)) / Math.max(1, players.length - 1),
        y: FLOOR_Y,
        vx: 0,
        vy: 0,
        grounded: true,
        onPlat: 0,
        coyote: 0,
        facing: 1,
        status: 'alive',
        ghost: 0,
        deathAnim: 0,
        best: 0,
      })),
      platforms: [{ id: 0, x: 0, y: FLOOR_Y, w: ARENA_W, vx: 0 }],
      camY: FLOOR_Y + 20 - ARENA_H + LAVA_DEPTH + 8,
      lavaY: FLOOR_Y + 20 - LAVA_DEPTH,
      genTop: FLOOR_Y,
      time: 0,
      nextId: 1,
    };
    this.generate();
  }

  private generate(): void {
    const st = this.state;
    // Rows appear as they scroll into view, so nobody can climb out of the top of the screen.
    while (st.genTop > st.camY + 24) {
      st.genTop -= ROW_GAP;
      const row = floorOf(st.genTop);
      const count = row % 3 === 0 ? 1 : this.rng.next() < 0.5 ? 2 : 3;
      const slot = ARENA_W / count;
      for (let k = 0; k < count; k++) {
        const w = this.rng.range(42, 70);
        const x = k * slot + this.rng.range(0, Math.max(1, slot - w));
        const moving = row > 3 && this.rng.next() < 0.25;
        st.platforms.push({ id: st.nextId++, x, y: st.genTop, w, vx: moving ? this.rng.pick([-1, 1]) * this.rng.range(25, 40) : 0 });
      }
    }
    st.platforms = st.platforms.filter((p) => p.y < st.lavaY + 40);
  }

  private platAt(x: number, y0: number, y1: number): Platform | undefined {
    // Landing: the feet crossed the platform top this tick, within its horizontal span.
    return this.state.platforms.find((pl) => y0 <= pl.y + 0.01 && y1 >= pl.y && this.overPlat(pl, x));
  }

  private overPlat(pl: Platform, x: number): boolean {
    const rel = (((x - pl.x) % ARENA_W) + ARENA_W) % ARENA_W;
    return rel <= pl.w + 3 || rel >= ARENA_W - 3;
  }

  update(dt: number, inputs: Map<PlayerId, TickInput>, heat: number): void {
    const st = this.state;
    st.time += dt;

    if (st.time > SCROLL_START) {
      const scroll = Math.min(SCROLL_MAX, SCROLL_BASE + (st.time - SCROLL_START) * 0.4) * (1 + heat * 0.5);
      st.camY -= scroll * dt;
    }
    st.lavaY = st.camY + ARENA_H - LAVA_DEPTH;

    for (const pl of st.platforms) {
      if (pl.vx === 0) continue;
      pl.x = (((pl.x + pl.vx * dt) % ARENA_W) + ARENA_W) % ARENA_W;
    }

    for (const p of st.players) {
      if (p.status === 'dead') p.deathAnim = Math.max(0, p.deathAnim - dt);
      if (p.status !== 'alive') continue;
      p.ghost = Math.max(0, p.ghost - dt);
      const inp = inputs.get(p.id);

      // Ride moving platforms.
      if (p.grounded) {
        const pl = st.platforms.find((pl) => pl.id === p.onPlat);
        if (pl) p.x += pl.vx * dt;
        if (!pl || !this.overPlat(pl, p.x)) {
          p.grounded = false;
          p.coyote = COYOTE;
        }
      } else {
        p.coyote = Math.max(0, p.coyote - dt);
      }

      p.vx = (inp?.dx ?? 0) * MOVE;
      if (p.vx !== 0) p.facing = p.vx > 0 ? 1 : -1;
      const wantsJump = inp?.pressed || (inp?.dy ?? 0) < 0;
      if (wantsJump && (p.grounded || p.coyote > 0)) {
        p.vy = -JUMP_V;
        p.grounded = false;
        p.coyote = 0;
        this.events.push({ type: 'sfx', name: 'jump' });
      }

      p.x = (((p.x + p.vx * dt) % ARENA_W) + ARENA_W) % ARENA_W;

      if (!p.grounded) {
        const y0 = p.y;
        p.vy = Math.min(420, p.vy + GRAVITY * dt);
        p.y += p.vy * dt;
        if (p.vy > 0) {
          const pl = this.platAt(p.x, y0, p.y);
          if (pl) {
            p.y = pl.y;
            p.vy = 0;
            p.grounded = true;
            p.onPlat = pl.id;
          }
        }
      }
      p.best = Math.max(p.best, floorOf(p.y));
    }

    this.generate();

    for (const p of st.players) {
      if (p.status !== 'alive' || p.ghost > 0) continue;
      if (p.y > st.lavaY) {
        p.status = 'dead';
        p.deathAnim = DEATH_ANIM;
        this.events.push({ type: 'death', player: p.id }, { type: 'sfx', name: 'die' });
      }
    }
  }

  onSuspend(): void {}

  onResume(): void {
    const st = this.state;
    for (const p of st.players) {
      if (p.status !== 'dead') continue;
      // A platform in the upper part of the screen, well above the lava.
      const options = st.platforms.filter((pl) => pl.y > st.camY + 30 && pl.y < st.camY + ARENA_H * 0.6 && pl.y < st.lavaY - 60);
      const pl = options.length ? this.rng.pick(options) : st.platforms.reduce((a, b) => (Math.abs(a.y - st.camY - 80) < Math.abs(b.y - st.camY - 80) ? a : b));
      p.x = (pl.x + pl.w / 2) % ARENA_W;
      p.y = pl.y;
      p.vx = 0;
      p.vy = 0;
      p.grounded = true;
      p.onPlat = pl.id;
      p.status = 'alive';
      p.ghost = GHOST_TIME;
      p.deathAnim = 0;
    }
  }

  removePlayer(id: PlayerId): void {
    const p = this.state.players.find((p) => p.id === id);
    if (p) p.status = 'out';
  }

  isFinished(): boolean {
    return this.state.time > TIME_CAP;
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  botInput(id: PlayerId, difficulty: BotDifficulty): PlayerInput {
    const st = this.state;
    const p = st.players.find((p) => p.id === id);
    if (!p || p.status !== 'alive') return NEUTRAL_INPUT;
    let mem = this.botMem.get(id);
    if (!mem) {
      mem = { timer: 0, target: -1, input: NEUTRAL_INPUT };
      this.botMem.set(id, mem);
    }
    mem.timer -= 1 / 60;
    if (mem.timer > 0) return { ...mem.input, action: false };
    mem.timer = BOT_CADENCE[difficulty];

    if (p.grounded || mem.target === -1) {
      // Pick the closest platform about one row up (two rows is right at the jump's limit).
      const above = st.platforms.filter((pl) => pl.y < p.y - 12 && pl.y > p.y - 50);
      let best: Platform | undefined;
      let bestScore = Infinity;
      for (const pl of above) {
        const score = Math.abs(wrapDx(p.x, pl.x + pl.w / 2)) - (p.y - pl.y) * 0.3;
        if (score < bestScore) {
          bestScore = score;
          best = pl;
        }
      }
      mem.target = best ? best.id : -1;
    }
    const target = st.platforms.find((pl) => pl.id === mem!.target);
    if (!target) {
      mem.input = { dx: 0, dy: 0, action: false };
      return mem.input;
    }
    // Lead moving platforms a little.
    const dx = wrapDx(p.x, target.x + target.w / 2 + target.vx * 0.4);
    const move = Math.abs(dx) > 4 ? (Math.sign(dx) as -1 | 1) : 0;
    // Jump when under the target, or when about to walk off our own platform (never just drop).
    const under = Math.abs(dx) < target.w / 2 + BOT_JUMP_WINDOW[difficulty];
    const cur = st.platforms.find((pl) => pl.id === p.onPlat);
    const atEdge = !!cur && move !== 0 && !this.overPlat(cur, p.x + move * 10);
    const jump = p.grounded && (under || atEdge);
    mem.input = { dx: move, dy: 0, action: jump };
    return mem.input;
  }
}

export const ElevadorSocialDef: MinigameDef = {
  id: 'elevator',
  name: 'ELEVADOR SOCIAL',
  handle: '@elevador.social',
  hint: 'A/D ANDAR  ESPAÇO PULAR  SUBA!',
  create: (players, seed) => new ElevadorSocial(players, seed),
};
