import type { View3D } from "../model/types";

export interface Projector {
  /** normalized box coords (0..1 each) → canvas mm [x, y, depth] */
  project: (u: number, v: number, w: number) => [number, number, number];
  /** unit light vector in view space for shading */
  shade: (nx: number, ny: number, nz: number) => number;
}

/**
 * Orthographic projection of the unit box into a frame (mm), with azimuth (rotation about z)
 * and elevation (tilt). Depth increases away from the viewer.
 */
export function makeProjector(view: View3D, frame: { xMm: number; yMm: number; wMm: number; hMm: number }): Projector {
  const az = (view.azimuth * Math.PI) / 180;
  const el = (view.elevation * Math.PI) / 180;
  const ca = Math.cos(az);
  const sa = Math.sin(az);
  const ce = Math.cos(el);
  const se = Math.sin(el);
  const bx = view.boxX;
  const by = view.boxY;
  const bz = view.boxZ;

  const rot = (u: number, v: number, w: number): [number, number, number] => {
    // center the box
    const x = (u - 0.5) * bx;
    const y = (v - 0.5) * by;
    const z = (w - 0.5) * bz;
    // rotate about z by azimuth
    const x1 = x * ca - y * sa;
    const y1 = x * sa + y * ca;
    // tilt: screen X = x1, screen Y = z*ce - y1*se (up positive), depth = y1*ce + z*se
    const sx = x1;
    const sy = z * ce + y1 * se;
    const depth = y1 * ce - z * se;
    return [sx, sy, depth];
  };

  // fit the rotated box into the frame
  const corners: [number, number, number][] = [];
  for (const u of [0, 1]) for (const v of [0, 1]) for (const w of [0, 1]) corners.push(rot(u, v, w));
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = Math.min(frame.wMm / (maxX - minX || 1), frame.hMm / (maxY - minY || 1));
  const cx = frame.xMm + frame.wMm / 2;
  const cy = frame.yMm + frame.hMm / 2;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  const project = (u: number, v: number, w: number): [number, number, number] => {
    const [sx, sy, d] = rot(u, v, w);
    return [cx + (sx - midX) * scale, cy - (sy - midY) * scale, d];
  };

  // light from the upper-left-front in view space
  const lx = -0.4;
  const ly = 0.6;
  const lz = -0.7;
  const ln = Math.hypot(lx, ly, lz);
  const shade = (nx: number, ny: number, nz: number) => {
    // transform the normal like a direction
    const x1 = nx * ca - ny * sa;
    const y1 = nx * sa + ny * ca;
    const vx = x1;
    const vy = nz * ce + y1 * se;
    const vz = y1 * ce - nz * se;
    const n = Math.hypot(vx, vy, vz) || 1;
    const dot = (vx * lx + vy * ly + vz * lz) / (n * ln);
    return 0.65 + 0.35 * Math.abs(dot);
  };
  return { project, shade };
}

/** Which of the box's vertical/horizontal edges are in front, to pick where axes are drawn. */
export function frontEdges(view: View3D, project?: Projector["project"]): { front: { u: 0 | 1; v: 0 | 1 }; xEdge: { v: 0 | 1; w: 0 | 1 }; yEdge: { u: 0 | 1; w: 0 | 1 }; zEdge: { u: 0 | 1; v: 0 | 1 } } {
  const az = (view.azimuth * Math.PI) / 180;
  // the corner closest to the viewer minimises depth ∝ (u-½)·sin(az) + (v-½)·cos(az)
  const front = { u: (Math.sin(az) > 0 ? 0 : 1) as 0 | 1, v: (Math.cos(az) > 0 ? 0 : 1) as 0 | 1 };
  const bottom: 0 | 1 = view.elevation >= 0 ? 0 : 1;
  // z axis: the vertical edge that is leftmost on screen, excluding the front corner
  let zEdge: { u: 0 | 1; v: 0 | 1 } = { u: front.u === 1 ? 0 : 1, v: front.v };
  if (project) {
    let best = Infinity;
    for (const u of [0, 1] as const)
      for (const v of [0, 1] as const) {
        if (u === front.u && v === front.v) continue;
        const [x] = project(u, v, 0.5);
        if (x < best) {
          best = x;
          zEdge = { u, v };
        }
      }
  }
  return { front, xEdge: { v: front.v, w: bottom }, yEdge: { u: front.u, w: bottom }, zEdge };
}

export function mixColor(hex: string, factor: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const f = (s: string) =>
    Math.round(Math.max(0, Math.min(255, parseInt(s, 16) * factor)))
      .toString(16)
      .padStart(2, "0");
  return `#${f(m[1])}${f(m[2])}${f(m[3])}`;
}
