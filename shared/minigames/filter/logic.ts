import type { Minigame, MinigameDef } from '../../minigame';
import { Rng } from '../../rng';
import type { BotDifficulty, GameEvent, PlayerId, PlayerInfo, PlayerInput, TickInput } from '../../types';
import { NEUTRAL_INPUT } from '../../types';

/**
 * FILTRO CERTO (Mushroom Mix-Up / Hexagon Heat): a grid of colored platforms over the water.
 * An influencer calls a filter (a color); when the call runs out every other platform sinks.
 * Each round the call is shorter. No shoving: it's just you against the clock.
 */

export const COLS = 8;
export const ROWS = 5;
export const TILE_W = 44;
export const TILE_H = 36;
export const GRID = { x: 16, y: 14, w: COLS * TILE_W, h: ROWS * TILE_H };
/** Filter names and colors, in palette order. */
export const FILTERS: ReadonlyArray<readonly [string, string]> = [
  ['VINTAGE', '#e8a23e'],
  ['NEON', '#ff5ac8'],
  ['GELO', '#3ee8ff'],
  ['GRAMA', '#5cf26a'],
  ['ROXO', '#9a5af2'],
];

export const PLAYER_R = 5;
const SPEED = 88;
export const SINK_TIME = 1.1;
export const RISE_TIME = 0.5;
const GHOST_TIME = 1.2;
export const DEATH_ANIM = 0.7;
const TIME_CAP = 50;

export interface FPlayer {
  id: PlayerId;
  character: number;
  x: number;
  y: number;
  status: 'alive' | 'dead' | 'out';
  ghost: number;
  deathAnim: number;
  walk: number;
}

export interface FilterState {
  players: FPlayer[];
  tiles: number[]; // palette index per cell (row-major)
  target: number; // the filter being called
  phase: 'call' | 'sink' | 'rise';
  phaseTime: number;
  callTime: number; // length of the current call
  round: number;
  time: number;
}

export function cellAt(x: number, y: number): number {
  const c = Math.floor((x - GRID.x) / TILE_W);
  const r = Math.floor((y - GRID.y) / TILE_H);
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return -1;
  return r * COLS + c;
}

export function cellCenter(i: number): [number, number] {
  return [GRID.x + (i % COLS) * TILE_W + TILE_W / 2, GRID.y + Math.floor(i / COLS) * TILE_H + TILE_H / 2];
}

interface BotMemory {
  round: number;
  react: number; // seconds before it reacts to the call
  goal: number; // target cell
  wrong: boolean;
}

const BOT_REACT: Record<BotDifficulty, [number, number]> = { easy: [0.4, 0.65], medium: [0.25, 0.45], hard: [0.12, 0.3] };
const BOT_WRONG: Record<BotDifficulty, number> = { easy: 0.08, medium: 0.04, hard: 0.015 };

class FiltroCerto implements Minigame<FilterState> {
  readonly defId = 'filter';
  readonly state: FilterState;
  private events: GameEvent[] = [];
  private rng: Rng;
  private botMem = new Map<PlayerId, BotMemory>();

  constructor(players: PlayerInfo[], seed: number) {
    this.rng = new Rng(seed);
    const cx = GRID.x + GRID.w / 2;
    const cy = GRID.y + GRID.h / 2;
    this.state = {
      players: players.map((p, i) => {
        const a = (i / players.length) * Math.PI * 2;
        return {
          id: p.id,
          character: p.character,
          x: cx + Math.cos(a) * 70,
          y: cy + Math.sin(a) * 45,
          status: 'alive',
          ghost: 0,
          deathAnim: 0,
          walk: 0,
        };
      }),
      tiles: [],
      target: 0,
      phase: 'call',
      phaseTime: 0,
      callTime: 2.4,
      round: 0,
      time: 0,
    };
    this.newRound(0);
  }

  /** Repaints the grid, calls a filter and makes sure everyone has a reachable safe platform. */
  private newRound(heat: number): void {
    const st = this.state;
    st.round++;
    const colors = 4;
    st.tiles = Array.from({ length: COLS * ROWS }, () => this.rng.int(colors));
    st.target = this.rng.int(colors);
    st.callTime = Math.max(1.05, 2.3 - st.round * 0.12 - heat * 0.6);
    st.phase = 'call';
    st.phaseTime = 0;
    // Keep the safe count steady, then guarantee one within reach of each player.
    const safeMax = 7;
    let safe = st.tiles.map((t, i) => (t === st.target ? i : -1)).filter((i) => i >= 0);
    while (safe.length > safeMax) {
      const k = this.rng.int(safe.length);
      st.tiles[safe[k]] = (st.target + 1 + this.rng.int(colors - 1)) % colors;
      safe.splice(k, 1);
    }
    const reach = SPEED * (st.callTime - 0.4);
    for (const p of st.players) {
      if (p.status !== 'alive') continue;
      if (safe.some((i) => this.distTo(p, i) < reach)) continue;
      const near: number[] = [];
      for (let i = 0; i < COLS * ROWS; i++) if (this.distTo(p, i) < reach) near.push(i);
      const pick = near.length ? this.rng.pick(near) : Math.max(0, cellAt(p.x, p.y));
      st.tiles[pick] = st.target;
      safe.push(pick);
    }
    this.events.push({ type: 'sfx', name: 'command' });
  }

  private distTo(p: FPlayer, i: number): number {
    const [x, y] = cellCenter(i);
    return Math.hypot(p.x - x, p.y - y);
  }

  /** Is (x, y) on solid ground right now? */
  safeAt(x: number, y: number): boolean {
    const st = this.state;
    const i = cellAt(x, y);
    if (i < 0) return false;
    if (st.tiles[i] !== st.target) return false;
    const [cx, cy] = cellCenter(i);
    const hw = TILE_W / 2 + 2;
    const hh = TILE_H / 2 + 2;
    return Math.abs(x - cx) <= hw && Math.abs(y - cy) <= hh;
  }

  update(dt: number, inputs: Map<PlayerId, TickInput>, heat: number): void {
    const st = this.state;
    st.time += dt;
    st.phaseTime += dt;

    if (st.phase === 'call' && st.phaseTime >= st.callTime) {
      st.phase = 'sink';
      st.phaseTime = 0;
      this.events.push({ type: 'sfx', name: 'splash' });
    } else if (st.phase === 'sink' && st.phaseTime >= SINK_TIME) {
      st.phase = 'rise';
      st.phaseTime = 0;
    } else if (st.phase === 'rise' && st.phaseTime >= RISE_TIME) {
      this.newRound(heat);
    }

    for (const p of st.players) {
      if (p.status === 'dead') p.deathAnim = Math.max(0, p.deathAnim - dt);
      if (p.status !== 'alive') continue;
      p.ghost = Math.max(0, p.ghost - dt);
      const inp = inputs.get(p.id);
      let mx = inp?.dx ?? 0;
      let my = inp?.dy ?? 0;
      const len = Math.hypot(mx, my);
      if (len > 0) {
        mx /= len;
        my /= len;
        p.walk += dt;
      } else {
        p.walk = 0;
      }
      p.x += mx * SPEED * dt;
      p.y += my * SPEED * dt;
      p.x = Math.max(GRID.x + 2, Math.min(GRID.x + GRID.w - 2, p.x));
      p.y = Math.max(GRID.y + 2, Math.min(GRID.y + GRID.h - 2, p.y));
    }

    if (st.phase === 'sink') {
      for (const p of st.players) {
        if (p.status !== 'alive' || p.ghost > 0) continue;
        if (!this.safeAt(p.x, p.y)) {
          p.status = 'dead';
          p.deathAnim = DEATH_ANIM;
          this.events.push({ type: 'death', player: p.id }, { type: 'sfx', name: 'die' });
        }
      }
    }
  }

  onSuspend(): void {}

  onResume(): void {
    const st = this.state;
    for (const p of st.players) {
      if (p.status !== 'dead') continue;
      // Back on a platform that will hold (a safe one if they're sinking right now).
      const cells = st.tiles.map((t, i) => (st.phase === 'call' || t === st.target ? i : -1)).filter((i) => i >= 0);
      const [x, y] = cellCenter(this.rng.pick(cells));
      p.x = x;
      p.y = y;
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
    if (!mem || mem.round !== st.round) {
      const [a, b] = BOT_REACT[difficulty];
      const wrong = this.rng.next() < BOT_WRONG[difficulty];
      // Nearest cell of the called color (or a random wrong one), avoiding crowded ones a bit.
      let goal = -1;
      let best = Infinity;
      for (let i = 0; i < COLS * ROWS; i++) {
        if ((st.tiles[i] === st.target) === wrong) continue;
        // Avoid platforms other bots already headed for.
        let crowd = 0;
        for (const [qid, m] of this.botMem) if (qid !== id && m.round === st.round && m.goal === i) crowd++;
        const score = this.distTo(p, i) + crowd * 40 + this.rng.range(0, 6);
        if (score < best) {
          best = score;
          goal = i;
        }
      }
      mem = { round: st.round, react: this.rng.range(a, b), goal, wrong };
      this.botMem.set(id, mem);
    }
    if (st.phase === 'rise' || st.phaseTime < mem.react || mem.goal < 0) return NEUTRAL_INPUT;
    const [gx, gy] = cellCenter(mem.goal);
    const ex = gx - p.x;
    const ey = gy - p.y;
    const dead = 3;
    const dx = (Math.abs(ex) > dead ? Math.sign(ex) : 0) as -1 | 0 | 1;
    const dy = (Math.abs(ey) > dead ? Math.sign(ey) : 0) as -1 | 0 | 1;
    return { dx, dy, action: false };
  }
}

export const FiltroCertoDef: MinigameDef = {
  id: 'filter',
  name: 'FILTRO CERTO',
  handle: '@filtro.certo',
  hint: 'WASD: CORRA PRO FILTRO CHAMADO',
  create: (players, seed) => new FiltroCerto(players, seed),
};
