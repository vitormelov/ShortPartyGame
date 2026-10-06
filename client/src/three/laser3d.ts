import { CENTER, DEATH_ANIM, EMITTER_R, FIELD, FLIP_WARNING, GAP, JUMP_TIME, WALL_THICK, type LaserPlayer, type LaserState } from '@shared/minigames/laser/logic';
import type { PlayerId } from '@shared/types';
import * as THREE from 'three';
import { Stage3D, addLights, canvasTexture, lambert, stageRenderer, type StageScene } from './stage';

/** LASER GRID in 3D: low rotating beams to jump over, tall sweeping walls with gaps to run through. */

const FLOOR_H = 6;
const WALL_H = 26;
const BEAM_LEN = Math.hypot(FIELD.w, FIELD.h) / 2;

function jumpHeight(p: LaserPlayer): number {
  if (p.jump <= 0) return 0;
  return Math.sin(Math.PI * (1 - p.jump / JUMP_TIME)) * 11;
}

class Laser3D extends Stage3D implements StageScene<LaserState> {
  private emitter: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshLambertMaterial>;
  private beams: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>[] = [];
  private glow: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>[] = [];
  private segs: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>[] = [];

  constructor() {
    super(CENTER.x, CENTER.y);
    this.scene.background = new THREE.Color('#0a0820');
    this.scene.fog = new THREE.Fog('#0a0820', 460, 860);
    addLights(this.scene, '#c8e8ff', '#1a1040', 1.4);
    this.look([0, 292, 290], [0, -16, 16]);

    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(FIELD.w, FLOOR_H, FIELD.h),
      [lambert('#2a2a4a'), lambert('#2a2a4a'), lambert('#ffffff', canvasTexture(84, 47, (c) => {
        c.fillStyle = '#26264a';
        c.fillRect(0, 0, 84, 47);
        c.fillStyle = '#3a3a6a';
        for (let x = 0; x < 84; x += 6) c.fillRect(x, 0, 1, 47);
        for (let y = 0; y < 47; y += 6) c.fillRect(0, y, 84, 1);
        c.fillStyle = '#3ee8ff';
        c.fillRect(0, 0, 84, 1); c.fillRect(0, 46, 84, 1); c.fillRect(0, 0, 1, 47); c.fillRect(83, 0, 1, 47);
      })), lambert('#2a2a4a'), lambert('#2a2a4a'), lambert('#2a2a4a')],
    );
    floor.position.y = -FLOOR_H / 2;
    const pit = new THREE.Mesh(new THREE.PlaneGeometry(1000, 800), lambert('#060414'));
    pit.rotation.x = -Math.PI / 2;
    pit.position.y = -40;
    this.scene.add(floor, pit);

    this.emitter = new THREE.Mesh(new THREE.CylinderGeometry(EMITTER_R * 0.8, EMITTER_R, 8, 10), lambert('#4a4a7a'));
    this.emitter.position.y = 4;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(EMITTER_R * 0.55, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ff3b5c' }));
    dome.position.y = 8;
    this.emitter.userData.dome = dome;
    this.scene.add(this.emitter, dome);
  }

  private pool<T extends THREE.Mesh>(list: T[], n: number, make: () => T): void {
    while (list.length < n) {
      const m = make();
      this.scene.add(m);
      list.push(m);
    }
    list.forEach((m, i) => (m.visible = i < n));
  }

  draw(ctx: CanvasRenderingContext2D, st: LaserState, time: number, localId: PlayerId): void {
    // Emitter blinks before the beams reverse.
    const warn = st.flipTimer < FLIP_WARNING && Math.floor(time * 16) % 2 === 0;
    (this.emitter.userData.dome as THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>).material.color.set(warn ? '#ffd23e' : '#ff3b5c');
    this.emitter.rotation.y = st.beamAngle;

    // Rotating beams: thin red bars just above the floor, with a soft glow.
    this.pool(this.beams, st.beams, () => new THREE.Mesh(new THREE.BoxGeometry(BEAM_LEN, 1.4, 1.4), new THREE.MeshBasicMaterial({ color: '#ff3b5c' })));
    this.pool(this.glow, st.beams, () => new THREE.Mesh(new THREE.BoxGeometry(BEAM_LEN, 3.4, 4), new THREE.MeshBasicMaterial({ color: '#ff3b5c', transparent: true, opacity: 0.3, depthWrite: false })));
    const step = (Math.PI * 2) / Math.max(1, st.beams);
    for (let k = 0; k < st.beams; k++) {
      const a = st.beamAngle + k * step;
      // Stop at the floor's edge.
      const len = Math.min(FIELD.w / 2 / Math.max(1e-3, Math.abs(Math.cos(a))), FIELD.h / 2 / Math.max(1e-3, Math.abs(Math.sin(a))));
      for (const m of [this.beams[k], this.glow[k]]) {
        m.position.set((Math.cos(a) * len) / 2, 2, (Math.sin(a) * len) / 2);
        m.scale.x = len / BEAM_LEN;
        m.rotation.y = -a;
      }
      this.beams[k].material.color.set(Math.floor(time * 20 + k) % 2 ? '#ff3b5c' : '#ff7a8a');
    }

    // Walls: tall translucent slabs, split around their gaps.
    const segs: Array<[number, number, number, number]> = []; // x, z, length, vertical
    for (const w of st.walls) {
      const length = w.vertical ? FIELD.h : FIELD.w;
      let start = 0;
      for (const g of [...w.gaps].sort((a, b) => a - b)) {
        if (g > start) segs.push([w.pos, start, g - start, w.vertical ? 1 : 0]);
        start = g + GAP;
      }
      if (start < length) segs.push([w.pos, start, length - start, w.vertical ? 1 : 0]);
    }
    this.pool(this.segs, segs.length, () => new THREE.Mesh(new THREE.BoxGeometry(1, WALL_H, 1), new THREE.MeshBasicMaterial({ color: '#3ee8ff', transparent: true, opacity: 0.55, depthWrite: false })));
    segs.forEach(([pos, from, len, vertical], i) => {
      const m = this.segs[i];
      if (vertical) {
        m.position.set(this.wx(pos), WALL_H / 2, this.wz(FIELD.y + from + len / 2));
        m.scale.set(WALL_THICK, 1, len);
      } else {
        m.position.set(this.wx(FIELD.x + from + len / 2), WALL_H / 2, this.wz(pos));
        m.scale.set(len, 1, WALL_THICK);
      }
      m.material.opacity = 0.45 + Math.sin(time * 12 + i) * 0.1;
    });

    this.beginChars();
    for (const p of st.players) {
      if (p.status === 'out') continue;
      if (p.status === 'dead') {
        if (p.deathAnim <= 0) continue;
        // Zapped: flickers and fades out lying down.
        const k = 1 - p.deathAnim / DEATH_ANIM;
        this.placeChar(p.id, p.character, p.x, p.y, time, { speed: 0, tilt: k * 1.4, visible: Math.floor(time * 20) % 2 === 0 });
        continue;
      }
      const blink = p.ghost > 0 && Math.floor(time * 16) % 2 === 0;
      this.placeChar(p.id, p.character, p.x, p.y, time, { visible: !blink, y: jumpHeight(p), height: 14 });
    }
    this.endChars(localId, time, 14);
    this.present(ctx);
  }

  positions(st: LaserState): Array<[PlayerId, number, number]> {
    return st.players.filter((p) => p.status === 'alive').map((p) => [p.id, ...this.projectLogic(p.x, p.y, 14 + jumpHeight(p))]);
  }
}

export const laser3dRenderer = stageRenderer(() => new Laser3D());
