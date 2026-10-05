import { ARENA_W } from '../../arena';
import type { Minigame, MinigameDef } from '../../minigame';
import { Rng } from '../../rng';
import type { BotDifficulty, GameEvent, PlayerId, PlayerInfo, PlayerInput, TickInput } from '../../types';
import { NEUTRAL_INPUT } from '../../types';

/**
 * "Simon says": the influencer shows a command and everyone must be HOLDING it when the
 * timer runs out. Wrong pose = into the pool.
 */

/** Poses: 0 up, 1 right, 2 down, 3 left, 4 action, -1 nothing. */
export const POSE_NONE = -1;
export const POSE_ACTION = 4;
/** Commands: the 5 poses plus PARADO (hold nothing). */
export const CMD_STILL = 5;

const WAIT_TIME = 0.55;
const RESULT_TIME = 0.6;
const GHOST_TIME = 1.2;
export const DEATH_ANIM = 0.8;
const TIME_CAP = 50;
export const RAFT_Y = 152;

export interface MimicPlayer {
  id: PlayerId;
  character: number;
  x: number;
  pose: number;
  status: 'alive' | 'dead' | 'out';
  ghost: number;
  deathAnim: number;
  /** Result of the last judged round, for the little check/cross. */
  last: 'ok' | 'fail' | '';
}

export interface MimicState {
  players: MimicPlayer[];
  phase: 'wait' | 'show' | 'result';
  phaseTime: number;
  window: number; // duration of the current 'show' phase
  command: number;
  opposite: boolean; // "CONTRÁRIO!": do the opposite direction
  round: number;
  time: number;
}

export function expectedPose(command: number, opposite: boolean): number {
  if (command === CMD_STILL) return POSE_NONE;
  if (opposite && command < 4) return (command + 2) % 4;
  return command;
}

export function poseFromInput(inp: PlayerInput | undefined): number {
  if (!inp) return POSE_NONE;
  if (inp.action) return POSE_ACTION;
  if (inp.dx !== 0 && inp.dy === 0) return inp.dx > 0 ? 1 : 3;
  if (inp.dy !== 0 && inp.dx === 0) return inp.dy > 0 ? 2 : 0;
  return POSE_NONE;
}

interface BotPlan {
  round: number;
  reactAt: number;
  pose: number;
}

const REACTION: Record<BotDifficulty, [number, number]> = { easy: [0.3, 0.75], medium: [0.25, 0.5], hard: [0.18, 0.35] };
const ERROR: Record<BotDifficulty, number> = { easy: 0.08, medium: 0.035, hard: 0.012 };
const OPPOSITE_ERROR: Record<BotDifficulty, number> = { easy: 0.2, medium: 0.1, hard: 0.04 };

class MimicMe implements Minigame<MimicState> {
  readonly defId = 'mimic';
  readonly state: MimicState;
  private events: GameEvent[] = [];
  private rng: Rng;
  private heat = 0;
  private plans = new Map<PlayerId, BotPlan>();

  constructor(players: PlayerInfo[], seed: number) {
    this.rng = new Rng(seed);
    const gap = ARENA_W / (players.length + 1);
    this.state = {
      players: players.map((p, i) => ({
        id: p.id,
        character: p.character,
        x: Math.round(gap * (i + 1)),
        pose: POSE_NONE,
        status: 'alive',
        ghost: 0,
        deathAnim: 0,
        last: '',
      })),
      phase: 'wait',
      phaseTime: 0,
      window: 1.2,
      command: 0,
      opposite: false,
      round: 0,
      time: 0,
    };
  }

  private nextCommand(): void {
    const st = this.state;
    st.round++;
    const r = this.rng.next();
    st.command = r < 0.1 ? CMD_STILL : r < 0.24 ? POSE_ACTION : this.rng.int(4);
    st.opposite = st.command < 4 && st.round > 2 && this.rng.next() < 0.18 + 0.15 * this.heat;
    st.window = Math.max(0.8, 1.3 - st.round * 0.025) - 0.15 * this.heat;
    st.phase = 'show';
    st.phaseTime = 0;
    this.events.push({ type: 'sfx', name: st.opposite ? 'laserFlip' : 'command' });
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
      p.pose = poseFromInput(inputs.get(p.id));
    }

    if (st.phase === 'wait' && st.phaseTime >= WAIT_TIME) {
      for (const p of st.players) p.last = '';
      this.nextCommand();
    } else if (st.phase === 'show' && st.phaseTime >= st.window) {
      const want = expectedPose(st.command, st.opposite);
      for (const p of st.players) {
        if (p.status !== 'alive') continue;
        if (p.pose === want || p.ghost > 0) {
          p.last = 'ok';
          continue;
        }
        p.last = 'fail';
        p.status = 'dead';
        p.deathAnim = DEATH_ANIM;
        this.events.push({ type: 'death', player: p.id });
      }
      this.events.push({ type: 'sfx', name: st.players.some((p) => p.last === 'fail') ? 'splash' : 'powerup' });
      st.phase = 'result';
      st.phaseTime = 0;
    } else if (st.phase === 'result' && st.phaseTime >= RESULT_TIME) {
      st.phase = 'wait';
      st.phaseTime = 0;
    }
  }

  onSuspend(): void {}

  onResume(): void {
    for (const p of this.state.players) {
      if (p.status !== 'dead') continue;
      p.status = 'alive';
      p.ghost = GHOST_TIME;
      p.deathAnim = 0;
      p.pose = POSE_NONE;
      p.last = '';
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
    if (!p || p.status !== 'alive' || st.phase !== 'show') return NEUTRAL_INPUT;
    let plan = this.plans.get(id);
    if (!plan || plan.round !== st.round) {
      const [a, b] = REACTION[difficulty];
      const want = expectedPose(st.command, st.opposite);
      const err = st.opposite ? OPPOSITE_ERROR[difficulty] : ERROR[difficulty];
      let pose = want;
      if (this.rng.next() < err) {
        // Classic mistake on CONTRÁRIO: do the shown direction instead.
        pose = st.opposite ? st.command : this.rng.pick([0, 1, 2, 3, POSE_ACTION, POSE_NONE].filter((x) => x !== want));
      }
      plan = { round: st.round, reactAt: this.rng.range(a, b), pose };
      this.plans.set(id, plan);
    }
    if (st.phaseTime < plan.reactAt || plan.pose === POSE_NONE) return NEUTRAL_INPUT;
    if (plan.pose === POSE_ACTION) return { dx: 0, dy: 0, action: true };
    const v: ReadonlyArray<readonly [number, number]> = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ];
    const [dx, dy] = v[plan.pose];
    return { dx: dx as -1 | 0 | 1, dy: dy as -1 | 0 | 1, action: false };
  }
}

export const MimicMeDef: MinigameDef = {
  id: 'mimic',
  name: 'MIMIC ME',
  handle: '@mimic.me',
  hint: 'SEGURE O QUE O INFLUENCER MANDAR!',
  create: (players, seed) => new MimicMe(players, seed),
};
