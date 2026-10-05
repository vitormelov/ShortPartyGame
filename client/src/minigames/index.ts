import { adRenderer } from './ad';
import { beamRenderer } from './beam';
import { bombRenderer } from './bomb';
import { bookRenderer } from './book';
import { bubbleRenderer } from './bubble';
import { countRenderer } from './count';
import { danceRenderer } from './dance';
import { duelRenderer } from './duel';
import { elevatorRenderer } from './elevator';
import { filterRenderer } from './filter';
import { kartRenderer } from './kart';
import { lanternRenderer } from './lantern';
import { laserRenderer } from './laser';
import { lookRenderer } from './look';
import { memoRenderer } from './memo';
import { meteorRenderer } from './meteor';
import { mimicRenderer } from './mimic';
import { paddleRenderer } from './paddle';
import { penguinRenderer } from './penguin';
import { pollRenderer } from './poll';
import type { MinigameRenderer } from './renderer';
import { ropeRenderer } from './rope';
import { tankRenderer } from './tank';

export const RENDERERS: Record<string, MinigameRenderer> = {
  kart: kartRenderer,
  bomb: bombRenderer,
  meteor: meteorRenderer,
  lantern: lanternRenderer,
  laser: laserRenderer,
  elevator: elevatorRenderer,
  beam: beamRenderer,
  mimic: mimicRenderer,
  book: bookRenderer,
  bubble: bubbleRenderer,
  penguin: penguinRenderer,
  count: countRenderer,
  tank: tankRenderer,
  rope: ropeRenderer,
  filter: filterRenderer,
  look: lookRenderer,
  dance: danceRenderer,
  paddle: paddleRenderer,
  poll: pollRenderer,
  duel: duelRenderer,
  ad: adRenderer,
  memoTell: memoRenderer,
  memoDo: memoRenderer,
};

/** Signature color of each minigame (used on title cards and the feed). */
export const CLIP_COLORS: Record<string, string> = {
  kart: '#e83b3b',
  bomb: '#3bc84a',
  meteor: '#f2862e',
  lantern: '#9a5af2',
  laser: '#3ee8ff',
  elevator: '#ffd23e',
  beam: '#ff5ac8',
  mimic: '#5cf26a',
  book: '#e8d8b0',
  bubble: '#ff8ad8',
  penguin: '#9ad8ff',
  count: '#e83b3b',
  tank: '#c8a46a',
  rope: '#ff6a1e',
  filter: '#3ee8ff',
  look: '#e83b3b',
  dance: '#ff5ac8',
  paddle: '#5cf26a',
  poll: '#ff7a8a',
  duel: '#ff3b5c',
  ad: '#ffd23e',
  memoTell: '#ffd23e',
  memoDo: '#ffd23e',
};
