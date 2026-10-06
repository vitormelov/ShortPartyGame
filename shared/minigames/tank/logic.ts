import { ARENA_H, ARENA_W } from '../../arena';
import { angleDiff, type Minigame, type MinigameDef } from '../../minigame';
import { Rng } from '../../rng';
import type { BotDifficulty, GameEvent, PlayerId, PlayerInfo, PlayerInput, TickInput } from '../../types';
import { NEUTRAL_INPUT } from '../../types';

/**
 * FLAME WAR: top-down spaceships, free for all, in an asteroid field. Tank controls: W forward,
 * S reverse, A/D rotate the ship (the gun points where the nose points). Space fires a laser.
 * Lasers stop at the first asteroid, so the rocks are cover. Two hits to go down.
 */

export const SHIP_R = 5;
const SPEED = 58;
const REVERSE = 0.6; // reverse thrusters are weaker
const TURN_SPEED = 3; // rad/s
export const SHOT_SPEED = 140;
const SHOT_R = 1.5;
const FIRE_COOLDOWN = 0.8;
const MAX_SHOTS = 2;
const MARGIN = 4; // ships stay this far inside the screen edges
export const MAX_HP = 2;
const HIT_GRACE = 0.35; // brief invulnerability after taking a hit
const GHOST_TIME = 1.2;
export const DEATH_ANIM = 0.6;
const TIME_CAP = 50;

export interface Ship {
  id: PlayerId;
  character: number;
  x: number;
  y: number;
  angle: number; // nose heading in radians (screen coords: 0 = right, PI/2 = down)
  cooldown: number;
  hp: number;
  hitT: number; // > 0 right after being hit (flash + grace)
  status: 'alive' | 'dead' | 'out';
  ghost: number;
  deathAnim: number;
  /** -1 reverse, 0 coasting, 1 thrusting (for the engine flame). */
  thrust: -1 | 0 | 1;
}

export interface Shot {
  id: number;
  owner: PlayerId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
}

export interface Asteroid {
  id: number;
  x: number;
  y: number;
  r: number;
  /** Seed for the rock's outline and craters (drawing only). */
  seed: number;
}

export interface Boom {
  x: number;
  y: number;
  t: number;
  big: boolean;
}

export interface ShipState {
  ships: Ship[];
  shots: Shot[];
  asteroids: Asteroid[];
  booms: Boom[];
  time: number;
  nextId: number;
}

/** Left half of a symmetric asteroid field (mirrored left/right); x, y, radius. */
const HALF_FIELD: ReadonlyArray<readonly [number, number, number]> = [
  [ARENA_W / 2, ARENA_H / 2, 19],
  [104, 52, 14],
  [104, 152, 14],
  [50, 102, 10],
  [ARENA_W / 2, 26, 9],
  [ARENA_W / 2, ARENA_H - 26, 9],
  [150, 96, 6],
];

const SPAWNS: ReadonlyArray<readonly [number, number]> = [
  [24, 20],
  [ARENA_W - 24, ARENA_H - 20],
  [ARENA_W - 24, 20],
  [24, ARENA_H - 20],
  [150, 40],
  [ARENA_W - 150, ARENA_H - 40],
  [ARENA_W - 150, 40],
  [150, ARENA_H - 40],
];

/** Bots "think" every so often (goal heading, drive, fire) and steer toward it every tick. */
interface BotMemory {
  timer: number;
  heading: number;
  move: -1 | 0 | 1; // forward / stop / reverse
  fire: boolean; // fire once the nose lines up with heading
  wander: number;
}

const BOT_CADENCE: Record<BotDifficulty, number> = { easy: 0.25, medium: 0.12, hard: 0.06 };
const BOT_FIRE: Record<BotDifficulty, number> = { easy: 0.08, medium: 0.14, hard: 0.2 };
/** Random aim error (radians), human-like imprecision. */
const BOT_MISAIM: Record<BotDifficulty, number> = { easy: 0.3, medium: 0.18, hard: 0.08 };
/** How well lined up the nose must be before the bot fires. */
const BOT_FIRE_TOL: Record<BotDifficulty, number> = { easy: 0.14, medium: 0.09, hard: 0.05 };
const KEEP_DISTANCE = 80;

class FlameWar implements Minigame<ShipState> {
  readonly defId = 'tank';
  readonly state: ShipState;
  private events: GameEvent[] = [];
  /** Seconds until the next asteroid blows up (late in a match). */
  private crumble = 5;
  private rng: Rng;
  private botMem = new Map<PlayerId, BotMemory>();

  constructor(players: PlayerInfo[], seed: number) {
    this.rng = new Rng(seed);
    const asteroids: Asteroid[] = [];
    let id = 1;
    for (const [x, y, r] of HALF_FIELD) {
      // A little jitter so every field is different, but it stays symmetric (fair).
      const jx = this.rng.range(-5, 5);
      const jy = this.rng.range(-5, 5);
      const rr = r + this.rng.range(-1.5, 1.5);
      const center = Math.abs(x - ARENA_W / 2) < 1;
      asteroids.push({ id: id++, x: center ? x : x + jx, y: y + jy, r: rr, seed: this.rng.int(1e6) });
      if (!center) asteroids.push({ id: id++, x: ARENA_W - x - jx, y: y + jy, r: rr, seed: this.rng.int(1e6) });
    }
    this.state = { ships: [], shots: [], asteroids, booms: [], time: 0, nextId: 1 };
    this.state.ships = players.map((p, i) => {
      const [sx, sy] = SPAWNS[i % SPAWNS.length];
      const spot = this.blocked(sx, sy) ? this.findSpot(null) : { x: sx, y: sy };
      return {
        id: p.id,
        character: p.character,
        x: spot.x,
        y: spot.y,
        angle: spot.x < ARENA_W / 2 ? 0 : Math.PI,
        cooldown: 0.5,
        hp: MAX_HP,
        hitT: 0,
        status: 'alive',
        ghost: 0,
        deathAnim: 0,
        thrust: 0,
      };
    });
  }

  private rockAt(x: number, y: number, pad: number): Asteroid | undefined {
    return this.state.asteroids.find((a) => Math.hypot(a.x - x, a.y - y) < a.r + pad);
  }

  private blocked(x: number, y: number): boolean {
    if (x < MARGIN + SHIP_R || y < MARGIN + SHIP_R || x > ARENA_W - MARGIN - SHIP_R || y > ARENA_H - MARGIN - SHIP_R) return true;
    return this.rockAt(x, y, SHIP_R) !== undefined;
  }

  update(dt: number, inputs: Map<PlayerId, TickInput>, heat: number): void {
    const st = this.state;
    st.time += dt;
    for (const b of st.booms) b.t += dt;
    st.booms = st.booms.filter((b) => b.t < 0.5);
    // Late in a match the asteroids start blowing up one by one: no hiding forever.
    if (heat > 0.7 && st.asteroids.length > 0) {
      this.crumble -= dt;
      if (this.crumble <= 0) {
        this.crumble = 5;
        const a = st.asteroids.splice(this.rng.int(st.asteroids.length), 1)[0];
        st.booms.push({ x: a.x, y: a.y, t: 0, big: true });
        this.events.push({ type: 'sfx', name: 'explosion' });
      }
    }

    for (const s of st.ships) {
      if (s.status === 'dead') s.deathAnim = Math.max(0, s.deathAnim - dt);
      if (s.status !== 'alive') continue;
      s.ghost = Math.max(0, s.ghost - dt);
      s.hitT = Math.max(0, s.hitT - dt);
      s.cooldown = Math.max(0, s.cooldown - dt);
      const inp = inputs.get(s.id);
      // Tank controls: A/D rotate, W forward, S reverse.
      const turn = inp?.dx ?? 0;
      const drive = inp?.dy ? (inp.dy < 0 ? 1 : -REVERSE) : 0;
      s.angle += turn * TURN_SPEED * dt;
      s.thrust = drive > 0 ? 1 : drive < 0 ? -1 : 0;
      if (drive !== 0) {
        const nx = s.x + Math.cos(s.angle) * SPEED * drive * dt;
        const ny = s.y + Math.sin(s.angle) * SPEED * drive * dt;
        if (!this.blocked(nx, s.y)) s.x = nx;
        if (!this.blocked(s.x, ny)) s.y = ny;
      }
      if (inp?.pressed) this.fire(s, heat);
    }

    this.moveShots(dt);
  }

  private fire(s: Ship, heat: number): void {
    const st = this.state;
    if (s.cooldown > 0 || st.shots.filter((o) => o.owner === s.id).length >= MAX_SHOTS) return;
    s.cooldown = FIRE_COOLDOWN;
    const mx = s.x + Math.cos(s.angle) * (SHIP_R + 3);
    const my = s.y + Math.sin(s.angle) * (SHIP_R + 3);
    if (this.rockAt(mx, my, 0)) return; // nose against a rock
    const speed = SHOT_SPEED * (1 + heat * 0.3);
    st.shots.push({ id: st.nextId++, owner: s.id, x: mx, y: my, vx: Math.cos(s.angle) * speed, vy: Math.sin(s.angle) * speed, age: 0 });
    this.events.push({ type: 'sfx', name: 'pew' });
  }

  private moveShots(dt: number): void {
    const st = this.state;
    const dead = new Set<Shot>();
    for (const o of st.shots) {
      o.age += dt;
      // Substeps so fast lasers can't skip past a small rock or ship.
      const steps = Math.ceil((Math.hypot(o.vx, o.vy) * dt) / 3);
      for (let k = 0; k < steps && !dead.has(o); k++) {
        o.x += (o.vx * dt) / steps;
        o.y += (o.vy * dt) / steps;
        if (o.x < 0 || o.y < 0 || o.x > ARENA_W || o.y > ARENA_H) {
          dead.add(o);
          break;
        }
        if (this.rockAt(o.x, o.y, SHOT_R)) {
          dead.add(o);
          st.booms.push({ x: o.x, y: o.y, t: 0, big: false });
          break;
        }
        for (const s of st.ships) {
          if (s.status !== 'alive' || s.ghost > 0 || s.hitT > 0 || s.id === o.owner) continue;
          if (Math.hypot(s.x - o.x, s.y - o.y) > SHIP_R + SHOT_R) continue;
          dead.add(o);
          if (--s.hp > 0) {
            s.hitT = HIT_GRACE;
            st.booms.push({ x: o.x, y: o.y, t: 0, big: false });
            this.events.push({ type: 'sfx', name: 'bump' });
          } else {
            this.kill(s);
          }
          break;
        }
      }
    }
    // Lasers cancel each other out.
    const live = st.shots.filter((o) => !dead.has(o));
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        if (Math.hypot(live[i].x - live[j].x, live[i].y - live[j].y) < SHOT_R * 3) {
          dead.add(live[i]);
          dead.add(live[j]);
          st.booms.push({ x: live[i].x, y: live[i].y, t: 0, big: false });
        }
      }
    }
    st.shots = st.shots.filter((o) => !dead.has(o));
  }

  private kill(s: Ship): void {
    s.status = 'dead';
    s.deathAnim = DEATH_ANIM;
    s.thrust = 0;
    this.state.booms.push({ x: s.x, y: s.y, t: 0, big: true });
    this.events.push({ type: 'death', player: s.id }, { type: 'sfx', name: 'explosion' });
  }

  /** The free spot farthest from ships and lasers. */
  private findSpot(self: Ship | null): { x: number; y: number } {
    const st = this.state;
    let best = { x: ARENA_W / 2, y: 20, score: -Infinity };
    for (let k = 0; k < 80; k++) {
      const x = this.rng.range(MARGIN + SHIP_R, ARENA_W - MARGIN - SHIP_R);
      const y = this.rng.range(MARGIN + SHIP_R, ARENA_H - MARGIN - SHIP_R);
      if (this.rockAt(x, y, SHIP_R + 3)) continue;
      const nearShip = Math.min(...st.ships.filter((o) => o !== self && o.status === 'alive').map((o) => Math.hypot(o.x - x, o.y - y)), 999);
      const nearShot = Math.min(...st.shots.map((o) => Math.hypot(o.x - x, o.y - y)), 999);
      const score = Math.min(nearShip, 120) + Math.min(nearShot, 60) * 2;
      if (score > best.score) best = { x, y, score };
    }
    return best;
  }

  onSuspend(): void {}

  onResume(): void {
    for (const s of this.state.ships) {
      if (s.status !== 'dead') continue;
      const spot = this.findSpot(s);
      s.x = spot.x;
      s.y = spot.y;
      s.status = 'alive';
      s.ghost = GHOST_TIME;
      s.deathAnim = 0;
      s.cooldown = 0.3;
      s.hp = MAX_HP;
    }
  }

  removePlayer(id: PlayerId): void {
    const s = this.state.ships.find((s) => s.id === id);
    if (s) s.status = 'out';
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

  /** Whether a laser from (x, y) along `a` reaches (tx, ty) without hitting a rock. */
  private clearShot(x: number, y: number, a: number, tx: number, ty: number): boolean {
    const dist = Math.hypot(tx - x, ty - y);
    for (let d = 0; d < dist; d += 3) {
      if (this.rockAt(x + Math.cos(a) * d, y + Math.sin(a) * d, SHOT_R)) return false;
    }
    return true;
  }

  botInput(id: PlayerId, difficulty: BotDifficulty): PlayerInput {
    const s = this.state.ships.find((s) => s.id === id);
    if (!s || s.status !== 'alive') return NEUTRAL_INPUT;
    let mem = this.botMem.get(id);
    if (!mem) {
      mem = { timer: 0, heading: s.angle, move: 0, fire: false, wander: this.rng.range(0, Math.PI * 2) };
      this.botMem.set(id, mem);
    }
    mem.timer -= 1 / 60;
    if (mem.timer <= 0) {
      mem.timer = BOT_CADENCE[difficulty];
      this.think(s, mem, difficulty);
    }
    // Steer toward the goal heading every tick; only drive once roughly lined up.
    const diff = angleDiff(s.angle, mem.heading);
    const turn = Math.abs(diff) > 0.05 ? (Math.sign(diff) as -1 | 1) : 0;
    const dy = mem.move !== 0 && Math.abs(diff) < 0.6 ? (mem.move > 0 ? -1 : 1) : 0;
    const fire = mem.fire && Math.abs(diff) < BOT_FIRE_TOL[difficulty] && s.cooldown <= 0;
    if (fire) mem.fire = false;
    return { dx: turn, dy: dy as -1 | 0 | 1, action: fire };
  }

  private think(s: Ship, mem: BotMemory, difficulty: BotDifficulty): void {
    const st = this.state;
    const free = (a: number, dist = 10) => !this.blocked(s.x + Math.cos(a) * dist, s.y + Math.sin(a) * dist);

    // 1) Dodge incoming lasers: move perpendicular to them, forward or in reverse,
    //    whichever needs less turning.
    const look = difficulty === 'easy' ? 0.35 : difficulty === 'medium' ? 0.55 : 0.75;
    for (const o of st.shots) {
      if (o.owner === s.id) continue;
      let danger = false;
      for (let k = 1; k <= 6 && !danger; k++) {
        const tt = (look * k) / 6;
        danger = Math.hypot(o.x + o.vx * tt - s.x, o.y + o.vy * tt - s.y) < SHIP_R + 6;
      }
      if (!danger || !this.clearShot(o.x, o.y, Math.atan2(o.vy, o.vx), s.x, s.y)) continue;
      const perp = Math.atan2(o.vy, o.vx) + Math.PI / 2;
      let best: { heading: number; move: -1 | 1; cost: number } | null = null;
      for (const side of [perp, perp + Math.PI]) {
        if (!free(side)) continue;
        for (const [heading, move] of [
          [side, 1],
          [side + Math.PI, -1],
        ] as const) {
          const cost = Math.abs(angleDiff(s.angle, heading));
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

    // 2) Take a shot at anyone in the open.
    const enemies = st.ships.filter((o) => o !== s && o.status === 'alive' && o.ghost <= 0);
    if (s.cooldown <= 0.2 && enemies.length && this.rng.next() < BOT_FIRE[difficulty]) {
      const inSight = enemies
        .filter((o) => Math.hypot(o.x - s.x, o.y - s.y) < 260)
        .find((o) => this.clearShot(s.x, s.y, Math.atan2(o.y - s.y, o.x - s.x), o.x, o.y));
      if (inSight) {
        mem.heading = Math.atan2(inSight.y - s.y, inSight.x - s.x) + this.rng.range(-BOT_MISAIM[difficulty], BOT_MISAIM[difficulty]);
        mem.move = 0;
        mem.fire = true;
        return;
      }
    }
    if (mem.fire) return; // still turning to take a shot

    // 3) Otherwise fly: toward the nearest enemy when far, circling it when close.
    const target = enemies.reduce<Ship | null>((best, o) => (!best || Math.hypot(o.x - s.x, o.y - s.y) < Math.hypot(best.x - s.x, best.y - s.y) ? o : best), null);
    let heading = mem.wander;
    if (target) {
      const toTarget = Math.atan2(target.y - s.y, target.x - s.x);
      heading = Math.hypot(target.x - s.x, target.y - s.y) > KEEP_DISTANCE ? toTarget : toTarget + (s.id % 2 ? 1 : -1) * (Math.PI / 2);
    }
    if (!free(heading, 12)) {
      // Blocked by a rock or the edge: pick a new free direction close to where we're facing.
      const options = Array.from({ length: 12 }, (_, k) => (k / 12) * Math.PI * 2).filter((a) => free(a, 12));
      mem.wander = options.length ? options.reduce((a, b) => (Math.abs(angleDiff(s.angle, a)) < Math.abs(angleDiff(s.angle, b)) ? a : b)) : s.angle + Math.PI;
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
  hint: 'W/S ACELERA  A/D GIRA  ESPAÇO ATIRA',
  create: (players, seed) => new FlameWar(players, seed),
};
