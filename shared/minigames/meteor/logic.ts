import type { Minigame, MinigameDef } from '../../minigame';
import { Rng } from '../../rng';
import type { BotDifficulty, GameEvent, PlayerId, PlayerInfo, PlayerInput, TickInput } from '../../types';
import { NEUTRAL_INPUT } from '../../types';

/** Walkable rectangle in arena coordinates. */
export const FIELD = { x: 20, y: 10, w: 344, h: 184 };

export const PLAYER_R = 5;
const SPEED = 72;
const DASH_SPEED = 210;
const DASH_TIME = 0.14;
const DASH_COOLDOWN = 1.4;
const KNOCKBACK = 170;
export const CRATER_TIME = 2.2;
const GHOST_TIME = 1.2;
export const DEATH_ANIM = 0.6;
const TIME_CAP = 50;

export interface Meteor {
  id: number;
  x: number;
  y: number;
  r: number;
  t: number; // seconds until impact
  warn: number; // total warning time (for the growing shadow)
}

export interface Crater {
  x: number;
  y: number;
  r: number;
  t: number; // remaining burn time
}

export interface MPlayer {
  id: PlayerId;
  character: number;
  x: number;
  y: number;
  vx: number; // knockback velocity
  vy: number;
  fx: number; // facing / last move direction
  fy: number;
  status: 'alive' | 'dead' | 'out';
  ghost: number;
  deathAnim: number;
  dashT: number;
  dashCd: number;
  walk: number;
}

export interface MeteorState {
  players: MPlayer[];
  meteors: Meteor[];
  craters: Crater[];
  time: number;
  spawnTimer: number;
  nextId: number;
}

interface BotMemory {
  timer: number;
  input: PlayerInput;
  wanderX: number;
  wanderY: number;
  wanderT: number;
}

const BOT_CADENCE: Record<BotDifficulty, number> = { easy: 0.3, medium: 0.16, hard: 0.08 };
const BOT_MARGIN: Record<BotDifficulty, number> = { easy: -2, medium: 1, hard: 4 };
const BOT_LOOK: Record<BotDifficulty, number> = { easy: 0.25, medium: 0.35, hard: 0.4 };

const DIRS8: ReadonlyArray<readonly [number, number]> = [
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

class MeteorFeed implements Minigame<MeteorState> {
  readonly defId = 'meteor';
  readonly state: MeteorState;
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
          vx: 0,
          vy: 0,
          fx: 1,
          fy: 0,
          status: 'alive',
          ghost: 0,
          deathAnim: 0,
          dashT: 0,
          dashCd: 0,
          walk: 0,
        };
      }),
      meteors: [],
      craters: [],
      time: 0,
      spawnTimer: 0.8,
      nextId: 1,
    };
  }

  update(dt: number, inputs: Map<PlayerId, TickInput>, heat: number): void {
    const st = this.state;
    st.time += dt;

    st.spawnTimer -= dt;
    if (st.spawnTimer <= 0) {
      st.spawnTimer = 0.3 - 0.14 * heat;
      this.spawnMeteor(heat);
    }

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
      p.x += (vx + p.vx) * dt;
      p.y += (vy + p.vy) * dt;
      const decay = Math.exp(-7 * dt);
      p.vx *= decay;
      p.vy *= decay;
      p.x = Math.max(FIELD.x + PLAYER_R, Math.min(FIELD.x + FIELD.w - PLAYER_R, p.x));
      p.y = Math.max(FIELD.y + PLAYER_R, Math.min(FIELD.y + FIELD.h - PLAYER_R, p.y));
    }

    this.collidePlayers();

    for (const m of st.meteors) m.t -= dt;
    const landed = st.meteors.filter((m) => m.t <= 0);
    if (landed.length) {
      st.meteors = st.meteors.filter((m) => m.t > 0);
      this.events.push({ type: 'sfx', name: 'explosion' });
      for (const m of landed) {
        st.craters.push({ x: m.x, y: m.y, r: m.r * 0.8, t: CRATER_TIME });
        for (const p of st.players) {
          if (Math.hypot(p.x - m.x, p.y - m.y) < m.r + PLAYER_R * 0.5) this.kill(p);
        }
      }
    }

    for (const c of st.craters) c.t -= dt;
    st.craters = st.craters.filter((c) => c.t > 0);
    for (const p of st.players) {
      if (st.craters.some((c) => Math.hypot(p.x - c.x, p.y - c.y) < c.r)) this.kill(p);
    }
  }

  private spawnMeteor(heat: number): void {
    const st = this.state;
    // Mostly small rocks, with the occasional giant one that forces a sprint.
    const r = this.rng.next() < 0.1 ? this.rng.range(30, 40) : this.rng.range(10, 20);
    let x = this.rng.range(FIELD.x + r, FIELD.x + FIELD.w - r);
    let y = this.rng.range(FIELD.y + r, FIELD.y + FIELD.h - r);
    const alive = st.players.filter((p) => p.status === 'alive');
    if (alive.length && this.rng.next() < 0.55) {
      const p = this.rng.pick(alive);
      x = Math.max(FIELD.x + r, Math.min(FIELD.x + FIELD.w - r, p.x + this.rng.range(-18, 18)));
      y = Math.max(FIELD.y + r, Math.min(FIELD.y + FIELD.h - r, p.y + this.rng.range(-18, 18)));
    }
    const warn = this.rng.range(1.2, 1.8) - 0.35 * heat + (r > 28 ? 0.5 : 0);
    st.meteors.push({ id: st.nextId++, x, y, r, t: warn, warn });
  }

  private collidePlayers(): void {
    const ps = this.state.players.filter((p) => p.status === 'alive' && p.ghost <= 0);
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i];
        const b = ps[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d === 0 || d >= PLAYER_R * 2) continue;
        const nx = dx / d;
        const ny = dy / d;
        const push = (PLAYER_R * 2 - d) / 2;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
        // A dash shoves whoever it hits.
        if (a.dashT > 0 && b.dashT <= 0) {
          b.vx += nx * KNOCKBACK;
          b.vy += ny * KNOCKBACK;
          this.events.push({ type: 'sfx', name: 'bump' });
        } else if (b.dashT > 0 && a.dashT <= 0) {
          a.vx -= nx * KNOCKBACK;
          a.vy -= ny * KNOCKBACK;
          this.events.push({ type: 'sfx', name: 'bump' });
        }
      }
    }
  }

  private kill(p: MPlayer): void {
    if (p.status !== 'alive' || p.ghost > 0) return;
    p.status = 'dead';
    p.deathAnim = DEATH_ANIM;
    this.events.push({ type: 'death', player: p.id }, { type: 'sfx', name: 'die' });
  }

  private dangerAt(x: number, y: number, horizon: number, margin: number): number {
    let d = 0;
    for (const m of this.state.meteors) {
      if (m.t > horizon + 0.9) continue;
      if (Math.hypot(x - m.x, y - m.y) < m.r + PLAYER_R + margin) d += 100 + (2 - m.t) * 50;
    }
    for (const c of this.state.craters) {
      if (Math.hypot(x - c.x, y - c.y) < c.r + PLAYER_R + margin) d += 300;
    }
    return d;
  }

  onSuspend(): void {}

  onResume(): void {
    const cx = FIELD.x + FIELD.w / 2;
    const cy = FIELD.y + FIELD.h / 2;
    for (const p of this.state.players) {
      if (p.status !== 'dead') continue;
      let best = { x: cx, y: cy, d: Infinity };
      for (let k = 0; k < 40; k++) {
        const x = cx + this.rng.range(-120, 120);
        const y = cy + this.rng.range(-60, 60);
        const d = this.dangerAt(x, y, 3, 8) + Math.hypot(x - cx, y - cy) * 0.1;
        if (d < best.d) best = { x, y, d };
      }
      p.x = best.x;
      p.y = best.y;
      p.vx = 0;
      p.vy = 0;
      p.dashT = 0;
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
    const p = this.state.players.find((p) => p.id === id);
    if (!p || p.status !== 'alive') return NEUTRAL_INPUT;
    let mem = this.botMem.get(id);
    if (!mem) {
      mem = { timer: 0, input: NEUTRAL_INPUT, wanderX: p.x, wanderY: p.y, wanderT: 0 };
      this.botMem.set(id, mem);
    }
    mem.timer -= 1 / 60;
    mem.wanderT -= 1 / 60;
    if (mem.timer > 0) return { ...mem.input, action: false };
    mem.timer = BOT_CADENCE[difficulty];
    if (mem.wanderT <= 0) {
      mem.wanderT = this.rng.range(1.5, 3);
      mem.wanderX = this.rng.range(FIELD.x + 40, FIELD.x + FIELD.w - 40);
      mem.wanderY = this.rng.range(FIELD.y + 30, FIELD.y + FIELD.h - 30);
    }

    const look = BOT_LOOK[difficulty];
    const margin = BOT_MARGIN[difficulty];
    let best: { dx: number; dy: number; score: number } = { dx: 0, dy: 0, score: Infinity };
    for (const [dx, dy] of DIRS8) {
      const len = Math.hypot(dx, dy) || 1;
      const x = Math.max(FIELD.x + PLAYER_R, Math.min(FIELD.x + FIELD.w - PLAYER_R, p.x + (dx / len) * SPEED * look));
      const y = Math.max(FIELD.y + PLAYER_R, Math.min(FIELD.y + FIELD.h - PLAYER_R, p.y + (dy / len) * SPEED * look));
      const mid = this.dangerAt((p.x + x) / 2, (p.y + y) / 2, look / 2, margin);
      const score = this.dangerAt(x, y, look, margin) + mid * 0.5 + Math.hypot(x - mem.wanderX, y - mem.wanderY) * 0.05;
      if (score < best.score) best = { dx, dy, score };
    }

    const hereDanger = this.state.meteors.some((m) => m.t < 0.35 && Math.hypot(p.x - m.x, p.y - m.y) < m.r + PLAYER_R);
    const dash = difficulty !== 'easy' && hereDanger && p.dashCd <= 0 && (best.dx !== 0 || best.dy !== 0);
    mem.input = { dx: best.dx as -1 | 0 | 1, dy: best.dy as -1 | 0 | 1, action: dash };
    return mem.input;
  }
}

export const MeteorFeedDef: MinigameDef = {
  id: 'meteor',
  name: 'METEOR FEED',
  handle: '@meteor.feed',
  hint: 'WASD FUGIR  ESPAÇO DASH (EMPURRA)',
  create: (players, seed) => new MeteorFeed(players, seed),
};
