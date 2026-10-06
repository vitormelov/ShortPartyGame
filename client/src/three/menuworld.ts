import { SCREEN_H, SCREEN_W } from '@shared/arena';
import { CHARACTERS } from '@shared/types';
import * as THREE from 'three';
import { FONT, RES } from '../core/draw';
import { settings } from '../core/settings';
import { Sea, Stage3D, addLights, canvasTexture, lambert, webglAvailable } from './stage';

/*
 * The menus' 3D world, Mario Party style: a floating island on the sea with board spaces, trees,
 * a giant phone monument showing the feed, the eight characters and the Algoritmo hovering around.
 *
 * Each screen picks a camera ("view"). The title also gets 3D UI (logo sign and menu slabs) in a
 * second scene with a fixed camera that maps 1 world unit to 1 screen pixel at z = 0.
 */

export type MenuView = 'title' | 'select' | 'options';

/** 3D menu slabs (and optionally the logo sign) drawn over the world. */
export interface MenuSlabs {
  labels: readonly string[];
  selected: number;
  /** Screen center of the column (default: under the logo) and the first slab's top. */
  x?: number;
  y?: number;
  logo?: boolean;
}

const UI_DIST = (SCREEN_H / 2) / Math.tan((34 / 2) * (Math.PI / 180));
const SPACES = 18;
const RING_R = 92;

/** Text in the game's pixel font on a canvas, for 3D signs. */
function labelTexture(lines: Array<[string, string, number]>, w: number, h: number, bg: string | null, border?: string): THREE.CanvasTexture {
  const k = 4;
  return canvasTexture(w * k, h * k, (c) => {
    c.scale(k, k);
    c.imageSmoothingEnabled = false;
    if (bg) {
      c.fillStyle = bg;
      c.fillRect(0, 0, w, h);
    }
    if (border) {
      c.strokeStyle = border;
      c.lineWidth = 2;
      c.strokeRect(1, 1, w - 2, h - 2);
    }
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const total = lines.reduce((s, [, , size]) => s + size + 3, -3);
    let y = h / 2 - total / 2;
    for (const [str, color, size] of lines) {
      c.font = `${size}px ${FONT}`;
      c.fillStyle = '#0a0614';
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [2, 2]]) c.fillText(str, w / 2 + ox, y + size / 2 + oy);
      c.fillStyle = color;
      c.fillText(str, w / 2, y + size / 2);
      y += size + 3;
    }
  }, false);
}

function tree(): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(2, 3, 18, 6), lambert('#8a5a2a'));
  trunk.position.y = 9;
  g.add(trunk);
  for (const [y, r] of [[22, 11], [30, 8], [36, 5]]) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(r, 12, 7), lambert('#2a9a3a', undefined, { flatShading: true }));
    c.position.y = y;
    g.add(c);
  }
  return g;
}

function cloud(): THREE.Group {
  const g = new THREE.Group();
  const white = lambert('#ffffff', undefined, { emissive: new THREE.Color('#5a6a8a') });
  for (const [x, y, r] of [[0, 0, 14], [14, -3, 10], [-14, -3, 11], [6, 7, 9]]) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), white);
    s.position.set(x, y, 0);
    g.add(s);
  }
  return g;
}

/** The host, as a 3D monitor with one eye. */
function algoritmo(): { group: THREE.Group; pupil: THREE.Mesh } {
  const group = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(30, 22, 8), lambert('#ff2e88'));
  const screen = new THREE.Mesh(new THREE.BoxGeometry(25, 17, 1), lambert('#1b0b3a'));
  screen.position.z = 4.1;
  const eye = new THREE.Mesh(new THREE.SphereGeometry(6, 12, 8), lambert('#fff4e0'));
  eye.scale.z = 0.4;
  eye.position.z = 4.8;
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(3, 10, 8), lambert('#ff2e88', undefined, { emissive: new THREE.Color('#3a0018') }));
  pupil.scale.z = 0.4;
  pupil.position.z = 7;
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 7, 5), lambert('#c6ff3d'));
  antenna.position.y = 14;
  const tip = new THREE.Mesh(new THREE.SphereGeometry(2, 6, 4), new THREE.MeshBasicMaterial({ color: '#c6ff3d' }));
  tip.position.y = 18;
  group.add(frame, screen, eye, pupil, antenna, tip);
  return { group, pupil };
}

const FEED_CARDS: Array<[string, string]> = [
  ['KART RUSH', '#e83b3b'], ['BOMB FEED', '#3bc84a'], ['METEOR FEED', '#f2862e'], ['LANTERNA', '#9a5af2'],
  ['LASER GRID', '#2ed8e8'], ['ELEVADOR', '#c89a1e'], ['MIMIC ME', '#3bc84a'], ['BOLHA SOCIAL', '#c8468a'],
  ['CANCELAMENTO', '#2a7ab8'], ['FLAME WAR', '#a8844a'], ['CORDA QUENTE', '#c84a1e'], ['DANCINHA', '#c83a9a'],
];

class MenuWorld extends Stage3D {
  private ui = new THREE.Scene();
  private uiCam = new THREE.PerspectiveCamera(34, SCREEN_W / SCREEN_H, 1, 2000);
  private sea = new Sea(-34, '#1e6ad8', '#2a7af0', [1600, 1200]);
  private clouds: THREE.Group[] = [];
  private host: { group: THREE.Group; pupil: THREE.Mesh };
  private phoneScreen: THREE.MeshLambertMaterial;
  private feedTex: THREE.Texture[];
  private logo: THREE.Group;
  private slabs: Array<{ mesh: THREE.Mesh; on: THREE.Texture; off: THREE.Texture }> = [];
  private menuKey = '';

  constructor() {
    super(0, 0);
    this.viewW = SCREEN_W;
    this.viewH = SCREEN_H;
    this.ownRenderer = worldRenderer();
    this.camera.aspect = SCREEN_W / SCREEN_H;
    this.camera.updateProjectionMatrix();
    this.scene.background = new THREE.Color('#6ab8ff');
    this.scene.fog = new THREE.Fog('#a8d8ff', 380, 900);
    addLights(this.scene, '#ffffff', '#3a6a3a', 1.9);
    this.scene.add(this.sea.mesh);

    // Sky dome with a gradient.
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1200, 16, 10), new THREE.MeshBasicMaterial({
      side: THREE.BackSide,
      fog: false,
      map: canvasTexture(4, 64, (c) => {
        const g = c.createLinearGradient(0, 0, 0, 64);
        g.addColorStop(0, '#2a5ad8');
        g.addColorStop(0.5, '#6ab8ff');
        g.addColorStop(1, '#d8f0ff');
        c.fillStyle = g;
        c.fillRect(0, 0, 4, 64);
      }),
    }));
    this.scene.add(sky);

    // The island: grass on top, dirt underneath.
    const grass = new THREE.Mesh(new THREE.CylinderGeometry(130, 122, 10, 20), lambert('#5cc84a', undefined, { flatShading: true }));
    grass.position.y = -5;
    const dirt = new THREE.Mesh(new THREE.ConeGeometry(122, 80, 20), lambert('#8a5a3a', undefined, { flatShading: true }));
    dirt.rotation.x = Math.PI;
    dirt.position.y = -50;
    this.scene.add(grass, dirt);
    // Board spaces in a ring: blue (+), red (-), and the odd green "?".
    for (let i = 0; i < SPACES; i++) {
      const a = (i / SPACES) * Math.PI * 2;
      const col = i % 6 === 5 ? '#3bc84a' : i % 3 === 2 ? '#e83b3b' : '#3b6ee8';
      const s = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 2, 16), lambert(col));
      s.position.set(Math.cos(a) * RING_R, 1, Math.sin(a) * RING_R);
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(10, 10, 1.4, 16), lambert('#fff4e0'));
      rim.position.set(s.position.x, 0.4, s.position.z);
      this.scene.add(rim, s);
    }
    for (const [x, z, k] of [[-110, -30, 1], [100, -60, 0.9], [-60, -100, 1.1], [70, 95, 0.8], [-95, 70, 0.9], [120, 30, 1]] as const) {
      const t = tree();
      t.position.set(x, 0, z);
      t.scale.setScalar(k);
      this.scene.add(t);
    }

    // The monument: a giant phone playing the feed.
    const phone = new THREE.Mesh(new THREE.BoxGeometry(44, 84, 8), lambert('#24163f'));
    phone.position.set(0, 44, -10);
    this.feedTex = FEED_CARDS.map(([name, color], i) => labelTexture([[name, '#ffffff', 5], [`${((i * 37) % 90) + 9}K`, '#fff4e0', 5]], 64, 120, color));
    this.phoneScreen = new THREE.MeshLambertMaterial({ map: this.feedTex[0], emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.35, emissiveMap: this.feedTex[0] });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(38, 72), this.phoneScreen);
    screen.position.set(0, 44, -5.9);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(20, 24, 6, 12), lambert('#3a2766'));
    base.position.set(0, 3, -10);
    this.scene.add(phone, screen, base);

    this.host = algoritmo();
    this.scene.add(this.host.group);
    for (let i = 0; i < 7; i++) {
      const c = cloud();
      c.scale.setScalar(0.8 + (i % 3) * 0.4);
      this.clouds.push(c);
      this.scene.add(c);
    }

    // ---------- title UI ----------
    this.uiCam.position.set(0, 0, UI_DIST);
    this.uiCam.lookAt(0, 0, 0);
    this.ui.add(new THREE.HemisphereLight('#ffffff', '#5a4a7a', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 1.4);
    sun.position.set(-60, 80, 200);
    this.ui.add(sun);
    const logoTex = labelTexture([['SHORT', '#ff5ac8', 24], ['PARTY', '#ffd23e', 24], ['O PARTY GAME DE 5 SEGUNDOS', '#3ee8ff', 6]], 170, 76, null);
    // A dark sign with the logo on its face.
    this.logo = new THREE.Group();
    const plate = new THREE.Mesh(new THREE.BoxGeometry(176, 80, 6), lambert('#1b0b3a', undefined, { transparent: true, opacity: 0.8 }));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(170, 76), lambert('#ffffff', logoTex, { transparent: true, alphaTest: 0.1 }));
    face.position.z = 3.2;
    this.logo.add(plate, face);
    this.ui.add(this.logo);
  }

  /** Builds the menu slabs once per set of labels. */
  private menu(labels: readonly string[]): void {
    const key = labels.join('|');
    if (key === this.menuKey) return;
    this.menuKey = key;
    for (const s of this.slabs) this.ui.remove(s.mesh);
    this.slabs = labels.map((label) => {
      const on = labelTexture([[label, '#ffffff', 8]], 132, 16, '#ff2e88', '#ffffff');
      const off = labelTexture([[label, '#c8c0e0', 8]], 132, 16, '#3a2766', '#5a4a8a');
      const edge = lambert('#1b0b3a');
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(132, 16, 6), [edge, edge, edge, edge, lambert('#ffffff', off), edge]);
      this.ui.add(mesh);
      return { mesh, on, off };
    });
  }

  draw(ctx: CanvasRenderingContext2D, time: number, view: MenuView, menu?: MenuSlabs): void {
    const r = this.ownRenderer;
    if (!r) return;
    this.sea.update(time, 0.7);
    // Camera per screen.
    // The title shifts the picture so the island sits to the right of the logo and menu.
    if (view === 'title') this.camera.setViewOffset(SCREEN_W, SCREEN_H, -SCREEN_W * 0.2, 0, SCREEN_W, SCREEN_H);
    else this.camera.clearViewOffset();
    if (view === 'title') {
      const a = time * 0.12;
      this.look([Math.sin(a) * 330, 130, Math.cos(a) * 330], [0, 22, 0]);
    } else if (view === 'select') {
      this.look([60, 70, 170], [0, 34, -10]);
    } else {
      const a = 2.2 + time * 0.05;
      this.look([Math.sin(a) * 320, 170, Math.cos(a) * 320], [0, 10, 0]);
    }
    this.clouds.forEach((c, i) => {
      const a = (i / this.clouds.length) * Math.PI * 2 + time * 0.02;
      c.position.set(Math.cos(a) * (300 + (i % 2) * 90), 110 + (i % 3) * 25, Math.sin(a) * (300 + (i % 2) * 90));
      c.lookAt(this.camera.position);
    });
    // The phone swipes to the next clip every 1.2 s.
    const tex = this.feedTex[Math.floor(time / 1.2) % this.feedTex.length];
    if (this.phoneScreen.map !== tex) {
      this.phoneScreen.map = tex;
      this.phoneScreen.emissiveMap = tex;
      this.phoneScreen.needsUpdate = true;
    }
    // The Algoritmo hovers around the phone, eye on the camera.
    const ha = time * 0.5;
    this.host.group.position.set(Math.cos(ha) * 48, 96 + Math.sin(time * 2) * 3, Math.sin(ha) * 30 + 10);
    this.host.group.lookAt(this.camera.position);
    this.host.pupil.position.x = Math.sin(time * 1.3) * 1.5;

    // The cast on the board spaces, hopping and turning.
    this.beginChars();
    CHARACTERS.forEach((_, i) => {
      const a = ((i * 2 + 1) / SPACES) * Math.PI * 2 + Math.PI * 0.5;
      const x = Math.cos(a) * RING_R;
      const z = Math.sin(a) * RING_R;
      const hop = Math.max(0, Math.sin(time * 3 + i * 1.3)) * 4;
      const face = Math.atan2(this.camera.position.x - x, this.camera.position.z - z);
      this.placeChar(i, i, 0, 0, time, { world: [x, 2 + hop, z], heading: face + Math.sin(time + i) * 0.4, speed: hop > 0 ? 0 : 20, height: 24 });
    });
    this.endChars(-1, time);

    r.autoClear = true;
    r.render(this.scene, this.camera);
    if (menu) {
      // Logo sign and menu slabs on top.
      r.autoClear = false;
      r.clearDepth();
      this.logo.visible = menu.logo ?? false;
      this.logo.position.set(112 - SCREEN_W / 2, SCREEN_H / 2 - 56 + Math.sin(time * 2.4) * 2, 0);
      this.logo.rotation.set(Math.sin(time * 1.3) * 0.06, Math.sin(time * 0.9) * 0.18, Math.sin(time * 1.7) * 0.02);
      {
        this.menu(menu.labels);
        const mx = menu.x ?? 112;
        const my = menu.y ?? 136;
        this.slabs.forEach((s, i) => {
          const sel = i === menu.selected;
          const mats = s.mesh.material as THREE.MeshLambertMaterial[];
          const want = sel ? s.on : s.off;
          if (mats[4].map !== want) {
            mats[4].map = want;
            mats[4].needsUpdate = true;
          }
          s.mesh.position.set(mx - SCREEN_W / 2, SCREEN_H / 2 - (my + 7 + i * 20), sel ? 10 : 0);
          s.mesh.rotation.set(sel ? Math.sin(time * 6) * 0.08 : 0, sel ? Math.sin(time * 3) * 0.25 : 0, 0);
          s.mesh.scale.setScalar(sel ? 1.08 : 1);
        });
      }
      r.render(this.ui, this.uiCam);
      r.autoClear = true;
    }
    ctx.drawImage(r.domElement, 0, 0, SCREEN_W, SCREEN_H);
  }
}

let renderer: THREE.WebGLRenderer | null | undefined;
function worldRenderer(): THREE.WebGLRenderer | null {
  if (renderer === undefined) {
    try {
      const canvas = document.createElement('canvas');
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.setSize(SCREEN_W * RES, SCREEN_H * RES, false);
    } catch {
      renderer = null;
    }
  }
  return renderer;
}

let world: MenuWorld | null = null;

/** The shared menu world, or null when the 3D menus are off (VISUAL 3D) or WebGL isn't available. */
export function menuWorld(): MenuWorld | null {
  if (!settings().visual3d || !webglAvailable() || !worldRenderer()) return null;
  return (world ??= new MenuWorld());
}

