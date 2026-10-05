import { ARENA_H, ARENA_W } from '../../arena';
import type { Minigame, MinigameDef } from '../../minigame';
import { Rng } from '../../rng';
import type { BotDifficulty, GameEvent, PlayerId, PlayerInfo, PlayerInput, TickInput } from '../../types';
import { NEUTRAL_INPUT } from '../../types';

/**
 * PONG DO CANCELAMENTO (Paddle Battle): a polygon arena with one side per player. Each one
 * guards their side with a paddle (A/D); a ball through your side costs a life and the side
 * turns into a wall until you come back. Space smashes. More balls join as it goes.
 */

export const CX = ARENA_W / 2;
export const CY = ARENA_H / 2;
const APOTHEM = 94; // center to the middle of each side
export const BALL_R = 3;
const PADDLE_SPEED = 135;
const BALL_START = 125;
const BALL_ACCEL = 1.06;
const BALL_MAX = 270;
const SMASH_TIME = 0.15;
const SMASH_CD = 0.6;
const SMASH_MULT = 1.3;
const SERVE_TIME = 0.8;
const GHOST_TIME = 1.2;
const TIME_CAP = 50;

export interface Side {
  ax: number; // endpoints (counter-clockwise order)
  ay: number;
  bx: number;
  by: number;
  nx: number; // inward normal
  ny: number;
  len: number;
  owner: PlayerId | -1;
}

export interface Paddler {
  id: PlayerId;
  character: number;
  side: number;
  u: number; // paddle center along the side, from -1 to 1
  status: 'alive' | 'dead' | 'out';
  ghost: number; // just came back: the side is still a wall
  smashT: number;
  smashCd: number;
  flash: number; // just conceded
}

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  serve: number; // > 0: waiting at the center
  lastHit: PlayerId | -1;
}

export interface PaddleState {
  sides: Side[];
  paddlers: Paddler[];
  balls: Ball[];
  paddleLen: number;
  time: number;
}

interface BotMemory {
  ballKey: string; // which approach it's aiming for
  aim: number; // offset error along the side
}

const BOT_ERR: Record<BotDifficulty, number> = { easy: 1.35, medium: 1.12, hard: 0.95 };
const BOT_LAG: Record<BotDifficulty, number> = { easy: 0.32, medium: 0.2, hard: 0.1 };

class PongDoCancelamento implements Minigame<PaddleState> {
  readonly defId = 'paddle';
  readonly state: PaddleState;
  private events: GameEvent[] = [];
  private rng: Rng;
  private botMem = new Map<PlayerId, BotMemory>();

  constructor(players: PlayerInfo[], seed: number) {
    this.rng = new Rng(seed);
    const n = Math.max(4, players.length);
    const r = APOTHEM / Math.cos(Math.PI / n);
    const a0 = Math.PI / 2 - Math.PI / n; // side 0 is the flat bottom
    const sides: Side[] = [];
    for (let i = 0; i < n; i++) {
      const a = a0 + (i * Math.PI * 2) / n;
      const b = a0 + ((i + 1) * Math.PI * 2) / n;
      const ax = CX + Math.cos(a) * r;
      const ay = CY + Math.sin(a) * r;
      const bx = CX + Math.cos(b) * r;
      const by = CY + Math.sin(b) * r;
      const mid = (a + b) / 2;
      sides.push({ ax, ay, bx, by, nx: -Math.cos(mid), ny: -Math.sin(mid), len: Math.hypot(bx - ax, by - ay), owner: i < players.length ? players[i].id : -1 });
    }
    this.state = {
      sides,
      paddlers: players.map((p, i) => ({ id: p.id, character: p.character, side: i, u: 0, status: 'alive', ghost: 0, smashT: 0, smashCd: 0, flash: 0 })),
      balls: [],
      paddleLen: Math.min(46, sides[0].len * 0.3),
      time: 0,
    };
    this.state.balls.push(this.newBall());
  }

  private newBall(): Ball {
    return { x: CX, y: CY, vx: 0, vy: 0, serve: SERVE_TIME, lastHit: -1 };
  }

  /** Serve toward a random living side, a bit off-center. */
  private serve(b: Ball): void {
    const st = this.state;
    const live = st.paddlers.filter((p) => this.guarded(p));
    const side = live.length ? st.sides[this.rng.pick(live).side] : this.rng.pick(st.sides);
    const a = Math.atan2(-side.ny, -side.nx) + this.rng.range(-0.45, 0.45);
    b.vx = Math.cos(a) * BALL_START;
    b.vy = Math.sin(a) * BALL_START;
  }

  /** Is this paddler's side a goal right now (as opposed to a wall)? */
  private guarded(p: Paddler): boolean {
    return p.status === 'alive' && p.ghost <= 0;
  }

  /** Half-range the paddle center can move along its side (in u units). */
  private uMax(): number {
    const st = this.state;
    return 1 - st.paddleLen / st.sides[0].len;
  }

  update(dt: number, inputs: Map<PlayerId, TickInput>, heat: number): void {
    const st = this.state;
    st.time += dt;
    const want = 1 + (st.time > 4 ? 1 : 0) + (heat > 0.5 ? 1 : 0);
    if (st.balls.length < want) st.balls.push(this.newBall());

    const umax = this.uMax();
    const halfLen = st.sides[0].len / 2;
    for (const p of st.paddlers) {
      p.flash = Math.max(0, p.flash - dt);
      if (p.status !== 'alive') continue;
      p.ghost = Math.max(0, p.ghost - dt);
      p.smashT = Math.max(0, p.smashT - dt);
      p.smashCd = Math.max(0, p.smashCd - dt);
      const inp = inputs.get(p.id);
      // The renderer turns the arena so your side is at the bottom, where a -> b runs
      // right-to-left: D (going right) lowers u.
      const dx = inp?.dx ?? 0;
      p.u = Math.max(-umax, Math.min(umax, p.u - (dx * PADDLE_SPEED * dt) / halfLen));
      if (inp?.pressed && p.smashCd <= 0) {
        p.smashT = SMASH_TIME;
        p.smashCd = SMASH_CD;
        this.events.push({ type: 'sfx', name: 'whoosh' });
      }
    }

    const maxV = Math.min(BALL_MAX, 200 + st.time * 2 + heat * 60);
    for (const b of st.balls) {
      if (b.serve > 0) {
        b.serve -= dt;
        if (b.serve <= 0) this.serve(b);
        continue;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      for (let i = 0; i < st.sides.length; i++) {
        const s = st.sides[i];
        const d = (b.x - s.ax) * s.nx + (b.y - s.ay) * s.ny;
        const vn = b.vx * s.nx + b.vy * s.ny;
        if (d > BALL_R + 3 || vn >= 0) continue;
        const p = st.paddlers.find((q) => q.side === i);
        const tx = (s.bx - s.ax) / s.len;
        const ty = (s.by - s.ay) / s.len;
        const along = (b.x - s.ax) * tx + (b.y - s.ay) * ty; // 0..len
        if (p && this.guarded(p)) {
          const center = s.len / 2 + (p.u * s.len) / 2;
          const off = (along - center) / (st.paddleLen / 2 + BALL_R);
          if (Math.abs(off) <= 1) {
            // Pong bounce: the further from the center, the steeper the angle.
            let speed = Math.min(maxV, Math.hypot(b.vx, b.vy) * BALL_ACCEL);
            if (p.smashT > 0) speed = Math.min(maxV * 1.15, speed * SMASH_MULT);
            const ang = off * 1.0;
            const ox = s.nx * Math.cos(ang) + tx * Math.sin(ang);
            const oy = s.ny * Math.cos(ang) + ty * Math.sin(ang);
            b.vx = ox * speed;
            b.vy = oy * speed;
            b.lastHit = p.id;
            this.pushOut(b, s);
            this.events.push({ type: 'sfx', name: p.smashT > 0 ? 'cannon' : 'blip' });
            continue;
          }
          if (d > -BALL_R) continue; // let it cross the line before it counts
          // Goal!
          p.status = 'dead';
          p.flash = 0.6;
          this.events.push({ type: 'death', player: p.id }, { type: 'sfx', name: 'explosion' });
          Object.assign(b, this.newBall());
          break;
        }
        // Wall.
        b.vx -= 2 * vn * s.nx;
        b.vy -= 2 * vn * s.ny;
        this.pushOut(b, s);
        this.events.push({ type: 'sfx', name: 'bump' });
      }
      // Never leave the arena (corners).
      if (Math.hypot(b.x - CX, b.y - CY) > APOTHEM / Math.cos(Math.PI / st.sides.length)) Object.assign(b, this.newBall());
    }
  }

  private pushOut(b: Ball, s: Side): void {
    const d = (b.x - s.ax) * s.nx + (b.y - s.ay) * s.ny;
    if (d < BALL_R + 3) {
      b.x += (BALL_R + 3 - d) * s.nx;
      b.y += (BALL_R + 3 - d) * s.ny;
    }
  }

  onSuspend(): void {}

  onResume(): void {
    for (const p of this.state.paddlers) {
      if (p.status !== 'dead') continue;
      p.status = 'alive';
      p.ghost = GHOST_TIME;
      p.u = 0;
    }
  }

  removePlayer(id: PlayerId): void {
    const p = this.state.paddlers.find((p) => p.id === id);
    if (p) {
      p.status = 'out';
      this.state.sides[p.side].owner = -1;
    }
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
    const p = st.paddlers.find((p) => p.id === id);
    if (!p || p.status !== 'alive') return NEUTRAL_INPUT;
    const s = st.sides[p.side];
    const tx = (s.bx - s.ax) / s.len;
    const ty = (s.by - s.ay) / s.len;
    // Earliest ball coming at my side: where along the side will it arrive?
    let best: { t: number; along: number; key: string } | null = null;
    st.balls.forEach((b, k) => {
      if (b.serve > 0) return;
      const vn = b.vx * s.nx + b.vy * s.ny;
      if (vn >= 0) return;
      const d = (b.x - s.ax) * s.nx + (b.y - s.ay) * s.ny - BALL_R - 3;
      const t = d / -vn;
      const along = (b.x + b.vx * t - s.ax) * tx + (b.y + b.vy * t - s.ay) * ty;
      if (along < -10 || along > s.len + 10) return;
      if (!best || t < best.t) best = { t, along, key: `${k}:${Math.round(b.vx)}:${Math.round(b.vy)}` };
    });
    let mem = this.botMem.get(id);
    if (!mem) {
      mem = { ballKey: '', aim: 0 };
      this.botMem.set(id, mem);
    }
    let target = 0;
    let action = false;
    const b0 = best as { t: number; along: number; key: string } | null;
    if (b0 && b0.t < 2.2) {
      if (b0.key !== mem.ballKey) {
        mem.ballKey = b0.key;
        mem.aim = this.rng.range(-1, 1) * BOT_ERR[difficulty] * (st.paddleLen / 2 + BALL_R);
      }
      // Reacts late: wanders until the ball is close enough.
      if (b0.t < 1.6 - BOT_LAG[difficulty] * 2) target = ((b0.along + mem.aim) / s.len) * 2 - 1;
      action = difficulty !== 'easy' && b0.t < 0.12 && this.rng.next() < 0.25;
    }
    const diff = target - p.u;
    if (Math.abs(diff) < 0.04) return { dx: 0, dy: 0, action };
    // Moving +u needs dx = -1 (see update).
    return { dx: diff > 0 ? -1 : 1, dy: 0, action };
  }
}

export const PongDoCancelamentoDef: MinigameDef = {
  id: 'paddle',
  name: 'PONG DO CANCELAMENTO',
  handle: '@pong.do.cancelamento',
  hint: 'A/D DEFENDE SEU LADO  ESPAÇO CORTADA',
  create: (players, seed) => new PongDoCancelamento(players, seed),
};
