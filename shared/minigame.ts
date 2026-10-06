import type { BotDifficulty, GameEvent, PlayerId, PlayerInfo, PlayerInput, TickInput } from './types';

/**
 * A minigame instance. All of its state must live in `state` as plain data, so it can be
 * frozen (simply not updated) while off-feed and later sent over the network as a snapshot.
 */
export interface Minigame<S = unknown> {
  readonly defId: string;
  readonly state: S;
  /** heat goes 0 -> 1 as the match drags on; minigames get deadlier with it. */
  update(dt: number, inputs: Map<PlayerId, TickInput>, heat: number): void;
  /** Called when the clip leaves the feed. */
  onSuspend(): void;
  /** Called when the clip comes back to the feed (before the swipe-in). Respawns dead players. */
  onResume(): void;
  /** A player lost their last life: remove them from this instance. */
  removePlayer(id: PlayerId): void;
  isFinished(): boolean;
  /** Round-based games (see MinigameDef.rounds): who goes out if a round ends with no deaths. */
  roundLosers?(): PlayerId[];
  /** Clips with a scripted length (like the ad) override the random clip duration. */
  fixedDuration?(): number;
  drainEvents(): GameEvent[];
  botInput(id: PlayerId, difficulty: BotDifficulty): PlayerInput;
}

export interface MinigameDef {
  id: string;
  name: string;
  /** Fake social handle shown in the feed HUD. */
  handle: string;
  /** One-line instruction shown on the title card. */
  hint: string;
  /** Feed events (ads): never returned to, always 1x speed, never two in a row. */
  feedEvent?: boolean;
  /**
   * isFinished() means a round really ended (not just the time cap): in the minigames mode a new
   * round starts with the survivors.
   */
  rounds?: boolean;
  create(players: PlayerInfo[], seed: number): Minigame;
}

export function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
