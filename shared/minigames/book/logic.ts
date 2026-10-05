import type { Minigame, MinigameDef } from '../../minigame';
import { Rng } from '../../rng';
import type { BotDifficulty, GameEvent, PlayerId, PlayerInfo, PlayerInput, TickInput } from '../../types';
import { NEUTRAL_INPUT } from '../../types';

/**
 * Booksquirm-style: giant "TERMOS DE USO" pages slam down on the floor. Each page has holes cut
 * out of it; stand inside one when it lands or get flattened. Space shoves.
 */

export const FIELD = { x: 56, y: 12, w: 272, h: 180 };
export const PLAYER_R = 4;
const SPEED = 80;
const SHOVE_SPEED = 200;
const SHOVE_TIME = 0.12;
export const SHOVE_COOLDOWN = 1.2;
const KNOCKBACK = 160;
export const SLAM_TIME = 0.45;
export const TURN_TIME = 0.35;
const FIRST_PREVIEW = 2.2;
const GHOST_TIME = 1.2;
export const DEATH_ANIM = 0.7;
const TIME_CAP = 50;

export interface Hole {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BookPlayer {
  id: PlayerId;
  character: number;
  x: number;
  y: number;
  vx: number; // knockback
  vy: number;
  fx: number;
  fy: number;
  shoveT: number;
  shoveCd: number;
  status: 'alive' | 'dead' | 'out';
  ghost: number;
  deathAnim: number;
  walk: number;
}

export interface BookState {
  players: BookPlayer[];
  phase: 'preview' | 'slam' | 'turn';
  phaseTime: number;
  previewTime: number;
  page: number;
  holes: Hole[];
  time: number;
}

export function inHole(h: Hole, x: number, y: number): boolean {
  const m = PLAYER_R * 0.5;
  return x > h.x + m && x < h.x + h.w - m && y > h.y + m && y < h.y + h.h - m;
}

interface BotMemory {
  timer: number;
  page: number;
  reactAt: number;
  input: PlayerInput;
}

const BOT_CADENCE: Record<BotDifficulty, number> = { easy: 0.2, medium: 0.1, hard: 0.05 };
const BOT_REACT: Record<BotDifficulty, [number, number]> = { easy: [0.25, 0.6], medium: [0.12, 0.35], hard: [0.05, 0.18] };
const BOT_SHOVE: Record<BotDifficulty, number> = { easy: 0, medium: 0.012, hard: 0.03 };

class TermosDeUso implements Minigame<BookState> {
  readonly defId = 'book';
  readonly state: BookState;
  private events: GameEvent[] = [];
  private rng: Rng;
  private heat = 0;
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
          x: cx + Math.cos(a) * 50,
          y: cy + Math.sin(a) * 40,
          vx: 0,
          vy: 0,
          fx: 1,
          fy: 0,
          shoveT: 0,
          shoveCd: 0,
          status: 'alive',
          ghost: 0,
          deathAnim: 0,
          walk: 0,
        };
      }),
      phase: 'preview',
      phaseTime: 0,
      previewTime: FIRST_PREVIEW,
      page: 1,
      holes: [],
      time: 0,
    };
    this.state.holes = this.makeHoles();
  }

  /** Non-overlapping rectangular holes; fewer and smaller as pages go by. */
  private makeHoles(): Hole[] {
    const page = this.state.page;
    const count = page <= 4 ? 4 : page <= 10 ? 3 : 2 + (this.rng.next() < 0.5 ? 1 : 0);
    const shrink = Math.max(0.65, 1 - page * 0.025 - this.heat * 0.15);
    const holes: Hole[] = [];
    for (let tries = 0; holes.length < count && tries < 200; tries++) {
      const w = Math.round(this.rng.range(44, 72) * shrink);
      const h = Math.round(this.rng.range(34, 54) * shrink);
      const x = Math.round(this.rng.range(FIELD.x + 4, FIELD.x + FIELD.w - w - 4));
      const y = Math.round(this.rng.range(FIELD.y + 4, FIELD.y + FIELD.h - h - 4));
      const clash = holes.some((o) => x < o.x + o.w + 14 && x + w + 14 > o.x && y < o.y + o.h + 14 && y + h + 14 > o.y);
      if (!clash) holes.push({ x, y, w, h });
    }
    return holes;
  }

  update(dt: number, inputs: Map<PlayerId, TickInput>, heat: number): void {
    const st = this.state;
    this.heat = heat;
    st.time += dt;
    st.phaseTime += dt;

    for (const p of st.players) {
      if (p.status === 'dead') p.deathAnim = Math.max(0, p.deathAnim - dt);
      if (p.status !== 'alive') continue;
      p.ghost = Math.max(0, p.ghost - dt);
      p.shoveCd = Math.max(0, p.shoveCd - dt);
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
      if (inp?.pressed && p.shoveCd <= 0) {
        p.shoveT = SHOVE_TIME;
        p.shoveCd = SHOVE_COOLDOWN;
        this.events.push({ type: 'sfx', name: 'dash' });
      }
      let vx = mx * SPEED;
      let vy = my * SPEED;
      if (p.shoveT > 0) {
        p.shoveT -= dt;
        vx = p.fx * SHOVE_SPEED;
        vy = p.fy * SHOVE_SPEED;
      }
      p.x += (vx + p.vx) * dt;
      p.y += (vy + p.vy) * dt;
      const decay = Math.exp(-8 * dt);
      p.vx *= decay;
      p.vy *= decay;
      p.x = Math.max(FIELD.x + PLAYER_R, Math.min(FIELD.x + FIELD.w - PLAYER_R, p.x));
      p.y = Math.max(FIELD.y + PLAYER_R, Math.min(FIELD.y + FIELD.h - PLAYER_R, p.y));
    }
    this.collidePlayers();

    if (st.phase === 'preview' && st.phaseTime >= st.previewTime) {
      st.phase = 'slam';
      st.phaseTime = 0;
      this.events.push({ type: 'sfx', name: 'slam' });
      for (const p of st.players) {
        if (p.status !== 'alive' || p.ghost > 0) continue;
        if (st.holes.some((h) => inHole(h, p.x, p.y))) continue;
        p.status = 'dead';
        p.deathAnim = DEATH_ANIM;
        this.events.push({ type: 'death', player: p.id });
      }
    } else if (st.phase === 'slam' && st.phaseTime >= SLAM_TIME) {
      st.phase = 'turn';
      st.phaseTime = 0;
      this.events.push({ type: 'sfx', name: 'page' });
    } else if (st.phase === 'turn' && st.phaseTime >= TURN_TIME) {
      st.page++;
      st.holes = this.makeHoles();
      st.previewTime = Math.max(1.4, 2.1 - st.page * 0.04) - 0.2 * heat;
      st.phase = 'preview';
      st.phaseTime = 0;
    }
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
        if (a.shoveT > 0 && b.shoveT <= 0) {
          b.vx += nx * KNOCKBACK;
          b.vy += ny * KNOCKBACK;
          this.events.push({ type: 'sfx', name: 'bump' });
        } else if (b.shoveT > 0 && a.shoveT <= 0) {
          a.vx -= nx * KNOCKBACK;
          a.vy -= ny * KNOCKBACK;
          this.events.push({ type: 'sfx', name: 'bump' });
        }
      }
    }
  }

  onSuspend(): void {}

  onResume(): void {
    const st = this.state;
    for (const p of st.players) {
      if (p.status !== 'dead') continue;
      // Back into a hole if a page is coming, otherwise anywhere.
      if (st.phase === 'preview' && st.holes.length) {
        const h = this.rng.pick(st.holes);
        p.x = h.x + h.w / 2 + this.rng.range(-h.w / 4, h.w / 4);
        p.y = h.y + h.h / 2 + this.rng.range(-h.h / 4, h.h / 4);
      } else {
        p.x = this.rng.range(FIELD.x + 20, FIELD.x + FIELD.w - 20);
        p.y = this.rng.range(FIELD.y + 20, FIELD.y + FIELD.h - 20);
      }
      p.vx = 0;
      p.vy = 0;
      p.shoveT = 0;
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
    const st = this.state;
    const p = st.players.find((p) => p.id === id);
    if (!p || p.status !== 'alive') return NEUTRAL_INPUT;
    let mem = this.botMem.get(id);
    if (!mem) {
      mem = { timer: 0, page: -1, reactAt: 0, input: NEUTRAL_INPUT };
      this.botMem.set(id, mem);
    }
    if (mem.page !== st.page) {
      const [a, b] = BOT_REACT[difficulty];
      mem.page = st.page;
      mem.reactAt = this.rng.range(a, b);
    }
    mem.timer -= 1 / 60;
    if (mem.timer > 0) return { ...mem.input, action: false };
    mem.timer = BOT_CADENCE[difficulty];

    if (st.phase !== 'preview' || st.phaseTime < mem.reactAt) {
      mem.input = NEUTRAL_INPUT;
      return mem.input;
    }

    // Best hole: close, and not already packed.
    const crowd = (h: Hole) => st.players.filter((o) => o !== p && o.status === 'alive' && inHole(h, o.x, o.y)).length;
    let best: Hole | null = null;
    let bestScore = Infinity;
    for (const h of st.holes) {
      const cx = h.x + h.w / 2;
      const cy = h.y + h.h / 2;
      const capacity = Math.max(1, Math.floor((h.w * h.h) / 260));
      const over = Math.max(0, crowd(h) - capacity + 1);
      const score = Math.hypot(cx - p.x, cy - p.y) + over * 40;
      if (score < bestScore) {
        bestScore = score;
        best = h;
      }
    }
    if (!best) {
      mem.input = NEUTRAL_INPUT;
      return mem.input;
    }
    // Aim for the inner part of the hole, then hold still.
    const tx = Math.max(best.x + 7, Math.min(best.x + best.w - 7, p.x));
    const ty = Math.max(best.y + 7, Math.min(best.y + best.h - 7, p.y));
    const inside = Math.abs(tx - p.x) < 2 && Math.abs(ty - p.y) < 2;
    const dx = inside ? 0 : Math.abs(tx - p.x) > 2 ? (Math.sign(tx - p.x) as -1 | 1) : 0;
    const dy = inside ? 0 : Math.abs(ty - p.y) > 2 ? (Math.sign(ty - p.y) as -1 | 1) : 0;

    // Shove a neighbor that's also in our hole, toward them.
    let action = false;
    // Shove only in the last moment before the page lands (so the victim can't get back in).
    const lastMoment = st.previewTime - st.phaseTime < 0.35;
    if (inside && lastMoment && p.shoveCd <= 0 && this.rng.next() < BOT_SHOVE[difficulty]) {
      const rival = st.players.find((o) => o !== p && o.status === 'alive' && Math.hypot(o.x - p.x, o.y - p.y) < 12);
      if (rival) {
        mem.input = { dx: Math.sign(rival.x - p.x) as -1 | 0 | 1, dy: Math.sign(rival.y - p.y) as -1 | 0 | 1, action: true };
        return mem.input;
      }
    }
    mem.input = { dx, dy, action };
    return mem.input;
  }
}

export const TermosDeUsoDef: MinigameDef = {
  id: 'book',
  name: 'TERMOS DE USO',
  handle: '@termos.de.uso',
  hint: 'FIQUE NOS BURACOS!  ESPAÇO EMPURRA',
  create: (players, seed) => new TermosDeUso(players, seed),
};
