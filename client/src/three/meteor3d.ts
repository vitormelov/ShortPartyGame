import { CRATER_TIME, DEATH_ANIM, FIELD, type MeteorState } from '@shared/minigames/meteor/logic';
import type { PlayerId } from '@shared/types';
import * as THREE from 'three';
import { Sea, Stage3D, addLights, canvasTexture, lambert, stageRenderer, type StageScene } from './stage';

/** METEOR FEED in 3D: a rock plateau over lava; flaming rocks fall where the shadows grow. */

const PLATEAU_H = 8;
const DROP_H = 240; // height a meteor falls from

interface Rock {
  rock: THREE.Mesh;
  trail: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>;
  shadow: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  x: number;
  y: number;
  r: number;
}

interface Boom {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  t: number;
  r: number;
}

class Meteor3D extends Stage3D implements StageScene<MeteorState> {
  private lava = new Sea(-PLATEAU_H - 1, '#c8261e', '#e8501e');
  private rocks = new Map<number, Rock>();
  private craters: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>[] = [];
  private booms: Boom[] = [];
  private lastTime = 0;

  constructor() {
    super(FIELD.x + FIELD.w / 2, FIELD.y + FIELD.h / 2);
    this.scene.background = new THREE.Color('#2a0a0a');
    this.scene.fog = new THREE.Fog('#4a1010', 400, 780);
    addLights(this.scene, '#ffd8b0', '#6a1a0a', 1.5);
    // Lava glows from below.
    const glow = new THREE.PointLight('#ff6a1e', 2.5, 400, 1);
    glow.position.set(0, -20, 0);
    this.scene.add(glow);
    this.lava.mesh.material.emissive = new THREE.Color('#5a1006');
    this.scene.add(this.lava.mesh);
    this.look([0, 232, 252], [0, -14, 14]);

    const top = lambert('#ffffff', canvasTexture(64, 36, (c) => {
      for (let y = 0; y < 36; y += 4) {
        for (let x = 0; x < 64; x += 4) {
          c.fillStyle = ((x + y) / 4) % 2 ? '#5e4434' : '#58402f';
          c.fillRect(x, y, 4, 4);
        }
      }
      c.fillStyle = '#3e2a20';
      for (let i = 0; i < 40; i++) c.fillRect((i * 37) % 64, (i * 17) % 36, 2, 1);
    }));
    const side = lambert('#3a261c');
    const slab = new THREE.Mesh(new THREE.BoxGeometry(FIELD.w + 4, PLATEAU_H, FIELD.h + 4), [side, side, top, side, side, side]);
    slab.position.y = -PLATEAU_H / 2;
    this.scene.add(slab);
    // A few rock spires out in the lava for depth.
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Mesh(new THREE.ConeGeometry(8 + (i % 3) * 4, 30 + (i % 4) * 14, 5), lambert('#2a1a14', undefined, { flatShading: true }));
      const a = (i / 7) * Math.PI * 2 + 0.4;
      s.position.set(Math.cos(a) * 240, -PLATEAU_H, Math.sin(a) * 150 - 40);
      this.scene.add(s);
    }
  }

  private rockView(id: number, m: { x: number; y: number; r: number }): Rock {
    let v = this.rocks.get(id);
    if (!v) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), lambert('#3a2418', undefined, { flatShading: true, emissive: new THREE.Color('#3a0a00') }));
      const trail = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 6, 1, true), new THREE.MeshBasicMaterial({ color: '#ff9a1e', transparent: true, opacity: 0.8, depthWrite: false }));
      const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 18), new THREE.MeshBasicMaterial({ color: '#0a0614', transparent: true, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2;
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 24), new THREE.MeshBasicMaterial({ color: '#ff3b5c', depthWrite: false, transparent: true }));
      ring.rotation.x = -Math.PI / 2;
      this.scene.add(rock, trail, shadow, ring);
      v = { rock, trail, shadow, ring, x: m.x, y: m.y, r: m.r };
      this.rocks.set(id, v);
    }
    v.x = m.x;
    v.y = m.y;
    v.r = m.r;
    return v;
  }

  draw(ctx: CanvasRenderingContext2D, st: MeteorState, time: number, localId: PlayerId): void {
    const dt = Math.max(0, Math.min(0.1, time - this.lastTime));
    this.lastTime = time;
    this.lava.update(time * 0.6, 0.6);

    // Meteors: a rock dropping from the sky on a slant, its shadow growing below.
    const seen = new Set<number>();
    for (const m of st.meteors) {
      seen.add(m.id);
      const v = this.rockView(m.id, m);
      const p = 1 - m.t / m.warn;
      const x = this.wx(m.x);
      const z = this.wz(m.y);
      v.shadow.position.set(x, 0.35, z);
      const sr = m.r * (0.4 + 0.6 * p);
      v.shadow.scale.set(sr, sr, 1);
      v.shadow.material.opacity = 0.2 + p * 0.45;
      v.ring.visible = m.t < 0.5 && Math.floor(time * 16) % 2 === 0;
      v.ring.position.set(x, 0.45, z);
      v.ring.scale.set(m.r, m.r, 1);
      const h = Math.min(1, m.t / 0.9) * DROP_H;
      const show = m.t < 0.9;
      const rr = Math.max(3, m.r * 0.55);
      v.rock.visible = v.trail.visible = show;
      v.rock.position.set(x + h * 0.35, h + rr, z - h * 0.15);
      v.rock.scale.setScalar(rr);
      v.rock.rotation.set(time * 3, time * 2, 0);
      // Fire trail pointing back up the path.
      v.trail.position.set(x + h * 0.35 + rr * 1.2, h + rr + rr * 2.2, z - h * 0.15 - rr * 0.4);
      v.trail.scale.set(rr * 0.9, rr * 4.5, rr * 0.9);
      v.trail.rotation.z = 0.33;
      v.trail.material.color.set(Math.floor(time * 20) % 2 ? '#ff9a1e' : '#ffd23e');
    }
    for (const [id, v] of this.rocks) {
      if (seen.has(id)) continue;
      // It landed: boom.
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 7), new THREE.MeshBasicMaterial({ color: '#ffd23e', transparent: true }));
      mesh.position.set(this.wx(v.x), 2, this.wz(v.y));
      this.scene.add(mesh);
      this.booms.push({ mesh, t: 0, r: v.r });
      this.scene.remove(v.rock, v.trail, v.shadow, v.ring);
      this.rocks.delete(id);
    }
    this.booms = this.booms.filter((b) => {
      b.t += dt;
      const k = b.t / 0.35;
      b.mesh.scale.setScalar(b.r * (0.6 + k * 0.9));
      b.mesh.material.opacity = 1 - k;
      b.mesh.material.color.set(k < 0.4 ? '#fff4c0' : '#ff7a1e');
      if (k >= 1) this.scene.remove(b.mesh);
      return k < 1;
    });

    // Craters: glowing pools that cool down.
    while (this.craters.length < st.craters.length) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(1, 18), new THREE.MeshBasicMaterial({ color: '#ff6a1e' }));
      m.rotation.x = -Math.PI / 2;
      this.scene.add(m);
      this.craters.push(m);
    }
    this.craters.forEach((m, i) => {
      const c = st.craters[i];
      m.visible = !!c;
      if (!c) return;
      const f = c.t / CRATER_TIME;
      m.position.set(this.wx(c.x), 0.3, this.wz(c.y));
      m.scale.setScalar(c.r * (0.5 + 0.5 * f));
      m.material.color.set(f > 0.5 ? (Math.floor(time * 10) % 2 ? '#ff9a1e' : '#ffd23e') : '#c8461e');
    });

    this.beginChars();
    for (const p of st.players) {
      if (p.status === 'out') continue;
      if (p.status === 'dead') {
        if (p.deathAnim <= 0) continue;
        // Flattened and charred.
        const o = this.placeChar(p.id, p.character, p.x, p.y, time, { speed: 0 });
        const s = Math.max(0.1, p.deathAnim / DEATH_ANIM);
        o.scale.y *= s;
        continue;
      }
      const blink = p.ghost > 0 && Math.floor(time * 16) % 2 === 0;
      this.placeChar(p.id, p.character, p.x, p.y, time, { visible: !blink, tilt: p.dashT > 0 ? 0.5 : 0 });
    }
    this.endChars(localId, time);
    this.present(ctx);

    const me = st.players.find((p) => p.id === localId);
    if (me && me.status === 'alive' && me.dashCd > 0) this.cooldownBar(ctx, me.x, me.y, 1 - me.dashCd / 1.4);
  }

  positions(st: MeteorState): Array<[PlayerId, number, number]> {
    return st.players.filter((p) => p.status === 'alive').map((p) => [p.id, ...this.projectLogic(p.x, p.y, 14)]);
  }
}

export const meteor3dRenderer = stageRenderer(() => new Meteor3D());
