import { ARENA_H, ARENA_W } from '../../arena';
import type { Minigame, MinigameDef } from '../../minigame';
import { Rng } from '../../rng';
import type { BotDifficulty, GameEvent, PlayerId, PlayerInfo, PlayerInput, TickInput } from '../../types';
import { NEUTRAL_INPUT } from '../../types';

/**
 * X1 (duel): a Roda-a-Roda style wheel spins and its two pointers pick both duelists at once
 * (bigger slice = more lives). They settle it in a quick duel — Quick Draw (cork pistols, best of
 * 3), Sword Swipe (8-move sequence race on a pier) or 1-point Pong — while everyone else bets on a
 * winner. Loser -1 life, winner +1; right bets earn a shield (applied by the director).
 */

export type DuelKind = 'quickdraw' | 'sword' | 'pong';

// Wheel.
export const SPIN_TIME = 3.3;
export const ROULETTE_TIME = 4;
const MAX_SLICE = 0.42; // fraction of the wheel, so one slice can never sit under both pointers
export const INTRO_TIME = 2.2;
export const RESULT_TIME = 2.2;

/** Keys used by Quick Draw / Sword Swipe: 0 W, 1 D, 2 S, 3 A, 4 Space. */
export const KEY_SPACE = 4;

// Quick Draw (best of 3).
export const QD_WAIT: [number, number] = [1.1, 2.6];
export const QD_ROUND_END = 1.1;
const QD_TIMEOUT = 2;
const QD_WINS = 2;
export const QD_FAKES = ['JA...', 'JABUTI!', 'JAPÃO!', 'JAQUETA!', 'JANTA!'];

// Sword Swipe.
export const SWORD_MOVES = 8;
export const SWORD_WAIT: [number, number] = [1.2, 2.4];
const SWORD_TIMEOUT = 8;

// Pong (1 point).
export const PONG = { top: 12, bottom: ARENA_H - 12, ax: 26, bx: ARENA_W - 26, half: 16, ballR: 3 };
const PADDLE_SPEED = 165;
const BALL_START = 200;
const BALL_ACCEL = 1.12;

export interface DuelBet {
  id: PlayerId;
  character: number;
  pick: -1 | 0 | 1; // 0 = left duelist, 1 = right duelist
}

export interface WheelSlice {
  candidate: number; // index into candidates
  start: number; // radians, wheel space
  size: number;
}

export interface QuickDrawState {
  round: number;
  score: [number, number];
  goAt: number; // round time of the real signal
  key: number; // key to press on the signal
  fakes: Array<{ at: number; text: string }>;
  roundTime: number;
  ended: boolean; // round over, showing who got corked
  roundWinner: 0 | 1 | -1;
  roundReason: string;
}

export interface SwordState {
  goAt: number;
  seq: number[];
  progress: [number, number];
  failed: [boolean, boolean];
  finishedAt: [number, number];
}

export interface DuelState {
  phase: 'roulette' | 'intro' | 'duel' | 'result';
  phaseTime: number;
  kind: DuelKind;
  candidates: Array<{ id: PlayerId; character: number }>;
  wheel: WheelSlice[];
  /** Final wheel rotation; the wheel turns from 0 to this, easing out. */
  spin: number;
  a: number; // candidate index under the top pointer (left duelist)
  b: number; // candidate index under the bottom pointer (right duelist)
  bets: DuelBet[];
  winner: 0 | 1 | -1;
  reason: string;
  qd: QuickDrawState;
  sword: SwordState;
  pong: { x: number; y: number; vx: number; vy: number; pa: number; pb: number; hits: number };
}

/** Wheel rotation at time t of the spin (cubic ease-out). */
export function wheelAngle(st: DuelState, t: number): number {
  const k = Math.min(1, t / SPIN_TIME);
  return st.spin * (1 - (1 - k) ** 3);
}

/** Which slice sits under a pointer at screen angle `pointer` when the wheel is rotated by `rot`. */
export function sliceAt(wheel: WheelSlice[], rot: number, pointer: number): number {
  const a = (((pointer - rot) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const s = wheel.find((w) => a >= w.start && a < w.start + w.size) ?? wheel[wheel.length - 1];
  return s.candidate;
}

export const POINTER_TOP = -Math.PI / 2;
export const POINTER_BOTTOM = Math.PI / 2;

interface BotPlan {
  at: number;
  value: number;
}

const QD_REACTION: Record<BotDifficulty, [number, number]> = { easy: [0.32, 0.6], medium: [0.24, 0.42], hard: [0.18, 0.3] };
const QD_JUMPY: Record<BotDifficulty, number> = { easy: 0.15, medium: 0.07, hard: 0.02 };
const QD_WRONG: Record<BotDifficulty, number> = { easy: 0.1, medium: 0.05, hard: 0.02 };
const SWORD_STEP: Record<BotDifficulty, [number, number]> = { easy: [0.28, 0.42], medium: [0.21, 0.32], hard: [0.16, 0.24] };
const SWORD_MISS: Record<BotDifficulty, number> = { easy: 0.035, medium: 0.018, hard: 0.008 };
const PONG_SKILL: Record<BotDifficulty, number> = { easy: 0.62, medium: 0.8, hard: 0.95 };
const PONG_ERROR: Record<BotDifficulty, number> = { easy: 16, medium: 10, hard: 5 };

class Duel implements Minigame<DuelState> {
  readonly defId = 'duel';
  readonly state: DuelState;
  private events: GameEvent[] = [];
  private rng: Rng;
  private bots: Map<PlayerId, BotDifficulty>;
  private plans = new Map<string, BotPlan>();
  private dirs = new Map<PlayerId, number>(); // held key per player (edge detection)
  private finishedAt = -1;
  private elapsed = 0;

  constructor(players: PlayerInfo[], seed: number, lives: Map<PlayerId, number>) {
    this.rng = new Rng(seed);
    this.bots = new Map(players.filter((p) => p.isBot).map((p) => [p.id, p.difficulty]));
    const candidates = players.map((p) => ({ id: p.id, character: p.character }));

    // Wheel: slices proportional to (1 + lives), capped, in a shuffled order.
    const order = candidates.map((_, i) => i).sort(() => this.rng.next() - 0.5);
    const raw = order.map((i) => 1 + (lives.get(candidates[i].id) ?? 1));
    const total = raw.reduce((s, x) => s + x, 0);
    let fracs = raw.map((x) => Math.min(MAX_SLICE, x / total));
    const sum = fracs.reduce((s, x) => s + x, 0);
    fracs = fracs.map((f) => f / sum);
    const wheel: WheelSlice[] = [];
    let at = 0;
    order.forEach((ci, k) => {
      const size = fracs[k] * Math.PI * 2;
      wheel.push({ candidate: ci, start: at, size });
      at += size;
    });

    // Spin: several full turns plus a random stop; both pointers read the result.
    let spin = Math.PI * 2 * (4 + this.rng.int(2)) + this.rng.range(0, Math.PI * 2);
    let a = sliceAt(wheel, spin, POINTER_TOP);
    let b = sliceAt(wheel, spin, POINTER_BOTTOM);
    for (let k = 0; k < 12 && a === b; k++) {
      spin += 0.2;
      a = sliceAt(wheel, spin, POINTER_TOP);
      b = sliceAt(wheel, spin, POINTER_BOTTOM);
    }
    if (a === b) b = (a + 1) % candidates.length; // only possible with a degenerate wheel

    const kind = this.rng.pick(['quickdraw', 'sword', 'pong'] as const);
    const serve = this.rng.next() < 0.5 ? 1 : -1;
    const ang = this.rng.range(-0.45, 0.45);
    this.state = {
      phase: 'roulette',
      phaseTime: 0,
      kind,
      candidates,
      wheel,
      spin,
      a,
      b,
      bets: candidates.filter((_, i) => i !== a && i !== b).map((c) => ({ id: c.id, character: c.character, pick: -1 })),
      winner: -1,
      reason: '',
      qd: this.newQdRound(1, [0, 0]),
      sword: {
        goAt: this.rng.range(SWORD_WAIT[0], SWORD_WAIT[1]),
        seq: Array.from({ length: SWORD_MOVES }, () => this.rng.int(4)),
        progress: [0, 0],
        failed: [false, false],
        finishedAt: [-1, -1],
      },
      pong: {
        x: ARENA_W / 2,
        y: ARENA_H / 2,
        vx: Math.cos(ang) * BALL_START * serve,
        vy: Math.sin(ang) * BALL_START,
        pa: ARENA_H / 2,
        pb: ARENA_H / 2,
        hits: 0,
      },
    };
  }

  private newQdRound(round: number, score: [number, number]): QuickDrawState {
    const goAt = this.rng.range(QD_WAIT[0], QD_WAIT[1]);
    const fakes: Array<{ at: number; text: string }> = [];
    if (goAt > 1.4 && this.rng.next() < 0.75) fakes.push({ at: this.rng.range(0.5, goAt - 0.5), text: this.rng.pick(QD_FAKES) });
    return { round, score, goAt, key: this.rng.int(5), fakes, roundTime: 0, ended: false, roundWinner: -1, roundReason: '' };
  }

  /** Upper bound; the clip ends as soon as the duel is decided (isFinished). */
  fixedDuration(): number {
    return 60;
  }

  get duelists(): [PlayerId, PlayerId] {
    return [this.state.candidates[this.state.a].id, this.state.candidates[this.state.b].id];
  }

  private setPhase(phase: DuelState['phase']): void {
    this.state.phase = phase;
    this.state.phaseTime = 0;
  }

  /** New key press for a player this tick: 0 W, 1 D, 2 S, 3 A, 4 Space; -1 if none. */
  private press(id: PlayerId, inp: TickInput | undefined): number {
    const dir = !inp ? -1 : inp.dx !== 0 && inp.dy === 0 ? (inp.dx > 0 ? 1 : 3) : inp.dy !== 0 && inp.dx === 0 ? (inp.dy > 0 ? 2 : 0) : -1;
    const prev = this.dirs.get(id) ?? -1;
    this.dirs.set(id, dir);
    if (inp?.pressed) return KEY_SPACE;
    return dir !== -1 && dir !== prev ? dir : -1;
  }

  update(dt: number, inputs: Map<PlayerId, TickInput>): void {
    const st = this.state;
    st.phaseTime += dt;
    this.elapsed += dt;

    // Bets: A = left duelist, D = right one, during the intro and the first second of the duel.
    const betting = st.phase === 'intro' || (st.phase === 'duel' && st.phaseTime < 1);
    for (const bet of st.bets) {
      const k = this.press(bet.id, inputs.get(bet.id));
      if (!betting) continue;
      if (k === 3) bet.pick = 0;
      else if (k === 1) bet.pick = 1;
    }

    if (st.phase === 'roulette') {
      if (st.phaseTime - dt < SPIN_TIME && st.phaseTime >= SPIN_TIME) this.events.push({ type: 'sfx', name: 'confirm' });
      else if (st.phaseTime < SPIN_TIME && Math.floor(wheelAngle(st, st.phaseTime) / 0.5) !== Math.floor(wheelAngle(st, st.phaseTime - dt) / 0.5)) {
        this.events.push({ type: 'sfx', name: 'click' }); // the wheel's ratchet
      }
      if (st.phaseTime >= ROULETTE_TIME) {
        this.setPhase('intro');
        this.events.push({ type: 'sfx', name: 'command' });
      }
      return;
    }
    if (st.phase === 'intro') {
      if (st.phaseTime >= INTRO_TIME) this.setPhase('duel');
      return;
    }
    if (st.phase === 'result') {
      if (this.finishedAt < 0 && st.phaseTime >= RESULT_TIME) this.finishedAt = this.elapsed;
      return;
    }

    const [ida, idb] = this.duelists;
    const ia = inputs.get(ida);
    const ib = inputs.get(idb);
    if (st.kind === 'quickdraw') this.updateQuickDraw(dt, this.press(ida, ia), this.press(idb, ib));
    else if (st.kind === 'sword') this.updateSword(this.press(ida, ia), this.press(idb, ib));
    else this.updatePong(dt, ia, ib);
  }

  private decide(winner: 0 | 1, reason: string): void {
    const st = this.state;
    st.winner = winner;
    st.reason = reason;
    this.setPhase('result');
    const [ida, idb] = this.duelists;
    const win = winner === 0 ? ida : idb;
    const lose = winner === 0 ? idb : ida;
    this.events.push({ type: 'death', player: lose });
    this.events.push({ type: 'bonusLife', player: win, reason: 'VENCEU O X1' });
    this.events.push({ type: 'duelResult', winner: win, loser: lose, torcida: st.bets.filter((b) => b.pick === winner).map((b) => b.id) });
    this.events.push({ type: 'sfx', name: 'win' });
  }

  private updateQuickDraw(dt: number, ka: number, kb: number): void {
    const q = this.state.qd;
    q.roundTime += dt;
    if (q.ended) {
      if (q.roundTime < QD_ROUND_END) return;
      if (q.score[0] >= QD_WINS || q.score[1] >= QD_WINS) {
        this.decide(q.score[0] > q.score[1] ? 0 : 1, `${q.score[0]} x ${q.score[1]}`);
        return;
      }
      this.state.qd = this.newQdRound(q.round + 1, q.score);
      return;
    }
    const t = q.roundTime;
    const go = t >= q.goAt;
    if (q.fakes.some((f) => t >= f.at && t - dt < f.at)) this.events.push({ type: 'sfx', name: 'tick' });
    if (go && t - dt < q.goAt) this.events.push({ type: 'sfx', name: 'go' });
    const endRound = (side: 0 | 1, reason: string) => {
      q.ended = true;
      q.roundWinner = side;
      q.roundReason = reason;
      q.score[side]++;
      q.roundTime = 0;
      this.events.push({ type: 'sfx', name: 'cannon' });
    };
    for (const side of [0, 1] as const) {
      const k = side === 0 ? ka : kb;
      if (k === -1) continue;
      const other = side === 0 ? 1 : 0;
      if (!go) return endRound(other, 'SE ADIANTOU!');
      if (k !== q.key) return endRound(other, 'TECLA ERRADA!');
      return endRound(side, `${(t - q.goAt).toFixed(2)}s`);
    }
    if (go && t - q.goAt > QD_TIMEOUT) endRound(this.rng.next() < 0.5 ? 0 : 1, 'OS DOIS DORMIRAM');
  }

  private updateSword(ka: number, kb: number): void {
    const s = this.state.sword;
    const t = this.state.phaseTime;
    const go = t >= s.goAt;
    if (go && t - 1 / 60 < s.goAt) this.events.push({ type: 'sfx', name: 'go' });
    for (const side of [0, 1] as const) {
      const k = side === 0 ? ka : kb;
      if (k === -1) continue;
      const other = side === 0 ? 1 : 0;
      if (!go) {
        this.decide(other, 'SE ADIANTOU!');
        return;
      }
      if (k !== s.seq[s.progress[side]]) {
        s.failed[side] = true;
        this.events.push({ type: 'sfx', name: 'bump' });
        this.decide(other, 'ERROU O GOLPE!');
        return;
      }
      s.progress[side]++;
      this.events.push({ type: 'sfx', name: 'dash' });
      if (s.progress[side] >= SWORD_MOVES) {
        s.finishedAt[side] = t - s.goAt;
        this.events.push({ type: 'sfx', name: 'splash' });
        this.decide(side, `GOLPE FINAL EM ${(t - s.goAt).toFixed(2)}s`);
        return;
      }
    }
    if (go && t - s.goAt > SWORD_TIMEOUT) {
      const w = s.progress[0] === s.progress[1] ? (this.rng.next() < 0.5 ? 0 : 1) : s.progress[0] > s.progress[1] ? 0 : 1;
      this.decide(w, 'NO TEMPO');
    }
  }

  private updatePong(dt: number, ia: TickInput | undefined, ib: TickInput | undefined): void {
    const p = this.state.pong;
    const clamp = (y: number) => Math.max(PONG.top + PONG.half, Math.min(PONG.bottom - PONG.half, y));
    p.pa = clamp(p.pa + (ia?.dy ?? 0) * PADDLE_SPEED * dt);
    p.pb = clamp(p.pb + (ib?.dy ?? 0) * PADDLE_SPEED * dt);
    if (this.state.phaseTime < 0.6) return; // a beat before the serve
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.y < PONG.top + PONG.ballR) {
      p.y = PONG.top + PONG.ballR;
      p.vy = Math.abs(p.vy);
    } else if (p.y > PONG.bottom - PONG.ballR) {
      p.y = PONG.bottom - PONG.ballR;
      p.vy = -Math.abs(p.vy);
    }
    const hit = (paddleY: number) => Math.abs(p.y - paddleY) <= PONG.half + PONG.ballR;
    if (p.vx < 0 && p.x - PONG.ballR <= PONG.ax + 2 && p.x > PONG.ax - 6 && hit(p.pa)) this.bounce(p.pa, 1);
    else if (p.vx > 0 && p.x + PONG.ballR >= PONG.bx - 2 && p.x < PONG.bx + 6 && hit(p.pb)) this.bounce(p.pb, -1);
    if (p.x < 0) this.decide(1, `${p.hits} REBATIDAS`);
    else if (p.x > ARENA_W) this.decide(0, `${p.hits} REBATIDAS`);
  }

  private bounce(paddleY: number, dir: 1 | -1): void {
    const p = this.state.pong;
    const speed = Math.hypot(p.vx, p.vy) * BALL_ACCEL;
    const off = (p.y - paddleY) / PONG.half;
    const ang = off * 0.9;
    p.vx = Math.cos(ang) * speed * dir;
    p.vy = Math.sin(ang) * speed;
    p.hits++;
    this.events.push({ type: 'sfx', name: 'bump' });
  }

  onSuspend(): void {}
  onResume(): void {}
  removePlayer(): void {}

  isFinished(): boolean {
    return this.finishedAt >= 0;
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ---------- bots ----------

  private plan(id: PlayerId, key: string, at: () => number, value: () => number): BotPlan {
    const k = `${id}:${key}`;
    let plan = this.plans.get(k);
    if (!plan) {
      plan = { at: at(), value: value() };
      this.plans.set(k, plan);
    }
    return plan;
  }

  /** Input that presses key k (0 W, 1 D, 2 S, 3 A, 4 Space) — only on the tick it's wanted. */
  private keyInput(k: number): PlayerInput {
    if (k === KEY_SPACE) return { dx: 0, dy: 0, action: true };
    const v: ReadonlyArray<readonly [number, number]> = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ];
    return { dx: v[k][0] as -1 | 0 | 1, dy: v[k][1] as -1 | 0 | 1, action: false };
  }

  botInput(id: PlayerId, difficulty: BotDifficulty): PlayerInput {
    const st = this.state;
    const d = this.bots.get(id) ?? difficulty;
    const [ida, idb] = this.duelists;
    const side = id === ida ? 0 : id === idb ? 1 : -1;

    if (side === -1) {
      // Torcida: bet on a hunch.
      const bet = st.bets.find((b) => b.id === id);
      if (!bet || bet.pick !== -1 || st.phase !== 'intro' || st.phaseTime < 0.5) return NEUTRAL_INPUT;
      const plan = this.plan(id, 'bet', () => this.rng.range(0.5, 1.8), () => (this.rng.next() < 0.5 ? -1 : 1));
      if (st.phaseTime < plan.at) return NEUTRAL_INPUT;
      return { dx: plan.value as -1 | 1, dy: 0, action: false };
    }
    if (st.phase !== 'duel') return NEUTRAL_INPUT;

    if (st.kind === 'quickdraw') {
      const q = st.qd;
      if (q.ended) return NEUTRAL_INPUT;
      const t = q.roundTime;
      const jumpy = this.plan(id, `jumpy${q.round}`, () => 0, () => (this.rng.next() < QD_JUMPY[d] ? 1 : 0));
      const fake = q.fakes.find((f) => t >= f.at + 0.2 && t < f.at + 0.22);
      if (jumpy.value && fake) return this.keyInput(this.rng.int(5));
      const [a, b] = QD_REACTION[d];
      const react = this.plan(id, `react${q.round}`, () => this.rng.range(a, b), () => (this.rng.next() < QD_WRONG[d] ? (q.key + 1 + this.rng.int(4)) % 5 : q.key));
      const at = q.goAt + react.at;
      return t >= at && t < at + 0.05 ? this.keyInput(react.value) : NEUTRAL_INPUT;
    }

    if (st.kind === 'sword') {
      const s = st.sword;
      const t = st.phaseTime - s.goAt;
      if (t < 0) return NEUTRAL_INPUT;
      const [a, b] = SWORD_STEP[d];
      // Press each move on its own beat, releasing in between so each press registers.
      const n = s.progress[side];
      const beat = this.plan(id, `step${n}`, () => this.rng.range(a, b), () => (this.rng.next() < SWORD_MISS[d] ? (s.seq[n] + 1 + this.rng.int(3)) % 4 : s.seq[n]));
      const start = this.plan(id, `start${n}`, () => t, () => 0);
      const since = t - start.at;
      return since >= beat.at && since < beat.at + 0.05 ? this.keyInput(beat.value) : NEUTRAL_INPUT;
    }

    // Pong: follow the ball (hard bots predict the bounce), with errors that grow with the rally.
    const p = st.pong;
    const mine = side === 0 ? p.pa : p.pb;
    const coming = side === 0 ? p.vx < 0 : p.vx > 0;
    const spread = PONG_ERROR[d] * (1 + p.hits * 0.6);
    const err = this.plan(id, `err${p.hits}`, () => 0, () => this.rng.range(-spread, spread));
    let target = ARENA_H / 2;
    if (coming) {
      const px = side === 0 ? PONG.ax : PONG.bx;
      const tt = (px - p.x) / p.vx;
      let y = p.y + p.vy * tt;
      if (d !== 'easy') {
        const lo = PONG.top + PONG.ballR;
        const hi = PONG.bottom - PONG.ballR;
        const span = hi - lo;
        let m = (((y - lo) % (2 * span)) + 2 * span) % (2 * span);
        if (m > span) m = 2 * span - m;
        y = lo + m;
      } else {
        y = p.y;
      }
      target = y + err.value;
    }
    if (this.rng.next() > PONG_SKILL[d]) return NEUTRAL_INPUT;
    const dy = Math.abs(target - mine) > 4 ? (Math.sign(target - mine) as -1 | 1) : 0;
    return { dx: 0, dy, action: false };
  }
}

export function createDuel(players: PlayerInfo[], seed: number, lives: Map<PlayerId, number>): Minigame {
  return new Duel(players, seed, lives);
}

export const DuelDef: MinigameDef = {
  id: 'duel',
  name: 'X1',
  handle: 'AO VIVO',
  hint: 'TORCIDA: A ESQUERDA  D DIREITA',
  feedEvent: true,
  create: (players, seed) => new Duel(players, seed, new Map()),
};
