import { DEATH_ANIM, FURNITURE, LIGHT_HALF, LIGHT_LEN, ROOM, inLight, type LPlayer, type LanternState } from '@shared/minigames/lantern/logic';
import type { PlayerId } from '@shared/types';
import * as THREE from 'three';
import { PAL } from '../core/draw';
import { hash } from '../minigames/renderer';
import { Stage3D, canvasTexture, lambert, stageRenderer, type StageScene } from './stage';

/**
 * LANTERNA FEED in 3D: a haunted room in real darkness. Every player carries a spotlight
 * flashlight; ghosts only show up inside a beam (in the dark you just see their red eyes).
 */

const WALL_H = 34;

function lightOn(p: LPlayer, time: number): boolean {
  if (!p.light || p.status !== 'alive') return false;
  // Low battery flickers.
  return !(p.battery < 0.2 && hash(Math.floor(time * 15) + p.id * 7) < 0.35);
}

interface Lamp {
  spot: THREE.SpotLight;
  glow: THREE.PointLight;
}

interface GhostView {
  body: THREE.Group;
  mat: THREE.MeshLambertMaterial;
  eyes: THREE.Group;
}

function ghostModel(): GhostView {
  const body = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: '#e8f0ff', transparent: true, opacity: 0.85, emissive: new THREE.Color('#202838') });
  const head = new THREE.Mesh(new THREE.SphereGeometry(6, 10, 8), mat);
  head.position.y = 12;
  const skirt = new THREE.Mesh(new THREE.ConeGeometry(6, 10, 10, 1, true), mat);
  skirt.position.y = 5;
  skirt.rotation.x = Math.PI;
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(1.6, 6, 4), lambert('#1a1a3a'));
  mouth.position.set(0, 9.5, 5.4);
  body.add(head, skirt, mouth);
  // The eyes glow red even in the dark (basic material ignores lighting).
  const eyes = new THREE.Group();
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(1.1, 6, 4), new THREE.MeshBasicMaterial({ color: '#ff283c' }));
    e.position.set(s * 2.2, 13, 5.4);
    eyes.add(e);
  }
  return { body, mat, eyes };
}

class Lantern3D extends Stage3D implements StageScene<LanternState> {
  private lamps = new Map<PlayerId, Lamp>();
  private ghosts = new Map<number, GhostView>();
  private puffs = new Map<number, THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>>();

  constructor() {
    super(ROOM.x + ROOM.w / 2, ROOM.y + ROOM.h / 2);
    this.scene.background = new THREE.Color('#06020e');
    // Almost no ambient light: the flashlights do the work.
    this.scene.add(new THREE.HemisphereLight('#3a3a6a', '#0a0414', 0.35));
    this.look([0, 262, 252], [0, -14, 14]);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.h), lambert('#ffffff', canvasTexture(64, 32, (c) => {
      for (let y = 0; y < 32; y += 4) {
        c.fillStyle = (y / 4) % 2 ? '#5a3a28' : '#4e3222';
        c.fillRect(0, y, 64, 4);
        c.fillStyle = '#2a1810';
        c.fillRect(((y * 7) % 48) + 4, y, 1, 4);
      }
    })));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    // Walls with old wallpaper.
    const paper = lambert('#ffffff', canvasTexture(16, 16, (c) => {
      c.fillStyle = '#3a2a4a'; c.fillRect(0, 0, 16, 16);
      c.fillStyle = '#4a3a5a'; c.fillRect(7, 0, 2, 16);
      c.fillStyle = '#5a4a3a'; c.fillRect(0, 13, 16, 3);
    }));
    paper.map!.wrapS = THREE.RepeatWrapping;
    paper.map!.repeat.set(20, 1);
    paper.map!.needsUpdate = true;
    for (const [x, z, w, d] of [
      [0, -ROOM.h / 2 - 3, ROOM.w + 12, 6],
      [0, ROOM.h / 2 + 3, ROOM.w + 12, 6],
      [-ROOM.w / 2 - 3, 0, 6, ROOM.h],
      [ROOM.w / 2 + 3, 0, 6, ROOM.h],
    ]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, z > 0 ? 8 : WALL_H, d), paper);
      wall.position.set(x, (z > 0 ? 8 : WALL_H) / 2, z);
      this.scene.add(wall);
    }
    // Furniture: dusty wooden blocks with a lighter top.
    const wood = lambert('#6a4a30');
    const top = lambert('#8a6a48');
    FURNITURE.forEach(([x, y, w, h], i) => {
      const height = i === 2 ? 10 : 16;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, height, h), [wood, wood, top, wood, wood, wood]);
      m.position.set(this.wx(x + w / 2), height / 2, this.wz(y + h / 2));
      this.scene.add(m);
    });
    // A candle that barely lights the middle table.
    const candle = new THREE.PointLight('#ff9a3e', 1.2, 60, 0);
    candle.position.set(this.wx(FURNITURE[2][0] + FURNITURE[2][2] / 2), 18, this.wz(FURNITURE[2][1] + FURNITURE[2][3] / 2));
    this.scene.add(candle);
  }

  private lamp(id: PlayerId): Lamp {
    let l = this.lamps.get(id);
    if (!l) {
      const spot = new THREE.SpotLight('#fff0c8', 0, LIGHT_LEN * 1.5, LIGHT_HALF * 1.1, 0.45, 0);
      const glow = new THREE.PointLight('#8a7aff', 0.9, 28, 0);
      this.scene.add(spot, spot.target, glow);
      l = { spot, glow };
      this.lamps.set(id, l);
    }
    return l;
  }

  draw(ctx: CanvasRenderingContext2D, st: LanternState, time: number, localId: PlayerId): void {
    this.beginChars();
    for (const p of st.players) {
      const l = this.lamp(p.id);
      const shown = p.status === 'alive' || (p.status === 'dead' && p.deathAnim > 0);
      l.glow.intensity = shown ? 0.9 : 0;
      l.spot.intensity = lightOn(p, time) ? 3.2 : 0;
      if (!shown) continue;
      const x = this.wx(p.x);
      const z = this.wz(p.y);
      l.glow.position.set(x, 10, z);
      l.spot.position.set(x + p.fx * 3, 9, z + p.fy * 3);
      l.spot.target.position.set(x + p.fx * LIGHT_LEN, 0, z + p.fy * LIGHT_LEN);
      if (p.status === 'dead') {
        const k = 1 - p.deathAnim / DEATH_ANIM;
        this.placeChar(p.id, p.character, p.x, p.y, time, { speed: 0, tilt: k * 1.4, height: 14 });
        continue;
      }
      const blink = p.ghost > 0 && Math.floor(time * 16) % 2 === 0;
      this.placeChar(p.id, p.character, p.x, p.y, time, { heading: Math.atan2(p.fx, p.fy), speed: p.walk > 0 ? 60 : 0, visible: !blink, height: 14 });
    }
    this.endChars(localId, time, 14);

    // Ghosts: solid in a beam (and burning if it's being fried), only red eyes in the dark.
    const seen = new Set<number>();
    for (const g of st.ghosts) {
      seen.add(g.id);
      let v = this.ghosts.get(g.id);
      if (!v) {
        v = ghostModel();
        this.scene.add(v.body, v.eyes);
        this.ghosts.set(g.id, v);
      }
      let puff = this.puffs.get(g.id);
      if (!puff) {
        puff = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: '#c8dcff', transparent: true, depthWrite: false }));
        this.scene.add(puff);
        this.puffs.set(g.id, puff);
      }
      const x = this.wx(g.x);
      const z = this.wz(g.y);
      const y = 4 + Math.sin(time * 5 + g.id) * 1.5;
      puff.visible = g.respawn > 1.1;
      if (puff.visible) {
        const p = (1.5 - g.respawn) / 0.4;
        puff.position.set(x, 12, z);
        puff.scale.setScalar(4 + p * 14);
        puff.material.opacity = 1 - p;
      }
      if (g.respawn > 0) {
        v.body.visible = v.eyes.visible = false;
        continue;
      }
      const lit = st.players.some((p) => p.status === 'alive' && inLight(p, g.x, g.y));
      v.body.visible = lit;
      v.eyes.visible = true;
      // Face the nearest player.
      let face = 0;
      let best = Infinity;
      for (const p of st.players) {
        if (p.status !== 'alive') continue;
        const d = Math.hypot(p.x - g.x, p.y - g.y);
        if (d < best) {
          best = d;
          face = Math.atan2(p.x - g.x, p.y - g.y);
        }
      }
      for (const o of [v.body, v.eyes]) {
        o.position.set(x, y, z);
        o.rotation.y = face;
      }
      const burn = g.lit && Math.floor(time * 20) % 2 === 0;
      v.mat.color.set(burn ? '#ffb0b0' : '#e8f0ff');
      v.mat.emissive.set(burn ? '#5a1010' : '#202838');
      for (const e of v.eyes.children as THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[]) e.material.opacity = 1;
    }
    for (const [id, v] of this.ghosts) {
      if (seen.has(id)) continue;
      this.scene.remove(v.body, v.eyes, this.puffs.get(id)!);
      this.ghosts.delete(id);
      this.puffs.delete(id);
    }
    this.present(ctx);

    // Battery under you.
    const me = st.players.find((p) => p.id === localId);
    if (me && me.status === 'alive') {
      const [sx, sy] = this.projectLogic(me.x, me.y + 6);
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(Math.round(sx - 6), Math.round(sy), 12, 3);
      ctx.fillStyle = me.battery < 0.2 ? PAL.red : me.battery < 0.5 ? PAL.yellow : PAL.green;
      ctx.fillRect(Math.round(sx - 5), Math.round(sy + 1), Math.round(10 * me.battery), 1);
    }
  }

  positions(st: LanternState): Array<[PlayerId, number, number]> {
    return st.players.filter((p) => p.status === 'alive').map((p) => [p.id, ...this.projectLogic(p.x, p.y, 14)]);
  }
}

export const lantern3dRenderer = stageRenderer(() => new Lantern3D());
