import type { Minigame, MinigameDef } from '../../minigame';
import { Rng } from '../../rng';
import type { BotDifficulty, GameEvent, PlayerId, PlayerInfo, PlayerInput, TickInput } from '../../types';
import { NEUTRAL_INPUT } from '../../types';

/**
 * Pushy-penguins style: everyone slides on an ice floe while lines of penguins cross it,
 * shoving whoever is in the way into the water. Space shoves other players.
 */

export const FLOE = { x: 60, y: 22, w: 264, h: 166 };
export const PLAYER_R = 5;
export const PENGUIN_R = 6;
const ACCEL = 170;
const FRICTION = 0.9; // low: it's ice
const MAX_SPEED = 95;
const SHOVE_IMPULSE = 120;
export const SHOVE_COOLDOWN = 1.4;
const SHOVE_TIME = 0.2;
const PENGUIN_PUSH = 1.35; // players get launched a bit faster than the penguin
export const FALL_TIME = 0.6;
const GHOST_TIME = 1.2;
const TIME_CAP = 50;

export interface Skater {
  id: PlayerId;
  character: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  shove: number;
  shoveCd: number;
  status: 'alive' | 'falling' | 'dead' | 'out';
  fall: number;
  ghost: number;
}

export interface Penguin {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface PenguinState {
  skaters: Skater[];
  penguins: Penguin[];
  waveTimer: number;
  time: number;
  nextId: number;
}

export function onFloe(x: number, y: number): boolean {
  return x > FLOE.x && x < FLOE.x + FLOE.w && y > FLOE.y && y < FLOE.y + FLOE.h;
}

interface BotMemory {
  timer: number;
  input: PlayerInput;
}

const BOT_CADENCE: Record<BotDifficulty, number> = { easy: 0.2, medium: 0.1, hard: 0.05 };
const BOT_LOOK: Record<BotDifficulty, number> = { easy: 0.35, medium: 0.5, hard: 0.6 };
const BOT_EDGE: Record<BotDifficulty, number> = { easy: 12, medium: 20, hard: 26 };
const BOT_SHOVE: Record<BotDifficulty, number> = { easy: 0, medium: 0.08, hard: 0.18 };

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

class Cancelamento implements Minigame<PenguinState> {
  readonly defId = 'penguin';
  readonly state: PenguinState;
  private events: GameEvent[] = [];
  private rng: Rng;
  private botMem = new Map<PlayerId, BotMemory>();
  private lastBump = -1;

  constructor(players: PlayerInfo[], seed: number) {
    this.rng = new Rng(seed);
    const cx = FLOE.x + FLOE.w / 2;
    const cy = FLOE.y + FLOE.h / 2;
    this.state = {
      skaters: players.map((p, i) => {
        const a = (i / players.length) * Math.PI * 2;
        return {
          id: p.id,
          character: p.character,
          x: cx + Math.cos(a) * 60,
          y: cy + Math.sin(a) * 40,
          vx: 0,
          vy: 0,
          facing: 1,
          shove: 0,
          shoveCd: 0,
          status: 'alive',
          fall: 0,
          ghost: 0,
        };
      }),
      penguins: [],
      waveTimer: 1.2,
      time: 0,
      nextId: 1,
    };
  }

  /** A wave: a line, a column, a V, or one very fast penguin, entering from one side. */
  private spawnWave(heat: number): void {
    const st = this.state;
    const side = this.rng.int(4); // 0 from left, 1 from right, 2 from top, 3 from bottom
    const horiz = side < 2;
    const dir = side === 0 || side === 2 ? 1 : -1;
    const ramp = Math.min(1, st.time / 40);
    let speed = this.rng.range(55, 75) + 25 * heat + 15 * ramp;
    const kind = this.rng.next();
    const spots: Array<[number, number]> = []; // [along, behind]: along = position across the floe
    const span = horiz ? FLOE.h : FLOE.w;
    if (kind < 0.12) {
      speed *= 1.8;
      spots.push([this.rng.range(15, span - 15), 0]);
    } else if (kind < 0.45) {
      // Wall: a row with one or two gaps.
      const n = 6 + this.rng.int(3);
      const gap = this.rng.int(n);
      for (let k = 0; k < n; k++) if (k !== gap && (n < 8 || k !== (gap + 3) % n)) spots.push([((k + 0.5) * span) / n, 0]);
    } else if (kind < 0.75) {
      // Column: a train of penguins on one line.
      const at = this.rng.range(20, span - 20);
      const n = 3 + this.rng.int(4);
      for (let k = 0; k < n; k++) spots.push([at, k * 18]);
    } else {
      // V formation.
      const at = this.rng.range(40, span - 40);
      spots.push([at, 0]);
      for (let k = 1; k <= 3; k++) {
        spots.push([at - k * 14, k * 12]);
        spots.push([at + k * 14, k * 12]);
      }
    }
    for (const [along, behind] of spots) {
      const start = (dir > 0 ? -10 : 10) - dir * behind;
      const x = horiz ? (dir > 0 ? FLOE.x : FLOE.x + FLOE.w) + start : FLOE.x + along;
      const y = horiz ? FLOE.y + along : (dir > 0 ? FLOE.y : FLOE.y + FLOE.h) + start;
      st.penguins.push({ id: st.nextId++, x, y, vx: horiz ? dir * speed : 0, vy: horiz ? 0 : dir * speed });
    }
    this.events.push({ type: 'sfx', name: 'penguins' });
  }

  update(dt: number, inputs: Map<PlayerId, TickInput>, heat: number): void {
    const st = this.state;
    st.time += dt;
    const ramp = Math.min(1, st.time / 40);

    st.waveTimer -= dt;
    if (st.waveTimer <= 0) {
      st.waveTimer = this.rng.range(2.3, 2.9) - 0.8 * ramp - 0.6 * heat;
      this.spawnWave(heat);
    }
    for (const p of st.penguins) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    st.penguins = st.penguins.filter((p) => p.x > FLOE.x - 80 && p.x < FLOE.x + FLOE.w + 80 && p.y > FLOE.y - 80 && p.y < FLOE.y + FLOE.h + 80);

    for (const s of st.skaters) {
      if (s.status === 'falling') {
        s.fall -= dt;
        s.x += s.vx * dt * 0.4;
        s.y += s.vy * dt * 0.4;
        if (s.fall <= 0) s.status = 'dead';
        continue;
      }
      if (s.status !== 'alive') continue;
      s.ghost = Math.max(0, s.ghost - dt);
      s.shove = Math.max(0, s.shove - dt);
      s.shoveCd = Math.max(0, s.shoveCd - dt);
      const inp = inputs.get(s.id);
      let ax = inp?.dx ?? 0;
      let ay = inp?.dy ?? 0;
      const len = Math.hypot(ax, ay);
      if (len > 0) {
        ax /= len;
        ay /= len;
        s.vx += ax * ACCEL * dt;
        s.vy += ay * ACCEL * dt;
        if (ax !== 0) s.facing = ax > 0 ? 1 : -1;
      }
      if (inp?.pressed && s.shoveCd <= 0) {
        let cx = ax;
        let cy = ay;
        if (len === 0) {
          cx = s.facing;
          cy = 0;
        }
        s.vx += cx * SHOVE_IMPULSE;
        s.vy += cy * SHOVE_IMPULSE;
        s.shove = SHOVE_TIME;
        s.shoveCd = SHOVE_COOLDOWN;
        this.events.push({ type: 'sfx', name: 'dash' });
      }
      const f = Math.exp(-FRICTION * dt);
      s.vx *= f;
      s.vy *= f;
      const sp = Math.hypot(s.vx, s.vy);
      const cap = s.shove > 0 ? MAX_SPEED * 2.2 : MAX_SPEED * 2; // being shoved can exceed walking speed
      if (sp > cap) {
        s.vx *= cap / sp;
        s.vy *= cap / sp;
      }
      if (len > 0 && sp > MAX_SPEED && s.shove <= 0) {
        // Skating alone never goes past MAX_SPEED (but momentum from hits fades slowly).
        s.vx *= Math.max(MAX_SPEED / sp, 0.985);
        s.vy *= Math.max(MAX_SPEED / sp, 0.985);
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }

    this.collide();

    for (const s of st.skaters) {
      if (s.status !== 'alive' || s.ghost > 0) continue;
      if (!onFloe(s.x, s.y)) {
        s.status = 'falling';
        s.fall = FALL_TIME;
        this.events.push({ type: 'death', player: s.id }, { type: 'sfx', name: 'splash' });
      }
    }
  }

  private collide(): void {
    const st = this.state;
    const live = st.skaters.filter((s) => s.status === 'alive' && s.ghost <= 0);
    // Penguins are unstoppable: they bulldoze skaters along their direction.
    for (const s of live) {
      for (const p of st.penguins) {
        const dx = s.x - p.x;
        const dy = s.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d === 0 || d >= PLAYER_R + PENGUIN_R) continue;
        const nx = dx / d;
        const ny = dy / d;
        s.x += nx * (PLAYER_R + PENGUIN_R - d);
        s.y += ny * (PLAYER_R + PENGUIN_R - d);
        const pv = Math.hypot(p.vx, p.vy) || 1;
        const ux = p.vx / pv;
        const uy = p.vy / pv;
        // Launch along the penguin's path (plus a little sideways from where we were hit).
        const along = s.vx * ux + s.vy * uy;
        const target = pv * PENGUIN_PUSH;
        if (along < target) {
          if (target - along > 40) this.bumpSfx(); // only real hits, not the carry
          s.vx += ux * (target - along) + nx * 20;
          s.vy += uy * (target - along) + ny * 20;
        }
      }
    }
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i];
        const b = live[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d === 0 || d >= PLAYER_R * 2) continue;
        const nx = dx / d;
        const ny = dy / d;
        const overlap = (PLAYER_R * 2 - d) / 2;
        a.x -= nx * overlap;
        a.y -= ny * overlap;
        b.x += nx * overlap;
        b.y += ny * overlap;
        const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (rel <= 0) continue;
        const aShare = b.shove > 0 && a.shove <= 0 ? 1.5 : a.shove > 0 && b.shove <= 0 ? 0.3 : 1;
        const bShare = a.shove > 0 && b.shove <= 0 ? 1.5 : b.shove > 0 && a.shove <= 0 ? 0.3 : 1;
        a.vx -= nx * rel * 0.9 * aShare;
        a.vy -= ny * rel * 0.9 * aShare;
        b.vx += nx * rel * 0.9 * bShare;
        b.vy += ny * rel * 0.9 * bShare;
        if (rel > 30) this.bumpSfx();
      }
    }
  }

  private bumpSfx(): void {
    if (this.state.time - this.lastBump < 0.12) return;
    this.lastBump = this.state.time;
    this.events.push({ type: 'sfx', name: 'bump' });
  }

  onSuspend(): void {}

  onResume(): void {
    const st = this.state;
    for (const s of st.skaters) {
      if (s.status !== 'falling' && s.status !== 'dead') continue;
      let best = { x: FLOE.x + FLOE.w / 2, y: FLOE.y + FLOE.h / 2, d: -1 };
      for (let k = 0; k < 30; k++) {
        const x = this.rng.range(FLOE.x + 50, FLOE.x + FLOE.w - 50);
        const y = this.rng.range(FLOE.y + 35, FLOE.y + FLOE.h - 35);
        const d = Math.min(...st.penguins.map((p) => Math.hypot(p.x - x, p.y - y)), 999);
        if (d > best.d) best = { x, y, d };
      }
      s.x = best.x;
      s.y = best.y;
      s.vx = 0;
      s.vy = 0;
      s.shove = 0;
      s.fall = 0;
      s.status = 'alive';
      s.ghost = GHOST_TIME;
    }
  }

  removePlayer(id: PlayerId): void {
    const s = this.state.skaters.find((s) => s.id === id);
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

  /** Penalty for being at (x, y) at time t from now. */
  private danger(x: number, y: number, t: number, edge: number): number {
    let d = 0;
    const m = Math.min(x - FLOE.x, FLOE.x + FLOE.w - x, y - FLOE.y, FLOE.y + FLOE.h - y);
    if (m < 0) d += 1000;
    else if (m < edge) d += (edge - m) * 8;
    for (const p of this.state.penguins) {
      const px = p.x + p.vx * t;
      const py = p.y + p.vy * t;
      const dist = Math.hypot(px - x, py - y);
      if (dist < 18) d += (18 - dist) * 12;
    }
    return d;
  }

  botInput(id: PlayerId, difficulty: BotDifficulty): PlayerInput {
    const st = this.state;
    const s = st.skaters.find((s) => s.id === id);
    if (!s || s.status !== 'alive') return NEUTRAL_INPUT;
    let mem = this.botMem.get(id);
    if (!mem) {
      mem = { timer: 0, input: NEUTRAL_INPUT };
      this.botMem.set(id, mem);
    }
    mem.timer -= 1 / 60;
    if (mem.timer > 0) return { ...mem.input, action: false };
    mem.timer = BOT_CADENCE[difficulty];

    const look = BOT_LOOK[difficulty];
    const edge = BOT_EDGE[difficulty];
    const cx = FLOE.x + FLOE.w / 2;
    const cy = FLOE.y + FLOE.h / 2;
    let best = { dx: 0, dy: 0, score: Infinity };
    for (const [dx, dy] of DIRS9) {
      const len = Math.hypot(dx, dy) || 1;
      // Predict with momentum: x + v t + a t^2 / 2 (friction ignored over short horizons).
      const ax = (dx / len) * ACCEL;
      const ay = (dy / len) * ACCEL;
      let score = 0;
      for (const t of [look * 0.5, look]) {
        const x = s.x + s.vx * t + 0.5 * ax * t * t;
        const y = s.y + s.vy * t + 0.5 * ay * t * t;
        score += this.danger(x, y, t, edge);
      }
      const x = s.x + s.vx * look + 0.5 * ax * look * look;
      const y = s.y + s.vy * look + 0.5 * ay * look * look;
      score += Math.hypot(x - cx, y - cy) * 0.05;
      if (score < best.score) best = { dx, dy, score };
    }
    mem.input = { dx: best.dx as -1 | 0 | 1, dy: best.dy as -1 | 0 | 1, action: false };

    // Opportunistic shove: someone right next to us and near the water.
    if (s.shoveCd <= 0 && this.rng.next() < BOT_SHOVE[difficulty]) {
      const victim = st.skaters.find((o) => {
        if (o === s || o.status !== 'alive' || o.ghost > 0) return false;
        const near = Math.hypot(o.x - s.x, o.y - s.y) < 16;
        const edgy = Math.min(o.x - FLOE.x, FLOE.x + FLOE.w - o.x, o.y - FLOE.y, FLOE.y + FLOE.h - o.y) < 30;
        return near && edgy;
      });
      if (victim) {
        mem.input = { dx: Math.sign(victim.x - s.x) as -1 | 0 | 1, dy: Math.sign(victim.y - s.y) as -1 | 0 | 1, action: true };
      }
    }
    return mem.input;
  }
}

export const CancelamentoDef: MinigameDef = {
  id: 'penguin',
  name: 'CANCELAMENTO',
  handle: '@cancelamento',
  hint: 'DESVIE DOS PINGUINS!  ESPAÇO EMPURRA',
  create: (players, seed) => new Cancelamento(players, seed),
};
