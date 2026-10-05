import type { Minigame, MinigameDef } from '../../minigame';
import { Rng } from '../../rng';
import type { BotDifficulty, GameEvent, PlayerId, PlayerInfo, PlayerInput, TickInput } from '../../types';
import { NEUTRAL_INPUT } from '../../types';

/**
 * Bumper-balls style: everyone rides a ball on a round platform that slowly shrinks.
 * Momentum-based movement, bouncy collisions; fall off the edge and you're out. Space charges.
 */

export const CENTER = { x: 192, y: 104 };
export const START_R = 90;
const MIN_R = 52;
export const BALL_R = 9;
const ACCEL = 210;
const MAX_SPEED = 115;
const FRICTION = 1.6; // per second, exponential
const BOUNCE = 0.95; // close to elastic: hits push hard but don't create energy
const CHARGE_IMPULSE = 135;
export const CHARGE_COOLDOWN = 1.5;
const CHARGE_TIME = 0.25; // how long the charge counts as "charging" (stronger hits)
export const FALL_TIME = 0.6;
const GHOST_TIME = 1.2;
const TIME_CAP = 50;

export interface Ball {
  id: PlayerId;
  character: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  roll: number; // distance rolled, for the stripe animation
  charge: number; // remaining "charging" time
  chargeCd: number;
  status: 'alive' | 'falling' | 'dead' | 'out';
  fall: number;
  ghost: number;
}

export interface BubbleState {
  balls: Ball[];
  radius: number;
  time: number;
}

interface BotMemory {
  timer: number;
  victim: PlayerId;
  input: PlayerInput;
}

const BOT_CADENCE: Record<BotDifficulty, number> = { easy: 0.2, medium: 0.1, hard: 0.05 };
const BOT_SAFETY: Record<BotDifficulty, number> = { easy: 14, medium: 22, hard: 28 };
const BOT_CHARGE: Record<BotDifficulty, number> = { easy: 0.15, medium: 0.4, hard: 0.7 };

const DIRS8: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

class BolhaSocial implements Minigame<BubbleState> {
  readonly defId = 'bubble';
  readonly state: BubbleState;
  private events: GameEvent[] = [];
  private rng: Rng;
  private botMem = new Map<PlayerId, BotMemory>();

  constructor(players: PlayerInfo[], seed: number) {
    this.rng = new Rng(seed);
    this.state = {
      balls: players.map((p, i) => {
        const a = (i / players.length) * Math.PI * 2;
        return {
          id: p.id,
          character: p.character,
          x: CENTER.x + Math.cos(a) * 52,
          y: CENTER.y + Math.sin(a) * 52,
          vx: 0,
          vy: 0,
          roll: 0,
          charge: 0,
          chargeCd: 0,
          status: 'alive',
          fall: 0,
          ghost: 0,
        };
      }),
      radius: START_R,
      time: 0,
    };
  }

  update(dt: number, inputs: Map<PlayerId, TickInput>, heat: number): void {
    const st = this.state;
    st.time += dt;
    st.radius = Math.max(MIN_R, START_R - st.time * 0.6 - heat * 18);

    for (const b of st.balls) {
      if (b.status === 'falling') {
        b.fall -= dt;
        b.x += b.vx * dt * 0.5;
        b.y += b.vy * dt * 0.5;
        if (b.fall <= 0) b.status = 'dead';
        continue;
      }
      if (b.status !== 'alive') continue;
      b.ghost = Math.max(0, b.ghost - dt);
      b.chargeCd = Math.max(0, b.chargeCd - dt);
      b.charge = Math.max(0, b.charge - dt);
      const inp = inputs.get(b.id);
      let ax = inp?.dx ?? 0;
      let ay = inp?.dy ?? 0;
      const len = Math.hypot(ax, ay);
      if (len > 0) {
        ax /= len;
        ay /= len;
        b.vx += ax * ACCEL * dt;
        b.vy += ay * ACCEL * dt;
      }
      if (inp?.pressed && b.chargeCd <= 0) {
        // Charge where you're steering, or keep going where you're rolling.
        let cx = ax;
        let cy = ay;
        if (len === 0) {
          const s = Math.hypot(b.vx, b.vy) || 1;
          cx = b.vx / s;
          cy = b.vy / s;
        }
        b.vx += cx * CHARGE_IMPULSE;
        b.vy += cy * CHARGE_IMPULSE;
        b.charge = CHARGE_TIME;
        b.chargeCd = CHARGE_COOLDOWN;
        this.events.push({ type: 'sfx', name: 'dash' });
      }
      const f = Math.exp(-FRICTION * dt);
      b.vx *= f;
      b.vy *= f;
      const speed = Math.hypot(b.vx, b.vy);
      const cap = b.charge > 0 ? MAX_SPEED * 2.2 : MAX_SPEED * 1.8; // hits can exceed the walking cap
      if (speed > cap) {
        b.vx *= cap / speed;
        b.vy *= cap / speed;
      }
      if (speed > MAX_SPEED && b.charge <= 0 && len > 0) {
        // Steering alone never goes past MAX_SPEED.
        b.vx *= Math.max(MAX_SPEED / speed, 0.98);
        b.vy *= Math.max(MAX_SPEED / speed, 0.98);
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.roll += speed * dt;
    }

    this.collide();

    for (const b of st.balls) {
      if (b.status !== 'alive' || b.ghost > 0) continue;
      if (Math.hypot(b.x - CENTER.x, b.y - CENTER.y) > st.radius) {
        b.status = 'falling';
        b.fall = FALL_TIME;
        this.events.push({ type: 'death', player: b.id }, { type: 'sfx', name: 'fall' });
      }
    }
  }

  private collide(): void {
    const bs = this.state.balls.filter((b) => b.status === 'alive' && b.ghost <= 0);
    for (let i = 0; i < bs.length; i++) {
      for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i];
        const b = bs[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d === 0 || d >= BALL_R * 2) continue;
        const nx = dx / d;
        const ny = dy / d;
        const overlap = (BALL_R * 2 - d) / 2;
        a.x -= nx * overlap;
        a.y -= ny * overlap;
        b.x += nx * overlap;
        b.y += ny * overlap;
        const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (rel <= 0) continue;
        // Equal masses: exchange the normal component, amplified. A charging ball hits harder
        // and barely recoils itself.
        const imp = rel * BOUNCE;
        const aShare = b.charge > 0 && a.charge <= 0 ? 1.5 : a.charge > 0 && b.charge <= 0 ? 0.35 : 1;
        const bShare = a.charge > 0 && b.charge <= 0 ? 1.5 : b.charge > 0 && a.charge <= 0 ? 0.35 : 1;
        a.vx -= nx * imp * aShare;
        a.vy -= ny * imp * aShare;
        b.vx += nx * imp * bShare;
        b.vy += ny * imp * bShare;
        if (rel > 30) this.events.push({ type: 'sfx', name: 'bump' });
      }
    }
  }

  onSuspend(): void {}

  onResume(): void {
    const st = this.state;
    for (const b of st.balls) {
      if (b.status !== 'falling' && b.status !== 'dead') continue;
      let best = { x: CENTER.x, y: CENTER.y, d: -1 };
      for (let k = 0; k < 30; k++) {
        const a = this.rng.range(0, Math.PI * 2);
        const r = this.rng.range(0, st.radius * 0.5);
        const x = CENTER.x + Math.cos(a) * r;
        const y = CENTER.y + Math.sin(a) * r;
        const d = Math.min(...st.balls.filter((o) => o !== b && o.status === 'alive').map((o) => Math.hypot(o.x - x, o.y - y)), 999);
        if (d > best.d) best = { x, y, d };
      }
      b.x = best.x;
      b.y = best.y;
      b.vx = 0;
      b.vy = 0;
      b.charge = 0;
      b.fall = 0;
      b.status = 'alive';
      b.ghost = GHOST_TIME;
    }
  }

  removePlayer(id: PlayerId): void {
    const b = this.state.balls.find((b) => b.id === id);
    if (b) b.status = 'out';
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
    const b = st.balls.find((b) => b.id === id);
    if (!b || b.status !== 'alive') return NEUTRAL_INPUT;
    let mem = this.botMem.get(id);
    if (!mem) {
      mem = { timer: 0, victim: -1, input: NEUTRAL_INPUT };
      this.botMem.set(id, mem);
    }
    mem.timer -= 1 / 60;
    if (mem.timer > 0) return { ...mem.input, action: false };
    mem.timer = BOT_CADENCE[difficulty];

    // Where will I be shortly? (further ahead the faster we go) If that's near the edge,
    // steer back toward the center first.
    const look = 0.35 + Math.hypot(b.vx, b.vy) / 260;
    const px = b.x + b.vx * look;
    const py = b.y + b.vy * look;
    const edgeDist = st.radius - Math.hypot(px - CENTER.x, py - CENTER.y);
    const pick = (tx: number, ty: number): PlayerInput => {
      // Choose the 8-way direction whose acceleration best turns our velocity toward the target.
      let best: readonly [number, number] = DIRS8[0];
      let bestScore = -Infinity;
      const want = Math.atan2(ty - b.y, tx - b.x);
      // Ease off as we arrive instead of overshooting.
      const speed = Math.min(MAX_SPEED, Math.hypot(tx - b.x, ty - b.y) * 2.5);
      const wx = Math.cos(want) * speed - b.vx;
      const wy = Math.sin(want) * speed - b.vy;
      for (const d of DIRS8) {
        const len = Math.hypot(d[0], d[1]);
        const score = (d[0] * wx + d[1] * wy) / len;
        if (score > bestScore) {
          bestScore = score;
          best = d;
        }
      }
      return { dx: best[0] as -1 | 0 | 1, dy: best[1] as -1 | 0 | 1, action: false };
    };

    if (edgeDist < BOT_SAFETY[difficulty]) {
      mem.input = pick(CENTER.x, CENTER.y);
      return mem.input;
    }

    // Pick a victim: the opponent closest to the edge that we can reach.
    const others = st.balls.filter((o) => o !== b && o.status === 'alive' && o.ghost <= 0);
    if (others.length === 0) {
      mem.input = pick(CENTER.x, CENTER.y);
      return mem.input;
    }
    const victim = others.reduce((best, o) => {
      const score = Math.hypot(o.x - b.x, o.y - b.y) - Math.hypot(o.x - CENTER.x, o.y - CENTER.y) * 1.2;
      const bestScore = Math.hypot(best.x - b.x, best.y - b.y) - Math.hypot(best.x - CENTER.x, best.y - CENTER.y) * 1.2;
      return score < bestScore ? o : best;
    });
    mem.victim = victim.id;
    // Approach from the center side so the hit pushes them outward.
    const ox = victim.x - CENTER.x;
    const oy = victim.y - CENTER.y;
    const ol = Math.hypot(ox, oy) || 1;
    const behindX = victim.x - (ox / ol) * BALL_R * 1.2;
    const behindY = victim.y - (oy / ol) * BALL_R * 1.2;
    mem.input = pick(behindX, behindY);

    const dist = Math.hypot(victim.x - b.x, victim.y - b.y);
    const towardVictim = (victim.x - b.x) * b.vx + (victim.y - b.y) * b.vy > 0;
    // Only charge if there's room behind the victim for us to stop.
    const room = st.radius - Math.hypot(victim.x - CENTER.x, victim.y - CENTER.y);
    const ownRoom = st.radius - Math.hypot(b.x - CENTER.x, b.y - CENTER.y);
    if (dist < 34 && towardVictim && ownRoom > 40 && room < 40 && b.chargeCd <= 0 && this.rng.next() < BOT_CHARGE[difficulty]) {
      mem.input = { ...mem.input, action: true };
    }
    return mem.input;
  }
}

export const BolhaSocialDef: MinigameDef = {
  id: 'bubble',
  name: 'BOLHA SOCIAL',
  handle: '@bolha.social',
  hint: 'EMPURRE PRA FORA!  ESPAÇO INVESTE',
  create: (players, seed) => new BolhaSocial(players, seed),
};
