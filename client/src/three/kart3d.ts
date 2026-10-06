import { ARENA_H, ARENA_W } from '@shared/arena';
import type { Kart, KartState } from '@shared/minigames/kart/logic';
import { LAPS, TRACK_HALF_W, TRACK_LENGTH, TRACK_POINTS, pointOnTrack } from '@shared/minigames/kart/track';
import { CHARACTERS, type PlayerId } from '@shared/types';
import * as THREE from 'three';
import { PAL, text } from '../core/draw';
import { Stage3D, addLights, canvasTexture, lambert, stageRenderer, type StageScene } from './stage';

/** KART RUSH in 3D: a floating space circuit (Rainbow Road vibes) and low-poly karts. */

const FALL_TIME = 0.6;
const ROAD_H = 4;

/** Screen angle (0 = right) -> rotation.y for a model facing +Z. */
const yaw = (angle: number) => Math.PI / 2 - angle;

interface KartView {
  group: THREE.Group;
  sparks: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>[];
}

function kartModel(character: number): KartView {
  const ch = CHARACTERS[character];
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(7, 2.6, 11), lambert(ch.color));
  body.position.y = 2.4;
  const nose = new THREE.Mesh(new THREE.BoxGeometry(6, 1.6, 3), lambert(ch.light));
  nose.position.set(0, 2.2, 6);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 2), lambert(ch.dark));
  seat.position.set(0, 4.4, -3.2);
  const wheelGeo = new THREE.CylinderGeometry(1.8, 1.8, 1.6, 8);
  const wheelMat = lambert('#1a1a2a');
  const wheels = [[-4.2, 3.6], [4.2, 3.6], [-4.2, -3.8], [4.2, -3.8]].map(([x, z]) => {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 1.8, z);
    return w;
  });
  const sparks = [0, 1, 2, 3].map((i) => {
    const s = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), new THREE.MeshBasicMaterial({ color: '#ffd23e' }));
    s.position.set(i % 2 ? 4 : -4, 0.8, -7 - Math.floor(i / 2) * 2);
    return s;
  });
  group.add(body, nose, seat, ...wheels, ...sparks);
  return { group, sparks };
}

class Kart3D extends Stage3D implements StageScene<KartState> {
  private karts = new Map<PlayerId, KartView>();
  private stars: THREE.Points;

  constructor() {
    super(ARENA_W / 2, ARENA_H / 2, 32);
    this.scene.background = new THREE.Color('#0e0820');
    addLights(this.scene, '#e0d8ff', '#2a1a5a', 1.7);
    this.look([0, 300, 222], [0, -10, 12]);

    const pts: number[] = [];
    for (let i = 0; i < 600; i++) pts.push((Math.random() - 0.5) * 1000, -40 - Math.random() * 200, (Math.random() - 0.5) * 700);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ff9ad8', size: 2, sizeAttenuation: false }));
    this.scene.add(this.stars);

    // The road is built like the 2D stroke: a slab per straight plus a disc at each corner (round joins),
    // over a slightly wider striped curb.
    const asphalt = lambert('#575172');
    const curb = lambert('#ffffff', canvasTexture(8, 2, (c) => {
      c.fillStyle = '#fff4e0'; c.fillRect(0, 0, 4, 2);
      c.fillStyle = '#e83b3b'; c.fillRect(4, 0, 4, 2);
    }));
    const under = lambert('#24183a');
    const n = TRACK_POINTS.length;
    for (let i = 0; i < n; i++) {
      const [ax, ay] = TRACK_POINTS[i];
      const [bx, by] = TRACK_POINTS[(i + 1) % n];
      const len = Math.hypot(bx - ax, by - ay);
      const rot = -Math.atan2(by - ay, bx - ax);
      const mx = this.wx((ax + bx) / 2);
      const mz = this.wz((ay + by) / 2);
      const road = new THREE.Mesh(new THREE.BoxGeometry(len, ROAD_H, TRACK_HALF_W * 2), asphalt);
      road.position.set(mx, -ROAD_H / 2, mz);
      road.rotation.y = rot;
      const tex = curb.map!.clone();
      tex.wrapS = THREE.RepeatWrapping;
      tex.repeat.set(len / 10, 1);
      tex.needsUpdate = true;
      const c = new THREE.Mesh(new THREE.BoxGeometry(len, ROAD_H, TRACK_HALF_W * 2 + 5), [under, under, lambert('#ffffff', tex), under, under, under]);
      c.position.set(mx, -ROAD_H / 2 - 0.3, mz);
      c.rotation.y = rot;
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(TRACK_HALF_W, TRACK_HALF_W, ROAD_H, 16), asphalt);
      disc.position.set(this.wx(ax), -ROAD_H / 2, this.wz(ay));
      const cdisc = new THREE.Mesh(new THREE.CylinderGeometry(TRACK_HALF_W + 2.5, TRACK_HALF_W + 2.5, ROAD_H, 16), lambert('#fff4e0'));
      cdisc.position.set(this.wx(ax), -ROAD_H / 2 - 0.3, this.wz(ay));
      this.scene.add(c, cdisc, road, disc);
    }
    // Checkered start line.
    const start = pointOnTrack(0);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(4, TRACK_HALF_W * 2), lambert('#ffffff', canvasTexture(2, 16, (c) => {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 2; x++) {
        c.fillStyle = (x + y) % 2 ? '#0a0614' : '#ffffff';
        c.fillRect(x, y, 1, 1);
      }
    }, false)));
    flag.rotation.set(-Math.PI / 2, 0, -start.angle);
    flag.position.set(this.wx(start.x), 0.15, this.wz(start.y));
    this.scene.add(flag);
  }

  private view(k: Kart): KartView {
    let v = this.karts.get(k.id);
    if (!v) {
      v = kartModel(k.character);
      this.scene.add(v.group);
      this.karts.set(k.id, v);
    }
    return v;
  }

  draw(ctx: CanvasRenderingContext2D, st: KartState, time: number, localId: PlayerId): void {
    this.stars.rotation.y = time * 0.01;
    this.beginChars();
    for (const k of st.karts) {
      const v = this.view(k);
      const shown = k.status === 'race' || k.status === 'done' || k.status === 'falling';
      const blink = k.ghost > 0 && Math.floor(time * 16) % 2 === 0;
      v.group.visible = shown && !blink;
      if (!shown) continue;
      let y = 0;
      let spin = 0;
      if (k.status === 'falling') {
        // Off the edge: spins and drops into the void.
        const f = 1 - Math.max(0, k.fall) / FALL_TIME;
        y = -f * 60;
        spin = f * 12;
      }
      v.group.position.set(this.wx(k.x), y, this.wz(k.y));
      v.group.rotation.y = yaw(k.angle) + spin;
      v.group.rotation.z = k.drifting ? Math.sign(k.steer || 1) * 0.08 : 0;
      v.sparks.forEach((s, i) => {
        s.visible = k.drifting && k.status === 'race';
        s.material.color.set(Math.floor(time * 20 + i) % 2 ? '#ffd23e' : '#3ee8ff');
      });
      this.placeChar(k.id, k.character, k.x - Math.cos(k.angle) * 1.5, k.y - Math.sin(k.angle) * 1.5, time, {
        height: 9,
        y: y + 3.4,
        heading: yaw(k.angle) + spin,
        speed: 0,
        visible: !blink,
        shadow: false,
      });
    }
    this.endChars(localId, time, 12);
    this.present(ctx);

    // Race HUD for the local player.
    const me = st.karts.find((k) => k.id === localId);
    const progress = (k: Kart) => (k.status === 'done' ? 1e6 - k.place : k.lap * TRACK_LENGTH + k.s);
    const order = st.karts.filter((k) => k.status !== 'out').sort((a, b) => progress(b) - progress(a));
    if (me && me.status !== 'out') {
      const lap = Math.max(1, Math.min(LAPS, me.lap));
      const pos = order.indexOf(me) + 1;
      text(ctx, `VOLTA ${lap}/${LAPS}`, 4, 4, PAL.yellow);
      text(ctx, `${pos}º`, 4, 14, pos === 1 ? PAL.green : PAL.white);
    }
    for (const k of st.karts) {
      if (k.status !== 'done') continue;
      const [sx, sy] = this.projectLogic(k.x, k.y, 18);
      text(ctx, `${k.place}º`, sx - 6, sy - 8, k.place === 1 ? PAL.yellow : PAL.white);
    }
  }

  positions(st: KartState): Array<[PlayerId, number, number]> {
    return st.karts.filter((k) => k.status === 'race' || k.status === 'done').map((k) => [k.id, ...this.projectLogic(k.x, k.y, 10)]);
  }
}

export const kart3dRenderer = stageRenderer(() => new Kart3D());
