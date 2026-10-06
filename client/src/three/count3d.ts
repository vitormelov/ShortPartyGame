import { FIELD, type CountState, type CrowdKind } from '@shared/minigames/count/logic';
import type { PlayerId } from '@shared/types';
import * as THREE from 'three';
import { drawCountUi, drawReveal } from '../minigames/count';
import { Stage3D, addLights, canvasTexture, lambert, stageRenderer, type StageScene } from './stage';

/**
 * CONTA OS HATERS in 3D (Roll Call): the haters (and the decoy fans) wander around a stage while
 * you count. The reveal is a scoreboard, so it stays 2D.
 */

const HATER_COLORS: Record<Exclude<CrowdKind, 'fan'>, string> = { red: '#e83b3b', blue: '#3b6ee8', purple: '#9a5af2' };

function haterModel(color: string): THREE.Group {
  const g = new THREE.Group();
  const face = canvasTexture(64, 32, (c) => {
    c.fillStyle = color;
    c.fillRect(0, 0, 64, 32);
    // Angry face centered at u = 0.25 (the sphere's front).
    c.fillStyle = '#ffffff';
    c.fillRect(9, 12, 5, 6); c.fillRect(18, 12, 5, 6);
    c.fillStyle = '#0a0614';
    c.fillRect(11, 14, 3, 3); c.fillRect(18, 14, 3, 3);
    c.fillRect(8, 9, 6, 2); c.fillRect(18, 9, 6, 2);
    c.fillRect(12, 22, 8, 2);
  });
  const body = new THREE.Mesh(new THREE.SphereGeometry(5, 10, 8), lambert('#ffffff', face));
  body.position.y = 5.5;
  const horns = [-1, 1].map((s) => {
    const h = new THREE.Mesh(new THREE.ConeGeometry(1.1, 3.4, 5), lambert('#2a0a14'));
    h.position.set(s * 2.8, 10.4, 0);
    h.rotation.z = -s * 0.4;
    return h;
  });
  const feet = [-1, 1].map((s) => {
    const f = new THREE.Mesh(new THREE.SphereGeometry(1.6, 6, 4), lambert(new THREE.Color(color).multiplyScalar(0.55)));
    f.position.set(s * 2.2, 0.8, 1);
    return f;
  });
  g.add(body, ...horns, ...feet);
  return g;
}

function fanModel(): THREE.Group {
  const g = new THREE.Group();
  const pink = lambert('#ff8ad8', undefined, { emissive: new THREE.Color('#3a0a2a') });
  for (const s of [-1, 1]) {
    const lobe = new THREE.Mesh(new THREE.SphereGeometry(3, 8, 6), pink);
    lobe.position.set(s * 2.2, 9, 0);
    g.add(lobe);
  }
  const tip = new THREE.Mesh(new THREE.ConeGeometry(4.6, 6.5, 8), pink);
  tip.rotation.x = Math.PI;
  tip.position.y = 5;
  g.add(tip);
  return g;
}

class Count3D extends Stage3D implements StageScene<CountState> {
  private crowd: THREE.Group[] = [];
  private kinds: CrowdKind[] = [];

  constructor() {
    super(FIELD.x + FIELD.w / 2, FIELD.y + FIELD.h / 2);
    this.scene.background = new THREE.Color('#100a20');
    addLights(this.scene, '#e8d8ff', '#1a0a2a', 1.6);
    this.look([0, 250, 210], [0, -14, 20]);
    // A "comment section" floor: rows of grey bars like the 2D one.
    const floor = new THREE.Mesh(new THREE.BoxGeometry(FIELD.w + 20, 6, FIELD.h + 20), [
      lambert('#1a1232'), lambert('#1a1232'),
      lambert('#ffffff', canvasTexture(96, 34, (c) => {
        c.fillStyle = '#16102a'; c.fillRect(0, 0, 96, 34);
        c.fillStyle = '#241a44';
        for (let y = 2; y < 34; y += 5) {
          c.fillRect(3, y, 3, 3);
          c.fillRect(8, y, 30 + ((y * 7) % 40), 1);
          c.fillRect(8, y + 2, 14 + ((y * 13) % 30), 1);
        }
      })),
      lambert('#1a1232'), lambert('#1a1232'), lambert('#1a1232'),
    ]);
    floor.position.y = -3;
    this.scene.add(floor);
  }

  private sync(st: CountState): void {
    // A new round has a new crowd: rebuild when the kinds change.
    const same = this.kinds.length === st.walkers.length && st.walkers.every((w, i) => w.kind === this.kinds[i]);
    if (same) return;
    for (const g of this.crowd) this.scene.remove(g);
    this.crowd = st.walkers.map((w) => {
      const g = w.kind === 'fan' ? fanModel() : haterModel(HATER_COLORS[w.kind]);
      this.scene.add(g);
      return g;
    });
    this.kinds = st.walkers.map((w) => w.kind);
  }

  draw(ctx: CanvasRenderingContext2D, st: CountState, time: number, localId: PlayerId): void {
    if (st.phase !== 'count') {
      drawReveal(ctx, st, time, localId);
      return;
    }
    this.sync(st);
    st.walkers.forEach((w, i) => {
      const g = this.crowd[i];
      const hop = Math.abs(Math.sin(time * 10 + i)) * 1.5;
      g.position.set(this.wx(w.x), w.kind === 'fan' ? 2 + Math.sin(time * 4 + i) * 1.5 : hop, this.wz(w.y));
      g.rotation.y = w.kind === 'fan' ? time * 2 + i : Math.atan2(w.vx, w.vy);
    });
    this.beginChars();
    this.endChars(localId, time);
    this.present(ctx);
    drawCountUi(ctx, st, localId);
  }

  positions(): Array<[PlayerId, number, number]> {
    return [];
  }
}

export const count3dRenderer = stageRenderer(() => new Count3D());
