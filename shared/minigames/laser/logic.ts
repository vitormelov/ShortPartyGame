import { angleDiff, type Minigame, type MinigameDef } from '../../minigame';
import { Rng } from '../../rng';
import type { BotDifficulty, GameEvent, PlayerId, PlayerInfo, PlayerInput, TickInput } from '../../types';
import { NEUTRAL_INPUT } from '../../types';

/** Walkable floor in arena coordinates. */
export const FIELD = { x: 24, y: 8, w: 336, h: 188 };
export const CENTER = { x: FIELD.x + FIELD.w / 2, y: FIELD.y + FIELD.h / 2 };
export const EMITTER_R = 11;

export const PLAYER_R = 4;
const SPEED = 66;
export const JUMP_TIME = 0.55;
export const JUMP_COOLDOWN = 0.7;
/** The emitter blinks this long before the beams reverse. */
export const FLIP_WARNING = 0.6;
const BEAM_HALF_W = 1.5; // low rotating beams: jump over them
export const WALL_THICK = 6; // tall sweeping walls: only the gap saves you
export const GAP = 44;
const GHOST_TIME = 1.2;
export const DEATH_ANIM = 0.6;
const TIME_CAP = 50;

export interface LaserPlayer {
  id: PlayerId;
  character: number;
  x: number;
  y: number;
  jump: number; // remaining airborne time
  jumpCd: number;
  status: 'alive' | 'dead' | 'out';
  ghost: number;
  deathAnim: number;
  walk: number;
}

export interface LaserWall {
  id: number;
  vertical: boolean; // vertical wall sweeps horizontally
  pos: number; // x for vertical walls, y for horizontal ones
  dir: 1 | -1;
  speed: number;
  gaps: number[]; // start of each gap along the wall
}

export interface LaserState {
  players: LaserPlayer[];
  beamAngle: number;
  beamSpeed: number; // rad/s, flips direction now and then
  beams: number; // how many evenly spaced rotating beams
  flipTimer: number;
  walls: LaserWall[];
  wallTimer: number;
  time: number;
  nextId: number;
}

interface BotMemory {
  timer: number;
  input: PlayerInput;
}

const BOT_CADENCE: Record<BotDifficulty, number> = { easy: 0.22, medium: 0.1, hard: 0.04 };
const BOT_LOOK: Record<BotDifficulty, number> = { easy: 0.2, medium: 0.32, hard: 0.4 };
const BOT_JUMP_SKILL: Record<BotDifficulty, number> = { easy: 0.75, medium: 0.92, hard: 1 };

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

class LaserGrid implements Minigame<LaserState> {
  readonly defId = 'laser';
  readonly state: LaserState;
  private events: GameEvent[] = [];
  private rng: Rng;
  private botMem = new Map<PlayerId, BotMemory>();

  constructor(players: PlayerInfo[], seed: number) {
    this.rng = new Rng(seed);
    this.state = {
      players: players.map((p, i) => {
        const a = (i / players.length) * Math.PI * 2 + 0.3;
        return {
          id: p.id,
          character: p.character,
          x: CENTER.x + Math.cos(a) * 70,
          y: CENTER.y + Math.sin(a) * 55,
          jump: 0,
          jumpCd: 0,
          status: 'alive',
          ghost: 0,
          deathAnim: 0,
          walk: 0,
        };
      }),
      beamAngle: this.rng.range(0, Math.PI * 2),
      beamSpeed: 1.1,
      beams: 2,
      flipTimer: this.rng.range(4, 7),
      walls: [],
      wallTimer: 2.5,
      time: 0,
      nextId: 1,
    };
  }

  // ---------- geometry ----------

  /** Is (x, y) on a rotating beam at the given beam angle? */
  private onBeam(x: number, y: number, angle: number): boolean {
    const dx = x - CENTER.x;
    const dy = y - CENTER.y;
    const d = Math.hypot(dx, dy);
    if (d < EMITTER_R) return false;
    const a = Math.atan2(dy, dx);
    const step = (Math.PI * 2) / this.state.beams;
    for (let k = 0; k < this.state.beams; k++) {
      const diff = Math.abs(angleDiff(angle + k * step, a));
      if (diff < Math.PI / 2 && Math.sin(diff) * d < BEAM_HALF_W + PLAYER_R * 0.6) return true;
    }
    return false;
  }

  private wallHits(w: LaserWall, x: number, y: number, pos = w.pos): boolean {
    const across = w.vertical ? x : y;
    const along = w.vertical ? y - FIELD.y : x - FIELD.x;
    if (Math.abs(across - pos) > WALL_THICK / 2 + PLAYER_R * 0.6) return false;
    return !w.gaps.some((g) => along > g + PLAYER_R && along < g + GAP - PLAYER_R);
  }

  private blocked(x: number, y: number): boolean {
    if (x < FIELD.x + PLAYER_R || x > FIELD.x + FIELD.w - PLAYER_R || y < FIELD.y + PLAYER_R || y > FIELD.y + FIELD.h - PLAYER_R) return true;
    return Math.hypot(x - CENTER.x, y - CENTER.y) < EMITTER_R + PLAYER_R;
  }

  // ---------- simulation ----------

  update(dt: number, inputs: Map<PlayerId, TickInput>, heat: number): void {
    const st = this.state;
    st.time += dt;
    st.beams = 2 + Math.floor(heat * 2.5);
    const spin = 1.1 + heat * 0.6 + Math.min(0.5, st.time * 0.01);
    st.beamSpeed = Math.sign(st.beamSpeed) * spin;
    st.beamAngle += st.beamSpeed * dt;
    st.flipTimer -= dt;
    if (st.flipTimer <= 0) {
      // Surprise reversal: the cruelest moment to come back from a swipe.
      st.beamSpeed = -st.beamSpeed;
      st.flipTimer = this.rng.range(3.5, 7);
      this.events.push({ type: 'sfx', name: 'laserFlip' });
    }

    st.wallTimer -= dt;
    if (st.wallTimer <= 0) {
      st.wallTimer = this.rng.range(4.5, 5.5) - 1.8 * heat;
      this.spawnWall(heat);
    }
    for (const w of st.walls) w.pos += w.dir * w.speed * dt;
    st.walls = st.walls.filter((w) => (w.vertical ? w.pos > FIELD.x - 10 && w.pos < FIELD.x + FIELD.w + 10 : w.pos > FIELD.y - 10 && w.pos < FIELD.y + FIELD.h + 10));

    for (const p of st.players) {
      if (p.status === 'dead') p.deathAnim = Math.max(0, p.deathAnim - dt);
      if (p.status !== 'alive') continue;
      p.ghost = Math.max(0, p.ghost - dt);
      p.jump = Math.max(0, p.jump - dt);
      p.jumpCd = Math.max(0, p.jumpCd - dt);
      const inp = inputs.get(p.id);
      if (inp?.pressed && p.jumpCd <= 0) {
        p.jump = JUMP_TIME;
        p.jumpCd = JUMP_COOLDOWN;
        this.events.push({ type: 'sfx', name: 'jump' });
      }
      let mx = inp?.dx ?? 0;
      let my = inp?.dy ?? 0;
      const len = Math.hypot(mx, my);
      if (len > 0) {
        mx /= len;
        my /= len;
        p.walk += dt;
        const nx = p.x + mx * SPEED * dt;
        const ny = p.y + my * SPEED * dt;
        if (!this.blocked(nx, p.y)) p.x = nx;
        if (!this.blocked(p.x, ny)) p.y = ny;
      } else {
        p.walk = 0;
      }

      if (p.ghost > 0) continue;
      const beam = p.jump <= 0 && this.onBeam(p.x, p.y, st.beamAngle);
      const wall = st.walls.some((w) => this.wallHits(w, p.x, p.y));
      if (beam || wall) {
        p.status = 'dead';
        p.deathAnim = DEATH_ANIM;
        this.events.push({ type: 'death', player: p.id }, { type: 'sfx', name: 'zap' });
      }
    }
  }

  private spawnWall(heat: number): void {
    const st = this.state;
    const vertical = this.rng.next() < 0.5;
    const dir = this.rng.next() < 0.5 ? 1 : -1;
    const length = vertical ? FIELD.h : FIELD.w;
    const pos = vertical ? (dir > 0 ? FIELD.x - 6 : FIELD.x + FIELD.w + 6) : dir > 0 ? FIELD.y - 6 : FIELD.y + FIELD.h + 6;
    st.walls.push({
      id: st.nextId++,
      vertical,
      pos,
      dir,
      speed: this.rng.range(34, 44) + 26 * heat,
      gaps: this.makeGaps(length, vertical ? 2 : 3),
    });
    this.events.push({ type: 'sfx', name: 'laserWall' });
  }

  /** Evenly spread gaps (one per section) so there's always one within reach. */
  private makeGaps(length: number, count: number): number[] {
    const section = length / count;
    const gaps: number[] = [];
    for (let k = 0; k < count; k++) gaps.push(k * section + this.rng.range(6, section - GAP - 6));
    return gaps;
  }

  onSuspend(): void {}

  onResume(): void {
    const st = this.state;
    for (const p of st.players) {
      if (p.status !== 'dead') continue;
      let best = { x: CENTER.x + 80, y: CENTER.y, score: -Infinity };
      for (let k = 0; k < 40; k++) {
        const x = this.rng.range(FIELD.x + 12, FIELD.x + FIELD.w - 12);
        const y = this.rng.range(FIELD.y + 12, FIELD.y + FIELD.h - 12);
        if (this.blocked(x, y)) continue;
        const wallD = Math.min(...st.walls.map((w) => Math.abs((w.vertical ? x : y) - w.pos)), 999);
        const score = Math.min(wallD, 80) + (this.onBeam(x, y, st.beamAngle) ? -100 : 0);
        if (score > best.score) best = { x, y, score };
      }
      p.x = best.x;
      p.y = best.y;
      p.status = 'alive';
      p.ghost = GHOST_TIME;
      p.deathAnim = 0;
      p.jump = 0;
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

  // ---------- bots ----------

  /** Danger of standing at (x, y) after `t` seconds, assuming we won't be airborne. */
  private danger(x: number, y: number, t: number): number {
    const st = this.state;
    let d = 0;
    for (const w of st.walls) {
      const pos = w.pos + w.dir * w.speed * t;
      if (this.wallHits(w, x, y, pos)) d += 100;
      // Also count the wall sweeping through us between now and then.
      const across = w.vertical ? x : y;
      if ((across - w.pos) * w.dir > 0 && (across - pos) * w.dir < 0 && this.wallHits(w, x, y, across)) d += 60;
    }
    if (this.onBeam(x, y, st.beamAngle + st.beamSpeed * t)) d += 25;
    return d;
  }

  /** Walls must be planned for early: pull toward the gap of every wall coming our way. */
  private gapPull(x: number, y: number, difficulty: BotDifficulty): number {
    const horizon = difficulty === 'easy' ? 1.6 : difficulty === 'medium' ? 3 : 4;
    let pull = 0;
    for (const w of this.state.walls) {
      const across = w.vertical ? x : y;
      const eta = ((across - w.pos) * w.dir) / w.speed;
      if (eta < 0 || eta > horizon) continue;
      const along = w.vertical ? y - FIELD.y : x - FIELD.x;
      const off = Math.min(...w.gaps.map((g) => Math.abs(along - (g + GAP / 2))));
      pull += Math.max(0, off - GAP / 2 + PLAYER_R + 2) * (1.5 / (eta + 0.3));
    }
    return pull;
  }

  botInput(id: PlayerId, difficulty: BotDifficulty): PlayerInput {
    const st = this.state;
    const p = st.players.find((p) => p.id === id);
    if (!p || p.status !== 'alive') return NEUTRAL_INPUT;
    let mem = this.botMem.get(id);
    if (!mem) {
      mem = { timer: 0, input: NEUTRAL_INPUT };
      this.botMem.set(id, mem);
    }

    // Jumping is a reflex, checked every tick, at where we'll be (we may be walking into a beam).
    const mlen = Math.hypot(mem.input.dx, mem.input.dy) || 1;
    const vx = (mem.input.dx / mlen) * SPEED;
    const vy = (mem.input.dy / mlen) * SPEED;
    const speeds = st.flipTimer < FLIP_WARNING ? [st.beamSpeed, -st.beamSpeed] : [st.beamSpeed];
    const beamSoon = speeds.some((s) => [0.03, 0.08, 0.14].some((t) => this.onBeam(p.x + vx * t, p.y + vy * t, st.beamAngle + s * t)));
    const wantJump = beamSoon && p.jumpCd <= 0 && p.jump <= 0 && this.rng.next() < BOT_JUMP_SKILL[difficulty];

    mem.timer -= 1 / 60;
    if (mem.timer <= 0) {
      mem.timer = BOT_CADENCE[difficulty];
      const look = BOT_LOOK[difficulty];
      let best = { dx: 0, dy: 0, score: Infinity };
      for (const [dx, dy] of DIRS9) {
        const len = Math.hypot(dx, dy) || 1;
        const x = p.x + (dx / len) * SPEED * look;
        const y = p.y + (dy / len) * SPEED * look;
        if (this.blocked(x, y)) continue;
        // Prefer staying away from the edges (walls come from there) and the emitter.
        const edge = Math.min(x - FIELD.x, FIELD.x + FIELD.w - x, y - FIELD.y, FIELD.y + FIELD.h - y);
        let score = this.danger(x, y, look) + this.danger((x + p.x) / 2, (y + p.y) / 2, look / 2) * 0.5 - Math.min(edge, 50) * 0.1;
        score += this.gapPull(x, y, difficulty);
        // Near the emitter the beams sweep slowly past you: longer than a jump lasts.
        score += Math.max(0, 50 - Math.hypot(x - CENTER.x, y - CENTER.y)) * 0.6;
        if (score < best.score) best = { dx, dy, score };
      }
      mem.input = { dx: best.dx as -1 | 0 | 1, dy: best.dy as -1 | 0 | 1, action: false };
    }
    return { ...mem.input, action: wantJump };
  }
}

export const LaserGridDef: MinigameDef = {
  id: 'laser',
  name: 'LASER GRID',
  handle: '@laser.grid',
  hint: 'ESPAÇO PULA  PAREDE: ACHE O BURACO',
  create: (players, seed) => new LaserGrid(players, seed),
};
