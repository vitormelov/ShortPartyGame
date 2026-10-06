import { adRenderer } from './ad';
import { beamRenderer } from './beam';
import { bombRenderer } from './bomb';
import { bookRenderer } from './book';
import { settings } from '../core/settings';
import { ads3dRenderer } from '../three/ads3d';
import { beam3dRenderer } from '../three/beam3d';
import { bomb3dRenderer } from '../three/bomb3d';
import { book3dRenderer } from '../three/book3d';
import { bubble3dAvailable, bubble3dRenderer } from '../three/bubble3d';
import { count3dRenderer } from '../three/count3d';
import { dance3dRenderer } from '../three/dance3d';
import { duel3dRenderer } from '../three/duel3d';
import { elevator3dRenderer } from '../three/elevator3d';
import { filter3dRenderer } from '../three/filter3d';
import { kart3dRenderer } from '../three/kart3d';
import { lantern3dRenderer } from '../three/lantern3d';
import { laser3dRenderer } from '../three/laser3d';
import { look3dRenderer } from '../three/look3d';
import { meteor3dRenderer } from '../three/meteor3d';
import { mimic3dRenderer } from '../three/mimic3d';
import { paddle3dRenderer } from '../three/paddle3d';
import { penguin3dRenderer } from '../three/penguin3d';
import { poll3dRenderer } from '../three/poll3d';
import { rope3dRenderer } from '../three/rope3d';
import { tank3dRenderer } from '../three/tank3d';
import { webglAvailable } from '../three/stage';
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

/** One 3D overlay shared by both memory ads (ANÚNCIO and COMPRA). */
const memo3d = ads3dRenderer(memoRenderer);

export const RENDERERS: Record<string, MinigameRenderer> = {
  kart: withVisual3d(kartRenderer, kart3dRenderer, webglAvailable),
  bomb: withVisual3d(bombRenderer, bomb3dRenderer, webglAvailable),
  meteor: withVisual3d(meteorRenderer, meteor3dRenderer, webglAvailable),
  lantern: withVisual3d(lanternRenderer, lantern3dRenderer, webglAvailable),
  laser: withVisual3d(laserRenderer, laser3dRenderer, webglAvailable),
  elevator: withVisual3d(elevatorRenderer, elevator3dRenderer, webglAvailable),
  beam: withVisual3d(beamRenderer, beam3dRenderer, webglAvailable),
  mimic: withVisual3d(mimicRenderer, mimic3dRenderer, webglAvailable),
  book: withVisual3d(bookRenderer, book3dRenderer, webglAvailable),
  bubble: withVisual3d(bubbleRenderer, bubble3dRenderer, bubble3dAvailable),
  penguin: withVisual3d(penguinRenderer, penguin3dRenderer, webglAvailable),
  count: withVisual3d(countRenderer, count3dRenderer, webglAvailable),
  tank: withVisual3d(tankRenderer, tank3dRenderer, webglAvailable),
  rope: withVisual3d(ropeRenderer, rope3dRenderer, webglAvailable),
  filter: withVisual3d(filterRenderer, filter3dRenderer, webglAvailable),
  look: withVisual3d(lookRenderer, look3dRenderer, webglAvailable),
  dance: withVisual3d(danceRenderer, dance3dRenderer, webglAvailable),
  paddle: withVisual3d(paddleRenderer, paddle3dRenderer, webglAvailable),
  poll: withVisual3d(pollRenderer, poll3dRenderer, webglAvailable),
  duel: withVisual3d(duelRenderer, duel3dRenderer, webglAvailable),
  ad: withVisual3d(adRenderer, ads3dRenderer(adRenderer), webglAvailable),
  memoTell: withVisual3d(memoRenderer, memo3d, webglAvailable),
  memoDo: withVisual3d(memoRenderer, memo3d, webglAvailable),
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
  tank: '#b89aff',
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

/** Pilot: uses the 3D renderer when VISUAL 3D is on in Opções and WebGL works, otherwise the 2D one. */
function withVisual3d(flat: MinigameRenderer, three: MinigameRenderer, available: () => unknown): MinigameRenderer {
  const pick = () => (settings().visual3d && available() ? three : flat);
  return {
    render: (ctx, state, time, localId) => pick().render(ctx, state, time, localId),
    positions: (state) => pick().positions?.(state) ?? [],
  };
}
