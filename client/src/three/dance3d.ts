import { ARENA_W } from '@shared/arena';
import { DEATH_ANIM, type DanceState } from '@shared/minigames/dance/logic';
import type { PlayerId } from '@shared/types';
import * as THREE from 'three';
import { PAL } from '../core/draw';
import { dancerPos, drawDanceHud } from '../minigames/dance';
import { Stage3D, addLights, lambert, stageRenderer, type StageScene } from './stage';

/** TREND DA DANCINHA in 3D: a disco stage with flashing tiles; the note highway stays 2D on top. */

const TILE = 24;
const FLOOR_COLORS = ['#3a1a5a', '#1a2a5a', '#5a1a3a', '#1a4a4a'];

class Dance3D extends Stage3D implements StageScene<DanceState> {
  private tiles: THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>[] = [];
  private ball: THREE.Mesh;
  private spots: THREE.SpotLight[] = [];

  constructor() {
    // Centered on the stage area to the right of the highway.
    super(ARENA_W / 2 + 46, 150);
    this.scene.background = new THREE.Color('#100820');
    addLights(this.scene, '#d8c8ff', '#1a0a2a', 1.0);
    this.look([0, 120, 210], [0, 6, -6]);
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 11; c++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(TILE - 1, 3, TILE - 1), lambert(FLOOR_COLORS[0]));
        m.position.set((c - 5) * TILE, -1.5, (r - 3.5) * TILE);
        this.tiles.push(m);
        this.scene.add(m);
      }
    }
    // Back wall with a neon strip, a disco ball and colored spotlights.
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(600, 200), lambert('#1a0c30'));
    wall.position.set(0, 90, -95);
    const neon = new THREE.Mesh(new THREE.BoxGeometry(260, 3, 2), new THREE.MeshBasicMaterial({ color: '#ff5ac8' }));
    neon.position.set(0, 70, -90);
    this.ball = new THREE.Mesh(new THREE.IcosahedronGeometry(10, 1), new THREE.MeshLambertMaterial({ color: '#c8c8e0', flatShading: true, emissive: new THREE.Color('#3a3a5a') }));
    this.ball.position.set(0, 95, -30);
    this.scene.add(wall, neon, this.ball);
    for (const [x, c] of [[-90, '#ff5ac8'], [0, '#3ee8ff'], [90, '#ffd23e']] as const) {
      const sp = new THREE.SpotLight(c, 40, 400, 0.35, 0.5, 1);
      sp.position.set(x, 160, 60);
      sp.target.position.set(x * 0.5, 0, -10);
      this.spots.push(sp);
      this.scene.add(sp, sp.target);
    }
  }

  draw(ctx: CanvasRenderingContext2D, st: DanceState, time: number, localId: PlayerId): void {
    // Floor flashes on the beat.
    const beat = Math.floor(st.beat);
    const pulse = 1 - (st.beat % 1);
    this.tiles.forEach((m, i) => {
      const k = (i + Math.floor(i / 11) + beat) % 4;
      m.material.color.set(FLOOR_COLORS[k]);
      m.material.emissive.set(FLOOR_COLORS[k]).multiplyScalar(0.25 + pulse * 0.35);
    });
    this.ball.rotation.y = time * 1.2;
    this.spots.forEach((sp, i) => {
      sp.target.position.x = Math.sin(time * 1.3 + i * 2) * 80;
      sp.intensity = 25 + pulse * 30;
    });

    this.beginChars();
    const n = st.dancers.length;
    st.dancers.forEach((d, i) => {
      if (d.status === 'out') return;
      const [x, y] = dancerPos(i, n);
      if (d.status === 'dead') {
        // Face-planted from cringe.
        const k = 1 - d.deathAnim / DEATH_ANIM;
        this.placeChar(d.id, d.character, x, y, time, { heading: 0, tilt: Math.min(1, k * 3) * 1.5, speed: 0, height: 20 });
        return;
      }
      const blink = d.ghost > 0 && Math.floor(time * 16) % 2 === 0;
      // Hop on the beat; pose from the last arrow hit: spin left/right, jump on up, squat on down.
      const posing = d.judge === 'hit' && d.judgeT > 0 ? d.lastLane : -1;
      const hop = st.beat % 1 < 0.3 ? 2 : 0;
      const heading = posing === 0 ? -0.9 : posing === 3 ? 0.9 : Math.sin(st.beat * Math.PI) * 0.25;
      const o = this.placeChar(d.id, d.character, x, y, time, {
        heading,
        y: hop + (posing === 1 ? 6 : 0),
        speed: 30, // a little two-step all the time
        visible: !blink,
        height: 20,
      });
      if (posing === 2) o.scale.y *= 0.78;
    });
    this.endChars(localId, time, 20);
    this.present(ctx);

    // Cringe bars over the dancers.
    st.dancers.forEach((d, i) => {
      if (d.status !== 'alive') return;
      const [x, y] = dancerPos(i, n);
      const [sx, sy] = this.projectLogic(x, y, 26);
      const w = 18;
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(Math.round(sx - w / 2 - 1), Math.round(sy), w + 2, 4);
      ctx.fillStyle = d.cringe > 0.66 ? PAL.red : d.cringe > 0.33 ? PAL.yellow : PAL.green;
      ctx.fillRect(Math.round(sx - w / 2), Math.round(sy + 1), Math.round(w * d.cringe), 2);
    });
    drawDanceHud(ctx, st, time, localId);
  }

  positions(st: DanceState): Array<[PlayerId, number, number]> {
    return st.dancers.flatMap((d, i) => (d.status === 'alive' ? [[d.id, ...this.projectLogic(...dancerPos(i, st.dancers.length), 18)] as [PlayerId, number, number]] : []));
  }
}

export const dance3dRenderer = stageRenderer(() => new Dance3D());
