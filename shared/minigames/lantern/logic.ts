import type { Minigame, MinigameDef } from '../../minigame';
import { Rng } from '../../rng';
import type { BotDifficulty, GameEvent, PlayerId, PlayerInfo, PlayerInput, TickInput } from '../../types';
import { NEUTRAL_INPUT } from '../../types';

/** Room interior in arena coordinates. */
export const ROOM = { x: 10, y: 10, w: 364, h: 184 };
/** Furniture blocks players (ghosts float through it). [x, y, w, h] */
export const FURNITURE: ReadonlyArray<readonly [number, number, number, number]> = [
  [60, 40, 44, 18],
  [280, 40, 44, 18],
  [166, 88, 52, 26],
  [56, 140, 26, 32],
  [296, 138, 40, 22],
];

export const PLAYER_R = 4;
const SPEED = 58;
export const LIGHT_LEN = 72;
export const LIGHT_HALF = 0.42; // half-angle of the flashlight cone (radians)
export const GLOW_R = 13; // tiny always-on glow around each player
const DRAIN = 0.26; // battery per second while on
const RECHARGE = 0.15;
const MIN_TO_TURN_ON = 0.15;

const GHOST_HP = 1.1; // seconds of light to banish
const GHOST_PUSH = 36;
const GHOST_KILL_R = 7;
const GHOST_RESPAWN = 1.5;
const GHOST_SPAWN_GAP = 90;
const GHOST_TIME = 1.2;
export const DEATH_ANIM = 0.7;
const TIME_CAP = 50;

export interface LPlayer {
  id: PlayerId;
  character: number;
  x: number;
  y: number;
  fx: number; // flashlight direction (unit)
  fy: number;
  light: boolean;
  battery: number;
  status: 'alive' | 'dead' | 'out';
  ghost: number; // post-respawn invulnerability
  deathAnim: number;
  walk: number;
}

export interface Ghost {
  id: number;
  x: number;
  y: number;
  hp: number;
  respawn: number; // > 0: banished, waiting to come back
  lit: boolean;
}

export interface LanternState {
  players: LPlayer[];
  ghosts: Ghost[];
  time: number;
  nextId: number;
}

/** True if (x, y) is inside the player's light (cone or personal glow). */
export function inLight(p: LPlayer, x: number, y: number): boolean {
  const dx = x - p.x;
  const dy = y - p.y;
  const d = Math.hypot(dx, dy);
  if (d < GLOW_R) return true;
  if (!p.light || p.status !== 'alive' || d > LIGHT_LEN) return false;
  return (dx * p.fx + dy * p.fy) / d > Math.cos(LIGHT_HALF);
}

interface BotMemory {
  timer: number;
  input: PlayerInput;
  tx: number;
  ty: number;
  tt: number;
}

const BOT_CADENCE: Record<BotDifficulty, number> = { easy: 0.25, medium: 0.12, hard: 0.05 };
const BOT_REACT: Record<BotDifficulty, number> = { easy: 45, medium: 70, hard: 95 };

class LanternFeed implements Minigame<LanternState> {
  readonly defId = 'lantern';
  readonly state: LanternState;
  private events: GameEvent[] = [];
  private rng: Rng;
  private botMem = new Map<PlayerId, BotMemory>();

  constructor(players: PlayerInfo[], seed: number) {
    this.rng = new Rng(seed);
    const cx = ROOM.x + ROOM.w / 2;
    const cy = ROOM.y + ROOM.h / 2;
    this.state = {
      players: players.map((p, i) => {
        const a = (i / players.length) * Math.PI * 2;
        const x = cx + Math.cos(a) * 34;
        const y = cy + Math.sin(a) * 34 + 30;
        return { id: p.id, character: p.character, x, y, fx: Math.cos(a), fy: Math.sin(a), light: true, battery: 1, status: 'alive', ghost: 0, deathAnim: 0, walk: 0 };
      }),
      ghosts: [],
      time: 0,
      nextId: 1,
    };
    for (let k = 0; k < 4; k++) this.state.ghosts.push(this.spawnGhost());
  }

  private blocked(x: number, y: number): boolean {
    if (x < ROOM.x + PLAYER_R || y < ROOM.y + PLAYER_R || x > ROOM.x + ROOM.w - PLAYER_R || y > ROOM.y + ROOM.h - PLAYER_R) return true;
    return FURNITURE.some(([fx, fy, fw, fh]) => x > fx - PLAYER_R && x < fx + fw + PLAYER_R && y > fy - PLAYER_R && y < fy + fh + PLAYER_R);
  }

  private spawnGhost(): Ghost {
    const alive = this.state.players.filter((p) => p.status === 'alive');
    let best = { x: ROOM.x + 8, y: ROOM.y + 8, d: -1 };
    for (let k = 0; k < 20; k++) {
      // somewhere along the walls
      const side = this.rng.int(4);
      const t = this.rng.next();
      const x = side < 2 ? ROOM.x + t * ROOM.w : side === 2 ? ROOM.x + 6 : ROOM.x + ROOM.w - 6;
      const y = side >= 2 ? ROOM.y + t * ROOM.h : side === 0 ? ROOM.y + 6 : ROOM.y + ROOM.h - 6;
      const d = Math.min(...alive.map((p) => Math.hypot(p.x - x, p.y - y)), 999);
      if (d > best.d) best = { x, y, d };
      if (d > GHOST_SPAWN_GAP) break;
    }
    return { id: this.state.nextId++, x: best.x, y: best.y, hp: GHOST_HP, respawn: 0, lit: false };
  }

  update(dt: number, inputs: Map<PlayerId, TickInput>, heat: number): void {
    const st = this.state;
    st.time += dt;

    for (const p of st.players) {
      if (p.status === 'dead') p.deathAnim = Math.max(0, p.deathAnim - dt);
      if (p.status !== 'alive') continue;
      p.ghost = Math.max(0, p.ghost - dt);
      const inp = inputs.get(p.id);
      if (inp?.pressed) {
        if (p.light) p.light = false;
        else if (p.battery >= MIN_TO_TURN_ON) p.light = true;
        this.events.push({ type: 'sfx', name: 'click' });
      }
      if (p.light) {
        p.battery = Math.max(0, p.battery - DRAIN * dt);
        if (p.battery <= 0) p.light = false;
      } else {
        p.battery = Math.min(1, p.battery + RECHARGE * dt);
      }
      let mx = inp?.dx ?? 0;
      let my = inp?.dy ?? 0;
      const len = Math.hypot(mx, my);
      if (len > 0) {
        mx /= len;
        my /= len;
        p.fx = mx;
        p.fy = my;
        p.walk += dt;
        const nx = p.x + mx * SPEED * dt;
        const ny = p.y + my * SPEED * dt;
        if (!this.blocked(nx, p.y)) p.x = nx;
        if (!this.blocked(p.x, ny)) p.y = ny;
      } else {
        p.walk = 0;
      }
    }

    const wanted = 4 + Math.floor(heat * 3);
    while (st.ghosts.length < wanted) st.ghosts.push(this.spawnGhost());

    const gSpeed = 36 + 16 * heat;
    for (const g of st.ghosts) {
      if (g.respawn > 0) {
        g.respawn -= dt;
        if (g.respawn <= 0) Object.assign(g, this.spawnGhost(), { id: g.id });
        continue;
      }
      const lighters = st.players.filter((p) => p.status === 'alive' && p.light && inLight(p, g.x, g.y));
      g.lit = lighters.length > 0;
      if (g.lit) {
        // Light pushes the ghost away and burns it.
        const src = lighters[0];
        const dx = g.x - src.x;
        const dy = g.y - src.y;
        const d = Math.hypot(dx, dy) || 1;
        g.x += (dx / d) * GHOST_PUSH * dt;
        g.y += (dy / d) * GHOST_PUSH * dt;
        g.hp -= dt * lighters.length;
        if (g.hp <= 0) {
          g.respawn = GHOST_RESPAWN;
          this.events.push({ type: 'sfx', name: 'poof' });
        }
        continue;
      }
      g.hp = Math.min(GHOST_HP, g.hp + dt * 0.3);
      const targets = st.players.filter((p) => p.status === 'alive' && p.ghost <= 0);
      if (targets.length === 0) continue;
      const t = targets.reduce((a, b) => (Math.hypot(a.x - g.x, a.y - g.y) < Math.hypot(b.x - g.x, b.y - g.y) ? a : b));
      const dx = t.x - g.x;
      const dy = t.y - g.y;
      const d = Math.hypot(dx, dy) || 1;
      g.x += (dx / d) * gSpeed * dt;
      g.y += (dy / d) * gSpeed * dt;
      if (d < GHOST_KILL_R) {
        t.status = 'dead';
        t.deathAnim = DEATH_ANIM;
        this.events.push({ type: 'death', player: t.id }, { type: 'sfx', name: 'scream' });
        g.respawn = GHOST_RESPAWN;
      }
    }

    // Keep ghosts from stacking into one blob.
    const live = st.ghosts.filter((g) => g.respawn <= 0);
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i];
        const b = live[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d > 0 && d < 12) {
          const push = (12 - d) / 2;
          a.x -= (dx / d) * push;
          a.y -= (dy / d) * push;
          b.x += (dx / d) * push;
          b.y += (dy / d) * push;
        }
      }
    }
  }

  onSuspend(): void {}

  onResume(): void {
    const st = this.state;
    for (const p of st.players) {
      if (p.status !== 'dead') continue;
      let best = { x: ROOM.x + ROOM.w / 2, y: ROOM.y + ROOM.h / 2, d: -1 };
      for (let k = 0; k < 40; k++) {
        const x = this.rng.range(ROOM.x + 20, ROOM.x + ROOM.w - 20);
        const y = this.rng.range(ROOM.y + 20, ROOM.y + ROOM.h - 20);
        if (this.blocked(x, y)) continue;
        const d = Math.min(...st.ghosts.filter((g) => g.respawn <= 0).map((g) => Math.hypot(g.x - x, g.y - y)), 999);
        if (d > best.d) best = { x, y, d };
      }
      p.x = best.x;
      p.y = best.y;
      p.status = 'alive';
      p.ghost = GHOST_TIME;
      p.deathAnim = 0;
      p.light = true;
      p.battery = Math.max(p.battery, 0.5);
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
      mem = { timer: 0, input: NEUTRAL_INPUT, tx: p.x, ty: p.y, tt: 0 };
      this.botMem.set(id, mem);
    }
    mem.timer -= 1 / 60;
    mem.tt -= 1 / 60;
    if (mem.timer > 0) return { ...mem.input, action: false };
    mem.timer = BOT_CADENCE[difficulty];

    const ghosts = st.ghosts.filter((g) => g.respawn <= 0);
    const near = ghosts.length
      ? ghosts.reduce((a, b) => (Math.hypot(a.x - p.x, a.y - p.y) < Math.hypot(b.x - p.x, b.y - p.y) ? a : b))
      : null;
    const dist = near ? Math.hypot(near.x - p.x, near.y - p.y) : Infinity;

    let gx = 0;
    let gy = 0;
    let wantLight = p.battery > 0.6 || (p.light && p.battery > 0.05);
    if (near && dist < BOT_REACT[difficulty]) {
      const canShine = p.light || p.battery >= MIN_TO_TURN_ON;
      wantLight = canShine;
      // Face it (moving toward it) while it's not too close; otherwise run.
      const toward = canShine && dist > 20 ? 1 : -1;
      gx = (near.x - p.x) * toward;
      gy = (near.y - p.y) * toward;
    } else {
      if (mem.tt <= 0 || Math.hypot(mem.tx - p.x, mem.ty - p.y) < 8) {
        mem.tt = this.rng.range(1.5, 3);
        mem.tx = this.rng.range(ROOM.x + 30, ROOM.x + ROOM.w - 30);
        mem.ty = this.rng.range(ROOM.y + 25, ROOM.y + ROOM.h - 25);
      }
      gx = mem.tx - p.x;
      gy = mem.ty - p.y;
      if (p.battery < 0.35) wantLight = false;
    }
    const q = (v: number, other: number) => (Math.abs(v) > Math.abs(other) * 0.4 && Math.abs(v) > 2 ? (Math.sign(v) as -1 | 1) : 0);
    mem.input = { dx: q(gx, gy), dy: q(gy, gx), action: wantLight !== p.light };
    return mem.input;
  }
}

export const LanternFeedDef: MinigameDef = {
  id: 'lantern',
  name: 'LANTERNA FEED',
  handle: '@lanterna.feed',
  hint: 'WASD ANDAR/MIRAR  ESPAÇO LIGA/DESLIGA',
  create: (players, seed) => new LanternFeed(players, seed),
};
