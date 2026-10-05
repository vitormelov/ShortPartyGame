/** Closed circuit floating over the void. Coordinates are arena-local (384x204). */
export const TRACK_POINTS: ReadonlyArray<readonly [number, number]> = [
  [110, 35], // start line, mid-straight so the grid isn't facing a corner
  [180, 30],
  [220, 70],
  [260, 30],
  [345, 40],
  [355, 110],
  [300, 120],
  [340, 170],
  [200, 180],
  [160, 130],
  [110, 175],
  [35, 160],
  [60, 100],
  [30, 70],
  [40, 40],
];

export const TRACK_HALF_W = 16;
export const LAPS = 3;

interface Segment {
  ax: number;
  ay: number;
  dx: number; // unit direction
  dy: number;
  len: number;
  s0: number; // distance along track at segment start
  angle: number;
}

const SEGMENTS: Segment[] = [];
let total = 0;
for (let i = 0; i < TRACK_POINTS.length; i++) {
  const [ax, ay] = TRACK_POINTS[i];
  const [bx, by] = TRACK_POINTS[(i + 1) % TRACK_POINTS.length];
  const len = Math.hypot(bx - ax, by - ay);
  SEGMENTS.push({ ax, ay, dx: (bx - ax) / len, dy: (by - ay) / len, len, s0: total, angle: Math.atan2(by - ay, bx - ax) });
  total += len;
}
export const TRACK_LENGTH = total;

export interface Projection {
  s: number; // distance along the track, [0, TRACK_LENGTH)
  dist: number; // distance from the centerline
}

export function projectOnTrack(x: number, y: number): Projection {
  let best: Projection = { s: 0, dist: Infinity };
  for (const seg of SEGMENTS) {
    const t = Math.max(0, Math.min(seg.len, (x - seg.ax) * seg.dx + (y - seg.ay) * seg.dy));
    const px = seg.ax + seg.dx * t;
    const py = seg.ay + seg.dy * t;
    const d = Math.hypot(x - px, y - py);
    if (d < best.dist) best = { s: seg.s0 + t, dist: d };
  }
  return best;
}

export function pointOnTrack(s: number): { x: number; y: number; angle: number } {
  s = ((s % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH;
  for (const seg of SEGMENTS) {
    if (s <= seg.s0 + seg.len) {
      const t = s - seg.s0;
      return { x: seg.ax + seg.dx * t, y: seg.ay + seg.dy * t, angle: seg.angle };
    }
  }
  const last = SEGMENTS[SEGMENTS.length - 1];
  return { x: last.ax, y: last.ay, angle: last.angle };
}
