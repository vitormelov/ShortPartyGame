import { COLS, DEATH_ANIM, FILTERS, GRID, RISE_TIME, ROWS, TILE_H, TILE_W, type FilterState } from '@shared/minigames/filter/logic';
import type { PlayerId } from '@shared/types';
import * as THREE from 'three';
import { drawFilterCall } from '../minigames/filter';
import { Sea, Stage3D, addLights, lambert, stageRenderer, type StageScene } from './stage';

/** FILTRO CERTO in 3D (Mushroom Mix-Up): colored blocks over the sea; the wrong ones sink. */

const TILE_D = 10; // block depth below the top
const SINK_DEPTH = 34;

class Filter3D extends Stage3D implements StageScene<FilterState> {
  private sea = new Sea(-TILE_D - 4);
  private tiles: THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial[]>[] = [];
  private mats: Array<[THREE.MeshLambertMaterial, THREE.MeshLambertMaterial]>;

  constructor() {
    super(GRID.x + GRID.w / 2, GRID.y + GRID.h / 2);
    this.scene.background = new THREE.Color('#123a7a');
    this.scene.fog = new THREE.Fog('#1a4a8e', 430, 820);
    addLights(this.scene);
    this.scene.add(this.sea.mesh);
    this.look([0, 262, 270], [0, -16, 16]);
    // Top in the filter color, sides a shade darker.
    this.mats = FILTERS.map(([, color]) => {
      const c = new THREE.Color(color);
      return [lambert(c), lambert(c.clone().multiplyScalar(0.55))];
    });
    const geo = new THREE.BoxGeometry(TILE_W - 3, TILE_D, TILE_H - 3);
    for (let i = 0; i < COLS * ROWS; i++) {
      const m = new THREE.Mesh(geo, [this.mats[0][1], this.mats[0][1], this.mats[0][0], this.mats[0][1], this.mats[0][1], this.mats[0][1]]);
      this.tiles.push(m);
      this.scene.add(m);
    }
  }

  draw(ctx: CanvasRenderingContext2D, st: FilterState, time: number, localId: PlayerId): void {
    this.sea.update(time);
    let sink = 0;
    if (st.phase === 'sink') sink = Math.min(1, st.phaseTime / 0.35);
    else if (st.phase === 'rise') sink = 1 - st.phaseTime / RISE_TIME;
    const shake = st.phase === 'call' && st.callTime - st.phaseTime < 0.45;
    this.tiles.forEach((m, i) => {
      const t = st.tiles[i];
      const [top, side] = this.mats[t] ?? this.mats[0];
      if (m.material[2] !== top) m.material = [side, side, top, side, side, side];
      const safe = t === st.target;
      const x = GRID.x + (i % COLS) * TILE_W + TILE_W / 2;
      const y = GRID.y + Math.floor(i / COLS) * TILE_H + TILE_H / 2;
      const jitter = !safe && shake ? Math.sin(time * 60 + i) * 0.8 : 0;
      m.position.set(this.wx(x) + jitter, -TILE_D / 2 - (safe ? 0 : sink * SINK_DEPTH), this.wz(y));
      // Safe ones pulse a little while the others go under.
      const s = safe && st.phase === 'sink' ? 1 + Math.sin(time * 10) * 0.02 : 1;
      m.scale.set(s, 1, s);
    });

    this.beginChars();
    for (const p of st.players) {
      if (p.status === 'out') continue;
      if (p.status === 'dead') {
        if (p.deathAnim <= 0) continue;
        // Goes down with the block, tipping over.
        const k = 1 - p.deathAnim / DEATH_ANIM;
        this.placeChar(p.id, p.character, p.x, p.y, time, { y: -k * 30, tilt: k * 1.3, speed: 0 });
        continue;
      }
      const blink = p.ghost > 0 && Math.floor(time * 16) % 2 === 0;
      this.placeChar(p.id, p.character, p.x, p.y, time, { visible: !blink });
    }
    this.endChars(localId, time);
    this.present(ctx);
    drawFilterCall(ctx, st);
  }

  positions(st: FilterState): Array<[PlayerId, number, number]> {
    return st.players.filter((p) => p.status === 'alive').map((p) => [p.id, ...this.projectLogic(p.x, p.y, 14)]);
  }
}

export const filter3dRenderer = stageRenderer(() => new Filter3D());
