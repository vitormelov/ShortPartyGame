import { BALL_R, CX, CY, type PaddleState } from '@shared/minigames/paddle/logic';
import { CHARACTERS, type PlayerId } from '@shared/types';
import * as THREE from 'three';
import { Stage3D, addLights, lambert, stageRenderer, type StageScene } from './stage';

/**
 * PONG DO CANCELAMENTO in 3D: a polygon arena with a wall per side; each player stands behind
 * their paddle. The camera sits behind your side, so your goal is always at the bottom.
 */

const WALL_H = 6;

class Paddle3D extends Stage3D implements StageScene<PaddleState> {
  private floor: THREE.Mesh | null = null;
  private walls: THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>[] = [];
  private paddles = new Map<PlayerId, THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>>();
  private balls: THREE.Mesh<THREE.SphereGeometry, THREE.MeshLambertMaterial>[] = [];
  private trails: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[] = [];
  private sides = 0;
  private camSide = -1;

  constructor() {
    super(CX, CY);
    this.scene.background = new THREE.Color('#0a0618');
    this.scene.fog = new THREE.Fog('#0a0618', 380, 760);
    addLights(this.scene, '#d8d0ff', '#1a1040', 1.5);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(600, 24), lambert('#140c2a'));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.6;
    this.scene.add(ground);
  }

  /** Builds the floor and walls the first time (the polygon never changes within a match). */
  private build(st: PaddleState): void {
    if (this.sides === st.sides.length) return;
    this.sides = st.sides.length;
    if (this.floor) this.scene.remove(this.floor);
    for (const w of this.walls) this.scene.remove(w);
    this.walls = [];
    const shape = new THREE.Shape(st.sides.map((s) => new THREE.Vector2(this.wx(s.ax), -this.wz(s.ay))));
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    this.floor = new THREE.Mesh(geo, lambert('#1a1036', undefined, { side: THREE.DoubleSide }));
    this.scene.add(this.floor);
    // Rings on the floor, like the 2D version.
    for (let r = 20; r < 120; r += 20) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.6, r, 40), new THREE.MeshBasicMaterial({ color: '#2a1c5a' }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.1;
      this.scene.add(ring);
    }
    for (const s of st.sides) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(s.len + 3, WALL_H, 3), lambert('#4a4068'));
      w.position.set(this.wx((s.ax + s.bx) / 2) - s.nx * 1.5, WALL_H / 2, this.wz((s.ay + s.by) / 2) - s.ny * 1.5);
      w.rotation.y = -Math.atan2(s.by - s.ay, s.bx - s.ax);
      this.walls.push(w);
      this.scene.add(w);
    }
  }

  /** Camera behind the local player's side (or side 0 for spectators). */
  private aim(st: PaddleState, localId: PlayerId): void {
    const me = st.paddlers.find((p) => p.id === localId && p.status !== 'out');
    const side = me ? me.side : 0;
    if (side === this.camSide) return;
    this.camSide = side;
    const s = st.sides[side];
    const ox = -s.nx;
    const oz = -s.ny;
    this.look([ox * 222, 272, oz * 222], [ox * 26, -10, oz * 26]);
  }

  draw(ctx: CanvasRenderingContext2D, st: PaddleState, time: number, localId: PlayerId): void {
    this.build(st);
    this.aim(st, localId);

    st.sides.forEach((_, i) => {
      const p = st.paddlers.find((q) => q.side === i);
      const ch = p ? CHARACTERS[p.character] : null;
      const guarded = p && p.status === 'alive' && p.ghost <= 0;
      let color = '#4a4068';
      if (guarded && ch) color = ch.dark;
      else if (p && p.status === 'alive' && ch) color = Math.floor(time * 10) % 2 ? ch.dark : '#4a4068';
      if (p && p.flash > 0 && Math.floor(time * 20) % 2) color = '#ffffff';
      this.walls[i].material.color.set(color);
      // A goal you defend is a low glowing strip; a wall is a full-height block.
      this.walls[i].scale.y = guarded ? 0.35 : 1;
      this.walls[i].position.y = (WALL_H * this.walls[i].scale.y) / 2;
    });

    this.beginChars();
    for (const p of st.paddlers) {
      let m = this.paddles.get(p.id);
      if (!m) {
        const ch = CHARACTERS[p.character];
        m = new THREE.Mesh(new THREE.BoxGeometry(1, 5, 3), lambert(ch.color));
        this.scene.add(m);
        this.paddles.set(p.id, m);
      }
      m.visible = p.status === 'alive' && !(p.ghost > 0 && Math.floor(time * 16) % 2 === 0);
      if (p.status !== 'alive') continue;
      const s = st.sides[p.side];
      const tx = (s.bx - s.ax) / s.len;
      const ty = (s.by - s.ay) / s.len;
      const c = s.len / 2 + (p.u * s.len) / 2;
      const push = 4 + (p.smashT > 0 ? 4 : 0);
      const lx = s.ax + tx * c;
      const ly = s.ay + ty * c;
      m.position.set(this.wx(lx + s.nx * push), 2.5, this.wz(ly + s.ny * push));
      m.rotation.y = -Math.atan2(ty, tx);
      m.scale.x = st.paddleLen;
      m.material.emissive.set(p.id === localId ? '#3a3a3a' : '#000000');
      // The player stands right behind the paddle, outside the wall, facing in.
      this.placeChar(p.id, p.character, lx - s.nx * 9, ly - s.ny * 9, time, { heading: Math.atan2(s.nx, s.ny), height: 14, speed: 0 });
    }
    this.endChars(localId, time, 14);

    // Balls (waiting serves blink at the center) with a short trail.
    const make = () => {
      const b = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * 1.4, 10, 7), lambert('#ffffff', undefined, { emissive: new THREE.Color('#5a5a5a') }));
      this.scene.add(b);
      return b;
    };
    while (this.balls.length < st.balls.length) this.balls.push(make());
    while (this.trails.length < st.balls.length * 3) {
      const t = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 6, 4), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false }));
      this.scene.add(t);
      this.trails.push(t);
    }
    this.balls.forEach((m, i) => (m.visible = i < st.balls.length));
    this.trails.forEach((m, i) => (m.visible = i < st.balls.length * 3));
    st.balls.forEach((b, i) => {
      const m = this.balls[i];
      const sp = Math.hypot(b.vx, b.vy);
      if (b.serve > 0) {
        m.visible = Math.floor(time * 8) % 2 === 0;
        m.position.set(this.wx(CX), BALL_R * 1.4, this.wz(CY));
        m.material.color.set('#ffd23e');
        for (let k = 0; k < 3; k++) this.trails[i * 3 + k].visible = false;
        return;
      }
      m.position.set(this.wx(b.x), BALL_R * 1.4, this.wz(b.y));
      m.material.color.set(sp > 200 ? '#ffb07a' : '#ffffff');
      for (let k = 0; k < 3; k++) {
        const t = this.trails[i * 3 + k];
        const d = (k + 1) * 4;
        t.position.set(this.wx(b.x - (b.vx / (sp || 1)) * d), BALL_R * 1.4, this.wz(b.y - (b.vy / (sp || 1)) * d));
        t.material.opacity = 0.45 - k * 0.12;
        t.material.color.set(sp > 200 ? '#ff7a4a' : '#c8f0ff');
      }
    });

    this.present(ctx);
  }

  positions(st: PaddleState): Array<[PlayerId, number, number]> {
    return st.paddlers
      .filter((p) => p.status === 'alive')
      .map((p) => {
        const s = st.sides[p.side];
        const c = 0.5 + p.u / 2;
        return [p.id, ...this.projectLogic(s.ax + (s.bx - s.ax) * c - s.nx * 9, s.ay + (s.by - s.ay) * c - s.ny * 9, 16)];
      });
  }
}

export const paddle3dRenderer = stageRenderer(() => new Paddle3D());
