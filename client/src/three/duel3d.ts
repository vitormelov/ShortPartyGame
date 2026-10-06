import { ARENA_H, ARENA_W } from '@shared/arena';
import { PONG, SPIN_TIME, wheelAngle, type DuelState } from '@shared/minigames/duel/logic';
import { CHARACTERS, type PlayerId } from '@shared/types';
import * as THREE from 'three';
import { portrait } from '../core/draw';
import { drawDuel } from '../minigames/duel';
import { Sea, Stage3D, addLights, lambert, n64Texture, splashRing, stageRenderer, type StageScene } from './stage';

/**
 * The X1 in 3D: a Roda a Roda wheel in a TV studio, the duelists on pedestals, a western street for
 * Quick Draw, a pier over the sea for the sword duel and a table for Pong. Texts, keys and the
 * betting UI come from the 2D renderer (drawDuel with ui = true).
 *
 * Front scenes use a camera that maps 1 world unit to 1 arena pixel at z = 0, with the origin at
 * the middle of the screen: world x = px - 192, world y = 102 - py.
 */

const FRONT_DIST = (ARENA_H / 2) / Math.tan((34 / 2) * (Math.PI / 180));
const WHEEL_R = 78;
const WHEEL_Y = ARENA_H / 2 - 106; // the 2D wheel's center
const fx = (px: number) => px - ARENA_W / 2;
const fy = (py: number) => ARENA_H / 2 - py;

function cowboyHat(): THREE.Group {
  const g = new THREE.Group();
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 1, 12), lambert('#3a2410'));
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 5.4, 6, 10), lambert('#6a4a22'));
  crown.position.y = 3.4;
  g.add(brim, crown);
  return g;
}

class Duel3D extends Stage3D implements StageScene<DuelState> {
  private studio = new THREE.Group();
  private western = new THREE.Group();
  private pier = new THREE.Group();
  private table = new THREE.Group();
  private wheel = new THREE.Group();
  private wheelSet = new THREE.Group();
  private face: THREE.Mesh<THREE.CircleGeometry, THREE.MeshLambertMaterial>;
  private bulbs: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[] = [];
  private pedestals: THREE.Mesh[] = [];
  private wheelKey = '';
  private hats: THREE.Group[] = [];
  private cork: THREE.Mesh;
  private swords: THREE.Group[] = [];
  private sea = new Sea(fy(150), '#1e5ac8', '#2468d8', [900, 600]);
  private splash = splashRing();
  private paddles: THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>[] = [];
  private ball: THREE.Mesh;
  private mode = '';

  constructor() {
    super(ARENA_W / 2, ARENA_H / 2);
    addLights(this.scene, '#ffffff', '#3a2a5a', 1.6);

    // ---------- studio: the wheel and two pedestals ----------
    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(900, 500), lambert('#200c34'));
    backdrop.position.z = -60;
    this.face = new THREE.Mesh(new THREE.CircleGeometry(WHEEL_R, 48), lambert('#ffffff'));
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_R + 6, WHEEL_R + 6, 8, 48), lambert('#c8962e'));
    rim.rotation.x = Math.PI / 2;
    rim.position.z = -4.5;
    this.wheel.add(this.face);
    for (let k = 0; k < 20; k++) {
      const a = (k / 20) * Math.PI * 2;
      const b = new THREE.Mesh(new THREE.SphereGeometry(2, 6, 4), new THREE.MeshBasicMaterial({ color: '#fff8c0' }));
      b.position.set(Math.cos(a) * (WHEEL_R + 3), Math.sin(a) * (WHEEL_R + 3), 1);
      this.bulbs.push(b);
      this.wheelSet.add(b);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 6, 20), lambert('#ffd23e'));
    hub.rotation.x = Math.PI / 2;
    hub.position.z = 3;
    const stand = new THREE.Mesh(new THREE.BoxGeometry(24, 60, 10), lambert('#5a3a7a'));
    stand.position.set(0, -WHEEL_R - 10, -10);
    // Pointers at the top and bottom, tips toward the wheel.
    const pointers = [1, -1].map((s) => {
      const p = new THREE.Mesh(new THREE.ConeGeometry(8, 14, 4), lambert('#ff3b5c'));
      p.rotation.z = s > 0 ? Math.PI : 0;
      p.position.set(0, s * (WHEEL_R + 14), 6);
      return p;
    });
    this.wheel.position.y = WHEEL_Y;
    this.studio.position.y = 0;
    for (const o of [rim, hub, stand, ...pointers]) o.position.y += WHEEL_Y;
    this.bulbs.forEach((b) => (b.position.y += WHEEL_Y));
    this.wheelSet.add(rim, this.wheel, hub, stand, ...pointers);
    this.studio.add(backdrop, this.wheelSet);
    for (const x of [-96, 96]) {
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(26, 30, 16, 16), lambert('#3a2766'));
      ped.position.set(x, fy(114), -10);
      this.pedestals.push(ped);
      this.studio.add(ped);
    }
    this.scene.add(this.studio);

    // ---------- western street ----------
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(1200, 800), lambert('#d8a060'));
    sand.rotation.x = -Math.PI / 2;
    sand.position.set(0, fy(132), 0);
    const sun = new THREE.Mesh(new THREE.CircleGeometry(40, 24), new THREE.MeshBasicMaterial({ color: '#ffe07a' }));
    sun.position.set(0, fy(104) + 10, -240);
    this.western.add(sand, sun);
    for (const [x, w, h] of [[-150, 70, 70], [-60, 40, 50], [70, 44, 56], [160, 76, 64]] as const) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 30), lambert('#7a3a2a'));
      b.position.set(x, fy(132) + h / 2, -170);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 8, 4, 34), lambert('#4a2418'));
      roof.position.set(x, fy(132) + h + 2, -170);
      this.western.add(b, roof);
    }
    this.hats = [cowboyHat(), cowboyHat()];
    this.cork = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3, 6, 8), lambert('#d8a86a'));
    this.cork.rotation.z = Math.PI / 2;
    this.western.add(...this.hats, this.cork);
    this.scene.add(this.western);

    // ---------- pier over the sea ----------
    this.pier.add(this.sea.mesh, this.splash);
    const planks = new THREE.Mesh(new THREE.BoxGeometry(ARENA_W - 80, 6, 40), lambert('#a8703a'));
    planks.position.set(0, fy(132) - 3, 0);
    this.pier.add(planks);
    for (const px of [52, 120, 192, 264, 332]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 50, 6), lambert('#3a2010'));
      post.position.set(fx(px), fy(132) - 28, 16);
      this.pier.add(post);
    }
    this.swords = [0, 1].map(() => {
      const g = new THREE.Group();
      const blade = new THREE.Mesh(new THREE.BoxGeometry(1.4, 22, 0.6), lambert('#e8ecff', undefined, { emissive: new THREE.Color('#303448') }));
      blade.position.y = 13;
      const guard = new THREE.Mesh(new THREE.BoxGeometry(7, 1.6, 1.6), lambert('#ffd23e'));
      guard.position.y = 2;
      g.add(blade, guard);
      this.pier.add(g);
      return g;
    });
    this.scene.add(this.pier);

    // ---------- pong table (seen from above) ----------
    const felt = new THREE.Mesh(new THREE.BoxGeometry(ARENA_W, 6, PONG.bottom - PONG.top), lambert('#1b0b3a'));
    felt.position.set(0, -3, this.wz((PONG.top + PONG.bottom) / 2));
    const net = new THREE.Mesh(new THREE.BoxGeometry(2, 1, PONG.bottom - PONG.top), lambert('#c8c4d8'));
    net.position.set(0, 0.5, this.wz((PONG.top + PONG.bottom) / 2));
    const rails = [PONG.top, PONG.bottom].map((y) => {
      const r = new THREE.Mesh(new THREE.BoxGeometry(ARENA_W, 4, 3), lambert('#c8c4d8'));
      r.position.set(0, 2, this.wz(y));
      return r;
    });
    this.paddles = [0, 1].map(() => new THREE.Mesh(new THREE.BoxGeometry(4, 5, PONG.half * 2), lambert('#ffffff')));
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(PONG.ballR * 1.3, 10, 7), lambert('#ffffff', undefined, { emissive: new THREE.Color('#5a5a5a') }));
    this.table.add(felt, net, ...rails, ...this.paddles, this.ball);
    this.scene.add(this.table);
  }

  /** Paints the wheel's slices (with portraits) once per set of candidates. */
  private paintWheel(st: DuelState): void {
    const key = st.wheel.map((s) => `${st.candidates[s.candidate].character}:${s.start.toFixed(3)}`).join('|');
    if (key === this.wheelKey) return;
    this.wheelKey = key;
    const size = 256;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const c = cv.getContext('2d')!;
    const k = size / 2 / WHEEL_R;
    c.translate(size / 2, size / 2);
    for (const s of st.wheel) {
      const ch = CHARACTERS[st.candidates[s.candidate].character];
      const a0 = s.start;
      const a1 = a0 + s.size;
      c.fillStyle = ch.color;
      c.beginPath();
      c.moveTo(0, 0);
      c.arc(0, 0, size / 2, a0, a1);
      c.closePath();
      c.fill();
      c.fillStyle = ch.dark;
      c.beginPath();
      c.moveTo(0, 0);
      c.arc(0, 0, size / 2 * 0.38, a0, a1);
      c.closePath();
      c.fill();
      c.strokeStyle = '#0a0614';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(Math.cos(a0) * size / 2, Math.sin(a0) * size / 2);
      c.stroke();
      const mid = (a0 + a1) / 2;
      c.save();
      c.translate(Math.cos(mid) * WHEEL_R * 0.66 * k, Math.sin(mid) * WHEEL_R * 0.66 * k);
      c.scale(k, k);
      portrait(c, st.candidates[s.candidate].character, -8, -8, 1);
      c.restore();
    }
    this.face.material.map?.dispose();
    this.face.material.map = n64Texture(new THREE.CanvasTexture(cv));
    this.face.material.needsUpdate = true;
  }

  private setMode(mode: string): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.studio.visible = mode === 'studio';
    this.western.visible = mode === 'quickdraw';
    this.pier.visible = mode === 'sword';
    this.table.visible = mode === 'pong';
    const bg = { studio: '#1a0a2a', quickdraw: '#f27a3a', sword: '#6a9af0', pong: '#0a0618' }[mode] ?? '#1a0a2a';
    this.scene.background = new THREE.Color(bg);
    this.scene.fog = mode === 'quickdraw' ? new THREE.Fog('#ff9a4a', 380, 700) : null;
    if (mode === 'pong') this.look([0, 370, 250], [0, -8, 12]);
    else this.look([0, 0, FRONT_DIST], [0, 0, 0]);
  }

  draw(ctx: CanvasRenderingContext2D, st: DuelState, time: number, localId: PlayerId): void {
    const mode = st.phase === 'roulette' || st.phase === 'intro' ? 'studio' : st.kind;
    this.setMode(mode);
    this.beginChars();
    const sides = [st.a, st.b];

    if (mode === 'studio') {
      this.paintWheel(st);
      const roulette = st.phase === 'roulette';
      // A slight three-quarter angle on the wheel; straight on for the duelists (the 2D names line up).
      if (roulette) this.look([70, 26, FRONT_DIST - 20], [10, WHEEL_Y * 0.6, 0]);
      else this.look([0, 0, FRONT_DIST], [0, 0, 0]);
      const stopped = st.phaseTime >= SPIN_TIME;
      this.wheelSet.visible = roulette;
      this.wheel.rotation.z = -wheelAngle(st, st.phaseTime);
      this.bulbs.forEach((b, k) => b.material.color.set((k + Math.floor(time * (stopped ? 6 : 12))) % 2 === 0 ? '#fff8c0' : '#8a5a1a'));
      for (const p of this.pedestals) p.visible = !roulette;
      if (!roulette) {
        // The two duelists on their pedestals, turning to the camera.
        sides.forEach((idx, side) => {
          const c = st.candidates[idx];
          this.placeChar(c.id, c.character, 0, 0, time, { world: [side ? 96 : -96, fy(106), -10], heading: Math.sin(time * 1.5 + side) * 0.5, speed: 0, height: 46 });
        });
      }
    } else if (mode === 'quickdraw') {
      const q = st.qd;
      const decided = st.phase === 'result';
      sides.forEach((idx, side) => {
        const c = st.candidates[idx];
        const lost = ((q.ended || decided) && q.roundWinner !== -1 && q.roundWinner !== side && q.roundTime > 0.25) || (decided && st.winner !== side);
        const x = fx(side ? ARENA_W - 104 : 104);
        const o = this.placeChar(c.id, c.character, 0, 0, time, { world: [x, fy(132), 0], heading: side ? -Math.PI / 2 : Math.PI / 2, tilt: lost ? -0.4 : 0, speed: 0, height: 28 });
        const hat = this.hats[side];
        hat.position.set(x, o.position.y + (lost ? 26 : 29), 0);
        hat.rotation.z = lost ? (side ? -0.5 : 0.5) : 0;
      });
      // The cork flies from the round winner to the loser's face.
      const w = q.roundWinner;
      const k = Math.min(1, q.roundTime / 0.25);
      this.cork.visible = (q.ended || decided) && w !== -1 && k < 1;
      if (this.cork.visible) {
        const from = fx(w === 0 ? 104 + 22 : ARENA_W - 104 - 22);
        const to = fx(w === 0 ? ARENA_W - 104 - 6 : 104 + 6);
        this.cork.position.set(from + (to - from) * k, fy(124), 4);
      }
    } else if (mode === 'sword') {
      this.sea.update(time, 0.6);
      const s = st.sword;
      const t = st.phaseTime;
      const decided = st.phase === 'result';
      this.splash.visible = false;
      sides.forEach((idx, side) => {
        const c = st.candidates[idx];
        let x = side ? ARENA_W - 120 : 120;
        let y = 132;
        if (decided && st.winner === side) x += (side ? -1 : 1) * Math.min(1, t / 0.25) * 110;
        else if (decided) {
          const kk = Math.min(1, Math.max(0, (t - 0.2) / 0.6));
          x += (side ? 1 : -1) * kk * 20;
          y += kk * kk * 70;
        }
        const flash = s.failed[side] && Math.floor(time * 16) % 2 === 0;
        const facing = side ? -Math.PI / 2 : Math.PI / 2;
        const o = this.placeChar(c.id, c.character, 0, 0, time, { world: [fx(x), fy(y), 0], heading: facing, speed: 0, height: 28, visible: !flash });
        // Sword raised, slashing on each correct move.
        const swing = s.progress[side] % 2;
        const sw = this.swords[side];
        sw.position.set(fx(x) + (side ? -8 : 8), o.position.y + 12, 6);
        sw.rotation.z = (side ? 1 : -1) * (0.5 + swing * 1.2);
        sw.visible = o.visible;
        if (decided && st.winner !== side && t > 0.75) {
          const kk = Math.min(1, (t - 0.75) / 0.6);
          this.splash.visible = true;
          this.splash.position.set(fx(x), this.sea.mesh.position.y + 1, 0);
          this.splash.scale.setScalar(4 + kk * 18);
          this.splash.material.opacity = 1 - kk;
        }
      });
    } else {
      const p = st.pong;
      sides.forEach((idx, side) => {
        const c = st.candidates[idx];
        const ch = CHARACTERS[c.character];
        const x = side ? PONG.bx : PONG.ax;
        const y = side ? p.pb : p.pa;
        const m = this.paddles[side];
        m.material.color.set(ch.color);
        m.position.set(this.wx(x + (side ? 2 : -2)), 2.5, this.wz(y));
        this.placeChar(c.id, c.character, x + (side ? 14 : -14), y, time, { heading: side ? -Math.PI / 2 : Math.PI / 2, speed: 0, height: 16 });
      });
      this.ball.position.set(this.wx(p.x), PONG.ballR * 1.3, this.wz(p.y));
    }
    this.endChars(localId, time, mode === 'studio' ? 52 : 28);
    this.present(ctx);
    drawDuel(ctx, st, time, localId, true);
  }

  positions(st: DuelState): Array<[PlayerId, number, number]> {
    if (st.phase === 'roulette') return [];
    return [st.a, st.b].map((idx, side) => {
      const c = st.candidates[idx];
      if (st.phase === 'intro') return [c.id, side ? 288 : 96, 80] as [PlayerId, number, number];
      if (st.kind === 'pong') return [c.id, ...this.projectLogic(side ? PONG.bx + 14 : PONG.ax - 14, side ? st.pong.pb : st.pong.pa, 16)] as [PlayerId, number, number];
      return [c.id, side ? ARENA_W - 110 : 110, 110] as [PlayerId, number, number];
    });
  }
}

export const duel3dRenderer = stageRenderer(() => new Duel3D());
