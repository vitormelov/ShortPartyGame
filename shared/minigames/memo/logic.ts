import type { Minigame, MinigameDef } from '../../minigame';
import { Rng } from '../../rng';
import type { BotDifficulty, GameEvent, PlayerId, PlayerInfo, PlayerInput, TickInput } from '../../types';
import { NEUTRAL_INPUT } from '../../types';
import { AD_COUNT } from '../ad/logic';

/**
 * Memory ads, always alternating: the ANÚNCIO ad shows a sequence of 3-6 moves (WASD) to
 * memorize; the next ad that shows up (possibly many clips later) is the COMPRA ad, where
 * everyone must type that exact sequence. One wrong move or not finishing in time costs a life.
 */

/** Directions: 0 up, 1 right, 2 down, 3 left. */
export type MoveSequence = number[];

export function randomSequence(rng: Rng): MoveSequence {
  const len = 3 + rng.int(4); // 3..6
  return Array.from({ length: len }, () => rng.int(4));
}

export type MemoStatus = 'typing' | 'ok' | 'fail' | 'out';

export interface MemoViewer {
  id: PlayerId;
  character: number;
  status: MemoStatus;
  typed: number[]; // moves entered so far (a wrong one ends it)
  dir: number; // direction currently held (-1 none), for edge detection
  started: boolean; // saw the first tick (so a key held from before doesn't count)
}

export interface MemoState {
  mode: 'tell' | 'do';
  sequence: MoveSequence;
  adIndex: number;
  time: number;
  window: number;
  phase: 'show' | 'result';
  viewers: MemoViewer[];
}

const RESULT_TIME = 1.2;
export const tellTime = (len: number) => 1.4 + 0.45 * len;
export const doWindow = (len: number) => 1.6 + 0.55 * len;

/** Chance of remembering each individual move. */
const MEMORY: Record<BotDifficulty, number> = { easy: 0.93, medium: 0.97, hard: 0.99 };
const REACTION: Record<BotDifficulty, [number, number]> = { easy: [0.5, 1], medium: [0.35, 0.7], hard: [0.25, 0.5] };
const TAP_EVERY: Record<BotDifficulty, number> = { easy: 0.34, medium: 0.27, hard: 0.22 };

/** Held direction from an input; diagonals and nothing count as "released". */
function heldDir(inp: PlayerInput | undefined): number {
  if (!inp) return -1;
  if (inp.dx !== 0 && inp.dy === 0) return inp.dx > 0 ? 1 : 3;
  if (inp.dy !== 0 && inp.dx === 0) return inp.dy > 0 ? 2 : 0;
  return -1;
}

interface BotPlan {
  moves: number[];
  reactAt: number;
  every: number;
}

class MemoAd implements Minigame<MemoState> {
  readonly defId: string;
  readonly state: MemoState;
  private events: GameEvent[] = [];
  private rng: Rng;
  private plans = new Map<PlayerId, BotPlan>();

  constructor(players: PlayerInfo[], seed: number, mode: 'tell' | 'do', sequence: MoveSequence) {
    this.rng = new Rng(seed);
    this.defId = mode === 'tell' ? 'memoTell' : 'memoDo';
    this.state = {
      mode,
      sequence,
      adIndex: this.rng.int(AD_COUNT),
      time: 0,
      window: mode === 'tell' ? tellTime(sequence.length) : doWindow(sequence.length),
      phase: 'show',
      viewers: players.map((p) => ({ id: p.id, character: p.character, status: 'typing', typed: [], dir: -1, started: false })),
    };
  }

  fixedDuration(): number {
    return this.state.mode === 'tell' ? this.state.window : this.state.window + RESULT_TIME;
  }

  update(dt: number, inputs: Map<PlayerId, TickInput>): void {
    const st = this.state;
    st.time += dt;
    if (st.mode === 'tell' || st.phase !== 'show') return;

    for (const v of st.viewers) {
      if (v.status !== 'typing') continue;
      const dir = heldDir(inputs.get(v.id));
      if (!v.started) {
        v.started = true;
        v.dir = dir;
        continue;
      }
      if (dir !== -1 && dir !== v.dir) {
        v.typed.push(dir);
        const i = v.typed.length - 1;
        if (st.sequence[i] !== dir) {
          v.status = 'fail';
          this.events.push({ type: 'sfx', name: 'bump' });
        } else if (v.typed.length === st.sequence.length) {
          v.status = 'ok';
          this.events.push({ type: 'sfx', name: 'powerup' });
        } else {
          this.events.push({ type: 'sfx', name: 'menu' });
        }
      }
      v.dir = dir;
    }

    if (st.time >= st.window) {
      st.phase = 'result';
      for (const v of st.viewers) {
        if (v.status === 'typing') v.status = 'fail'; // ran out of time
        if (v.status === 'fail') this.events.push({ type: 'death', player: v.id });
      }
      this.events.push({ type: 'sfx', name: st.viewers.some((v) => v.status === 'fail') ? 'die' : 'bonusLife' });
    }
  }

  onSuspend(): void {}
  onResume(): void {}

  removePlayer(id: PlayerId): void {
    const v = this.state.viewers.find((v) => v.id === id);
    if (v && v.status === 'typing') v.status = 'out';
  }

  isFinished(): boolean {
    return this.state.time >= this.fixedDuration();
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  botInput(id: PlayerId, difficulty: BotDifficulty): PlayerInput {
    const st = this.state;
    if (st.mode === 'tell' || st.phase !== 'show') return NEUTRAL_INPUT;
    let plan = this.plans.get(id);
    if (!plan) {
      // Each move is remembered independently; a forgotten one becomes a random other direction.
      const moves = st.sequence.map((m) => (this.rng.next() < MEMORY[difficulty] ? m : (m + 1 + this.rng.int(3)) % 4));
      const [a, b] = REACTION[difficulty];
      plan = { moves, reactAt: this.rng.range(a, b), every: TAP_EVERY[difficulty] };
      this.plans.set(id, plan);
    }
    const t = st.time - plan.reactAt;
    if (t < 0) return NEUTRAL_INPUT;
    const k = Math.floor(t / plan.every);
    if (k >= plan.moves.length || t - k * plan.every > plan.every * 0.5) return NEUTRAL_INPUT; // release between taps
    const v: ReadonlyArray<readonly [number, number]> = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ];
    const [dx, dy] = v[plan.moves[k]];
    return { dx: dx as -1 | 0 | 1, dy: dy as -1 | 0 | 1, action: false };
  }
}

export function createMemoAd(players: PlayerInfo[], seed: number, mode: 'tell' | 'do', sequence: MoveSequence): Minigame {
  return new MemoAd(players, seed, mode, sequence);
}

export const MemoTellDef: MinigameDef = {
  id: 'memoTell',
  name: 'ANÚNCIO',
  handle: 'Anúncio',
  hint: 'DECORE A SEQUÊNCIA!',
  feedEvent: true,
  create: (players, seed) => new MemoAd(players, seed, 'tell', randomSequence(new Rng(seed))),
};

export const MemoDoDef: MinigameDef = {
  id: 'memoDo',
  name: 'COMPRA',
  handle: 'Compra',
  hint: 'DIGITE A SEQUÊNCIA DO ANÚNCIO!',
  feedEvent: true,
  create: (players, seed) => new MemoAd(players, seed, 'do', randomSequence(new Rng(seed))),
};
