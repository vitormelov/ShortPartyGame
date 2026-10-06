import { ARENA_H, ARENA_W } from '@shared/arena';
import { DEATH_ANIM, PLAT_H, floorOf, type ElevatorState } from '@shared/minigames/elevator/logic';
import type { PlayerId } from '@shared/types';
import * as THREE from 'three';
import { PAL, text } from '../core/draw';
import { Stage3D, addLights, canvasTexture, lambert, stageRenderer, type StageScene } from './stage';

/**
 * ELEVADOR SOCIAL in 3D, seen from the side (2.5D): metal girders in a shaft, lava rising from below.
 * World X = logic x - 192, world Y = -logic y; the camera follows camY.
 */

const DEPTH = 22; // platform depth
const DIST = 334; // camera distance that shows the full 384 px width at z = 0

class Elevator3D extends Stage3D implements StageScene<ElevatorState> {
  private plats = new Map<number, THREE.Mesh[]>();
  private lava: THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>;
  private lavaTop: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private wall: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>;
  private still: THREE.MeshLambertMaterial;
  private moving: THREE.MeshLambertMaterial;
  private glow: THREE.PointLight;

  constructor() {
    super(ARENA_W / 2, 0);
    this.scene.background = new THREE.Color('#1a1030');
    addLights(this.scene, '#e0e0ff', '#3a1a2a', 1.5);
    this.glow = new THREE.PointLight('#ff6a1e', 3, 260, 1);
    this.scene.add(this.glow);

    // Back wall of the shaft, scrolling with the camera.
    this.wall = new THREE.Mesh(
      new THREE.PlaneGeometry(700, 500),
      lambert('#ffffff', canvasTexture(32, 32, (c) => {
        c.fillStyle = '#241640'; c.fillRect(0, 0, 32, 32);
        c.fillStyle = '#2e1e52';
        for (let y = 0; y < 32; y += 8) for (let x = (y / 8) % 2 ? 8 : 0; x < 32; x += 16) c.fillRect(x, y, 15, 7);
      })),
    );
    this.wall.material.map!.wrapS = this.wall.material.map!.wrapT = THREE.RepeatWrapping;
    this.wall.material.map!.repeat.set(14, 10);
    this.wall.material.map!.needsUpdate = true;
    this.wall.position.z = -50;
    this.scene.add(this.wall);
    // Side rails.
    for (const x of [-ARENA_W / 2 - 4, ARENA_W / 2 + 4]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(6, 2000, 6), lambert('#4a3a6a'));
      rail.position.set(x, 0, -20);
      rail.userData.rail = true;
      this.scene.add(rail);
    }

    this.still = lambert('#ffffff', canvasTexture(16, 4, (c) => {
      c.fillStyle = '#8a8aa8'; c.fillRect(0, 0, 16, 4);
      c.fillStyle = '#c8c8e0'; c.fillRect(0, 0, 16, 1);
      c.fillStyle = '#4a4a68'; c.fillRect(3, 2, 1, 1); c.fillRect(11, 2, 1, 1);
    }));
    this.moving = lambert('#ffffff', canvasTexture(8, 4, (c) => {
      c.fillStyle = '#ffd23e'; c.fillRect(0, 0, 4, 4);
      c.fillStyle = '#1a1a2a'; c.fillRect(4, 0, 4, 4);
    }, false));
    this.moving.map!.wrapS = THREE.RepeatWrapping;
    this.moving.map!.needsUpdate = true;

    this.lava = new THREE.Mesh(new THREE.BoxGeometry(900, 400, 200), lambert('#e8501e', undefined, { emissive: new THREE.Color('#8a1a06') }));
    this.lavaTop = new THREE.Mesh(new THREE.PlaneGeometry(900, 200, 30, 4), new THREE.MeshBasicMaterial({ color: '#ffd23e', transparent: true, opacity: 0.7 }));
    this.lavaTop.rotation.x = -Math.PI / 2;
    this.scene.add(this.lava, this.lavaTop);
  }

  private platMeshes(id: number, w: number, moving: boolean): THREE.Mesh[] {
    let ms = this.plats.get(id);
    if (!ms) {
      const mat = moving ? this.moving.clone() : this.still;
      if (moving) {
        mat.map = this.moving.map!.clone();
        mat.map.repeat.set(w / 12, 1);
        mat.map.needsUpdate = true;
      }
      ms = [0, 1].map(() => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, PLAT_H, DEPTH), mat);
        this.scene.add(m);
        return m;
      });
      this.plats.set(id, ms);
    }
    return ms;
  }

  draw(ctx: CanvasRenderingContext2D, st: ElevatorState, time: number, localId: PlayerId): void {
    const midY = -(st.camY + ARENA_H / 2);
    this.look([0, midY + 78, DIST - 10], [0, midY + 4, 0]);
    this.wall.position.y = midY;
    for (const o of this.scene.children) if (o.userData.rail) o.position.y = midY;
    this.wall.material.map!.offset.y = (-midY / 500) * 10;

    const seen = new Set<number>();
    for (const pl of st.platforms) {
      seen.add(pl.id);
      const [a, b] = this.platMeshes(pl.id, pl.w, pl.vx !== 0);
      a.position.set(this.wx(pl.x + pl.w / 2), -pl.y - PLAT_H / 2, 0);
      // Wrapped copy when it pokes out the right side.
      b.visible = pl.x + pl.w > ARENA_W;
      b.position.set(this.wx(pl.x - ARENA_W + pl.w / 2), -pl.y - PLAT_H / 2, 0);
    }
    for (const [id, ms] of this.plats) if (!seen.has(id)) (ms.forEach((m) => this.scene.remove(m)), this.plats.delete(id));

    // Lava: a glowing block whose top bubbles.
    this.lava.position.set(0, -st.lavaY - 200, 0);
    this.lavaTop.position.set(0, -st.lavaY + 0.5 + Math.sin(time * 3) * 0.6, 0);
    this.lavaTop.material.color.set(Math.floor(time * 6) % 2 ? '#ffd23e' : '#ff9a1e');
    this.glow.position.set(0, -st.lavaY + 20, 40);

    this.beginChars();
    for (const p of st.players) {
      if (p.status === 'out') continue;
      if (p.status === 'dead') {
        if (p.deathAnim <= 0) continue;
        const o = this.placeChar(p.id, p.character, p.x, p.y, time, { world: [this.wx(p.x), -p.y, 4], heading: 0, speed: 0, height: 15 });
        o.scale.y *= Math.max(0.1, p.deathAnim / DEATH_ANIM);
        continue;
      }
      const blink = p.ghost > 0 && Math.floor(time * 16) % 2 === 0;
      this.placeChar(p.id, p.character, p.x, p.y, time, {
        world: [this.wx(p.x), -p.y, 4],
        heading: p.facing * 1.1, // three-quarter view toward where they walk
        speed: p.grounded ? Math.abs(p.vx) : 0,
        visible: !blink,
        height: 15,
      });
    }
    this.endChars(localId, time, 15);
    this.present(ctx);

    const me = st.players.find((p) => p.id === localId);
    if (me && me.status === 'alive') {
      text(ctx, `${floorOf(me.y)}º ANDAR`, 4, 4, PAL.yellow);
      if (st.lavaY - me.y < 40 && Math.floor(time * 8) % 2 === 0) text(ctx, 'SOBE!', 4, 14, PAL.red);
    }
  }

  positions(st: ElevatorState): Array<[PlayerId, number, number]> {
    return st.players.filter((p) => p.status === 'alive').map((p) => [p.id, ...this.project(this.wx(p.x), -p.y + 12, 4)]);
  }
}

export const elevator3dRenderer = stageRenderer(() => new Elevator3D());
