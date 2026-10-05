import type { Minigame, MinigameDef } from '../../minigame';
import { Rng } from '../../rng';
import type { BotDifficulty, GameEvent, PlayerId, PlayerInfo, PlayerInput, TickInput } from '../../types';
import { NEUTRAL_INPUT } from '../../types';

export const COLS = 19;
export const ROWS = 13;

export const FLOOR = 0;
export const WALL = 1;
export const BRICK = 2;

export const PU_NONE = 0;
export const PU_BOMB = 1;
export const PU_FIRE = 2;

const FUSE = 2.4;
const FLAME_TIME = 0.5;
const SPEED = 3.6; // tiles per second
const GHOST_TIME = 1.2;
const DEATH_ANIM = 0.6;
const TIME_CAP = 55;

const SPAWNS: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [17, 11],
  [17, 1],
  [1, 11],
  [9, 1],
  [9, 11],
  [1, 6],
  [17, 6],
];

export interface Bomb {
  id: number;
  c: number;
  r: number;
  owner: PlayerId;
  fuse: number;
  range: number;
  passers: PlayerId[];
  /** Dropped by the feed itself ("anúncio"), not by a player. */
  ad: boolean;
}

export interface BPlayer {
  id: PlayerId;
  character: number;
  x: number; // tile units, center of player
  y: number;
  status: 'alive' | 'dead' | 'out';
  ghost: number;
  deathAnim: number;
  maxBombs: number;
  range: number;
  facing: 0 | 1 | 2 | 3; // down, up, left, right
  walk: number;
  spawnC: number;
  spawnR: number;
}

export interface BombState {
  grid: number[];
  powerups: number[];
  flames: number[];
  bombs: Bomb[];
  players: BPlayer[];
  time: number;
  nextBombId: number;
  adTimer: number;
}

const idx = (c: number, r: number) => r * COLS + c;
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0, -1],
  [-1, 0],
  [1, 0],
];

interface BotMemory {
  timer: number;
  input: PlayerInput;
}

const BOT_CADENCE: Record<BotDifficulty, number> = { easy: 0.28, medium: 0.12, hard: 0 };
const BOT_AGGRO: Record<BotDifficulty, number> = { easy: 0.35, medium: 0.6, hard: 0.85 };
const BOT_CARELESS: Record<BotDifficulty, number> = { easy: 0.15, medium: 0.04, hard: 0 };

class BombFeed implements Minigame<BombState> {
  readonly defId = 'bomb';
  readonly state: BombState;
  private events: GameEvent[] = [];
  private rng: Rng;
  private botMem = new Map<PlayerId, BotMemory>();

  constructor(players: PlayerInfo[], seed: number) {
    this.rng = new Rng(seed);
    const grid: number[] = [];
    const powerups: number[] = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const border = r === 0 || c === 0 || r === ROWS - 1 || c === COLS - 1;
        const pillar = r % 2 === 0 && c % 2 === 0;
        if (border || pillar) grid.push(WALL);
        else grid.push(this.rng.next() < 0.6 ? BRICK : FLOOR);
        powerups.push(PU_NONE);
      }
    }
    for (const [c, r] of SPAWNS) {
      for (const [dc, dr] of [[0, 0], ...DIRS]) {
        const cc = c + dc;
        const rr = r + dr;
        if (grid[idx(cc, rr)] === BRICK) grid[idx(cc, rr)] = FLOOR;
      }
    }
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] === BRICK && this.rng.next() < 0.28) powerups[i] = this.rng.next() < 0.5 ? PU_BOMB : PU_FIRE;
    }

    this.state = {
      grid,
      powerups,
      flames: grid.map(() => 0),
      bombs: [],
      players: players.map((p, i) => {
        const [c, r] = SPAWNS[i % SPAWNS.length];
        return {
          id: p.id,
          character: p.character,
          x: c + 0.5,
          y: r + 0.5,
          status: 'alive',
          ghost: 0,
          deathAnim: 0,
          maxBombs: 1,
          range: 2,
          facing: 0,
          walk: 0,
          spawnC: c,
          spawnR: r,
        };
      }),
      time: 0,
      nextBombId: 1,
      adTimer: 2,
    };
  }

  // ---------- simulation ----------

  update(dt: number, inputs: Map<PlayerId, TickInput>, heat: number): void {
    const st = this.state;
    st.time += dt;
    if (heat > 0) {
      st.adTimer -= dt;
      if (st.adTimer <= 0) {
        st.adTimer = 3.5 - 2.5 * heat;
        this.dropAd();
      }
    }

    for (const b of st.bombs) {
      b.passers = b.passers.filter((id) => {
        const p = this.player(id);
        return p && p.status === 'alive' && Math.floor(p.x) === b.c && Math.floor(p.y) === b.r;
      });
    }

    for (const p of st.players) {
      if (p.status === 'dead') {
        p.deathAnim = Math.max(0, p.deathAnim - dt);
        continue;
      }
      if (p.status !== 'alive') continue;
      p.ghost = Math.max(0, p.ghost - dt);
      const inp = inputs.get(p.id);
      if (!inp) continue;

      const dist = SPEED * dt;
      if (inp.dx !== 0 && this.moveAxis(p, true, inp.dx, dist)) {
        p.facing = inp.dx < 0 ? 2 : 3;
        p.walk += dt;
      } else if (inp.dy !== 0 && this.moveAxis(p, false, inp.dy, dist)) {
        p.facing = inp.dy < 0 ? 1 : 0;
        p.walk += dt;
      } else {
        p.walk = 0;
      }

      const c = Math.floor(p.x);
      const r = Math.floor(p.y);
      const pu = st.powerups[idx(c, r)];
      if (pu !== PU_NONE && st.grid[idx(c, r)] === FLOOR) {
        if (pu === PU_BOMB) p.maxBombs = Math.min(5, p.maxBombs + 1);
        else p.range = Math.min(6, p.range + 1);
        st.powerups[idx(c, r)] = PU_NONE;
        this.events.push({ type: 'sfx', name: 'powerup' });
      }

      if (inp.pressed) this.placeBomb(p);
    }

    for (const b of st.bombs) b.fuse -= dt;
    let exploding = st.bombs.find((b) => b.fuse <= 0);
    if (exploding) this.events.push({ type: 'sfx', name: 'explosion' });
    while (exploding) {
      this.explode(exploding);
      exploding = st.bombs.find((b) => b.fuse <= 0);
    }

    for (let i = 0; i < st.flames.length; i++) {
      if (st.flames[i] > 0) st.flames[i] = Math.max(0, st.flames[i] - dt);
    }

    for (const p of st.players) {
      if (p.status !== 'alive' || p.ghost > 0) continue;
      if (st.flames[idx(Math.floor(p.x), Math.floor(p.y))] > 0) {
        p.status = 'dead';
        p.deathAnim = DEATH_ANIM;
        this.events.push({ type: 'death', player: p.id }, { type: 'sfx', name: 'die' });
      }
    }
  }

  private player(id: PlayerId): BPlayer | undefined {
    return this.state.players.find((p) => p.id === id);
  }

  private bombAt(c: number, r: number): Bomb | undefined {
    return this.state.bombs.find((b) => b.c === c && b.r === r);
  }

  private passable(c: number, r: number, id: PlayerId): boolean {
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return false;
    if (this.state.grid[idx(c, r)] !== FLOOR) return false;
    const b = this.bombAt(c, r);
    return !b || b.passers.includes(id);
  }

  /** Grid movement with auto-centering on the cross axis and corner sliding. */
  private moveAxis(p: BPlayer, horiz: boolean, dir: number, dist: number): boolean {
    let along = horiz ? p.x : p.y;
    let cross = horiz ? p.y : p.x;
    const alongCell = Math.floor(along);
    const crossCell = Math.floor(cross);
    const at = (a: number, x: number) => (horiz ? this.passable(a, x, p.id) : this.passable(x, a, p.id));
    const nextFree = at(alongCell + dir, crossCell);
    const alongCenter = alongCell + 0.5;
    const beforeCenter = (alongCenter - along) * dir > 0.001;
    const crossCenter = crossCell + 0.5;

    if (!nextFree && !beforeCenter) {
      const off = cross - crossCenter;
      if (Math.abs(off) < 0.15) return false;
      const side = Math.sign(off);
      if (!at(alongCell, crossCell + side) || !at(alongCell + dir, crossCell + side)) return false;
      cross += side * dist;
    } else {
      const off = crossCenter - cross;
      cross += Math.sign(off) * Math.min(Math.abs(off), dist);
      along += dir * dist;
      if (!nextFree) along = dir > 0 ? Math.min(along, alongCenter) : Math.max(along, alongCenter);
    }

    if (horiz) {
      p.x = along;
      p.y = cross;
    } else {
      p.y = along;
      p.x = cross;
    }
    return true;
  }

  private placeBomb(p: BPlayer): void {
    const st = this.state;
    const c = Math.floor(p.x);
    const r = Math.floor(p.y);
    if (this.bombAt(c, r)) return;
    if (st.bombs.filter((b) => b.owner === p.id).length >= p.maxBombs) return;
    const passers = st.players
      .filter((o) => o.status === 'alive' && Math.floor(o.x) === c && Math.floor(o.y) === r)
      .map((o) => o.id);
    st.bombs.push({ id: st.nextBombId++, c, r, owner: p.id, fuse: FUSE, range: p.range, passers, ad: false });
    this.events.push({ type: 'sfx', name: 'bomb' });
  }

  /** Heat hazard: the feed drops an "ad" bomb, usually right next to someone. */
  private dropAd(): void {
    const st = this.state;
    const alive = st.players.filter((p) => p.status === 'alive');
    const free: number[] = [];
    st.grid.forEach((t, i) => {
      if (t === FLOOR && !this.bombAt(i % COLS, Math.floor(i / COLS))) free.push(i);
    });
    if (free.length === 0) return;
    let target = this.rng.pick(free);
    if (alive.length > 0 && this.rng.next() < 0.6) {
      const p = this.rng.pick(alive);
      const near = free.filter((i) => Math.abs((i % COLS) - Math.floor(p.x)) + Math.abs(Math.floor(i / COLS) - Math.floor(p.y)) <= 2);
      if (near.length > 0) target = this.rng.pick(near);
    }
    const c = target % COLS;
    const r = Math.floor(target / COLS);
    const passers = alive.filter((o) => Math.floor(o.x) === c && Math.floor(o.y) === r).map((o) => o.id);
    st.bombs.push({ id: st.nextBombId++, c, r, owner: -1, fuse: 1.8, range: 2, passers, ad: true });
    this.events.push({ type: 'sfx', name: 'bomb' });
  }

  private explode(b: Bomb): void {
    const st = this.state;
    st.bombs = st.bombs.filter((o) => o !== b);
    st.flames[idx(b.c, b.r)] = FLAME_TIME;
    for (const [dc, dr] of DIRS) {
      for (let i = 1; i <= b.range; i++) {
        const c = b.c + dc * i;
        const r = b.r + dr * i;
        const t = st.grid[idx(c, r)];
        if (t === WALL) break;
        st.flames[idx(c, r)] = FLAME_TIME;
        if (t === BRICK) {
          st.grid[idx(c, r)] = FLOOR;
          break;
        }
        st.powerups[idx(c, r)] = PU_NONE;
        const chained = this.bombAt(c, r);
        if (chained) chained.fuse = 0;
      }
    }
  }

  // ---------- feed lifecycle ----------

  onSuspend(): void {}

  onResume(): void {
    const danger = this.dangerMap();
    for (const p of this.state.players) {
      if (p.status !== 'dead') continue;
      const path = this.bfs(
        idx(p.spawnC, p.spawnR),
        (i) => danger[i] === Infinity && !this.state.bombs.some((b) => idx(b.c, b.r) === i),
        null,
        true,
      );
      const target = path ? path[path.length - 1] : idx(p.spawnC, p.spawnR);
      p.x = (target % COLS) + 0.5;
      p.y = Math.floor(target / COLS) + 0.5;
      p.status = 'alive';
      p.ghost = GHOST_TIME;
      p.deathAnim = 0;
    }
  }

  removePlayer(id: PlayerId): void {
    const p = this.player(id);
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

  // ---------- bots ----------

  /** Seconds until each tile is hit by a flame (0 = burning now, Infinity = safe). */
  private dangerMap(extra?: { c: number; r: number; range: number }): number[] {
    const st = this.state;
    const danger = st.grid.map(() => Infinity);
    st.flames.forEach((f, i) => {
      if (f > 0) danger[i] = 0;
    });
    const mark = (c: number, r: number, range: number, t: number) => {
      danger[idx(c, r)] = Math.min(danger[idx(c, r)], t);
      for (const [dc, dr] of DIRS) {
        for (let i = 1; i <= range; i++) {
          const cc = c + dc * i;
          const rr = r + dr * i;
          const tile = st.grid[idx(cc, rr)];
          if (tile === WALL) break;
          danger[idx(cc, rr)] = Math.min(danger[idx(cc, rr)], t);
          if (tile === BRICK) break;
        }
      }
    };
    for (const b of st.bombs) mark(b.c, b.r, b.range, b.fuse);
    if (extra) mark(extra.c, extra.r, extra.range, FUSE);
    return danger;
  }

  /**
   * BFS over walkable tiles. Returns the path (start..goal) to the nearest tile matching `goal`.
   * With `danger`, tiles are only entered if they won't burn by the time we arrive.
   */
  private bfs(start: number, goal: (i: number) => boolean, danger: number[] | null, ignoreBombs = false, avoidAllDanger = false): number[] | null {
    const st = this.state;
    const prev = new Map<number, number>([[start, -1]]);
    const queue: Array<[number, number]> = [[start, 0]];
    while (queue.length) {
      const [cur, steps] = queue.shift()!;
      if (goal(cur)) {
        const path: number[] = [];
        for (let n = cur; n !== -1; n = prev.get(n)!) path.unshift(n);
        return path;
      }
      const c = cur % COLS;
      const r = Math.floor(cur / COLS);
      for (const [dc, dr] of DIRS) {
        const n = idx(c + dc, r + dr);
        if (prev.has(n) || st.grid[n] !== FLOOR) continue;
        if (!ignoreBombs && this.bombAt(c + dc, r + dr)) continue;
        if (danger) {
          if (avoidAllDanger && danger[n] !== Infinity) continue;
          const arrival = (steps + 1) / SPEED;
          if (danger[n] < arrival + 0.35 && danger[n] > arrival - 0.6) continue;
          if (danger[n] === 0) continue;
        }
        prev.set(n, cur);
        queue.push([n, steps + 1]);
      }
    }
    return null;
  }

  private goodBombSpot(i: number, self: BPlayer): boolean {
    const st = this.state;
    const c = i % COLS;
    const r = Math.floor(i / COLS);
    for (const [dc, dr] of DIRS) {
      if (st.grid[idx(c + dc, r + dr)] === BRICK) return true;
    }
    for (const o of st.players) {
      if (o === self || o.status !== 'alive') continue;
      const oc = Math.floor(o.x);
      const or = Math.floor(o.y);
      if ((oc === c && Math.abs(or - r) <= self.range) || (or === r && Math.abs(oc - c) <= self.range)) return true;
    }
    return false;
  }

  botInput(id: PlayerId, difficulty: BotDifficulty): PlayerInput {
    const p = this.player(id);
    if (!p || p.status !== 'alive') return NEUTRAL_INPUT;

    let mem = this.botMem.get(id);
    if (!mem) {
      mem = { timer: 0, input: NEUTRAL_INPUT };
      this.botMem.set(id, mem);
    }
    mem.timer -= 1 / 60;
    if (mem.timer > 0) return { ...mem.input, action: false };
    mem.timer = BOT_CADENCE[difficulty];
    mem.input = this.decide(p, difficulty);
    return mem.input;
  }

  private decide(p: BPlayer, difficulty: BotDifficulty): PlayerInput {
    const st = this.state;
    const c = Math.floor(p.x);
    const r = Math.floor(p.y);
    const here = idx(c, r);
    const danger = this.dangerMap();

    if (danger[here] !== Infinity) {
      const path = this.bfs(here, (i) => danger[i] === Infinity, danger);
      return path ? this.follow(p, path) : NEUTRAL_INPUT;
    }

    const myBombs = st.bombs.filter((b) => b.owner === p.id).length;
    if (myBombs < p.maxBombs && !this.bombAt(c, r) && this.goodBombSpot(here, p) && this.rng.next() < BOT_AGGRO[difficulty]) {
      const withBomb = this.dangerMap({ c, r, range: p.range });
      const escape = this.bfs(here, (i) => withBomb[i] === Infinity, withBomb);
      if (escape || this.rng.next() < BOT_CARELESS[difficulty]) return { dx: 0, dy: 0, action: true };
    }

    const path = this.bfs(here, (i) => i !== here && this.goodBombSpot(i, p), danger, false, true);
    if (path) return this.follow(p, path);

    // Nothing to do: wander to a random safe neighbor.
    const options = DIRS.filter(([dc, dr]) => this.passable(c + dc, r + dr, p.id) && danger[idx(c + dc, r + dr)] === Infinity);
    if (options.length === 0) return NEUTRAL_INPUT;
    const [dc, dr] = this.rng.pick(options);
    return { dx: dc as -1 | 0 | 1, dy: dr as -1 | 0 | 1, action: false };
  }

  private follow(p: BPlayer, path: number[]): PlayerInput {
    const c = Math.floor(p.x);
    const r = Math.floor(p.y);
    const next = path.length > 1 ? path[1] : path[0];
    const nc = next % COLS;
    const nr = Math.floor(next / COLS);
    if (nc !== c) return { dx: Math.sign(nc - c) as -1 | 1, dy: 0, action: false };
    if (nr !== r) return { dx: 0, dy: Math.sign(nr - r) as -1 | 1, action: false };
    const ox = nc + 0.5 - p.x;
    const oy = nr + 0.5 - p.y;
    if (Math.abs(ox) > 0.1) return { dx: Math.sign(ox) as -1 | 1, dy: 0, action: false };
    if (Math.abs(oy) > 0.1) return { dx: 0, dy: Math.sign(oy) as -1 | 1, action: false };
    return NEUTRAL_INPUT;
  }
}

export const BombFeedDef: MinigameDef = {
  id: 'bomb',
  name: 'BOMB FEED',
  handle: '@bomb.feed',
  hint: 'WASD ANDAR  ESPAÇO BOMBA',
  create: (players, seed) => new BombFeed(players, seed),
};
