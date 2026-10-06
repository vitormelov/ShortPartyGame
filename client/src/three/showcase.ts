import { SCREEN_H, SCREEN_W } from '@shared/arena';
import * as THREE from 'three';
import { RES } from '../core/draw';
import { settings } from '../core/settings';
import { Stage3D, addLights, webglAvailable } from './stage';

/*
 * 3D characters on the menu screens (title, selection, results). A screen queues characters at
 * screen positions while it draws (`add`), then `flush` renders them over what's there, inside the
 * current clip. The camera maps 1 world unit to 1 screen pixel at z = 0.
 */

const DIST = (SCREEN_H / 2) / Math.tan((34 / 2) * (Math.PI / 180));

export interface ShowcaseItem {
  character: number;
  /** Keeps the same 3D instance across frames (default: the character). */
  key?: number;
  /** Screen position of the feet. */
  x: number;
  y: number;
  height: number;
  /** Turn (radians); the default is a slow sway. */
  heading?: number;
  /** Bounce in pixels (celebrating). */
  hop?: number;
  tilt?: number;
  /** Run cycle (an excited little dance). */
  dance?: boolean;
}

let renderer: THREE.WebGLRenderer | null | undefined;
function showcaseRenderer(): THREE.WebGLRenderer | null {
  if (renderer === undefined) {
    try {
      const canvas = document.createElement('canvas');
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, alpha: true });
      renderer.setPixelRatio(1);
      renderer.setSize(SCREEN_W * RES, SCREEN_H * RES, false);
      renderer.setClearColor(0x000000, 0);
    } catch {
      renderer = null;
    }
  }
  return renderer;
}

export class Showcase extends Stage3D {
  private queue: ShowcaseItem[] = [];

  constructor() {
    super(SCREEN_W / 2, SCREEN_H / 2);
    this.viewW = SCREEN_W;
    this.viewH = SCREEN_H;
    this.ownRenderer = showcaseRenderer();
    this.camera.aspect = SCREEN_W / SCREEN_H;
    this.camera.updateProjectionMatrix();
    addLights(this.scene, '#ffffff', '#4a3a6a', 1.9);
    this.look([0, 0, DIST], [0, 0, 0]);
  }

  /** True when the menus should show 3D characters (VISUAL 3D on and WebGL working). */
  static enabled(): boolean {
    return settings().visual3d && webglAvailable() && showcaseRenderer() !== null;
  }

  add(item: ShowcaseItem): void {
    this.queue.push(item);
  }

  /** Renders the queued characters over the canvas (respecting its current clip) and clears the queue. */
  flush(ctx: CanvasRenderingContext2D, time: number): void {
    if (!this.ownRenderer) {
      this.queue = [];
      return;
    }
    this.beginChars();
    this.queue.forEach((it, i) => {
      this.placeChar(it.key ?? it.character, it.character, 0, 0, time, {
        world: [it.x - SCREEN_W / 2, SCREEN_H / 2 - it.y + (it.hop ?? 0), 0],
        heading: it.heading ?? Math.sin(time * 1.2 + i * 0.7) * 0.45,
        tilt: it.tilt ?? 0,
        speed: it.dance ? 50 : 0,
        height: it.height,
      });
    });
    this.endChars(-1, time);
    this.queue = [];
    this.present(ctx);
  }
}
