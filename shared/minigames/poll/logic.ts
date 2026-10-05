import type { Minigame, MinigameDef } from '../../minigame';
import { Rng } from '../../rng';
import type { BotDifficulty, GameEvent, PlayerId, PlayerInfo, PlayerInput, TickInput } from '../../types';
import { NEUTRAL_INPUT } from '../../types';

/**
 * ENQUETE (story poll): everyone has a few seconds to vote for someone else. Cursors are visible
 * live. The director applies the outcome (gift, spotlight, or the death bet).
 */

export type PollKind = 'gift' | 'spotlight' | 'bet';

export interface Candidate {
  id: PlayerId;
  character: number;
}

export interface Voter {
  id: PlayerId;
  character: number;
  cursor: number; // candidate index, -1 = not chosen yet
  locked: boolean;
  dir: number; // held direction for edge detection
  status: 'voting' | 'out';
}

export interface PollState {
  kind: PollKind;
  candidates: Candidate[];
  voters: Voter[];
  phase: 'vote' | 'reveal';
  time: number;
  tally: number[]; // votes per candidate (filled at reveal)
  winners: PlayerId[];
}

export const POLL_COLS = 4;
export const VOTE_TIME = 4.5;
export const REVEAL_TIME = 2.4;

interface BotPlan {
  target: number; // candidate index
  nextMove: number;
  lockAt: number;
}

const BOT_SPEED: Record<BotDifficulty, [number, number]> = { easy: [0.3, 0.5], medium: [0.2, 0.35], hard: [0.14, 0.25] };

class Enquete implements Minigame<PollState> {
  readonly defId = 'poll';
  readonly state: PollState;
  private events: GameEvent[] = [];
  private rng: Rng;
  private plans = new Map<PlayerId, BotPlan>();
  /** Lives per player at poll time (bots use it to pick). */
  private lives: Map<PlayerId, number>;

  constructor(players: PlayerInfo[], seed: number, kind: PollKind, lives: Map<PlayerId, number>) {
    this.rng = new Rng(seed);
    this.lives = lives;
    this.state = {
      kind,
      candidates: players.map((p) => ({ id: p.id, character: p.character })),
      voters: players.map((p) => ({ id: p.id, character: p.character, cursor: -1, locked: false, dir: -1, status: 'voting' })),
      phase: 'vote',
      time: 0,
      tally: [],
      winners: [],
    };
  }

  fixedDuration(): number {
    return VOTE_TIME + REVEAL_TIME;
  }

  private selfIndex(id: PlayerId): number {
    return this.state.candidates.findIndex((c) => c.id === id);
  }

  /** Move a cursor one step, skipping the voter's own card. */
  private step(v: Voter, dir: number): void {
    const n = this.state.candidates.length;
    const self = this.selfIndex(v.id);
    if (v.cursor === -1) {
      v.cursor = self === 0 ? 1 : 0;
      return;
    }
    const delta = dir === 1 ? 1 : dir === 3 ? -1 : dir === 2 ? POLL_COLS : -POLL_COLS;
    let next = v.cursor + delta;
    if (next === self) next += delta;
    if (next >= 0 && next < n) v.cursor = next;
  }

  update(dt: number, inputs: Map<PlayerId, TickInput>): void {
    const st = this.state;
    st.time += dt;
    if (st.phase !== 'vote') return;

    for (const v of st.voters) {
      if (v.status !== 'voting' || v.locked) continue;
      const inp = inputs.get(v.id);
      const dir = !inp ? -1 : inp.dx !== 0 && inp.dy === 0 ? (inp.dx > 0 ? 1 : 3) : inp.dy !== 0 && inp.dx === 0 ? (inp.dy > 0 ? 2 : 0) : -1;
      if (dir !== -1 && dir !== v.dir) {
        this.step(v, dir);
        this.events.push({ type: 'sfx', name: 'menu' });
      }
      v.dir = dir;
      if (inp?.pressed && v.cursor !== -1) {
        v.locked = true;
        this.events.push({ type: 'sfx', name: 'confirm' });
      }
    }

    if (st.time >= VOTE_TIME) {
      st.phase = 'reveal';
      st.tally = st.candidates.map(() => 0);
      const votes: Array<[PlayerId, PlayerId]> = [];
      for (const v of st.voters) {
        if (v.status !== 'voting' || v.cursor === -1) continue;
        st.tally[v.cursor]++;
        votes.push([v.id, st.candidates[v.cursor].id]);
      }
      const top = Math.max(0, ...st.tally);
      st.winners = top > 0 ? st.candidates.filter((_, i) => st.tally[i] === top).map((c) => c.id) : [];
      this.events.push({ type: 'pollResult', kind: st.kind, winners: st.winners, votes });
      this.events.push({ type: 'sfx', name: 'bonusLife' });
    }
  }

  onSuspend(): void {}
  onResume(): void {}

  removePlayer(id: PlayerId): void {
    const v = this.state.voters.find((v) => v.id === id);
    if (v) v.status = 'out';
  }

  isFinished(): boolean {
    return this.state.time >= this.fixedDuration();
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Bots: gift goes to someone struggling, spotlight to the leader, the bet on the weakest. */
  private pickTarget(id: PlayerId): number {
    const st = this.state;
    const options = st.candidates.map((c, i) => ({ c, i })).filter((o) => o.c.id !== id);
    const lives = (pid: PlayerId) => this.lives.get(pid) ?? 1;
    const maxL = Math.max(...options.map((o) => lives(o.c.id)));
    const weight = (pid: PlayerId) => {
      const l = lives(pid);
      if (st.kind === 'spotlight') return 1 + l * l;
      return 1 + (maxL - l + 1) ** 2; // gift & bet: fewer lives
    };
    // Some herd behavior: follow whoever already has the most cursors.
    if (this.rng.next() < 0.3) {
      const counts = st.candidates.map(() => 0);
      for (const v of st.voters) if (v.cursor >= 0 && v.id !== id) counts[v.cursor]++;
      const best = counts.indexOf(Math.max(...counts));
      if (counts[best] > 0 && st.candidates[best].id !== id) return best;
    }
    const total = options.reduce((s, o) => s + weight(o.c.id), 0);
    let r = this.rng.next() * total;
    for (const o of options) {
      r -= weight(o.c.id);
      if (r <= 0) return o.i;
    }
    return options[0].i;
  }

  botInput(id: PlayerId, difficulty: BotDifficulty): PlayerInput {
    const st = this.state;
    const v = st.voters.find((v) => v.id === id);
    if (!v || st.phase !== 'vote' || v.locked) return NEUTRAL_INPUT;
    let plan = this.plans.get(id);
    if (!plan) {
      plan = { target: this.pickTarget(id), nextMove: this.rng.range(0.4, 1), lockAt: this.rng.range(2, VOTE_TIME - 0.4) };
      this.plans.set(id, plan);
    }
    if (st.time < plan.nextMove) return NEUTRAL_INPUT;
    if (v.cursor === plan.target) return st.time >= plan.lockAt ? { dx: 0, dy: 0, action: true } : NEUTRAL_INPUT;
    if (v.dir !== -1) return NEUTRAL_INPUT; // release between steps
    const [a, b] = BOT_SPEED[difficulty];
    plan.nextMove = st.time + this.rng.range(a, b);
    if (v.cursor === -1) return { dx: 1, dy: 0, action: false };
    const cr = Math.floor(v.cursor / POLL_COLS);
    const tr = Math.floor(plan.target / POLL_COLS);
    if (cr !== tr) return { dx: 0, dy: tr > cr ? 1 : -1, action: false };
    return { dx: plan.target > v.cursor ? 1 : -1, dy: 0, action: false };
  }
}

export function createPoll(players: PlayerInfo[], seed: number, kind: PollKind, lives: Map<PlayerId, number>): Minigame {
  return new Enquete(players, seed, kind, lives);
}

export const PollDef: MinigameDef = {
  id: 'poll',
  name: 'ENQUETE',
  handle: 'Enquete',
  hint: 'WASD ESCOLHE  ESPAÇO CONFIRMA',
  feedEvent: true,
  create: (players, seed) => new Enquete(players, seed, 'gift', new Map()),
};
