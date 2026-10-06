import { ARENA_H, ARENA_W } from '@shared/arena';
import { MAX_HP, SHIP_R, type ShipState } from '@shared/minigames/tank/logic';
import { CHARACTERS, type PlayerId } from '@shared/types';
import * as THREE from 'three';
import { PAL } from '../core/draw';
import { Stage3D, addLights, lambert, stageRenderer, type StageScene } from './stage';

/** FLAME WAR in 3D: little spaceships (the character in the cockpit) in an asteroid field. */

const HOVER = 4; // ships float this high above the "floor" of space

interface ShipView {
  group: THREE.Group;
  hull: THREE.MeshLambertMaterial;
  flame: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>;
}

/** Screen angle (0 = right, PI/2 = down) -> rotation.y for a model facing +Z. */
const yaw = (angle: number) => Math.PI / 2 - angle;

function shipModel(character: number): ShipView {
  const ch = CHARACTERS[character];
  const group = new THREE.Group();
  const hull = lambert(ch.color);
  const body = new THREE.Mesh(new THREE.ConeGeometry(3.6, 14, 6), hull);
  body.rotation.x = Math.PI / 2; // tip toward +Z
  body.scale.set(1, 1, 0.55);
  const wings = new THREE.Mesh(new THREE.BoxGeometry(15, 1, 5), lambert(ch.dark));
  wings.position.set(0, -0.6, -3);
  const fins = [-1, 1].map((s) => {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.8, 4, 3.4), lambert(ch.light));
    f.position.set(s * 7, 1.2, -4);
    return f;
  });
  const engine = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.4, 2.4, 7), lambert('#5a5470'));
  engine.rotation.x = Math.PI / 2;
  engine.position.z = -7;
  const flame = new THREE.Mesh(new THREE.ConeGeometry(1.8, 6, 7), new THREE.MeshBasicMaterial({ color: '#ff2e88' }));
  flame.rotation.x = -Math.PI / 2;
  flame.position.z = -11;
  group.add(body, wings, ...fins, engine, flame);
  return { group, hull, flame };
}

class Tank3D extends Stage3D implements StageScene<ShipState> {
  private ships = new Map<PlayerId, ShipView>();
  private rocks = new Map<number, THREE.Mesh>();
  private shots = new Map<number, THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>>();
  private booms: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[] = [];
  private stars: THREE.Points;

  constructor() {
    super(ARENA_W / 2, ARENA_H / 2, 32);
    this.scene.background = new THREE.Color('#06030f');
    addLights(this.scene, '#c8d0ff', '#1a0a3a', 1.9);
    this.look([0, 330, 175], [0, 0, 10]);

    // Stars far below the ships, plus a faint nebula.
    const pts: number[] = [];
    for (let i = 0; i < 500; i++) pts.push((Math.random() - 0.5) * 900, -60 - Math.random() * 120, (Math.random() - 0.5) * 600);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffffff', size: 2, sizeAttenuation: false }));
    this.scene.add(this.stars);
    for (const [x, z, c, r] of [[-130, -40, '#3a1a6a', 110], [140, 60, '#5a1a4a', 90]] as const) {
      const n = new THREE.Mesh(new THREE.CircleGeometry(r, 20), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.35, depthWrite: false }));
      n.rotation.x = -Math.PI / 2;
      n.position.set(x, -70, z);
      this.scene.add(n);
    }
  }

  draw(ctx: CanvasRenderingContext2D, st: ShipState, time: number, localId: PlayerId): void {
    this.stars.rotation.y = time * 0.01;

    // Asteroids: lumpy faceted rocks, slowly tumbling.
    const rockSeen = new Set<number>();
    for (const a of st.asteroids) {
      rockSeen.add(a.id);
      let m = this.rocks.get(a.id);
      if (!m) {
        m = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), lambert('#7a5a7a', undefined, { flatShading: true }));
        const k = (a.seed % 100) / 100;
        m.scale.set(a.r * (0.95 + k * 0.2), a.r * (0.7 + k * 0.3), a.r * (1.05 - k * 0.15));
        m.rotation.set(k * 3, k * 5, k * 2);
        this.scene.add(m);
        this.rocks.set(a.id, m);
      }
      m.position.set(this.wx(a.x), HOVER, this.wz(a.y));
      m.rotation.y += 0.002;
    }
    for (const [id, m] of this.rocks) if (!rockSeen.has(id)) (this.scene.remove(m), this.rocks.delete(id));

    // Lasers: glowing bolts in the shooter's color.
    const shotSeen = new Set<number>();
    for (const o of st.shots) {
      shotSeen.add(o.id);
      let m = this.shots.get(o.id);
      if (!m) {
        const ship = st.ships.find((s) => s.id === o.owner);
        m = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 9), new THREE.MeshBasicMaterial({ color: ship ? CHARACTERS[ship.character].light : '#ffffff' }));
        this.scene.add(m);
        this.shots.set(o.id, m);
      }
      m.position.set(this.wx(o.x), HOVER + 1, this.wz(o.y));
      m.rotation.y = yaw(Math.atan2(o.vy, o.vx));
    }
    for (const [id, m] of this.shots) if (!shotSeen.has(id)) (this.scene.remove(m), this.shots.delete(id));

    // Explosions.
    while (this.booms.length < st.booms.length) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 7), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
      this.scene.add(m);
      this.booms.push(m);
    }
    this.booms.forEach((m, i) => {
      const b = st.booms[i];
      m.visible = !!b;
      if (!b) return;
      const k = b.t / 0.5;
      m.position.set(this.wx(b.x), HOVER, this.wz(b.y));
      m.scale.setScalar((b.big ? 16 : 5) * (0.4 + k));
      m.material.color.set(b.big ? (k < 0.4 ? '#fff4c0' : '#ff7a1e') : '#3ee8ff');
      m.material.opacity = 1 - k;
    });

    // Ships, each with its pilot standing in the cockpit.
    this.beginChars();
    for (const s of st.ships) {
      let v = this.ships.get(s.id);
      if (!v) {
        v = shipModel(s.character);
        this.scene.add(v.group);
        this.ships.set(s.id, v);
      }
      const alive = s.status === 'alive';
      const blink = s.ghost > 0 && Math.floor(time * 16) % 2 === 0;
      v.group.visible = alive && !blink;
      if (!alive) continue;
      const bank = Math.sin(time * 2 + s.id) * 0.06;
      v.group.position.set(this.wx(s.x), HOVER + Math.sin(time * 3 + s.id) * 0.6, this.wz(s.y));
      v.group.rotation.set(0, yaw(s.angle), bank);
      v.group.scale.setScalar((SHIP_R * 2.2) / 12);
      const flash = s.hitT > 0 && Math.floor(time * 24) % 2 === 0;
      v.hull.emissive.set(flash ? '#ffffff' : s.hp < MAX_HP && Math.floor(time * 6) % 2 ? '#3a0a00' : '#000000');
      v.flame.visible = s.thrust !== 0;
      v.flame.scale.set(1, (s.thrust > 0 ? 1 : 0.5) * (1 + (Math.floor(time * 30) % 2) * 0.3), 1);
      v.flame.material.color.set(Math.floor(time * 30) % 2 ? '#ff2e88' : '#ffd23e');
      this.placeChar(s.id, s.character, s.x, s.y, time, { height: 7, y: HOVER + 1.2, heading: yaw(s.angle), speed: 0, visible: !blink, shadow: false });
    }
    for (const [id, v] of this.ships) if (!st.ships.some((s) => s.id === id)) (this.scene.remove(v.group), this.ships.delete(id));
    this.endChars(localId, time, 10);
    this.present(ctx);

    // Armor pips under your ship.
    const me = st.ships.find((s) => s.id === localId);
    if (me && me.status === 'alive') {
      const [x, y] = this.projectLogic(me.x, me.y + 8, HOVER);
      for (let k = 0; k < MAX_HP; k++) {
        ctx.fillStyle = PAL.ink;
        ctx.fillRect(Math.round(x - 6 + k * 7), Math.round(y), 5, 3);
        ctx.fillStyle = k < me.hp ? PAL.green : '#3a2a50';
        ctx.fillRect(Math.round(x - 5 + k * 7), Math.round(y + 1), 3, 1);
      }
    }
  }

  positions(st: ShipState): Array<[PlayerId, number, number]> {
    return st.ships.filter((s) => s.status === 'alive').map((s) => [s.id, ...this.projectLogic(s.x, s.y, HOVER + 6)]);
  }
}

export const tank3dRenderer = stageRenderer(() => new Tank3D());
