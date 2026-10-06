import { ARENA_H, ARENA_W } from '@shared/arena';
import type { PlayerId } from '@shared/types';
import * as THREE from 'three';
import { artCapture } from '../minigames/ad';
import type { MinigameRenderer } from '../minigames/renderer';
import { Stage3D, addLights, canvasTexture, lambert, stageRenderer, type StageScene } from './stage';

/**
 * The ads (PATROCINADO, ANÚNCIO, COMPRA) in 3D: the 2D ad is drawn as usual, but the product spins as
 * a low-poly 3D model and the viewers' portraits become little 3D characters. The scene has no
 * background, so it pastes over the 2D ad.
 */

const DIST = (ARENA_H / 2) / Math.tan((34 / 2) * (Math.PI / 180));
type Product = (typeof artCapture.products)[number]['kind'];

function productModel(kind: Product): THREE.Group {
  const g = new THREE.Group();
  switch (kind) {
    case 'can': {
      const label = canvasTexture(64, 32, (c) => {
        c.fillStyle = '#d8d8e8'; c.fillRect(0, 0, 64, 32);
        c.fillStyle = '#1a1a2a'; c.fillRect(0, 7, 64, 18);
        c.fillStyle = '#ffd23e';
        for (const x of [8, 40]) { c.beginPath(); c.moveTo(x + 6, 9); c.lineTo(x, 17); c.lineTo(x + 5, 17); c.lineTo(x + 2, 24); c.lineTo(x + 9, 14); c.lineTo(x + 4, 14); c.fill(); }
      });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(10, 10, 32, 14), lambert('#ffffff', label));
      const top = new THREE.Mesh(new THREE.CylinderGeometry(8.5, 10, 2.4, 14), lambert('#c8c8d8'));
      top.position.y = 17;
      g.add(body, top);
      break;
    }
    case 'chart': {
      const board = new THREE.Mesh(new THREE.BoxGeometry(34, 30, 2), lambert('#ffffff'));
      g.add(board);
      [6, 10, 8, 16, 26].forEach((h, i) => {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(4, h, 4), lambert(i === 4 ? '#22a046' : '#5cf26a'));
        bar.position.set(-12 + i * 6, -14 + h / 2, 2);
        g.add(bar);
      });
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(3, 7, 4), lambert('#22a046'));
      arrow.position.set(12, 16, 2);
      g.add(arrow);
      break;
    }
    case 'phones': {
      const band = new THREE.Mesh(new THREE.TorusGeometry(14, 2, 6, 16, Math.PI), lambert('#1a1a2a'));
      band.position.y = 2;
      g.add(band);
      for (const s of [-1, 1]) {
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 5, 12), lambert('#ffffff'));
        cup.rotation.z = Math.PI / 2;
        cup.position.set(s * 14, -4, 0);
        g.add(cup);
      }
      break;
    }
    case 'bell': {
      const bell = new THREE.Mesh(new THREE.CylinderGeometry(7, 15, 18, 14), lambert('#ffd23e'));
      const dome = new THREE.Mesh(new THREE.SphereGeometry(7, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), lambert('#ffd23e'));
      dome.position.y = 9;
      const lip = new THREE.Mesh(new THREE.TorusGeometry(15, 2, 6, 16), lambert('#e8b020'));
      lip.rotation.x = Math.PI / 2;
      lip.position.y = -9;
      const badge = new THREE.Mesh(new THREE.SphereGeometry(6, 10, 8), lambert('#ff3b5c'));
      badge.position.set(12, 12, 4);
      g.add(bell, dome, lip, badge);
      break;
    }
    case 'kart': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(34, 10, 18), lambert('#ffd23e', undefined, { emissive: new THREE.Color('#3a2a00') }));
      const seat = new THREE.Mesh(new THREE.BoxGeometry(10, 9, 14), lambert('#c89a1e'));
      seat.position.set(-8, 8, 0);
      g.add(body, seat);
      for (const [x, z] of [[-11, 10], [11, 10], [-11, -10], [11, -10]]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 4, 10), lambert('#1a1a2a'));
        w.rotation.x = Math.PI / 2;
        w.position.set(x, -5, z);
        g.add(w);
      }
      break;
    }
    case 'pill': {
      for (const [s, col] of [[-1, '#ffffff'], [1, '#3ee8ff']] as const) {
        const half = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 18, 12), lambert(col));
        half.rotation.z = Math.PI / 2;
        half.position.x = s * 9;
        const cap = new THREE.Mesh(new THREE.SphereGeometry(9, 12, 8), lambert(col));
        cap.position.x = s * 18;
        g.add(half, cap);
      }
      break;
    }
  }
  return g;
}

class Ads3D extends Stage3D implements StageScene<unknown> {
  private products = new Map<Product, THREE.Group>();

  constructor(private flat: MinigameRenderer) {
    super(ARENA_W / 2, ARENA_H / 2);
    addLights(this.scene, '#ffffff', '#5a4a7a', 2);
    this.look([0, 0, DIST], [0, 0, 0]);
  }

  draw(ctx: CanvasRenderingContext2D, st: unknown, time: number, localId: PlayerId): void {
    artCapture.on = true;
    artCapture.products.length = 0;
    artCapture.faces.length = 0;
    try {
      this.flat.render(ctx, st, time, localId);
    } finally {
      artCapture.on = false;
    }
    for (const g of this.products.values()) g.visible = false;
    for (const p of artCapture.products) {
      let g = this.products.get(p.kind);
      if (!g) {
        g = productModel(p.kind);
        this.scene.add(g);
        this.products.set(p.kind, g);
      }
      g.visible = true;
      // The 2D product sits in a 34px tall box from y down.
      g.position.set(p.x - ARENA_W / 2, ARENA_H / 2 - (p.y + 17) + Math.sin(time * 4) * 2, 10);
      g.rotation.set(0.25, time * 1.6, Math.sin(time * 2) * 0.1);
      g.scale.setScalar(1.15);
    }
    this.beginChars();
    artCapture.faces.forEach((f, i) => {
      const box = 16 * f.scale;
      this.placeChar(1000 + i, f.character, 0, 0, time, {
        world: [f.x + box / 2 - ARENA_W / 2, ARENA_H / 2 - (f.y + box + 2), 0],
        heading: Math.sin(time * 2 + i) * 0.4,
        tilt: f.dead ? 0.9 : 0,
        speed: 0,
        height: box * 1.15,
      });
    });
    this.endChars(-1, time);
    this.present(ctx);
  }

  positions(): Array<[PlayerId, number, number]> {
    return [];
  }
}

/** Wraps a 2D ad renderer with the 3D product and viewers. */
export function ads3dRenderer(flat: MinigameRenderer): MinigameRenderer {
  return stageRenderer(() => new Ads3D(flat));
}
