import { ARENA_H, ARENA_W } from '@shared/arena';
import { BRICK, COLS, PU_BOMB, PU_NONE, ROWS, WALL, type BombState } from '@shared/minigames/bomb/logic';
import type { PlayerId } from '@shared/types';
import * as THREE from 'three';
import { PAL, text } from '../core/draw';
import { Stage3D, addLights, canvasTexture, lambert, stageRenderer, type StageScene } from './stage';

/** BOMB FEED in 3D (Bomberman 64 vibes): stone pillars, brick blocks, round bombs, flame crosses. */

const T = 15;
const OX = Math.floor((ARENA_W - COLS * T) / 2);
const OY = Math.floor((ARENA_H - ROWS * T) / 2);
const BLOCK_H = 9;

/** Tile units -> logic pixels. */
const px = (c: number) => OX + c * T;
const py = (r: number) => OY + r * T;

class Bomb3D extends Stage3D implements StageScene<BombState> {
  private walls: THREE.Mesh[] = [];
  private bricks: THREE.Mesh[] = [];
  private flames: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>[] = [];
  private pups: THREE.Mesh[] = [];
  private bombs = new Map<number, THREE.Group>();

  constructor() {
    super(ARENA_W / 2, ARENA_H / 2, 32);
    this.scene.background = new THREE.Color('#122a18');
    addLights(this.scene, '#e8ffe0', '#2a3a1a', 1.7);
    this.look([0, 330, 168], [0, -4, 14]);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(COLS * T, ROWS * T),
      lambert('#ffffff', canvasTexture(COLS * 4, ROWS * 4, (c) => {
        for (let r = 0; r < ROWS; r++) for (let k = 0; k < COLS; k++) {
          c.fillStyle = (r + k) % 2 ? '#3a8a3a' : '#46a046';
          c.fillRect(k * 4, r * 4, 4, 4);
        }
      }, false)),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(this.wx(px(0) + (COLS * T) / 2), 0, this.wz(py(0) + (ROWS * T) / 2));
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 700), lambert('#1a3a22'));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.5;
    this.scene.add(ground, floor);

    const stone = lambert('#ffffff', canvasTexture(16, 16, (c) => {
      c.fillStyle = '#8a8aa0'; c.fillRect(0, 0, 16, 16);
      c.fillStyle = '#a8a8c0'; c.fillRect(1, 1, 14, 3);
      c.fillStyle = '#5a5a70'; c.fillRect(0, 14, 16, 2); c.fillRect(14, 0, 2, 16);
    }));
    const brick = lambert('#ffffff', canvasTexture(16, 16, (c) => {
      c.fillStyle = '#c86a3a'; c.fillRect(0, 0, 16, 16);
      c.fillStyle = '#7a3a1a';
      for (let y = 0; y < 16; y += 4) {
        c.fillRect(0, y, 16, 1);
        for (let x = (y / 4) % 2 ? 4 : 0; x < 16; x += 8) c.fillRect(x, y, 1, 4);
      }
    }));
    const box = new THREE.BoxGeometry(T - 0.5, BLOCK_H, T - 0.5);
    const flameGeo = new THREE.BoxGeometry(T - 1, 5, T - 1);
    for (let i = 0; i < COLS * ROWS; i++) {
      const x = this.wx(px(i % COLS) + T / 2);
      const z = this.wz(py(Math.floor(i / COLS)) + T / 2);
      const w = new THREE.Mesh(box, stone);
      w.position.set(x, BLOCK_H / 2, z);
      const b = new THREE.Mesh(box, brick);
      b.position.set(x, BLOCK_H / 2, z);
      const f = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ color: '#ff9a1e', transparent: true }));
      f.position.set(x, 2.5, z);
      const p = new THREE.Mesh(new THREE.BoxGeometry(7, 7, 7), lambert('#ffffff'));
      p.position.set(x, 6, z);
      this.walls.push(w);
      this.bricks.push(b);
      this.flames.push(f);
      this.pups.push(p);
      this.scene.add(w, b, f, p);
    }
  }

  private bombModel(ad: boolean): THREE.Group {
    const g = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(5.5, 12, 9), lambert(ad ? '#c8268a' : '#1a1a2a'));
    ball.position.y = 5.5;
    const shine = new THREE.Mesh(new THREE.SphereGeometry(1.2, 6, 4), lambert(ad ? '#ffaaee' : '#6a6a8a'));
    shine.position.set(-2, 8, 3);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 1.6, 7), lambert('#8a8aa0'));
    cap.position.y = 11.2;
    const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 3, 4), lambert('#8a6a3a'));
    fuse.position.set(0.6, 13, 0);
    fuse.rotation.z = -0.4;
    const spark = new THREE.Mesh(new THREE.SphereGeometry(1, 6, 4), new THREE.MeshBasicMaterial({ color: '#ffd23e' }));
    spark.position.set(1.4, 14.6, 0);
    g.add(ball, shine, cap, fuse, spark);
    g.userData.ball = ball;
    g.userData.spark = spark;
    return g;
  }

  draw(ctx: CanvasRenderingContext2D, st: BombState, time: number, localId: PlayerId): void {
    for (let i = 0; i < COLS * ROWS; i++) {
      this.walls[i].visible = st.grid[i] === WALL;
      this.bricks[i].visible = st.grid[i] === BRICK;
      const f = st.flames[i];
      const fm = this.flames[i];
      fm.visible = f > 0;
      if (f > 0) {
        const k = f / 0.5;
        fm.scale.set(0.6 + k * 0.4, 0.6 + k * 1.2, 0.6 + k * 0.4);
        fm.material.color.set(Math.floor(time * 20 + i) % 2 ? '#ff9a1e' : '#fff07a');
        fm.material.opacity = 0.5 + k * 0.5;
      }
      const pu = st.powerups[i];
      const pm = this.pups[i];
      pm.visible = st.grid[i] === 0 && pu !== PU_NONE;
      if (pm.visible) {
        (pm.material as THREE.MeshLambertMaterial).color.set(pu === PU_BOMB ? '#3ee8ff' : '#ff6a1e');
        pm.rotation.y = time * 2;
        pm.position.y = 6 + Math.sin(time * 4 + i) * 1.2;
      }
    }

    const seen = new Set<number>();
    for (const b of st.bombs) {
      seen.add(b.id);
      let g = this.bombs.get(b.id);
      if (!g) {
        g = this.bombModel(b.ad);
        this.scene.add(g);
        this.bombs.set(b.id, g);
      }
      const pulse = Math.sin(time * (b.fuse < 0.8 ? 30 : 10)) > 0 ? 1 : 0;
      g.position.set(this.wx(px(b.c) + T / 2), 0, this.wz(py(b.r) + T / 2));
      g.scale.setScalar(1 + pulse * 0.08);
      ((g.userData.ball as THREE.Mesh).material as THREE.MeshLambertMaterial).emissive.set(b.fuse < 0.8 && pulse ? '#ff1a3a' : '#000000');
      ((g.userData.spark as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(Math.floor(time * 24) % 2 ? '#ffd23e' : '#ff6a1e');
    }
    for (const [id, g] of this.bombs) if (!seen.has(id)) (this.scene.remove(g), this.bombs.delete(id));

    this.beginChars();
    for (const p of st.players) {
      if (p.status === 'out') continue;
      const x = px(p.x);
      const y = py(p.y);
      if (p.status === 'dead') {
        if (p.deathAnim <= 0) continue;
        // Blown up: spins and shrinks.
        const o = this.placeChar(p.id, p.character, x, y, time, { speed: 0, height: 14 });
        o.rotation.y = time * 20;
        o.scale.multiplyScalar(Math.max(0.1, p.deathAnim / 0.6));
        continue;
      }
      const blink = p.ghost > 0 && Math.floor(time * 16) % 2 === 0;
      this.placeChar(p.id, p.character, x, y, time, { visible: !blink, height: 14 });
    }
    this.endChars(localId, time, 14);
    this.present(ctx);

    for (const b of st.bombs) {
      if (!b.ad) continue;
      const [sx, sy] = this.projectLogic(px(b.c) + T / 2, py(b.r) + T / 2, 20);
      text(ctx, 'AD', sx - 7, sy - 6, PAL.pink);
    }
  }

  positions(st: BombState): Array<[PlayerId, number, number]> {
    return st.players.filter((p) => p.status === 'alive').map((p) => [p.id, ...this.projectLogic(px(p.x), py(p.y), 14)]);
  }
}

export const bomb3dRenderer = stageRenderer(() => new Bomb3D());
