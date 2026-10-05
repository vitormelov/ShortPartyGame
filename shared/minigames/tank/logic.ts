import { angleDiff, type Minigame, type MinigameDef } from '../../minigame';
import { Rng } from '../../rng';
import type { BotDifficulty, GameEvent, PlayerId, PlayerInfo, PlayerInput, TickInput } from '../../types';
import { NEUTRAL_INPUT } from '../../types';

/**
 * FLAME WAR: top-down tanks, free for all. Tank controls: W forward, S reverse, A/D rotate the
 * tank (the cannon points where the hull points). Space fires. Shells ricochet once off walls,
 * so you can bank shots — or hit yourself.
 * Crates break and sometimes drop power-ups.
 */

export const CELL = 12;
export const COLS = 32;
export const ROWS = 17;
export const EMPTY = 0;
export const STEEL = 1;
export const CRATE = 2;

export const TANK_R = 5;
const SPEED = 54;
const REVERSE = 0.65; // reverse is slower than forward
const TURN_SPEED = 2.8; // rad/s
export const SHELL_SPEED = 110;
const SHELL_R = 1.5;
const FIRE_COOLDOWN = 0.9;
const MAX_SHELLS = 2;
const SELF_GRACE = 0.15; // a fresh shell can't hit its own tank right at the muzzle
export const POWER_TIME = 8;
const GHOST_TIME = 1.2;
export const MAX_HP = 2;
const HIT_GRACE = 0.35; // brief invulnerability after taking a hit
export const DEATH_ANIM = 0.6;
const TIME_CAP = 50;

export type PowerKind = 'triple' | 'bounce' | 'shield';

export interface Tank {
  id: PlayerId;
  character: number;
  x: number;
  y: number;
  angle: number; // hull/cannon heading in radians (screen coords: 0 = right, PI/2 = down)
  cooldown: number;
  triple: number; // power-up timers
  bounce: number;
  shield: boolean;
  hp: number;
  hitT: number; // > 0 right after being hit (flash + grace)
  status: 'alive' | 'dead' | 'out';
  ghost: number;
  deathAnim: number;
  moving: boolean;
  tread: number;
}

export interface Shell {
  id: number;
  owner: PlayerId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  bounces: number; // ricochets left
  age: number;
}

export interface PowerUp {
  c: number;
  r: number;
  kind: PowerKind;
}

export interface Boom {
  x: number;
  y: number;
  t: number;
  big: boolean;
}

export interface TankState {
  grid: number[];
  tanks: Tank[];
  shells: Shell[];
  powerups: PowerUp[];
  booms: Boom[];
  time: number;
  nextId: number;
}

const idx = (c: number, r: number) => r * COLS + c;

/** Symmetric fixed layout: '#' steel, '.' floor, '?' possible crate. Mirrored left/right. */
const HALF_LAYOUT = [
  '################',
  '#...............',
  '#.....??....##..',
  '#..##.??........',
  '#..#.......?....',
  '#......##..?....',
  '#.??...##.....??',
  '#.??...........?',
  '#.......###.....',
  '#.??...........?',
  '#.??...##.....??',
  '#......##..?....',
  '#..#.......?....',
  '#..##.??........',
  '#.....??....##..',
  '#...............',
  '################',
];

const SPAWNS: ReadonlyArray<readonly [number, number]> = [
  [2, 1],
  [29, 15],
  [29, 1],
  [2, 15],
  [15, 2],
  [16, 14],
  [5, 8],
  [26, 8],
];

/** Bots "think" every so often (goal heading, drive, fire) and steer toward it every tick. */
interface BotMemory {
  timer: number;
  heading: number;
  move: -1 | 0 | 1; // forward / stop / reverse
  fire: boolean; // fire once the hull lines up with heading
  wander: number;
}

const BOT_CADENCE: Record<BotDifficulty, number> = { easy: 0.25, medium: 0.12, hard: 0.06 };
const BOT_FIRE: Record<BotDifficulty, number> = { easy: 0.08, medium: 0.14, hard: 0.2 };
/** Random aim error (radians), human-like imprecision. */
const BOT_MISAIM: Record<BotDifficulty, number> = { easy: 0.3, medium: 0.18, hard: 0.08 };
/** How well lined up the hull must be before the bot fires. */
const BOT_FIRE_TOL: Record<BotDifficulty, number> = { easy: 0.14, medium: 0.09, hard: 0.05 };
const KEEP_DISTANCE = 70;

class FlameWar implements Minigame<TankState> {
  readonly defId = 'tank';
  readonly state: TankState;
  private events: GameEvent[] = [];
  private rng: Rng;
  private botMem = new Map<PlayerId, BotMemory>();

  constructor(players: PlayerInfo[], seed: number) {
    this.rng = new Rng(seed);
    const grid: number[] = [];
    for (let r = 0; r < ROWS; r++) {
      const half = HALF_LAYOUT[r];
      const row = half + half.split('').reverse().join('');
      for (let c = 0; c < COLS; c++) {
        const ch = row[c];
        grid.push(ch === '#' ? STEEL : ch === '?' && this.rng.next() < 0.75 ? CRATE : EMPTY);
      }
    }
    for (const [c, r] of SPAWNS) grid[idx(c, r)] = EMPTY;
    this.state = {
      grid,
      tanks: players.map((p, i) => {
        const [c, r] = SPAWNS[i % SPAWNS.length];
        const x = (c + 0.5) * CELL;
        return {
          id: p.id,
          character: p.character,
          x,
          y: (r + 0.5) * CELL,
          angle: x < (COLS * CELL) / 2 ? 0 : Math.PI,
          cooldown: 0.5,
          triple: 0,
          bounce: 0,
          shield: false,
          hp: MAX_HP,
          hitT: 0,
          status: 'alive',
          ghost: 0,
          deathAnim: 0,
          moving: false,
          tread: 0,
        };
      }),
      shells: [],
      powerups: [],
      booms: [],
      time: 0,
      nextId: 1,
    };
  }

  private solidAt(x: number, y: number): boolean {
    const c = Math.floor(x / CELL);
    const r = Math.floor(y / CELL);
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return true;
    return this.state.grid[idx(c, r)] !== EMPTY;
  }

  private tankBlocked(x: number, y: number): boolean {
    const m = TANK_R - 0.5;
    return this.solidAt(x - m, y - m) || this.solidAt(x + m, y - m) || this.solidAt(x - m, y + m) || this.solidAt(x + m, y + m);
  }

  update(dt: number, inputs: Map<PlayerId, TickInput>, heat: number): void {
    const st = this.state;
    st.time += dt;
    for (const b of st.booms) b.t += dt;
    st.booms = st.booms.filter((b) => b.t < 0.5);

    for (const t of st.tanks) {
      if (t.status === 'dead') t.deathAnim = Math.max(0, t.deathAnim - dt);
      if (t.status !== 'alive') continue;
      t.ghost = Math.max(0, t.ghost - dt);
      t.hitT = Math.max(0, t.hitT - dt);
      t.cooldown = Math.max(0, t.cooldown - dt);
      t.triple = Math.max(0, t.triple - dt);
      t.bounce = Math.max(0, t.bounce - dt);
      const inp = inputs.get(t.id);
      // Tank controls: A/D rotate, W forward, S reverse.
      const turn = inp?.dx ?? 0;
      const drive = inp?.dy ? (inp.dy < 0 ? 1 : -REVERSE) : 0;
      t.angle += turn * TURN_SPEED * dt;
      t.moving = drive !== 0 || turn !== 0;
      if (drive !== 0) {
        const nx = t.x + Math.cos(t.angle) * SPEED * drive * dt;
        const ny = t.y + Math.sin(t.angle) * SPEED * drive * dt;
        if (!this.tankBlocked(nx, t.y)) t.x = nx;
        if (!this.tankBlocked(t.x, ny)) t.y = ny;
      }
      if (t.moving) t.tread += dt * (drive < 0 ? -1 : 1);
      // Power-up pickup.
      const c = Math.floor(t.x / CELL);
      const r = Math.floor(t.y / CELL);
      const pu = st.powerups.find((p) => p.c === c && p.r === r);
      if (pu) {
        if (pu.kind === 'triple') t.triple = POWER_TIME;
        else if (pu.kind === 'bounce') t.bounce = POWER_TIME;
        else t.shield = true;
        st.powerups = st.powerups.filter((p) => p !== pu);
        this.events.push({ type: 'sfx', name: 'powerup' });
      }
      if (inp?.pressed) this.fire(t, heat);
    }

    this.moveShells(dt);
  }

  private fire(t: Tank, heat: number): void {
    const st = this.state;
    if (t.cooldown > 0 || st.shells.filter((s) => s.owner === t.id).length >= MAX_SHELLS) return;
    t.cooldown = FIRE_COOLDOWN;
    const angles = t.triple > 0 ? [-0.25, 0, 0.25] : [0];
    const speed = SHELL_SPEED * (1 + heat * 0.3);
    for (const da of angles) {
      const a = t.angle + da;
      const mx = t.x + Math.cos(a) * (TANK_R + 3);
      const my = t.y + Math.sin(a) * (TANK_R + 3);
      if (this.solidAt(mx, my)) continue; // barrel against a wall
      st.shells.push({ id: st.nextId++, owner: t.id, x: mx, y: my, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, bounces: t.bounce > 0 ? 3 : 1, age: 0 });
    }
    this.events.push({ type: 'sfx', name: 'cannon' });
  }

  private moveShells(dt: number): void {
    const st = this.state;
    const dead = new Set<Shell>();
    for (const s of st.shells) {
      s.age += dt;
      // Substeps so fast shells can't tunnel through a cell.
      const steps = Math.ceil((Math.hypot(s.vx, s.vy) * dt) / 4);
      for (let k = 0; k < steps && !dead.has(s); k++) {
        const ox = s.x;
        const oy = s.y;
        const nx = s.x + (s.vx * dt) / steps;
        const ny = s.y + (s.vy * dt) / steps;
        if (this.solidAt(nx, ny)) {
          const c = Math.floor(nx / CELL);
          const r = Math.floor(ny / CELL);
          if (c >= 0 && r >= 0 && c < COLS && r < ROWS && st.grid[idx(c, r)] === CRATE) {
            this.breakCrate(c, r);
            dead.add(s);
            break;
          }
          if (s.bounces <= 0) {
            dead.add(s);
            st.booms.push({ x: ox, y: oy, t: 0, big: false });
            break;
          }
          s.bounces--;
          const hitX = this.solidAt(nx, oy);
          const hitY = this.solidAt(ox, ny);
          if (hitX || !hitY) s.vx = -s.vx;
          if (hitY || !hitX) s.vy = -s.vy;
          this.events.push({ type: 'sfx', name: 'ricochet' });
          continue;
        }
        s.x = nx;
        s.y = ny;
        // Tanks.
        for (const t of st.tanks) {
          if (t.status !== 'alive' || t.ghost > 0 || t.hitT > 0) continue;
          if (t.id === s.owner && s.age < SELF_GRACE) continue;
          if (Math.hypot(t.x - s.x, t.y - s.y) > TANK_R + SHELL_R) continue;
          dead.add(s);
          if (t.shield) {
            t.shield = false;
            this.events.push({ type: 'sfx', name: 'bump' });
          } else if (--t.hp > 0) {
            t.hitT = HIT_GRACE;
            st.booms.push({ x: s.x, y: s.y, t: 0, big: false });
            this.events.push({ type: 'sfx', name: 'bump' });
          } else {
            this.kill(t);
          }
          break;
        }
      }
    }
    // Shells cancel each other out.
    const live = st.shells.filter((s) => !dead.has(s));
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        if (Math.hypot(live[i].x - live[j].x, live[i].y - live[j].y) < SHELL_R * 3) {
          dead.add(live[i]);
          dead.add(live[j]);
          st.booms.push({ x: live[i].x, y: live[i].y, t: 0, big: false });
        }
      }
    }
    st.shells = st.shells.filter((s) => !dead.has(s));
  }

  private breakCrate(c: number, r: number): void {
    const st = this.state;
    st.grid[idx(c, r)] = EMPTY;
    st.booms.push({ x: (c + 0.5) * CELL, y: (r + 0.5) * CELL, t: 0, big: false });
    if (this.rng.next() < 0.35) st.powerups.push({ c, r, kind: this.rng.pick(['triple', 'bounce', 'shield'] as const) });
    this.events.push({ type: 'sfx', name: 'bomb' });
  }

  private kill(t: Tank): void {
    t.status = 'dead';
    t.deathAnim = DEATH_ANIM;
    t.triple = 0;
    t.bounce = 0;
    this.state.booms.push({ x: t.x, y: t.y, t: 0, big: true });
    this.events.push({ type: 'death', player: t.id }, { type: 'sfx', name: 'explosion' });
  }

  onSuspend(): void {}

  onResume(): void {
    const st = this.state;
    for (const t of st.tanks) {
      if (t.status !== 'dead') continue;
      let best = { x: t.x, y: t.y, score: -Infinity };
      for (let k = 0; k < 60; k++) {
        const x = (this.rng.int(COLS - 2) + 1.5) * CELL;
        const y = (this.rng.int(ROWS - 2) + 1.5) * CELL;
        if (this.tankBlocked(x, y)) continue;
        const nearTank = Math.min(...st.tanks.filter((o) => o !== t && o.status === 'alive').map((o) => Math.hypot(o.x - x, o.y - y)), 999);
        const nearShell = Math.min(...st.shells.map((s) => Math.hypot(s.x - x, s.y - y)), 999);
        const score = Math.min(nearTank, 120) + Math.min(nearShell, 60) * 2;
        if (score > best.score) best = { x, y, score };
      }
      t.x = best.x;
      t.y = best.y;
      t.status = 'alive';
      t.ghost = GHOST_TIME;
      t.deathAnim = 0;
      t.cooldown = 0.3;
      t.hp = MAX_HP;
    }
  }

  removePlayer(id: PlayerId): void {
    const t = this.state.tanks.find((t) => t.id === id);
    if (t) t.status = 'out';
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

  /** Path of a shell fired from (x, y) along `dir`, with `bounces` ricochets, sampled every 4px. */
  private trace(x: number, y: number, vx: number, vy: number, bounces: number, maxLen: number): Array<[number, number]> {
    const pts: Array<[number, number]> = [];
    const sp = Math.hypot(vx, vy);
    let ux = vx / sp;
    let uy = vy / sp;
    for (let d = 0; d < maxLen; d += 4) {
      const nx = x + ux * 4;
      const ny = y + uy * 4;
      if (this.solidAt(nx, ny)) {
        if (bounces <= 0 || this.solidCrate(nx, ny)) break;
        bounces--;
        const hitX = this.solidAt(nx, y);
        const hitY = this.solidAt(x, ny);
        if (hitX || !hitY) ux = -ux;
        if (hitY || !hitX) uy = -uy;
        continue;
      }
      x = nx;
      y = ny;
      pts.push([x, y]);
    }
    return pts;
  }

  private solidCrate(x: number, y: number): boolean {
    const c = Math.floor(x / CELL);
    const r = Math.floor(y / CELL);
    return c >= 0 && r >= 0 && c < COLS && r < ROWS && this.state.grid[idx(c, r)] === CRATE;
  }

  botInput(id: PlayerId, difficulty: BotDifficulty): PlayerInput {
    const t = this.state.tanks.find((t) => t.id === id);
    if (!t || t.status !== 'alive') return NEUTRAL_INPUT;
    let mem = this.botMem.get(id);
    if (!mem) {
      mem = { timer: 0, heading: t.angle, move: 0, fire: false, wander: this.rng.range(0, Math.PI * 2) };
      this.botMem.set(id, mem);
    }
    mem.timer -= 1 / 60;
    if (mem.timer <= 0) {
      mem.timer = BOT_CADENCE[difficulty];
      this.think(t, mem, difficulty);
    }
    // Steer toward the goal heading every tick; only drive once roughly lined up.
    const diff = angleDiff(t.angle, mem.heading);
    const turn = Math.abs(diff) > 0.05 ? (Math.sign(diff) as -1 | 1) : 0;
    const dy = mem.move !== 0 && Math.abs(diff) < 0.6 ? (mem.move > 0 ? -1 : 1) : 0;
    const fire = mem.fire && Math.abs(diff) < BOT_FIRE_TOL[difficulty] && t.cooldown <= 0;
    if (fire) mem.fire = false;
    return { dx: turn, dy: dy as -1 | 0 | 1, action: fire };
  }

  private think(t: Tank, mem: BotMemory, difficulty: BotDifficulty): void {
    const st = this.state;
    const free = (a: number, dist = 9) => !this.tankBlocked(t.x + Math.cos(a) * dist, t.y + Math.sin(a) * dist);

    // 1) Dodge incoming shells: move perpendicular to them, forward or in reverse,
    //    whichever needs less turning.
    const look = difficulty === 'easy' ? 0.4 : difficulty === 'medium' ? 0.6 : 0.8;
    for (const s of st.shells) {
      let danger = false;
      for (let k = 1; k <= 6 && !danger; k++) {
        const tt = (look * k) / 6;
        danger = Math.hypot(s.x + s.vx * tt - t.x, s.y + s.vy * tt - t.y) < TANK_R + 6;
      }
      if (!danger) continue;
      const perp = Math.atan2(s.vy, s.vx) + Math.PI / 2;
      let best: { heading: number; move: -1 | 1; cost: number } | null = null;
      for (const side of [perp, perp + Math.PI]) {
        if (!free(side)) continue;
        for (const [heading, move] of [
          [side, 1],
          [side + Math.PI, -1],
        ] as const) {
          const cost = Math.abs(angleDiff(t.angle, heading));
          if (!best || cost < best.cost) best = { heading, move, cost };
        }
      }
      if (best) {
        mem.heading = best.heading;
        mem.move = best.move;
        mem.fire = false;
        return;
      }
    }

    // 2) Look for a shot: straight at someone, or (hard bots) a bank shot with one ricochet.
    const enemies = st.tanks.filter((o) => o !== t && o.status === 'alive' && o.ghost <= 0);
    if (t.cooldown <= 0.2 && enemies.length && this.rng.next() < BOT_FIRE[difficulty]) {
      const candidates: number[] = enemies.map((o) => Math.atan2(o.y - t.y, o.x - t.x));
      if (difficulty === 'hard') for (let k = 0; k < 24; k++) candidates.push((k / 24) * Math.PI * 2);
      for (const a of candidates) {
        const vx = Math.cos(a);
        const vy = Math.sin(a);
        const bounces = difficulty === 'hard' ? 1 : 0;
        const path = this.trace(t.x + vx * (TANK_R + 3), t.y + vy * (TANK_R + 3), vx, vy, bounces, 260);
        const hit = path.findIndex(([x, y]) => enemies.some((o) => Math.hypot(o.x - x, o.y - y) < TANK_R + 2));
        if (hit === -1) continue;
        // Don't fire a bank shot that comes back to ourselves first.
        if (path.slice(0, hit).some(([x, y], i) => i > 4 && Math.hypot(t.x - x, t.y - y) < TANK_R + 3)) continue;
        mem.heading = a + this.rng.range(-BOT_MISAIM[difficulty], BOT_MISAIM[difficulty]);
        mem.move = 0;
        mem.fire = true;
        return;
      }
    }
    if (mem.fire) return; // still turning to take a shot

    // 3) Otherwise drive: toward the nearest enemy when far, circling it when close.
    const target = enemies.reduce<Tank | null>((best, o) => (!best || Math.hypot(o.x - t.x, o.y - t.y) < Math.hypot(best.x - t.x, best.y - t.y) ? o : best), null);
    let heading = mem.wander;
    if (target) {
      const toTarget = Math.atan2(target.y - t.y, target.x - t.x);
      heading = Math.hypot(target.x - t.x, target.y - t.y) > KEEP_DISTANCE ? toTarget : toTarget + (t.id % 2 ? 1 : -1) * (Math.PI / 2);
    }
    if (!free(heading, 10)) {
      // Blocked: pick a new free direction (prefer one close to where we're facing).
      const options = Array.from({ length: 8 }, (_, k) => (k / 8) * Math.PI * 2).filter((a) => free(a, 10));
      mem.wander = options.length ? options.reduce((a, b) => (Math.abs(angleDiff(t.angle, a)) < Math.abs(angleDiff(t.angle, b)) ? a : b)) : t.angle + Math.PI;
      heading = mem.wander;
    }
    mem.heading = heading;
    mem.move = 1;
  }
}
export const FlameWarDef: MinigameDef = {
  id: 'tank',
  name: 'FLAME WAR',
  handle: '@flame.war',
  hint: 'W/S ANDA  A/D GIRA  ESPAÇO ATIRA',
  create: (players, seed) => new FlameWar(players, seed),
};
