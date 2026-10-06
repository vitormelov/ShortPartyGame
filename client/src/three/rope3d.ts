import { ARENA_W } from '@shared/arena';
import { GROUND_Y, HAND_H, ROPE_LEFT, ROPE_R, ROPE_RIGHT, jumpHeight, type RopeState } from '@shared/minigames/rope/logic';
import type { PlayerId } from '@shared/types';
import * as THREE from 'three';
import { PAL, outlinedText, text } from '../core/draw';
import { Stage3D, addLights, canvasTexture, lambert, stageRenderer, type StageScene } from './stage';

/**
 * CORDA QUENTE in 3D: the jumpers in a row on a stage, two big haters swinging a flaming rope that
 * really circles around them (over the heads, behind, under the feet, in front).
 */

const SEGS = 24;

function hater(): THREE.Group {
  const g = new THREE.Group();
  const red = lambert('#e83b3b');
  const body = new THREE.Mesh(new THREE.SphereGeometry(10, 10, 8), red);
  body.scale.set(1, 1.15, 0.9);
  body.position.y = 14;
  const head = new THREE.Mesh(new THREE.SphereGeometry(9, 10, 8), lambert('#ffffff', canvasTexture(64, 32, (c) => {
    c.fillStyle = '#e83b3b'; c.fillRect(0, 0, 64, 32);
    // Angry face centered at u = 0.25 (the sphere's front).
    c.fillStyle = '#ffffff';
    c.fillRect(9, 11, 6, 6); c.fillRect(17, 11, 6, 6);
    c.fillStyle = '#0a0614';
    c.fillRect(11, 13, 3, 3); c.fillRect(18, 13, 3, 3);
    c.fillRect(8, 9, 7, 2); c.fillRect(17, 9, 7, 2);
    c.fillRect(11, 21, 10, 2);
  })));
  head.position.y = 31;
  const horns = [-1, 1].map((s) => {
    const h = new THREE.Mesh(new THREE.ConeGeometry(2, 6, 5), lambert('#2a0a14'));
    h.position.set(s * 5, 40, 0);
    h.rotation.z = -s * 0.35;
    return h;
  });
  g.add(body, head, ...horns);
  return g;
}

class Rope3D extends Stage3D implements StageScene<RopeState> {
  private rope: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial>;
  private glowRope: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial>;
  private arms: THREE.Group[] = [];
  private embers: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>[] = [];

  constructor() {
    super(ARENA_W / 2, GROUND_Y);
    this.scene.background = new THREE.Color('#1a0c2a');
    this.scene.fog = new THREE.Fog('#2a0e2a', 420, 900);
    addLights(this.scene, '#ffd8c0', '#3a0a2a', 1.4);
    const fire = new THREE.PointLight('#ff6a1e', 2, 300, 1);
    fire.position.set(0, 50, 60);
    this.scene.add(fire);
    this.look([0, 84, 330], [0, 6, 0]);

    // Stage: wooden planks over a lava glow.
    const stage = new THREE.Mesh(new THREE.BoxGeometry(400, 10, 90), [lambert('#3a2418'), lambert('#3a2418'), lambert('#ffffff', canvasTexture(64, 16, (c) => {
      for (let x = 0; x < 64; x += 4) { c.fillStyle = (x / 4) % 2 ? '#4a2e20' : '#5a3a28'; c.fillRect(x, 0, 4, 16); }
    })), lambert('#3a2418'), lambert('#4a2e20'), lambert('#3a2418')]);
    stage.position.y = -5;
    const lava = new THREE.Mesh(new THREE.PlaneGeometry(1200, 800), lambert('#c8261e', undefined, { emissive: new THREE.Color('#6a1006') }));
    lava.rotation.x = -Math.PI / 2;
    lava.position.y = -30;
    this.scene.add(stage, lava);

    [ROPE_LEFT - 14, ROPE_RIGHT + 14].forEach((x, i) => {
      const t = hater();
      t.position.set(this.wx(x), 0, 0);
      t.rotation.y = i ? -Math.PI / 2 : Math.PI / 2; // facing each other
      // The cranking arm turns around the rope's axis (world X), so it lives outside the body group.
      const arm = new THREE.Group();
      const a = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 9, 6), lambert('#c82a2a'));
      a.position.y = -4.5;
      arm.add(a);
      arm.position.set(this.wx(i ? ROPE_RIGHT + 4 : ROPE_LEFT - 4), HAND_H, 0);
      this.arms.push(arm);
      this.scene.add(t, arm);
    });

    const geo = new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(), new THREE.Vector3(1, 0, 0)), SEGS, 1.4, 5);
    this.rope = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#ff6a1e' }));
    this.glowRope = new THREE.Mesh(geo.clone(), new THREE.MeshBasicMaterial({ color: '#ffd23e', transparent: true, opacity: 0.3, depthWrite: false }));
    this.scene.add(this.rope, this.glowRope);
    for (let i = 0; i < 14; i++) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), new THREE.MeshBasicMaterial({ color: '#ffd23e' }));
      this.embers.push(e);
      this.scene.add(e);
    }
  }

  /** A point on the rope: hands at both ends, the middle swung around the hand axis by `angle`. */
  private ropePoint(t: number, angle: number): THREE.Vector3 {
    const sag = 4 * t * (1 - t);
    const x = this.wx(ROPE_LEFT + (ROPE_RIGHT - ROPE_LEFT) * t);
    // angle 0 = over the heads, PI = at the feet; sin gives the front/back swing.
    return new THREE.Vector3(x, HAND_H + Math.cos(angle) * ROPE_R * sag, Math.sin(angle) * ROPE_R * 0.8 * sag);
  }

  draw(ctx: CanvasRenderingContext2D, st: RopeState, time: number, localId: PlayerId): void {
    const pts = Array.from({ length: SEGS + 1 }, (_, i) => this.ropePoint(i / SEGS, st.angle));
    const curve = new THREE.CatmullRomCurve3(pts);
    for (const [m, r] of [[this.rope, 1.4], [this.glowRope, 3]] as const) {
      m.geometry.dispose();
      m.geometry = new THREE.TubeGeometry(curve, SEGS, r, 5);
    }
    this.rope.material.color.set(Math.floor(time * 20) % 2 ? '#ff6a1e' : '#ff9a3e');
    this.embers.forEach((e, i) => {
      const p = curve.getPoint(((i + 0.5) / this.embers.length + time * 0.07) % 1);
      e.position.set(p.x, p.y + 2 + Math.sin(time * 12 + i) * 1.5, p.z);
      e.material.color.set((i + Math.floor(time * 10)) % 2 ? '#ffd23e' : '#ff6a1e');
    });
    // The turners' arms crank with the rope (pointing where its middle is).
    for (const a of this.arms) a.rotation.x = Math.PI + st.angle;

    this.beginChars();
    for (const j of st.jumpers) {
      if (j.status === 'out') continue;
      if (j.status === 'dead') {
        if (j.deathAnim <= 0) continue;
        // Tripped: flat on the floor.
        this.placeChar(j.id, j.character, j.x, GROUND_Y, time, { world: [this.wx(j.x), 0, 0], heading: 0, tilt: -Math.PI / 2, speed: 0, height: 16 });
        continue;
      }
      const blink = j.ghost > 0 && Math.floor(time * 16) % 2 === 0;
      this.placeChar(j.id, j.character, j.x, GROUND_Y, time, { world: [this.wx(j.x), jumpHeight(j), 0], heading: 0, speed: 0, visible: !blink, height: 16 });
    }
    this.endChars(localId, time, 16);
    this.present(ctx);

    const me = st.jumpers.find((j) => j.id === localId);
    if (me && me.status === 'alive') text(ctx, `PULOS: ${me.jumps}`, 6, 6, PAL.yellow);
    if (st.paceMsgT > 0 && Math.floor(time * 8) % 2 === 0) outlinedText(ctx, st.paceMsg, ARENA_W / 2, 20, st.paceMsg === 'ACELEROU!' ? PAL.red : PAL.cyan, 16);
  }

  positions(st: RopeState): Array<[PlayerId, number, number]> {
    return st.jumpers.filter((j) => j.status === 'alive').map((j) => [j.id, ...this.project(this.wx(j.x), jumpHeight(j) + 12, 0)]);
  }
}

export const rope3dRenderer = stageRenderer(() => new Rope3D());
