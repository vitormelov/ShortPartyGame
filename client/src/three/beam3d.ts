import { BEAM_HALF, BOLT_R, DASH_COOLDOWN, DEATH_ANIM, FIELD, FIRE_TIME, type BeamState } from '@shared/minigames/beam/logic';
import type { PlayerId } from '@shared/types';
import * as THREE from 'three';
import { Stage3D, addLights, canvasTexture, lambert, stageRenderer, type StageScene } from './stage';

/** LASER BEAM in 3D: a neon stage; beams telegraph on the floor, then fire as glowing walls. */

const FLOOR_H = 6;
const LEN = 820;

class Beam3D extends Stage3D implements StageScene<BeamState> {
  private warns: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>[] = [];
  private cores: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>[] = [];
  private halos: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>[] = [];
  private bolts: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[] = [];

  constructor() {
    super(FIELD.x + FIELD.w / 2, FIELD.y + FIELD.h / 2);
    this.scene.background = new THREE.Color('#12061e');
    this.scene.fog = new THREE.Fog('#12061e', 460, 860);
    addLights(this.scene, '#ffd8f0', '#2a0a3a', 1.4);
    this.look([0, 292, 290], [0, -16, 16]);
    const top = lambert('#ffffff', canvasTexture(91, 47, (c) => {
      for (let y = 0; y < 47; y += 4) for (let x = 0; x < 91; x += 4) {
        c.fillStyle = ((x + y) / 4) % 2 ? '#2a1040' : '#22083a';
        c.fillRect(x, y, 4, 4);
      }
      c.fillStyle = '#ff5ac8';
      c.fillRect(0, 0, 91, 1); c.fillRect(0, 46, 91, 1); c.fillRect(0, 0, 1, 47); c.fillRect(90, 0, 1, 47);
    }));
    const side = lambert('#1a0a2a');
    const floor = new THREE.Mesh(new THREE.BoxGeometry(FIELD.w, FLOOR_H, FIELD.h), [side, side, top, side, side, side]);
    floor.position.y = -FLOOR_H / 2;
    this.scene.add(floor);
  }

  private pool<T extends THREE.Mesh>(list: T[], n: number, make: () => T): void {
    while (list.length < n) {
      const m = make();
      this.scene.add(m);
      list.push(m);
    }
    list.forEach((m, i) => (m.visible = i < n));
  }

  draw(ctx: CanvasRenderingContext2D, st: BeamState, time: number, localId: PlayerId): void {
    const warning = st.beams.filter((b) => b.warn > 0);
    const firing = st.beams.filter((b) => b.warn <= 0);
    const basic = (color: string, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });

    // Telegraph: a thin line on the floor that blinks faster before firing.
    this.pool(this.warns, warning.length, () => new THREE.Mesh(new THREE.BoxGeometry(LEN, 0.4, 1.2), basic('#ff3b5c', 0.6)));
    warning.forEach((b, i) => {
      const m = this.warns[i];
      const p = 1 - b.warn / b.warnTotal;
      const bright = Math.floor(time * (8 + p * 24)) % 2 === 0;
      m.position.set(this.wx(b.x), 0.4, this.wz(b.y));
      m.rotation.y = -b.a;
      m.material.color.set(p > 0.7 ? '#ffffff' : '#ff3b5c');
      m.material.opacity = bright ? 0.45 + p * 0.55 : 0.2 + p * 0.25;
    });

    // Firing: a tall glowing wall of light.
    this.pool(this.cores, firing.length, () => new THREE.Mesh(new THREE.BoxGeometry(LEN, 12, BEAM_HALF * 2), basic('#ff5ac8', 0.9)));
    this.pool(this.halos, firing.length, () => new THREE.Mesh(new THREE.BoxGeometry(LEN, 16, BEAM_HALF * 2 + 6), basic('#ff5ac8', 0.3)));
    firing.forEach((b, i) => {
      const fade = Math.min(1, b.fire / (FIRE_TIME * 0.4));
      for (const [m, op] of [[this.cores[i], 0.9], [this.halos[i], 0.3]] as const) {
        m.position.set(this.wx(b.x), 6, this.wz(b.y));
        m.rotation.y = -b.a;
        m.material.opacity = op * fade;
      }
      this.cores[i].material.color.set(Math.floor(time * 30) % 2 ? '#ff5ac8' : '#ffc0ec');
    });

    this.pool(this.bolts, st.bolts.length, () => new THREE.Mesh(new THREE.SphereGeometry(BOLT_R * 1.3, 8, 6), basic('#ffd23e')));
    st.bolts.forEach((o, i) => {
      this.bolts[i].position.set(this.wx(o.x), 4, this.wz(o.y));
      this.bolts[i].material.color.set(Math.floor(time * 24 + i) % 2 ? '#ffd23e' : '#ffffff');
    });

    this.beginChars();
    for (const p of st.players) {
      if (p.status === 'out') continue;
      if (p.status === 'dead') {
        if (p.deathAnim <= 0) continue;
        const k = 1 - p.deathAnim / DEATH_ANIM;
        this.placeChar(p.id, p.character, p.x, p.y, time, { speed: 0, tilt: k * 1.4, visible: Math.floor(time * 20) % 2 === 0, height: 14 });
        continue;
      }
      const blink = p.ghost > 0 && Math.floor(time * 16) % 2 === 0;
      this.placeChar(p.id, p.character, p.x, p.y, time, { visible: !blink, tilt: p.dashT > 0 ? 0.5 : 0, height: 14 });
    }
    this.endChars(localId, time, 14);
    this.present(ctx);

    const me = st.players.find((p) => p.id === localId);
    if (me && me.status === 'alive' && me.dashCd > 0) this.cooldownBar(ctx, me.x, me.y, 1 - me.dashCd / DASH_COOLDOWN);
  }

  positions(st: BeamState): Array<[PlayerId, number, number]> {
    return st.players.filter((p) => p.status === 'alive').map((p) => [p.id, ...this.projectLogic(p.x, p.y, 14)]);
  }
}

export const beam3dRenderer = stageRenderer(() => new Beam3D());
