import type { Minigame, MinigameDef } from '../../minigame';
import { Rng } from '../../rng';
import type { BotDifficulty, GameEvent, PlayerId, PlayerInfo, PlayerInput, TickInput } from '../../types';
import { NEUTRAL_INPUT } from '../../types';

/**
 * Bullet hell: telegraphed beams sweep in from every edge (thin blinking warning, then a thick
 * deadly beam) while fast laser bolts cross the screen. Space dashes.
 */

export const FIELD = { x: 10, y: 8, w: 364, h: 188 };
export const PLAYER_R = 4;
const SPEED = 64;
const DASH_SPEED = 220;
const DASH_TIME = 0.13;
export const DASH_COOLDOWN = 1.2;
export const BEAM_HALF = 4;
export const FIRE_TIME = 0.3;
export const BOLT_R = 2;
const GHOST_TIME = 1.2;
export const DEATH_ANIM = 0.6;
const TIME_CAP = 50;

export interface BeamPlayer {
  id: PlayerId;
  character: number;
  x: number;
  y: number;
  fx: number;
  fy: number;
  dashT: number;
  dashCd: number;
  status: 'alive' | 'dead' | 'out';
  ghost: number;
  deathAnim: number;
  walk: number;
}

/** A beam is an infinite line through (x, y) with direction angle `a`, clipped to the field. */
export interface Beam {
  id: number;
  x: number;
  y: number;
  a: number;
  warn: number; // seconds of warning left (> 0: telegraph only)
  warnTotal: number;
  fire: number; // seconds of firing left
}

export interface Bolt {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface BeamState {
  players: BeamPlayer[];
  beams: Beam[];
  bolts: Bolt[];
  beamTimer: number;
  boltTimer: number;
  volleyTimer: number;
  time: number;
  nextId: number;
}

/** Distance from (px, py) to the beam's line. */
export function beamDistance(b: Beam, px: number, py: number): number {
  const dx = Math.cos(b.a);
  const dy = Math.sin(b.a);
  return Math.abs((px - b.x) * dy - (py - b.y) * dx);
}

interface BotMemory {
  timer: number;
  input: PlayerInput;
}

const BOT_CADENCE: Record<BotDifficulty, number> = { easy: 0.15, medium: 0.1, hard: 0.04 };
const BOT_LOOK: Record<BotDifficulty, number> = { easy: 0.28, medium: 0.32, hard: 0.36 };
const BOT_MARGIN: Record<BotDifficulty, number> = { easy: 1.5, medium: 2.5, hard: 4 };

const DIRS9: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

class LaserBeam implements Minigame<BeamState> {
  readonly defId = 'beam';
  readonly state: BeamState;
  private events: GameEvent[] = [];
  private rng: Rng;
  private botMem = new Map<PlayerId, BotMemory>();

  constructor(players: PlayerInfo[], seed: number) {
    this.rng = new Rng(seed);
    const cx = FIELD.x + FIELD.w / 2;
    const cy = FIELD.y + FIELD.h / 2;
    this.state = {
      players: players.map((p, i) => {
        const a = (i / players.length) * Math.PI * 2;
        return {
          id: p.id,
          character: p.character,
          x: cx + Math.cos(a) * 60,
          y: cy + Math.sin(a) * 45,
          fx: 1,
          fy: 0,
          dashT: 0,
          dashCd: 0,
          status: 'alive',
          ghost: 0,
          deathAnim: 0,
          walk: 0,
        };
      }),
      beams: [],
      bolts: [],
      beamTimer: 1,
      boltTimer: 1.5,
      volleyTimer: 2.5,
      time: 0,
      nextId: 1,
    };
  }

  private randomTarget(): [number, number] {
    const alive = this.state.players.filter((p) => p.status === 'alive');
    if (alive.length && this.rng.next() < 0.5) {
      const p = this.rng.pick(alive);
      return [p.x + this.rng.range(-15, 15), p.y + this.rng.range(-15, 15)];
    }
    return [this.rng.range(FIELD.x + 20, FIELD.x + FIELD.w - 20), this.rng.range(FIELD.y + 15, FIELD.y + FIELD.h - 15)];
  }

  private spawnBeam(heat: number): void {
    const st = this.state;
    const [x, y] = this.randomTarget();
    // Mostly straight lines (they read better), some diagonals.
    const r = this.rng.next();
    const a = r < 0.35 ? 0 : r < 0.7 ? Math.PI / 2 : this.rng.range(0, Math.PI);
    const warn = this.rng.range(0.75, 0.95) - 0.25 * heat;
    st.beams.push({ id: st.nextId++, x, y, a, warn, warnTotal: warn, fire: FIRE_TIME });
    this.events.push({ type: 'sfx', name: 'beamWarn' });
  }

  /** A volley: several parallel beams fired together; the safe spots are between them. */
  private spawnVolley(heat: number): void {
    const st = this.state;
    const r = this.rng.next();
    const a = r < 0.4 ? 0 : r < 0.8 ? Math.PI / 2 : this.rng.pick([Math.PI / 4, (3 * Math.PI) / 4]);
    const n = 4 + this.rng.int(3);
    // Spread the lines across the field, perpendicular to their direction.
    const nx = -Math.sin(a);
    const ny = Math.cos(a);
    const span = Math.abs(nx) * FIELD.w + Math.abs(ny) * FIELD.h;
    const spacing = span / n;
    const offset = this.rng.range(0, spacing);
    const cx = FIELD.x + FIELD.w / 2;
    const cy = FIELD.y + FIELD.h / 2;
    const warn = this.rng.range(1, 1.15) - 0.2 * heat;
    for (let k = 0; k < n; k++) {
      const d = -span / 2 + offset + k * spacing;
      st.beams.push({ id: st.nextId++, x: cx + nx * d, y: cy + ny * d, a, warn, warnTotal: warn, fire: FIRE_TIME });
    }
    this.events.push({ type: 'sfx', name: 'laserWall' });
  }

  private spawnBolt(heat: number): void {
    const st = this.state;
    // From a random point on the border toward somewhere in the field.
    const side = this.rng.int(4);
    const t = this.rng.next();
    const x = side < 2 ? FIELD.x + t * FIELD.w : side === 2 ? FIELD.x : FIELD.x + FIELD.w;
    const y = side >= 2 ? FIELD.y + t * FIELD.h : side === 0 ? FIELD.y : FIELD.y + FIELD.h;
    const [tx, ty] = this.randomTarget();
    const d = Math.hypot(tx - x, ty - y) || 1;
    const speed = this.rng.range(105, 140) + 50 * heat;
    st.bolts.push({ x, y, vx: ((tx - x) / d) * speed, vy: ((ty - y) / d) * speed });
  }

  update(dt: number, inputs: Map<PlayerId, TickInput>, heat: number): void {
    const st = this.state;
    st.time += dt;
    const ramp = Math.min(1, st.time / 40); // it keeps getting busier the longer this clip lives

    st.beamTimer -= dt;
    if (st.beamTimer <= 0) {
      st.beamTimer = this.rng.range(0.7, 0.95) - 0.2 * ramp - 0.15 * heat;
      this.spawnBeam(heat);
      if (this.rng.next() < 0.25 + 0.3 * ramp) this.spawnBeam(heat);
    }
    st.volleyTimer -= dt;
    if (st.volleyTimer <= 0) {
      st.volleyTimer = this.rng.range(2.6, 3.2) - 0.8 * ramp - 0.5 * heat;
      this.spawnVolley(heat);
      st.beamTimer = Math.max(st.beamTimer, 0.6); // let the volley read on its own
    }
    st.boltTimer -= dt;
    if (st.boltTimer <= 0) {
      st.boltTimer = this.rng.range(0.32, 0.45) - 0.08 * ramp - 0.08 * heat;
      this.spawnBolt(heat);
    }

    for (const b of st.beams) {
      if (b.warn > 0) {
        b.warn -= dt;
        if (b.warn <= 0) this.events.push({ type: 'sfx', name: 'beamFire' });
      } else {
        b.fire -= dt;
      }
    }
    st.beams = st.beams.filter((b) => b.warn > 0 || b.fire > 0);

    for (const bolt of st.bolts) {
      bolt.x += bolt.vx * dt;
      bolt.y += bolt.vy * dt;
    }
    st.bolts = st.bolts.filter((b) => b.x > FIELD.x - 6 && b.x < FIELD.x + FIELD.w + 6 && b.y > FIELD.y - 6 && b.y < FIELD.y + FIELD.h + 6);

    for (const p of st.players) {
      if (p.status === 'dead') p.deathAnim = Math.max(0, p.deathAnim - dt);
      if (p.status !== 'alive') continue;
      p.ghost = Math.max(0, p.ghost - dt);
      p.dashCd = Math.max(0, p.dashCd - dt);
      const inp = inputs.get(p.id);
      let mx = inp?.dx ?? 0;
      let my = inp?.dy ?? 0;
      const len = Math.hypot(mx, my);
      if (len > 0) {
        mx /= len;
        my /= len;
        p.fx = mx;
        p.fy = my;
        p.walk += dt;
      } else {
        p.walk = 0;
      }
      if (inp?.pressed && p.dashCd <= 0) {
        p.dashT = DASH_TIME;
        p.dashCd = DASH_COOLDOWN;
        this.events.push({ type: 'sfx', name: 'dash' });
      }
      let vx = mx * SPEED;
      let vy = my * SPEED;
      if (p.dashT > 0) {
        p.dashT -= dt;
        vx = p.fx * DASH_SPEED;
        vy = p.fy * DASH_SPEED;
      }
      p.x = Math.max(FIELD.x + PLAYER_R, Math.min(FIELD.x + FIELD.w - PLAYER_R, p.x + vx * dt));
      p.y = Math.max(FIELD.y + PLAYER_R, Math.min(FIELD.y + FIELD.h - PLAYER_R, p.y + vy * dt));

      if (p.ghost > 0) continue;
      const hitBeam = st.beams.some((b) => b.warn <= 0 && beamDistance(b, p.x, p.y) < BEAM_HALF + PLAYER_R * 0.5);
      const hitBolt = st.bolts.some((b) => Math.hypot(b.x - p.x, b.y - p.y) < BOLT_R + PLAYER_R * 0.8);
      if (hitBeam || hitBolt) {
        p.status = 'dead';
        p.deathAnim = DEATH_ANIM;
        this.events.push({ type: 'death', player: p.id }, { type: 'sfx', name: 'zap' });
      }
    }
  }

  /** How dangerous it is to be at (x, y) at time `t` from now. */
  private danger(x: number, y: number, t: number, margin: number): number {
    let d = 0;
    for (const b of this.state.beams) {
      const firing = b.warn - t <= 0 && b.warn - t > -b.fire;
      const soon = b.warn - t < 0.35;
      if ((firing || soon) && beamDistance(b, x, y) < BEAM_HALF + PLAYER_R + margin) d += firing ? 100 : 40;
    }
    for (const bolt of this.state.bolts) {
      const bx = bolt.x + bolt.vx * t;
      const by = bolt.y + bolt.vy * t;
      if (Math.hypot(bx - x, by - y) < BOLT_R + PLAYER_R + margin + 3) d += 80;
      // also the segment the bolt sweeps in between
      const mx = bolt.x + bolt.vx * t * 0.5;
      const my = bolt.y + bolt.vy * t * 0.5;
      if (Math.hypot(mx - x, my - y) < BOLT_R + PLAYER_R + margin) d += 40;
    }
    return d;
  }

  onSuspend(): void {}

  onResume(): void {
    const st = this.state;
    for (const p of st.players) {
      if (p.status !== 'dead') continue;
      let best = { x: FIELD.x + FIELD.w / 2, y: FIELD.y + FIELD.h / 2, d: Infinity };
      for (let k = 0; k < 40; k++) {
        const x = this.rng.range(FIELD.x + 20, FIELD.x + FIELD.w - 20);
        const y = this.rng.range(FIELD.y + 15, FIELD.y + FIELD.h - 15);
        const d = this.danger(x, y, 0.3, 8) + this.danger(x, y, 0.8, 8);
        if (d < best.d) best = { x, y, d };
      }
      p.x = best.x;
      p.y = best.y;
      p.status = 'alive';
      p.ghost = GHOST_TIME;
      p.deathAnim = 0;
      p.dashT = 0;
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
    const p = this.state.players.find((p) => p.id === id);
    if (!p || p.status !== 'alive') return NEUTRAL_INPUT;
    let mem = this.botMem.get(id);
    if (!mem) {
      mem = { timer: 0, input: NEUTRAL_INPUT };
      this.botMem.set(id, mem);
    }
    mem.timer -= 1 / 60;
    if (mem.timer > 0) return { ...mem.input, action: false };
    mem.timer = BOT_CADENCE[difficulty];

    const look = BOT_LOOK[difficulty];
    const margin = BOT_MARGIN[difficulty];
    const cx = FIELD.x + FIELD.w / 2;
    const cy = FIELD.y + FIELD.h / 2;
    let best = { dx: 0, dy: 0, score: Infinity };
    for (const [dx, dy] of DIRS9) {
      const len = Math.hypot(dx, dy) || 1;
      const x = Math.max(FIELD.x + PLAYER_R, Math.min(FIELD.x + FIELD.w - PLAYER_R, p.x + (dx / len) * SPEED * look));
      const y = Math.max(FIELD.y + PLAYER_R, Math.min(FIELD.y + FIELD.h - PLAYER_R, p.y + (dy / len) * SPEED * look));
      const score =
        this.danger(x, y, look, margin) +
        this.danger((p.x + x) / 2, (p.y + y) / 2, look / 2, margin) * 0.7 +
        Math.hypot(x - cx, y - cy) * 0.02;
      if (score < best.score) best = { dx, dy, score };
    }
    const hereBad = this.danger(p.x, p.y, 0.15, margin) >= 80;
    const dash = hereBad && p.dashCd <= 0 && (best.dx !== 0 || best.dy !== 0);
    mem.input = { dx: best.dx as -1 | 0 | 1, dy: best.dy as -1 | 0 | 1, action: dash };
    return mem.input;
  }
}

export const LaserBeamDef: MinigameDef = {
  id: 'beam',
  name: 'LASER BEAM',
  handle: '@laser.beam',
  hint: 'DESVIE DE TUDO!  ESPAÇO DASH',
  create: (players, seed) => new LaserBeam(players, seed),
};
