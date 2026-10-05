import type { MinigameDef } from '../minigame';
import { AdDef } from './ad/logic';
import { LaserBeamDef } from './beam/logic';
import { BombFeedDef } from './bomb/logic';
import { TermosDeUsoDef } from './book/logic';
import { BolhaSocialDef } from './bubble/logic';
import { ElevadorSocialDef } from './elevator/logic';
import { KartRushDef } from './kart/logic';
import { LanternFeedDef } from './lantern/logic';
import { LaserGridDef } from './laser/logic';
import { MemoDoDef, MemoTellDef } from './memo/logic';
import { MeteorFeedDef } from './meteor/logic';
import { MimicMeDef } from './mimic/logic';
import { CancelamentoDef } from './penguin/logic';

export const MINIGAMES: MinigameDef[] = [KartRushDef, BombFeedDef, MeteorFeedDef, LanternFeedDef, LaserGridDef, ElevadorSocialDef, LaserBeamDef, MimicMeDef, TermosDeUsoDef, BolhaSocialDef, CancelamentoDef];

/** Feed events: not in the regular rotation and never returned to. */
export const AD_DEF = AdDef;

export function getMinigameDef(id: string): MinigameDef {
  const def = [...MINIGAMES, AD_DEF, MemoTellDef, MemoDoDef].find((d) => d.id === id);
  if (!def) throw new Error(`Unknown minigame ${id}`);
  return def;
}
