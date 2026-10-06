import { ARENA_W } from '@shared/arena';
import { DEATH_ANIM, POSE_ACTION, POSE_NONE, type MimicState } from '@shared/minigames/mimic/logic';
import { CHARACTERS, type PlayerId } from '@shared/types';
import * as THREE from 'three';
import { PAL, text } from '../core/draw';
import { arrow, drawSign } from '../minigames/mimic';
import { Sea, Stage3D, addLights, lambert, splashRing, stageRenderer, type StageScene } from './stage';

/**
 * MIMIC ME in 3D (Shy Guy Says): everyone on a raft in a pool, the influencer on a stage behind
 * pointing with a real arm. The command sign and the pose bubbles stay 2D.
 */

const RAFT_Z = 34;
const INF_X = -24;

function influencer(): { group: THREE.Group; arm: THREE.Group } {
  const group = new THREE.Group();
  const shirt = new THREE.Mesh(new THREE.CylinderGeometry(5, 6, 13, 8), lambert('#ff5ac8'));
  shirt.position.y = 16;
  const legs = [-1, 1].map((s) => {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 9, 6), lambert('#2a2a4a'));
    l.position.set(s * 2.4, 5, 0);
    return l;
  });
  const head = new THREE.Mesh(new THREE.SphereGeometry(6, 10, 8), lambert('#ffc89a'));
  head.position.y = 28;
  const hair = new THREE.Mesh(new THREE.SphereGeometry(6.4, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.2), lambert('#ffd23e'));
  hair.position.y = 29;
  const shades = new THREE.Mesh(new THREE.BoxGeometry(10, 2.2, 1), lambert('#0a0614'));
  shades.position.set(0, 29, 5.6);
  const phone = new THREE.Mesh(new THREE.BoxGeometry(2.4, 4, 0.8), new THREE.MeshBasicMaterial({ color: '#3ee8ff' }));
  phone.position.set(-8, 18, 3);
  // The pointing arm pivots at the shoulder.
  const arm = new THREE.Group();
  const a = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 11, 6), lambert('#ffc89a'));
  a.position.y = 5.5;
  const hand = new THREE.Mesh(new THREE.SphereGeometry(2, 6, 4), lambert('#fff8f0'));
  hand.position.y = 11.5;
  arm.add(a, hand);
  arm.position.set(6, 21, 1);
  group.add(shirt, ...legs, head, hair, shades, phone, arm);
  return { group, arm };
}

class Mimic3D extends Stage3D implements StageScene<MimicState> {
  private sea = new Sea(-3, '#1e6ae8', '#2a7af2', [700, 400]);
  private rafts = new Map<PlayerId, THREE.Mesh>();
  private splashes = new Map<PlayerId, THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>>();
  private arm: THREE.Group;
  private inf: THREE.Group;

  constructor() {
    super(ARENA_W / 2, 0);
    this.scene.background = new THREE.Color('#3a6ad8');
    this.scene.fog = new THREE.Fog('#5a8ae8', 320, 700);
    addLights(this.scene, '#ffffff', '#2a4a8a', 1.7);
    this.look([0, 120, 230], [0, 10, 0]);
    this.scene.add(this.sea.mesh);
    // Stage behind the pool: a tiled deck with a colorful backdrop.
    const deck = new THREE.Mesh(new THREE.BoxGeometry(500, 14, 70), lambert('#e8d8b0'));
    deck.position.set(0, 2, -55);
    const backdrop = new THREE.Mesh(new THREE.BoxGeometry(500, 90, 4), lambert('#ff8ad8'));
    backdrop.position.set(0, 50, -92);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(500, 8, 5), lambert('#ffd23e'));
    stripe.position.set(0, 30, -91);
    this.scene.add(deck, backdrop, stripe);
    const inf = influencer();
    this.inf = inf.group;
    this.arm = inf.arm;
    this.inf.position.set(INF_X, 9, -48);
    this.scene.add(this.inf);
  }

  draw(ctx: CanvasRenderingContext2D, st: MimicState, time: number, localId: PlayerId): void {
    this.sea.update(time, 0.5);
    this.inf.position.y = 9 + (Math.floor(time * 4) % 2) * 0.6;
    // Point at the command: up, right, down, left (screen directions = world X / Y).
    const showing = st.phase !== 'wait' && st.command < 4;
    const dir = showing ? st.command : 2;
    this.arm.rotation.z = [0, -Math.PI / 2, Math.PI, Math.PI / 2][dir];

    this.beginChars();
    for (const p of st.players) {
      let raft = this.rafts.get(p.id);
      if (!raft) {
        raft = new THREE.Mesh(new THREE.BoxGeometry(22, 3, 16), lambert('#8a5a2a'));
        this.scene.add(raft);
        this.rafts.set(p.id, raft);
      }
      let splash = this.splashes.get(p.id);
      if (!splash) {
        splash = splashRing();
        this.scene.add(splash);
        this.splashes.set(p.id, splash);
      }
      raft.visible = p.status !== 'out';
      splash.visible = false;
      if (p.status === 'out') continue;
      const x = this.wx(p.x);
      const bob = Math.sin(time * 2 + p.id) * 0.6;
      raft.position.set(x, -1.5 + bob, RAFT_Z);
      raft.rotation.z = Math.sin(time * 1.6 + p.id) * 0.04;
      if (p.status === 'dead') {
        if (p.deathAnim <= 0) continue;
        const k = 1 - p.deathAnim / DEATH_ANIM;
        this.placeChar(p.id, p.character, p.x, 0, time, { world: [x, bob - k * 22, RAFT_Z], heading: 0, tilt: k, speed: 0, height: 16 });
        splash.visible = true;
        splash.position.set(x, 0, RAFT_Z + 6);
        splash.scale.setScalar(3 + k * 14);
        splash.material.opacity = 1 - k;
        continue;
      }
      // Body language for the held pose: hop on up, lean on left/right, crouch on down, spin on Space.
      const pose = p.pose;
      const heading = pose === 1 ? 0.9 : pose === 3 ? -0.9 : pose === POSE_ACTION ? time * 12 : 0;
      const blink = p.ghost > 0 && Math.floor(time * 16) % 2 === 0;
      const o = this.placeChar(p.id, p.character, p.x, 0, time, { world: [x, bob + 0.5 + (pose === 0 ? 3 : 0), RAFT_Z], heading, speed: 0, visible: !blink, height: 16 });
      if (pose === 2) o.scale.y *= 0.75;
    }
    this.endChars(localId, time, 16);
    this.present(ctx);

    drawSign(ctx, st, time);
    // What each player holds, so everyone can copy (or be fooled).
    for (const p of st.players) {
      if (p.status !== 'alive') continue;
      const [bx, by] = this.project(this.wx(p.x), 30, RAFT_Z);
      if (p.pose !== POSE_NONE) {
        ctx.fillStyle = PAL.ink;
        ctx.fillRect(Math.round(bx - 6), Math.round(by - 6), 13, 13);
        ctx.fillStyle = '#fff4e0';
        ctx.fillRect(Math.round(bx - 5), Math.round(by - 5), 11, 11);
        if (p.pose === POSE_ACTION) text(ctx, '!', bx - 3, by - 3, PAL.ink, 8, 'left', null);
        else arrow(ctx, bx, by + 1, p.pose, 1, CHARACTERS[p.character].dark);
      }
      if (st.phase === 'result' && p.last === 'ok') {
        ctx.fillStyle = PAL.green;
        ctx.fillRect(Math.round(bx - 3), Math.round(by - 14), 2, 2);
        ctx.fillRect(Math.round(bx - 1), Math.round(by - 12), 2, 2);
        ctx.fillRect(Math.round(bx + 1), Math.round(by - 14), 2, 2);
        ctx.fillRect(Math.round(bx + 3), Math.round(by - 16), 2, 2);
      }
    }
  }

  positions(st: MimicState): Array<[PlayerId, number, number]> {
    return st.players.filter((p) => p.status === 'alive').map((p) => [p.id, ...this.project(this.wx(p.x), 14, RAFT_Z)]);
  }
}

export const mimic3dRenderer = stageRenderer(() => new Mimic3D());
