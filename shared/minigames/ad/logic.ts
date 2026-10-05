import type { Minigame, MinigameDef } from '../../minigame';
import { Rng } from '../../rng';
import type { BotDifficulty, GameEvent, PlayerId, PlayerInfo, PlayerInput, TickInput } from '../../types';
import { NEUTRAL_INPUT } from '../../types';

/**
 * Skippable ad: a fake "PULAR EM 3, 2, 1" countdown. Press before it can be skipped and you lose
 * a life; fail to skip within the window and you lose one too. Never comes back on the feed.
 */

export type AdViewerStatus = 'watching' | 'skipped' | 'early' | 'late' | 'out';

export interface AdViewer {
  id: PlayerId;
  character: number;
  status: AdViewerStatus;
  skipTime: number; // seconds after the skip button appeared
}

export interface AdState {
  adIndex: number;
  time: number;
  /** When each countdown digit (N..1, N = 1-3) ends; the last entry is when skipping unlocks. */
  digitEnds: number[];
  window: number; // seconds the skip button is available
  phase: 'wait' | 'skip' | 'done';
  viewers: AdViewer[];
}

export const AD_COUNT = 6;
const RESULT_TIME = 0.9;

const REACTION: Record<BotDifficulty, [number, number]> = { easy: [0.35, 0.95], medium: [0.25, 0.6], hard: [0.18, 0.4] };
const EARLY_CHANCE: Record<BotDifficulty, number> = { easy: 0.1, medium: 0.04, hard: 0 };

class SkippableAd implements Minigame<AdState> {
  readonly defId = 'ad';
  readonly state: AdState;
  private events: GameEvent[] = [];
  /** Bot press time relative to skip unlock (negative = presses too early). */
  private botPlan = new Map<PlayerId, number>();

  constructor(players: PlayerInfo[], seed: number) {
    const rng = new Rng(seed);
    // Counts down from 1, 2 or 3; each "second" is a bit uneven so the timing can't be memorized.
    const count = 1 + rng.int(3);
    const digits = Array.from({ length: count }, () => rng.range(0.7, 1.25));
    const digitEnds: number[] = [];
    let t = 0;
    for (const d of digits) digitEnds.push((t += d));
    this.state = {
      adIndex: rng.int(AD_COUNT),
      time: 0,
      digitEnds,
      window: rng.range(1.1, 1.4),
      phase: 'wait',
      viewers: players.map((p) => ({ id: p.id, character: p.character, status: 'watching', skipTime: 0 })),
    };
    for (const p of players) {
      if (!p.isBot) continue;
      const [a, b] = REACTION[p.difficulty];
      this.botPlan.set(p.id, rng.next() < EARLY_CHANCE[p.difficulty] ? -rng.range(0.15, 0.8) : rng.range(a, b));
    }
  }

  get unlockAt(): number {
    return this.state.digitEnds[this.state.digitEnds.length - 1];
  }

  fixedDuration(): number {
    return this.unlockAt + this.state.window + RESULT_TIME;
  }

  update(dt: number, inputs: Map<PlayerId, TickInput>): void {
    const st = this.state;
    st.time += dt;
    const unlock = this.unlockAt;

    if (st.phase === 'wait' && st.time >= unlock) {
      st.phase = 'skip';
      this.events.push({ type: 'sfx', name: 'skipReady' });
    }
    if (st.phase === 'skip' && st.time >= unlock + st.window) {
      st.phase = 'done';
      for (const v of st.viewers) {
        if (v.status !== 'watching') continue;
        v.status = 'late';
        this.events.push({ type: 'death', player: v.id });
      }
    }
    if (st.phase === 'done') return;

    for (const v of st.viewers) {
      if (v.status !== 'watching' || !inputs.get(v.id)?.pressed) continue;
      if (st.phase === 'wait') {
        v.status = 'early';
        this.events.push({ type: 'death', player: v.id }, { type: 'sfx', name: 'die' });
      } else {
        v.status = 'skipped';
        v.skipTime = st.time - unlock;
        this.events.push({ type: 'sfx', name: 'menu' });
      }
    }
  }

  onSuspend(): void {}
  onResume(): void {}

  removePlayer(id: PlayerId): void {
    const v = this.state.viewers.find((v) => v.id === id);
    if (v && v.status === 'watching') v.status = 'out';
  }

  isFinished(): boolean {
    return this.state.time >= this.fixedDuration();
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  botInput(id: PlayerId, _difficulty: BotDifficulty): PlayerInput {
    const plan = this.botPlan.get(id);
    if (plan === undefined) return NEUTRAL_INPUT;
    const at = this.unlockAt + plan;
    // Hold the button for a moment once it's time (press edge is detected by the director).
    return { dx: 0, dy: 0, action: this.state.time >= at && this.state.time < at + 0.1 };
  }
}

export const AdDef: MinigameDef = {
  id: 'ad',
  name: 'PATROCINADO',
  handle: 'Patrocinado',
  hint: 'SÓ PULE (ESPAÇO) QUANDO PUDER!',
  feedEvent: true,
  create: (players, seed) => new SkippableAd(players, seed),
};
