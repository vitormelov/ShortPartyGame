import { FALL_TIME, FLOE, SHOVE_COOLDOWN, type PenguinState } from '@shared/minigames/penguin/logic';
import type { PlayerId } from '@shared/types';
import * as THREE from 'three';
import { Sea, Stage3D, addLights, canvasTexture, lambert, splashRing, stageRenderer, type StageScene } from './stage';

/** CANCELAMENTO in 3D (Pushy Penguins): an ice floe on a dark sea, waddling penguins in lines. */

const FLOE_H = 7;

function penguinModel(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(5, 9, 7), lambert('#1a1a2a'));
  body.scale.set(1, 1.25, 0.95);
  body.position.y = 6;
  const belly = new THREE.Mesh(new THREE.SphereGeometry(4.2, 9, 7), lambert('#f4f4ff'));
  belly.scale.set(0.9, 1.15, 0.7);
  belly.position.set(0, 5.4, 1.6);
  const head = new THREE.Mesh(new THREE.SphereGeometry(3.6, 9, 7), lambert('#1a1a2a'));
  head.position.y = 12.4;
  const beak = new THREE.Mesh(new THREE.ConeGeometry(1.1, 3, 5), lambert('#ffa01e'));
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 12, 3.8);
  const eyes = [-1, 1].map((s) => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.9, 6, 4), lambert('#ffffff'));
    e.position.set(s * 1.4, 13.2, 3);
    return e;
  });
  // Angry brows: these penguins mean business.
  const brows = [-1, 1].map((s) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(2, 0.5, 0.5), lambert('#ff3b5c'));
    b.position.set(s * 1.4, 14.3, 3.2);
    b.rotation.z = s * 0.45;
    return b;
  });
  const feet = [-1, 1].map((s) => {
    const f = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 3), lambert('#ffa01e'));
    f.position.set(s * 1.8, 0.4, 1.2);
    return f;
  });
  const wings = [-1, 1].map((s) => {
    const w = new THREE.Mesh(new THREE.BoxGeometry(1, 6, 3), lambert('#1a1a2a'));
    w.position.set(s * 5, 7, 0);
    w.rotation.z = s * 0.25;
    return w;
  });
  g.add(body, belly, head, beak, ...eyes, ...brows, ...feet, ...wings);
  g.userData.wings = wings;
  return g;
}

class Penguin3D extends Stage3D implements StageScene<PenguinState> {
  private sea = new Sea(-FLOE_H - 2, '#0e3a5a', '#164a72');
  private penguins = new Map<number, THREE.Group>();
  private splashes = new Map<PlayerId, THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>>();
  private chunks: THREE.Mesh[] = [];

  constructor() {
    super(FLOE.x + FLOE.w / 2, FLOE.y + FLOE.h / 2);
    this.scene.background = new THREE.Color('#0e3a5a');
    this.scene.fog = new THREE.Fog('#123a5a', 400, 780);
    addLights(this.scene, '#e0f4ff', '#203a5a', 1.6);
    this.scene.add(this.sea.mesh);
    this.look([0, 232, 252], [0, -14, 14]);

    // The floe: an icy slab with snowy top and translucent blue sides.
    const top = lambert('#ffffff', canvasTexture(64, 40, (c) => {
      c.fillStyle = '#eaf6ff';
      c.fillRect(0, 0, 64, 40);
      c.fillStyle = '#c8e4f4';
      for (let i = 0; i < 18; i++) c.fillRect((i * 37) % 64, (i * 23) % 40, 5, 1);
      c.fillStyle = '#ffffff';
      for (let i = 0; i < 30; i++) c.fillRect((i * 13) % 64, (i * 29) % 40, 1, 1);
    }));
    const side = lambert('#5aa8d8');
    const slab = new THREE.Mesh(new THREE.BoxGeometry(FLOE.w, FLOE_H, FLOE.h), [side, side, top, side, side, side]);
    slab.position.y = -FLOE_H / 2;
    const under = new THREE.Mesh(new THREE.BoxGeometry(FLOE.w - 10, 14, FLOE.h - 10), lambert('#2a6a9a'));
    under.position.y = -FLOE_H - 6;
    this.scene.add(slab, under);

    // Ice chunks drifting around.
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(8 + (i % 3) * 4, 3, 6 + (i % 2) * 4), lambert('#c8e8f8'));
      this.chunks.push(m);
      this.scene.add(m);
    }
  }

  draw(ctx: CanvasRenderingContext2D, st: PenguinState, time: number, localId: PlayerId): void {
    this.sea.update(time, 0.8);
    this.chunks.forEach((m, i) => {
      const a = i * 0.7 + time * 0.03;
      const r = 200 + (i % 3) * 30;
      m.position.set(Math.cos(a) * r, -FLOE_H - 1 + Math.sin(time * 1.5 + i) * 0.6, Math.sin(a) * r * 0.6);
      m.rotation.y = a * 2;
    });

    // Penguins: waddle along their velocity.
    const seen = new Set<number>();
    for (const p of st.penguins) {
      seen.add(p.id);
      let g = this.penguins.get(p.id);
      if (!g) {
        g = penguinModel();
        g.scale.setScalar(0.85);
        this.scene.add(g);
        this.penguins.set(p.id, g);
      }
      g.position.set(this.wx(p.x), Math.abs(Math.sin(time * 12 + p.id)) * 0.8, this.wz(p.y));
      g.rotation.y = Math.atan2(p.vx, p.vy);
      g.rotation.z = Math.sin(time * 12 + p.id) * 0.12;
      for (const [k, w] of (g.userData.wings as THREE.Mesh[]).entries()) w.rotation.z = (k ? 1 : -1) * (0.25 + Math.abs(Math.sin(time * 12 + p.id)) * 0.4);
    }
    for (const [id, g] of this.penguins) {
      if (seen.has(id)) continue;
      this.scene.remove(g);
      this.penguins.delete(id);
    }

    this.beginChars();
    for (const s of st.skaters) {
      let splash = this.splashes.get(s.id);
      if (!splash) {
        splash = splashRing();
        this.scene.add(splash);
        this.splashes.set(s.id, splash);
      }
      splash.visible = false;
      if (s.status !== 'alive' && s.status !== 'falling') continue;
      const blink = s.ghost > 0 && Math.floor(time * 16) % 2 === 0;
      if (s.status === 'falling') {
        // Tipping into the water.
        const k = 1 - Math.max(0, s.fall) / FALL_TIME;
        this.placeChar(s.id, s.character, s.x, s.y, time, { y: -k * 26, tilt: k * 1.2, speed: 0 });
        splash.visible = k > 0.25;
        splash.position.set(this.wx(s.x), this.sea.mesh.position.y + 1, this.wz(s.y));
        const r = 3 + (k - 0.25) * 20;
        splash.scale.set(r, r, 1);
        splash.material.opacity = 1 - k;
        continue;
      }
      // Shoving: lean into it. Sliding fast on ice: no running, just a lean.
      const speed = Math.hypot(s.vx, s.vy);
      this.placeChar(s.id, s.character, s.x, s.y, time, { visible: !blink, tilt: s.shove > 0 ? 0.45 : Math.min(0.2, speed / 400) });
    }
    this.endChars(localId, time);
    this.present(ctx);

    const me = st.skaters.find((s) => s.id === localId);
    if (me && me.status === 'alive' && me.shoveCd > 0) this.cooldownBar(ctx, me.x, me.y, 1 - me.shoveCd / SHOVE_COOLDOWN);
  }

  positions(st: PenguinState): Array<[PlayerId, number, number]> {
    return st.skaters.filter((s) => s.status === 'alive').map((s) => [s.id, ...this.projectLogic(s.x, s.y, 14)]);
  }
}

export const penguin3dRenderer = stageRenderer(() => new Penguin3D());
