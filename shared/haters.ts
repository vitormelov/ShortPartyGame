import type { PlayerId } from './types';

/**
 * MODO HATER: eliminated players keep playing as commenters. They pick a comment (W/S), a target
 * (A/D) and send it (Space), spending "hate" charges that slowly refill.
 */

export type CommentKind = 'common' | 'tag' | 'fake';

export interface HaterOption {
  kind: CommentKind;
  text: string;
  /** For fake tips: the direction the arrow points (0 up, 1 right, 2 down, 3 left, 4 Space). */
  dir?: number;
}

export const HATER_MENU: HaterOption[] = [
  { kind: 'common', text: 'KKKKKKKK' },
  { kind: 'common', text: 'VAI CAIR!' },
  { kind: 'common', text: 'NOOB' },
  { kind: 'common', text: 'ACABOU PRA VOCÊ' },
  { kind: 'tag', text: 'VAI MORRER' },
  { kind: 'tag', text: 'TÁ COM LAG' },
  { kind: 'tag', text: 'É O PRÓXIMO' },
  { kind: 'fake', text: 'VAI PRA CIMA!', dir: 0 },
  { kind: 'fake', text: 'DIREITA!', dir: 1 },
  { kind: 'fake', text: 'DESCE!', dir: 2 },
  { kind: 'fake', text: 'ESQUERDA!', dir: 3 },
  { kind: 'fake', text: 'APERTA ESPAÇO!', dir: 4 },
];

export const COMMENT_COST: Record<CommentKind, number> = { common: 1, tag: 1, fake: 2 };
export const MAX_CHARGE = 3;
export const CHARGE_EVERY = 3; // seconds per charge
export const COMMENT_LIFE: Record<CommentKind, number> = { common: 1.7, tag: 2, fake: 1.3 };
export const MAX_COMMENTS = 6;
/** A death this soon after being targeted counts as an assist for the hater. */
export const ASSIST_WINDOW = 2;

export interface HaterComment {
  id: number;
  kind: CommentKind;
  text: string;
  dir: number;
  author: PlayerId;
  authorCharacter: number;
  target: PlayerId; // -1 = everyone
  age: number;
  life: number;
  /** Where it floats (arena coords), for comments not attached to a player. */
  x: number;
  y: number;
}

export interface HaterPanel {
  id: PlayerId;
  charge: number;
  menu: number; // index into HATER_MENU
  target: number; // index into the alive list; -1 = everyone
  dir: number; // held direction (edge detection)
}
