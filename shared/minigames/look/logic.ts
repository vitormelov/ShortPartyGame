import type { Minigame, MinigameDef } from '../../minigame';
import { Rng } from '../../rng';
import type { BotDifficulty, GameEvent, PlayerId, PlayerInfo, PlayerInput, TickInput } from '../../types';
import { NEUTRAL_INPUT } from '../../types';

/**
 * NÃO OLHE (Look Away), one round per clip: everyone secretly picks where to look (WASD).
 * Then the hater turns to one side. Whoever looked the same way loses a life.
 * Players who don't pick anything get a random direction.
 */

/** 0 up (W), 1 right (D), 2 down (S), 3 left (A). */
export type Dir = 0 | 1 | 2 | 3;

export interface Looker {
  id: PlayerId;
  character: number;
  choice: Dir | -1;
  random: boolean; // didn't choose: the game picked for them
  result: 'safe' | 'caught' | '';
  status: 'alive' | 'out';
}

export interface LookState {
  lookers: Looker[];
  phase: 'choose' | 'turn' | 'result';
  phaseTime: number;
  chooseTime: number;
  haterDir: Dir;
}

export const TURN_TIME = 0.9;
export const RESULT_TIME = 1.6;

interface BotPlan {
  at: number; // when it picks
  changeAt: number; // may change its mind once
}

class NaoOlhe implements Minigame<LookState> {
  readonly defId = 'look';
  readonly state: LookState;
  private events: GameEvent[] = [];
  private rng: Rng;
  private plans = new Map<PlayerId, BotPlan>();
  private lastTick = -1;

  constructor(players: PlayerInfo[], seed: number) {
    this.rng = new Rng(seed);
    this.state = {
      lookers: players.map((p) => ({ id: p.id, character: p.character, choice: -1, random: false, result: '', status: 'alive' })),
      phase: 'choose',
      phaseTime: 0,
      chooseTime: 3.2,
      haterDir: 0,
    };
  }

  /** The whole round fits in one clip. */
  fixedDuration(): number {
    return this.state.chooseTime + TURN_TIME + RESULT_TIME + 0.05;
  }

  update(dt: number, inputs: Map<PlayerId, TickInput>): void {
    const st = this.state;
    st.phaseTime += dt;

    if (st.phase === 'choose') {
      for (const l of st.lookers) {
        if (l.status !== 'alive') continue;
        const inp = inputs.get(l.id);
        if (!inp) continue;
        // Last direction held wins (diagonals: vertical first).
        const d: Dir | -1 = inp.dy < 0 ? 0 : inp.dy > 0 ? 2 : inp.dx > 0 ? 1 : inp.dx < 0 ? 3 : -1;
        if (d !== -1 && d !== l.choice) {
          l.choice = d;
          this.events.push({ type: 'sfx', name: 'click' });
        }
      }
      const tick = Math.ceil(st.chooseTime - st.phaseTime);
      if (tick !== this.lastTick && tick <= 3 && tick > 0) this.events.push({ type: 'sfx', name: 'tick' });
      this.lastTick = tick;
      if (st.phaseTime >= st.chooseTime) {
        st.phase = 'turn';
        st.phaseTime = 0;
        st.haterDir = this.rng.int(4) as Dir;
        for (const l of st.lookers) {
          if (l.status !== 'alive' || l.choice !== -1) continue;
          l.choice = this.rng.int(4) as Dir;
          l.random = true;
        }
        this.events.push({ type: 'sfx', name: 'whoosh' });
      }
    } else if (st.phase === 'turn' && st.phaseTime >= TURN_TIME) {
      st.phase = 'result';
      st.phaseTime = 0;
      let caught = 0;
      for (const l of st.lookers) {
        if (l.status !== 'alive') continue;
        l.result = l.choice === st.haterDir ? 'caught' : 'safe';
        if (l.result === 'caught') {
          caught++;
          this.events.push({ type: 'death', player: l.id });
        }
      }
      this.events.push({ type: 'sfx', name: caught ? 'scream' : 'confirm' });
    }
  }

  onSuspend(): void {}
  onResume(): void {}

  removePlayer(id: PlayerId): void {
    const l = this.state.lookers.find((l) => l.id === id);
    if (l) l.status = 'out';
  }

  isFinished(): boolean {
    return this.state.phase === 'result' && this.state.phaseTime >= RESULT_TIME;
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  botInput(id: PlayerId, _difficulty: BotDifficulty): PlayerInput {
    const st = this.state;
    const l = st.lookers.find((l) => l.id === id);
    if (!l || l.status !== 'alive' || st.phase !== 'choose') return NEUTRAL_INPUT;
    let plan = this.plans.get(id);
    if (!plan) {
      plan = { at: this.rng.range(0.4, st.chooseTime - 0.6), changeAt: this.rng.next() < 0.35 ? this.rng.range(1.5, st.chooseTime - 0.2) : 99 };
      this.plans.set(id, plan);
    }
    // Pure luck: a random pick, sometimes a last-second change of heart.
    const pickNow = (l.choice === -1 && st.phaseTime >= plan.at) || (st.phaseTime >= plan.changeAt && (plan.changeAt = 99) === 99);
    if (!pickNow) return NEUTRAL_INPUT;
    const d = this.rng.int(4);
    return { dx: d === 1 ? 1 : d === 3 ? -1 : 0, dy: d === 0 ? -1 : d === 2 ? 1 : 0, action: false };
  }
}

export const NaoOlheDef: MinigameDef = {
  id: 'look',
  name: 'NÃO OLHE',
  handle: '@nao.olhe',
  hint: 'ESCOLHA UM LADO (WASD). NÃO OLHE PRO MESMO DO HATER',
  rounds: true,
  create: (players, seed) => new NaoOlhe(players, seed),
};
