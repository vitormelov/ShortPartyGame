import { DEATH_ANIM, FIELD, SHOVE_COOLDOWN, TURN_TIME, type BookState, type Hole } from '@shared/minigames/book/logic';
import type { PlayerId } from '@shared/types';
import * as THREE from 'three';
import { PAL, text } from '../core/draw';
import { hash } from '../minigames/renderer';
import { Stage3D, addLights, canvasTexture, lambert, n64Texture, stageRenderer, type StageScene } from './stage';

/**
 * TERMOS DE USO in 3D (Booksquirm): a giant book on a desk. The page with holes is hinged at the
 * spine: it hangs up in the air during the preview, slams flat, then flips over to the left.
 */

const TEX = 2; // texture pixels per logic pixel

/** Paper with the fake legal text, the holes cut out (alpha), for one page. */
function pageCanvas(holes: Hole[], page: number, ink: boolean): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = FIELD.w * TEX;
  cv.height = FIELD.h * TEX;
  const c = cv.getContext('2d')!;
  c.scale(TEX, TEX);
  c.fillStyle = ink ? '#140a20' : '#fffaf0';
  c.fillRect(0, 0, FIELD.w, FIELD.h);
  if (!ink) {
    c.fillStyle = '#3a2a5a';
    c.font = '8px "Press Start 2P", monospace';
    c.textAlign = 'center';
    c.textBaseline = 'top';
    c.fillText('TERMOS DE USO', FIELD.w / 2, 6);
    c.fillStyle = '#9a90b0';
    let row = 0;
    for (let y = 20; y < FIELD.h - 8; y += 7) {
      let x = 12;
      for (let k = 0; x < FIELD.w - 14; k++) {
        const w = Math.min(6 + Math.floor(hash((page + 3) * 97 + row * 31 + k) * 22), FIELD.w - 14 - x);
        c.fillRect(x, y, w, 2);
        x += w + 3;
      }
      row++;
    }
    c.textAlign = 'right';
    c.fillText(`CLÁUSULA ${page}`, FIELD.w - 6, FIELD.h - 10);
  }
  // Cut the holes (with a dark edge on the paper).
  for (const h of holes) {
    c.fillStyle = ink ? '#000000' : '#8a7a5a';
    c.fillRect(h.x - FIELD.x - 1, h.y - FIELD.y - 1, h.w + 2, h.h + 2);
    c.clearRect(h.x - FIELD.x, h.y - FIELD.y, h.w, h.h);
  }
  return cv;
}

class Book3D extends Stage3D implements StageScene<BookState> {
  private hinge = new THREE.Group();
  private page: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>;
  private shade: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private outline: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private texPage = -1;

  constructor() {
    super(FIELD.x + FIELD.w / 2, FIELD.y + FIELD.h / 2);
    this.scene.background = new THREE.Color('#1e1008');
    addLights(this.scene, '#fff0d8', '#3a2010', 1.6);
    this.look([0, 262, 250], [0, -14, 14]);

    // Desk, book cover and spine, and the page everyone stands on.
    const desk = new THREE.Mesh(new THREE.PlaneGeometry(1000, 800), lambert('#ffffff', canvasTexture(8, 32, (c) => {
      for (let y = 0; y < 32; y += 4) { c.fillStyle = (y / 4) % 2 ? '#3a2414' : '#36200f'; c.fillRect(0, y, 8, 4); }
    })));
    desk.material.map!.wrapS = desk.material.map!.wrapT = THREE.RepeatWrapping;
    desk.material.map!.repeat.set(20, 20);
    desk.material.map!.needsUpdate = true;
    desk.rotation.x = -Math.PI / 2;
    desk.position.y = -10;
    const cover = new THREE.Mesh(new THREE.BoxGeometry(FIELD.w + 16, 8, FIELD.h + 10), lambert('#6a1a24'));
    cover.position.set(3, -6, 0);
    const spine = new THREE.Mesh(new THREE.BoxGeometry(8, 10, FIELD.h + 10), lambert('#8a2a30'));
    spine.position.set(-FIELD.w / 2 - 6, -5, 0);
    const floorPage = new THREE.Mesh(new THREE.BoxGeometry(FIELD.w, 2, FIELD.h), lambert('#efe4c8'));
    floorPage.position.y = -1;
    this.scene.add(desk, cover, spine, floorPage);

    // The hinged page: its left edge sits on the spine.
    this.page = new THREE.Mesh(new THREE.PlaneGeometry(FIELD.w, FIELD.h), lambert('#ffffff', undefined, { side: THREE.DoubleSide, alphaTest: 0.5 }));
    this.page.rotation.x = -Math.PI / 2;
    this.page.position.x = FIELD.w / 2;
    this.hinge.position.set(-FIELD.w / 2, 1.2, 0);
    this.hinge.add(this.page);
    this.scene.add(this.hinge);

    // The page's shadow on the floor during the preview (the holes stay lit).
    this.shade = new THREE.Mesh(new THREE.PlaneGeometry(FIELD.w, FIELD.h), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
    this.shade.rotation.x = -Math.PI / 2;
    this.shade.position.y = 0.15;
    this.scene.add(this.shade);
    this.outline = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#ffd23e' }));
    this.scene.add(this.outline);
  }

  private setPage(st: BookState): void {
    if (this.texPage === st.page) return;
    this.texPage = st.page;
    this.page.material.map?.dispose();
    this.page.material.map = n64Texture(new THREE.CanvasTexture(pageCanvas(st.holes, st.page, false)));
    this.page.material.needsUpdate = true;
    this.shade.material.map?.dispose();
    this.shade.material.map = n64Texture(new THREE.CanvasTexture(pageCanvas(st.holes, st.page, true)));
    this.shade.material.needsUpdate = true;
    // Hole outlines on the floor.
    const pts: number[] = [];
    for (const h of st.holes) {
      const x0 = this.wx(h.x), x1 = this.wx(h.x + h.w), z0 = this.wz(h.y), z1 = this.wz(h.y + h.h);
      for (const [ax, az, bx, bz] of [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]]) pts.push(ax, 0.3, az, bx, 0.3, bz);
    }
    this.outline.geometry.dispose();
    this.outline.geometry = new THREE.BufferGeometry();
    this.outline.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  }

  draw(ctx: CanvasRenderingContext2D, st: BookState, time: number, localId: PlayerId): void {
    this.setPage(st);
    // Hinge angle: 0 = flat on the floor, PI/2 = standing up, PI = flipped onto the left.
    let angle = 0;
    this.shade.visible = false;
    this.outline.visible = false;
    if (st.phase === 'preview') {
      const p = Math.min(1, st.phaseTime / st.previewTime);
      angle = 0.8 - p * 0.55;
      this.shade.visible = true;
      this.shade.material.opacity = 0.12 + p * 0.5;
      this.outline.visible = true;
      const blink = Math.floor(time * (6 + p * 20)) % 2 === 0;
      this.outline.material.color.set(p > 0.7 && blink ? PAL.red : PAL.yellow);
    } else if (st.phase === 'slam') {
      angle = Math.max(0, 0.25 * (1 - st.phaseTime / 0.08));
    } else {
      angle = Math.min(1, st.phaseTime / TURN_TIME) * Math.PI;
    }
    this.hinge.rotation.z = angle;
    this.page.visible = angle < Math.PI - 0.02;

    this.beginChars();
    for (const p of st.players) {
      if (p.status === 'out') continue;
      if (p.status === 'dead') {
        if (p.deathAnim <= 0) continue;
        // Squashed flat by the page.
        const o = this.placeChar(p.id, p.character, p.x, p.y, time, { speed: 0, height: 14 });
        o.scale.y *= Math.max(0.08, (p.deathAnim / DEATH_ANIM) * 0.3);
        continue;
      }
      const blink = p.ghost > 0 && Math.floor(time * 16) % 2 === 0;
      this.placeChar(p.id, p.character, p.x, p.y, time, { visible: !blink, tilt: p.shoveT > 0 ? 0.5 : 0, height: 14 });
    }
    this.endChars(localId, time, 14);
    this.present(ctx);

    const me = st.players.find((p) => p.id === localId);
    if (me && me.status === 'alive' && me.shoveCd > 0) this.cooldownBar(ctx, me.x, me.y, 1 - me.shoveCd / SHOVE_COOLDOWN);
    text(ctx, `PÁG. ${st.page}`, 4, 4, PAL.yellow);
  }

  positions(st: BookState): Array<[PlayerId, number, number]> {
    return st.players.filter((p) => p.status === 'alive').map((p) => [p.id, ...this.projectLogic(p.x, p.y, 14)]);
  }
}

export const book3dRenderer = stageRenderer(() => new Book3D());
