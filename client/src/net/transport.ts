import type { FeedSnapshot } from '@shared/feed';
import type { GameEvent, PlayerId, PlayerInput } from '@shared/types';

/**
 * How the client talks to the match simulation. Phase 1 runs it in the browser (LocalTransport);
 * phase 2 adds a WebSocketTransport talking to the authoritative server.
 */
export interface Transport {
  readonly localPlayerId: PlayerId;
  update(realDt: number): void;
  sendInput(input: PlayerInput): void;
  snapshot(): FeedSnapshot;
  drainEvents(): GameEvent[];
  dispose(): void;
}
