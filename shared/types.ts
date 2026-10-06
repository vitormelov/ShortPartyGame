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

/** The eight characters: emojis from the comments come to life. `color` identifies the player everywhere. */
export const CHARACTERS: Character[] = [
  { name: 'PALHAÇO', color: '#ff5a5a', dark: '#9a1a2a', light: '#ffa89a' },
  { name: 'FOGO', color: '#ff8a1e', dark: '#9a3a0a', light: '#ffc88a' },
  { name: 'RISADA', color: '#ffd23e', dark: '#9a6a0a', light: '#fff08a' },
  { name: 'OLHINHOS', color: '#5cf26a', dark: '#1a7a2a', light: '#b8ffb0' },
  { name: 'CHAD', color: '#3ee8ff', dark: '#0a6a8a', light: '#b0f6ff' },
  { name: 'CHORÃO', color: '#3b7ef8', dark: '#1a2a8a', light: '#9ac0ff' },
  { name: 'CAVEIRA', color: '#b89aff', dark: '#5a3aa8', light: '#e0d4ff' },
  { name: 'DIVA', color: '#ff7ac8', dark: '#a8206a', light: '#ffc0e6' },
]

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
  // emitted by the poll, applied by the director:
  | { type: 'pollResult'; kind: 'gift' | 'spotlight' | 'bet'; winners: PlayerId[]; votes: Array<[PlayerId, PlayerId]> }
  | { type: 'betResolved'; dead: PlayerId; winners: PlayerId[] }
  // X1 duel:
  | { type: 'duelResult'; winner: PlayerId; loser: PlayerId; torcida: PlayerId[] }
  | { type: 'shieldUsed'; player: PlayerId }
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
  pollChance: number; // 0..1 chance the next clip is an ENQUETE
  duelChance: number; // 0..1 chance the next clip is an X1 duel
  /** Test mode: only this minigame (by id), no ads or polls. null = the normal feed. */
  onlyGame: string | null;
  /** Show the title card with the name and controls when a new clip starts. */
  tutorials: boolean;
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
  pollChance: 0.1,
  duelChance: 0.08,
  onlyGame: null,
  tutorials: false,
};
