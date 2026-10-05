import { FeedDirector, type FeedSnapshot } from '@shared/feed';
import { randomSeed } from '@shared/rng';
import type { GameEvent, MatchConfig, PlayerId, PlayerInfo, PlayerInput } from '@shared/types';
import type { Transport } from './transport';

const STEP = 1 / 60;

/** Runs the whole match (feed, minigames, bots) inside the browser at a fixed 60 Hz. */
export class LocalTransport implements Transport {
  private director: FeedDirector;
  private acc = 0;
  private events: GameEvent[] = [];

  constructor(players: PlayerInfo[], config: MatchConfig, readonly localPlayerId: PlayerId) {
    this.director = new FeedDirector(players, config, randomSeed());
  }

  update(realDt: number): void {
    this.acc += Math.min(realDt, 0.25);
    while (this.acc >= STEP) {
      this.director.tick(STEP);
      this.events.push(...this.director.drainEvents());
      this.acc -= STEP;
    }
  }

  sendInput(input: PlayerInput): void {
    this.director.setInput(this.localPlayerId, input);
  }

  snapshot(): FeedSnapshot {
    return this.director.snapshot();
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  dispose(): void {}
}
