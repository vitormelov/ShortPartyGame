import { ARENA_H, ARENA_W } from '../../arena';
import type { Minigame, MinigameDef } from '../../minigame';
import { Rng } from '../../rng';
import type { BotDifficulty, GameEvent, PlayerId, PlayerInfo, PlayerInput, TickInput } from '../../types';
import { NEUTRAL_INPUT } from '../../types';

/**
 * Roll-call style, one round per clip: the haters are already on screen, wandering around;
 * everyone sets a counter (W +1, S -1, Space locks it) and at the end of the same clip the
 * answer is revealed. Off by 3+ costs a life; the first exact lock gets +1 life.
 */

export type CountQuestion = 'all' | 'red' | 'fans';
/** Entity kinds: haters in three colors, and "fans" (hearts) as distractors. */
export type CrowdKind = 'red' | 'blue' | 'purple' | 'fan';

export interface Walker {
  kind: CrowdKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  counts: boolean; // is it one of the things to count
}

export interface Counter {
  id: PlayerId;
  character: number;
  guess: number;
  locked: boolean;
  lockTime: number;
  dir: number; // held W/S (-1 none, 0 up, 2 down) for edges + auto-repeat
  holdT: number;
  result: 'ok' | 'exact' | 'fail' | 'best' | '';
  status: 'alive' | 'out';
}

export interface CountState {
  question: CountQuestion;
  walkers: Walker[];
  answer: number;
  phase: 'count' | 'reveal';
  phaseTime: number;
  counters: Counter[];
}

export const COUNT_TIME = 6;
export const REVEAL_STEP = 0.07;
export const RESULT_TIME = 1.5;
const TOLERANCE = 2;
const REPEAT_DELAY = 0.35;
const REPEAT_EVERY = 0.07;
/** Area the haters wander in (keeps clear of the question banner and the guess box). */
export const FIELD = { x: 12, y: 30, w: ARENA_W - 24, h: ARENA_H - 86 };

export function revealTime(answer: number): number {
  return Math.min(1.6, answer * REVEAL_STEP) + RESULT_TIME;
}

interface BotPlan {
  target: number; // the count it believes
  tapCd: number;
  lockAt: number;
}

const BOT_ERROR: Record<BotDifficulty, number> = { easy: 3, medium: 2, hard: 1 };
const BOT_LOCK: Record<BotDifficulty, number> = { easy: 0.15, medium: 0.35, hard: 0.55 };

class ContaOsHaters implements Minigame<CountState> {
  readonly defId = 'count';
  readonly state: CountState;
  private events: GameEvent[] = [];
  private rng: Rng;
  private plans = new Map<PlayerId, BotPlan>();

  constructor(players: PlayerInfo[], seed: number) {
    this.rng = new Rng(seed);
    const r = this.rng.next();
    const question: CountQuestion = r < 0.4 ? 'all' : r < 0.7 ? 'red' : 'fans';
    const targets = 8 + this.rng.int(10);
    const extras = question === 'all' ? 0 : Math.round(targets * this.rng.range(0.5, 0.9));
    const walkers: Walker[] = [];
    const add = (kind: CrowdKind, counts: boolean) => {
      const a = this.rng.range(0, Math.PI * 2);
      const speed = this.rng.range(18, 45);
      walkers.push({
        kind,
        counts,
        x: this.rng.range(FIELD.x + 6, FIELD.x + FIELD.w - 6),
        y: this.rng.range(FIELD.y + 6, FIELD.y + FIELD.h - 6),
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
      });
    };
    for (let k = 0; k < targets; k++) add(question === 'all' ? this.rng.pick(['red', 'blue', 'purple'] as const) : 'red', true);
    for (let k = 0; k < extras; k++) add(question === 'red' ? this.rng.pick(['blue', 'purple'] as const) : 'fan', false);
    this.state = {
      question,
      walkers: walkers.sort(() => this.rng.next() - 0.5),
      answer: targets,
      phase: 'count',
      phaseTime: 0,
      counters: players.map((p) => ({ id: p.id, character: p.character, guess: 0, locked: false, lockTime: 0, dir: -1, holdT: 0, result: '', status: 'alive' })),
    };
  }

  /** The whole round fits in one clip (a hair longer so the game finishes before the clip ends). */
  fixedDuration(): number {
    return COUNT_TIME + revealTime(this.state.answer) + 0.05;
  }

  update(dt: number, inputs: Map<PlayerId, TickInput>, heat: number): void {
    const st = this.state;
    st.phaseTime += dt;

    if (st.phase === 'count') {
      // Wander and bounce inside the field; faster with heat.
      const k = 1 + heat * 0.8;
      for (const w of st.walkers) {
        w.x += w.vx * k * dt;
        w.y += w.vy * k * dt;
        if (w.x < FIELD.x + 5 || w.x > FIELD.x + FIELD.w - 5) w.vx = -w.vx;
        if (w.y < FIELD.y + 5 || w.y > FIELD.y + FIELD.h - 5) w.vy = -w.vy;
        w.x = Math.max(FIELD.x + 5, Math.min(FIELD.x + FIELD.w - 5, w.x));
        w.y = Math.max(FIELD.y + 5, Math.min(FIELD.y + FIELD.h - 5, w.y));
      }
      for (const c of st.counters) {
        if (c.status !== 'alive' || c.locked) continue;
        const inp = inputs.get(c.id);
        const dir = inp && inp.dy !== 0 && inp.dx === 0 ? (inp.dy < 0 ? 0 : 2) : -1;
        let steps = 0;
        if (dir !== -1 && dir !== c.dir) {
          steps = 1;
          c.holdT = 0;
        } else if (dir !== -1) {
          // Holding repeats after a short delay.
          const before = c.holdT;
          c.holdT += dt;
          if (c.holdT > REPEAT_DELAY) steps = Math.floor((c.holdT - REPEAT_DELAY) / REPEAT_EVERY) - Math.floor(Math.max(0, before - REPEAT_DELAY) / REPEAT_EVERY);
        }
        if (steps) c.guess = Math.max(0, Math.min(99, c.guess + (dir === 0 ? steps : -steps)));
        c.dir = dir;
        if (inp?.pressed) {
          c.locked = true;
          c.lockTime = st.phaseTime;
          this.events.push({ type: 'sfx', name: 'confirm' });
        }
      }
      if (st.phaseTime >= COUNT_TIME) this.judge();
    }
  }

  private judge(): void {
    const st = this.state;
    st.phase = 'reveal';
    st.phaseTime = 0;
    let best: Counter | null = null;
    for (const c of st.counters) {
      if (c.status !== 'alive') continue;
      const off = Math.abs(c.guess - st.answer);
      c.result = off === 0 ? 'exact' : off <= TOLERANCE ? 'ok' : 'fail';
      if (c.result === 'fail') this.events.push({ type: 'death', player: c.id });
      if (c.result === 'exact' && c.locked && (!best || c.lockTime < best.lockTime)) best = c;
    }
    if (best) {
      best.result = 'best';
      this.events.push({ type: 'bonusLife', player: best.id, reason: 'CONTOU CERTINHO' });
    }
    this.events.push({ type: 'sfx', name: 'page' });
  }

  onSuspend(): void {}
  onResume(): void {}

  removePlayer(id: PlayerId): void {
    const c = this.state.counters.find((c) => c.id === id);
    if (c) c.status = 'out';
  }

  isFinished(): boolean {
    return this.state.phase === 'reveal' && this.state.phaseTime >= revealTime(this.state.answer);
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  botInput(id: PlayerId, difficulty: BotDifficulty): PlayerInput {
    const st = this.state;
    const c = st.counters.find((c) => c.id === id);
    if (!c || c.status !== 'alive' || st.phase !== 'count' || c.locked) return NEUTRAL_INPUT;
    let plan = this.plans.get(id);
    if (!plan) {
      const e = BOT_ERROR[difficulty];
      plan = {
        target: Math.max(0, st.answer + this.rng.int(e * 2 + 1) - e),
        tapCd: this.rng.range(0.6, 1.4), // takes a moment to start counting
        lockAt: this.rng.next() < BOT_LOCK[difficulty] ? this.rng.range(3, COUNT_TIME - 0.5) : 99,
      };
      this.plans.set(id, plan);
    }
    plan.tapCd -= 1 / 60;
    if (st.phaseTime >= plan.lockAt && c.guess === plan.target) return { dx: 0, dy: 0, action: true };
    if (plan.tapCd > 0 || plan.target === c.guess) return NEUTRAL_INPUT;
    plan.tapCd = 0.16;
    // Tap (press then release next tick) so each press registers.
    return c.dir === -1 ? { dx: 0, dy: plan.target > c.guess ? -1 : 1, action: false } : NEUTRAL_INPUT;
  }
}

export const ContaOsHatersDef: MinigameDef = {
  id: 'count',
  name: 'CONTA OS HATERS',
  handle: '@conta.os.haters',
  hint: 'W SOMA  S DIMINUI  ESPAÇO CONFIRMA',
  create: (players, seed) => new ContaOsHaters(players, seed),
};
