import { ARENA_W } from '@shared/arena';
import { RESULT_TIME, TURN_TIME, type Dir, type LookState } from '@shared/minigames/look/logic';
import type { PlayerId } from '@shared/types';
import * as THREE from 'three';
import { PAL, outlinedText, text } from '../core/draw';
import { DIR_VEC, KEY, arrow, slotX } from '../minigames/look';
import { Stage3D, addLights, lambert, stageRenderer, type StageScene } from './stage';

/**
 * NÃO OLHE in 3D (Look Away): a giant hater head floats over the stage and turns to one side;
 * the players stand in a row and turn to where they chose to look.
 */

const ROW_Z = 40;

class Look3D extends Stage3D implements StageScene<LookState> {
  private head = new THREE.Group();
  private pupils: THREE.Mesh[] = [];
  private skin: THREE.MeshLambertMaterial;

  constructor() {
    super(ARENA_W / 2, 0);
    this.scene.background = new THREE.Color('#1b0b3a');
    addLights(this.scene, '#e8d8ff', '#1a0a2a', 1.4);
    this.look([0, 96, 352], [0, 30, 0]);
    const stage = new THREE.Mesh(new THREE.CylinderGeometry(190, 190, 8, 40, 1, false, 0, Math.PI), lambert('#24163f'));
    stage.rotation.y = -Math.PI / 2;
    stage.position.set(0, -4, -10);
    const rim = new THREE.Mesh(new THREE.BoxGeometry(400, 2, 2), lambert('#3a2766'));
    rim.position.set(0, 0, ROW_Z + 14);
    this.scene.add(stage, rim);
    // Spotlight cone on the hater.
    const cone = new THREE.Mesh(new THREE.ConeGeometry(60, 140, 24, 1, true), new THREE.MeshBasicMaterial({ color: '#ffe6b4', transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide }));
    cone.position.set(0, 80, -40);
    this.scene.add(cone);

    // The hater head: big red sphere, horns, two eyes with pupils.
    this.skin = lambert('#e83b3b');
    const ball = new THREE.Mesh(new THREE.SphereGeometry(24, 14, 10), this.skin);
    const horns = [-1, 1].map((s) => {
      const h = new THREE.Mesh(new THREE.ConeGeometry(4, 13, 6), lambert('#2a0a14'));
      h.position.set(s * 14, 22, 0);
      h.rotation.z = -s * 0.45;
      return h;
    });
    const eyes = [-1, 1].map((s) => {
      const w = new THREE.Mesh(new THREE.SphereGeometry(6.5, 10, 8), lambert('#fff4e0'));
      w.position.set(s * 9, 5, 19);
      const p = new THREE.Mesh(new THREE.SphereGeometry(3, 8, 6), lambert('#0a0614'));
      p.position.set(s * 9, 5, 25);
      this.pupils.push(p);
      return [w, p];
    }).flat();
    const brows = [-1, 1].map((s) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(11, 2.4, 3), lambert('#2a0a14'));
      b.position.set(s * 9, 14, 21);
      b.rotation.z = s * 0.3;
      return b;
    });
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(16, 3, 3), lambert('#2a0a14'));
    mouth.position.set(0, -10, 21);
    this.head.add(ball, ...horns, ...eyes, ...brows, mouth);
    this.head.position.set(0, 62, -30);
    this.scene.add(this.head);
  }

  draw(ctx: CanvasRenderingContext2D, st: LookState, time: number, localId: PlayerId): void {
    // Stares at you while you choose, spins, then commits to a side.
    let look: Dir | -1 = -1;
    if (st.phase === 'turn') look = st.phaseTime < TURN_TIME * 0.7 ? ((Math.floor(st.phaseTime * 14) % 4) as Dir) : st.haterDir;
    else if (st.phase === 'result') look = st.haterDir;
    const [vx, vy] = look === -1 ? [0, 0] : DIR_VEC[look];
    const want = new THREE.Euler(vy * 0.55, vx * 0.75, 0);
    this.head.rotation.x += (want.x - this.head.rotation.x) * 0.35;
    this.head.rotation.y += (want.y - this.head.rotation.y) * 0.35;
    this.head.position.y = 62 + Math.sin(time * 2) * 1.5;
    this.pupils.forEach((p, i) => p.position.set((i ? 9 : -9) + vx * 2.5, 5 - vy * 2.5, 25));
    this.skin.emissive.set(st.phase === 'result' ? '#4a0a0a' : '#000000');

    this.beginChars();
    const n = st.lookers.length;
    st.lookers.forEach((l, i) => {
      if (l.status === 'out') return;
      const x = this.wx(slotX(i, n));
      const caught = l.result === 'caught';
      // After the reveal everyone turns to where they looked.
      let heading = 0;
      let tilt = 0;
      if (st.phase !== 'choose' && l.choice !== -1) {
        if (l.choice === 1) heading = 1.2;
        if (l.choice === 3) heading = -1.2;
        if (l.choice === 0) tilt = -0.35;
        if (l.choice === 2) tilt = 0.35;
      }
      if (caught && st.phase === 'result') tilt = Math.min(1.4, st.phaseTime * 3);
      const hop = !caught && st.phase === 'result' && l.result === 'safe' ? Math.abs(Math.sin(time * 10)) * 3 : 0;
      this.placeChar(l.id, l.character, 0, 0, time, { world: [x, hop, ROW_Z], heading, tilt, speed: 0, height: 18 });
    });
    this.endChars(localId, time, 18);
    this.present(ctx);

    if (st.phase === 'result') {
      const [hx, hy] = this.project(0, 62, -30);
      const pulse = Math.floor(time * 8) % 2;
      arrow(ctx, hx + vx * 52, hy + vy * 40, st.haterDir, 9 + pulse, PAL.red);
    }
    const me = st.lookers.find((l) => l.id === localId);
    if (st.phase === 'choose') {
      const left = Math.max(0, Math.ceil(st.chooseTime - st.phaseTime));
      outlinedText(ctx, `${left}`, 40, 30, left <= 1 ? PAL.red : PAL.yellow, 32);
      outlinedText(ctx, 'NÃO OLHE!', ARENA_W - 64, 36, PAL.white, 8);
      if (me && me.status === 'alive') text(ctx, me.choice === -1 ? 'ESCOLHA: WASD' : `VOCÊ: ${KEY[me.choice]}`, ARENA_W - 64, 52, me.choice === -1 ? PAL.grey : PAL.cyan, 8, 'center');
    }
    st.lookers.forEach((l, i) => {
      if (l.status === 'out') return;
      const [x, y] = this.project(this.wx(slotX(i, n)), 26, ROW_Z);
      const [, fy] = this.project(this.wx(slotX(i, n)), 0, ROW_Z);
      const mine = l.id === localId;
      const caught = l.result === 'caught';
      if (st.phase === 'choose') {
        if (mine && l.choice !== -1) arrow(ctx, x, y, l.choice, 5, PAL.cyan);
        else if (!mine) text(ctx, l.choice === -1 ? '...' : '?', x + 1, y - 4, l.choice === -1 ? PAL.grey : PAL.yellow, 8, 'center');
      } else if (l.choice !== -1) {
        arrow(ctx, x, y, l.choice, 5, caught ? PAL.red : PAL.green);
        if (l.random) text(ctx, '?', x + 8, y - 10, PAL.grey, 8, 'center');
        if (st.phase === 'result') text(ctx, caught ? '-1' : 'OK', x + 1, fy + 4, caught ? PAL.red : PAL.green, 8, 'center');
      }
    });
    if (st.phase === 'result' && me && me.result) {
      const t = Math.min(1, st.phaseTime / (RESULT_TIME * 0.3));
      outlinedText(ctx, me.result === 'caught' ? 'TE PEGOU! -1' : 'ESCAPOU!', 64, 40 + (1 - t) * 6, me.result === 'caught' ? PAL.red : PAL.green, 8);
    }
  }

  positions(st: LookState): Array<[PlayerId, number, number]> {
    const n = st.lookers.length;
    return st.lookers.flatMap((l, i) => (l.status === 'alive' ? [[l.id, ...this.project(this.wx(slotX(i, n)), 14, ROW_Z)] as [PlayerId, number, number]] : []));
  }
}

export const look3dRenderer = stageRenderer(() => new Look3D());
