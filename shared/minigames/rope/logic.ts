import type { Minigame, MinigameDef } from '../../minigame';
import { Rng } from '../../rng';
import type { BotDifficulty, GameEvent, PlayerId, PlayerInfo, PlayerInput, TickInput } from '../../types';
import { NEUTRAL_INPUT } from '../../types';

/**
 * CORDA QUENTE (hot rope jump): everyone stands in a row while two haters swing a flaming rope.
 * Jump (Space or W) as it sweeps under your feet. The rope speeds up over time and sometimes
 * changes pace to throw you off.
 */

export const GROUND_Y = 150;
export const ROPE_LEFT = 44;
export const ROPE_RIGHT = 340;
export const HAND_H = 40; // hands height above the ground
export const ROPE_R = 40; // rope midpoint height goes from 0 (feet) to 2R (over heads)
export const JUMP_TIME = 0.5;
export const JUMP_H = 18;
const SAFE_H = 5; // feet higher than this clear the rope
const BASE_SPEED = 2.5; // rad/s
const MAX_SPEED = 6.2;
const GHOST_TIME = 1.2;
export const DEATH_ANIM = 0.8;
const TIME_CAP = 50;

export interface Jumper {
  id: PlayerId;
  character: number;
  x: number;
  jumpT: number; // time since the jump started, -1 = on the ground
  status: 'alive' | 'dead' | 'out';
  deathAnim: number;
  ghost: number;
  upHeld: boolean;
  jumps: number; // rope passes cleared
}

export interface RopeState {
  jumpers: Jumper[];
  angle: number; // 0 = rope over the heads, PI = at the feet
  speed: number;
  pace: number; // multiplier the speed eases toward (pace changes)
  paceTimer: number;
  paceMsg: string;
  paceMsgT: number;
  time: number;
}

export function jumpHeight(j: Jumper): number {
  if (j.jumpT < 0) return 0;
  const u = j.jumpT / JUMP_TIME;
  return JUMP_H * 4 * u * (1 - u);
}

/** Height of the rope's middle above the ground. */
export function ropeHeight(angle: number): number {
  return ROPE_R * (1 + Math.cos(angle));
}

interface BotMemory {
  pass: number; // which rope pass the plan is for
  offset: number; // timing error for this pass
  miss: boolean;
}

const BOT_TIMING: Record<BotDifficulty, number> = { easy: 0.13, medium: 0.08, hard: 0.04 };
const BOT_MISS: Record<BotDifficulty, number> = { easy: 0.07, medium: 0.035, hard: 0.012 };

class CordaQuente implements Minigame<RopeState> {
  readonly defId = 'rope';
  readonly state: RopeState;
  private events: GameEvent[] = [];
  private rng: Rng;
  private botMem = new Map<PlayerId, BotMemory>();
  private passes = 0;

  constructor(players: PlayerInfo[], seed: number) {
    this.rng = new Rng(seed);
    const n = players.length;
    const span = Math.min(180, (n - 1) * 24);
    this.state = {
      jumpers: players.map((p, i) => ({
        id: p.id,
        character: p.character,
        x: 192 - span / 2 + (n > 1 ? (i * span) / (n - 1) : 0),
        jumpT: -1,
        status: 'alive',
        deathAnim: 0,
        ghost: 0,
        upHeld: false,
        jumps: 0,
      })),
      angle: 0.3,
      speed: BASE_SPEED,
      pace: 1,
      paceTimer: this.rng.range(4, 6),
      paceMsg: '',
      paceMsgT: 0,
      time: 0,
    };
  }

  update(dt: number, inputs: Map<PlayerId, TickInput>, heat: number): void {
    const st = this.state;
    st.time += dt;
    st.paceMsgT = Math.max(0, st.paceMsgT - dt);

    // Pace changes: the turners speed up or slow down to trick you.
    st.paceTimer -= dt;
    if (st.paceTimer <= 0) {
      st.paceTimer = this.rng.range(3, 5.5);
      const r = this.rng.next();
      const next = r < 0.4 ? 1.35 : r < 0.6 ? 0.75 : 1;
      if (next > st.pace) {
        st.paceMsg = 'ACELEROU!';
        st.paceMsgT = 1;
      } else if (next < st.pace) {
        st.paceMsg = 'FREOU...';
        st.paceMsgT = 1;
      }
      st.pace = next;
    }
    const base = Math.min(MAX_SPEED, BASE_SPEED + st.time * 0.055 + heat * 1.4);
    const target = Math.min(MAX_SPEED * 1.2, base * st.pace);
    st.speed += (target - st.speed) * Math.min(1, dt * 2.5);

    for (const j of st.jumpers) {
      if (j.status === 'dead') j.deathAnim = Math.max(0, j.deathAnim - dt);
      if (j.status !== 'alive') continue;
      j.ghost = Math.max(0, j.ghost - dt);
      const inp = inputs.get(j.id);
      const up = (inp?.dy ?? 0) < 0;
      const wants = inp?.pressed || (up && !j.upHeld);
      j.upHeld = up;
      if (j.jumpT >= 0) {
        j.jumpT += dt;
        if (j.jumpT >= JUMP_TIME) j.jumpT = -1;
      } else if (wants) {
        j.jumpT = 0;
        this.events.push({ type: 'sfx', name: 'jump' });
      }
    }

    // The rope sweeps under the feet when the angle crosses PI.
    const before = st.angle;
    st.angle += st.speed * dt;
    const crossed = Math.floor((before - Math.PI) / (Math.PI * 2)) !== Math.floor((st.angle - Math.PI) / (Math.PI * 2));
    if (crossed) {
      this.passes++;
      this.events.push({ type: 'sfx', name: 'whoosh' });
      for (const j of st.jumpers) {
        if (j.status !== 'alive') continue;
        if (j.ghost > 0 || jumpHeight(j) > SAFE_H) {
          j.jumps++;
          continue;
        }
        j.status = 'dead';
        j.deathAnim = DEATH_ANIM;
        j.jumpT = -1;
        this.events.push({ type: 'death', player: j.id }, { type: 'sfx', name: 'die' });
      }
    }
    if (st.angle > Math.PI * 4) st.angle -= Math.PI * 2;
  }

  onSuspend(): void {}

  onResume(): void {
    for (const j of this.state.jumpers) {
      if (j.status !== 'dead') continue;
      j.status = 'alive';
      j.ghost = GHOST_TIME;
      j.deathAnim = 0;
      j.jumpT = -1;
    }
  }

  removePlayer(id: PlayerId): void {
    const j = this.state.jumpers.find((j) => j.id === id);
    if (j) j.status = 'out';
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
    const j = st.jumpers.find((j) => j.id === id);
    if (!j || j.status !== 'alive' || j.jumpT >= 0) return NEUTRAL_INPUT;
    // Time until the rope reaches the feet; jump so it passes at the top of the jump.
    const toPi = (((Math.PI - st.angle) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const tb = toPi / Math.max(0.5, st.speed);
    let mem = this.botMem.get(id);
    if (!mem || mem.pass !== this.passes) {
      const e = BOT_TIMING[difficulty];
      mem = { pass: this.passes, offset: this.rng.range(-e, e), miss: this.rng.next() < BOT_MISS[difficulty] };
      this.botMem.set(id, mem);
    }
    if (mem.miss) return NEUTRAL_INPUT;
    const want = JUMP_TIME / 2 + mem.offset;
    return { dx: 0, dy: 0, action: tb <= want && tb > want - 0.05 };
  }
}

export const CordaQuenteDef: MinigameDef = {
  id: 'rope',
  name: 'CORDA QUENTE',
  handle: '@corda.quente',
  hint: 'PULE A CORDA: ESPAÇO OU W',
  create: (players, seed) => new CordaQuente(players, seed),
};
