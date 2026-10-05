export type PlayerId = number; // slot index 0..7

export type BotDifficulty = 'easy' | 'medium' | 'hard';

/** What a player's controller sends: direction + one action button (held). */
export interface PlayerInput {
  dx: -1 | 0 | 1;
  dy: -1 | 0 | 1;
  action: boolean;
}

/** Input as seen by minigames: adds the edge-detected press of the action button. */
export interface TickInput extends PlayerInput {
  pressed: boolean;
}

export const NEUTRAL_INPUT: PlayerInput = { dx: 0, dy: 0, action: false };

export interface PlayerInfo {
  id: PlayerId;
  name: string;
  character: number; // index into CHARACTERS
  isBot: boolean;
  difficulty: BotDifficulty;
}

export interface Character {
  name: string;
  color: string;
  dark: string;
  light: string;
}

export const CHARACTERS: Character[] = [
  { name: 'BYTE', color: '#e83b3b', dark: '#8a1a2a', light: '#ff9a8a' },
  { name: 'PIXEL', color: '#3b6ee8', dark: '#1a2a8a', light: '#8ab4ff' },
  { name: 'GLITCH', color: '#3bc84a', dark: '#1a6a2a', light: '#9cf28a' },
  { name: 'TURBO', color: '#f2c81e', dark: '#9a6a0a', light: '#fff08a' },
  { name: 'NEON', color: '#f25ac8', dark: '#8a1a6a', light: '#ffaaee' },
  { name: 'COMBO', color: '#f2862e', dark: '#9a3a0a', light: '#ffc88a' },
  { name: 'LAG', color: '#2ed8e8', dark: '#0a6a7a', light: '#aaf6ff' },
  { name: 'MOD', color: '#9a5af2', dark: '#4a1a8a', light: '#d2aaff' },
];

export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 4;

/** Events emitted by minigames and the feed director. */
export type GameEvent =
  | { type: 'death'; player: PlayerId }
  | { type: 'bonusLife'; player: PlayerId; reason: string }
  | { type: 'sfx'; name: string }
  // emitted only by the director:
  | { type: 'lifeLost'; player: PlayerId; lives: number; onReturn: boolean }
  | { type: 'eliminated'; player: PlayerId }
  | { type: 'swipe' }
  | { type: 'clipStart'; isReturn: boolean; speed: number }
  | { type: 'countdown'; n: number }
  | { type: 'notification' }
  | { type: 'gameOver'; winners: PlayerId[] };

export interface MatchConfig {
  lives: number;
  clipMin: number; // seconds
  clipMax: number;
  returnChance: number; // 0..1
  returnPreview: number; // seconds the frozen frame is shown before release
  speedChance: number; // 0..1 chance a clip plays fast-forwarded (1.25x/1.5x/2x)
  adChance: number; // 0..1 chance the next clip is a skippable ad
  notifChance: number; // 0..1 chance a clip gets a big notification pop-up
}

export const DEFAULT_CONFIG: MatchConfig = {
  lives: 5,
  clipMin: 5,
  clipMax: 8,
  returnChance: 0.45,
  returnPreview: 0.4,
  speedChance: 0.2,
  adChance: 0.12,
  notifChance: 0.15,
};
