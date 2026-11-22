import type { LineConnect, LineEnd, LineOptions, Shape } from "../model/types";
import { fmtMm, ptToMm } from "./units";

export type Pt = [number, number] | null;

const f = fmtMm;

/**
 * Build an SVG path through the points (mm). Null entries break the line (axis gaps, missing data).
 * `smoothing` (0…1, default 1) sets how far a "spline" line bends: 0 is straight segments, 1 the full spline.
 */
export function linePath(points: Pt[], connect: LineConnect = "straight", smoothing = 1): string {
  const runs: [number, number][][] = [];
  let cur: [number, number][] = [];
  for (const p of points) {
    if (p) cur.push(p);
    else if (cur.length) {
      runs.push(cur);
      cur = [];
    }
  }
  if (cur.length) runs.push(cur);
  return runs.map((r) => runPath(r, connect, smoothing)).join("");
}

/**
 * Closed area between an upper and a lower edge (same length, mm). Null entries in either edge break the
 * band into separate pieces. Each piece is the upper edge followed by the lower edge in reverse.
 */
export function bandPath(upper: Pt[], lower: Pt[], connect: LineConnect = "straight"): string {
  const runs: { up: [number, number][]; lo: [number, number][] }[] = [];
  let cur: { up: [number, number][]; lo: [number, number][] } = { up: [], lo: [] };
  for (let i = 0; i < upper.length; i++) {
    const u = upper[i];
    const l = lower[i];
    if (u && l) {
      cur.up.push(u);
      cur.lo.push(l);
    } else if (cur.up.length) {
      runs.push(cur);
      cur = { up: [], lo: [] };
    }
  }
  if (cur.up.length) runs.push(cur);
  return runs
    .filter((r) => r.up.length > 1)
    .map((r) => runPath(r.up, connect) + runPath([...r.lo].reverse(), connect).replace(/^M/, "L") + "Z")
    .join("");
}

function runPath(pts: [number, number][], connect: LineConnect, smoothing = 1): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${f(pts[0][0])} ${f(pts[0][1])}`;
  switch (connect) {
    case "spline":
      return smoothing >= 1 ? catmullRom(pts) : smoothPath(pts, smoothing, false);
    case "bspline":
      return bSpline(pts);
    case "stepH":
      return pts.map((p, i) => (i === 0 ? `M${f(p[0])} ${f(p[1])}` : `H${f(p[0])}V${f(p[1])}`)).join("");
    case "stepV":
      return pts.map((p, i) => (i === 0 ? `M${f(p[0])} ${f(p[1])}` : `V${f(p[1])}H${f(p[0])}`)).join("");
    default:
      return pts.map((p, i) => `${i === 0 ? "M" : "L"}${f(p[0])} ${f(p[1])}`).join("");
  }
}

/**
 * Path through the vertices of a drawn polyline / polygon with an adjustable amount of smoothing:
 * 0 gives straight segments, 1 the full Catmull-Rom spline (the tangent at each vertex scales with `amount`).
 * A closed path wraps the tangents around the first vertex so a polygon has no corner at its start and ends with "Z".
 */
export function smoothPath(pts: [number, number][], amount: number, closed: boolean): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${f(pts[0][0])} ${f(pts[0][1])}`;
  const a = Math.min(1, Math.max(0, amount || 0));
  if (a === 0) return pts.map((p, i) => `${i === 0 ? "M" : "L"}${f(p[0])} ${f(p[1])}`).join("") + (closed ? "Z" : "");
  const t = a / 6;
  const at = (i: number) => (closed ? pts[((i % n) + n) % n] : pts[Math.min(n - 1, Math.max(0, i))]);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1x = p1[0] + (p2[0] - p0[0]) * t;
    const c1y = p1[1] + (p2[1] - p0[1]) * t;
    const c2x = p2[0] - (p3[0] - p1[0]) * t;
    const c2y = p2[1] - (p3[1] - p1[1]) * t;
    d += `C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + (closed ? "Z" : "");
}

/**
 * A polyline shortened by `dist` at its end, measured along its segments (never by more than half its length):
 * the remaining vertices, closed by the cut point. With `dist` 0 the points come back unchanged.
 */
export function cutPolylineEnd(pts: [number, number][], dist: number): [number, number][] {
  const n = pts.length;
  if (n < 2 || !(dist > 0)) return pts;
  let total = 0;
  for (let i = 1; i < n; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  let left = Math.min(dist, total / 2);
  for (let i = n - 1; i > 0; i--) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (seg >= left && seg > 0) {
      const k = left / seg;
      return [...pts.slice(0, i), [pts[i][0] + (pts[i - 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i - 1][1] - pts[i][1]) * k]];
    }
    left -= seg;
  }
  return pts;
}

/** What is drawn at the start / end of a line-like shape (line, arrow, polyline, pen stroke), or null for nothing. */
export function lineEndOf(sh: Pick<Shape, "headStart" | "headEnd" | "headStartShape" | "headEndShape">, which: "start" | "end"): LineEnd | null {
  if (which === "start") return sh.headStart ? (sh.headStartShape ?? "arrow") : null;
  return sh.headEnd ? (sh.headEndShape ?? "arrow") : null;
}

/** Smoothing amount of a drawn shape: the new 0…1 value, or 1 for shapes saved with the old `smooth` flag. */
export function shapeSmoothing(sh: { smoothing?: number; smooth?: boolean }): number {
  return sh.smoothing ?? (sh.smooth ? 1 : 0);
}

/**
 * A smoothed polyline in 3D (any coordinates): the same curves as `linePath` — "spline" through the points with
 * `smoothing` 0…1, or "bspline" near them — sampled `steps` times per segment. Returns, per original segment
 * i → i+1 ("bspline": per knot span), the sampled points including both ends, so each piece can be projected and
 * depth-sorted on its own. Straight lines come back as the plain segments.
 */
export function smoothPolyline3(p: [number, number, number][], connect: LineConnect, smoothing = 1, steps = 8): [number, number, number][][] {
  const n = p.length;
  if (n < 2) return [];
  const lerp = (a: number[], b: number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t] as [number, number, number];
  const pieces: [number, number, number][][] = [];
  if (connect === "bspline") {
    // uniform cubic B-spline, end points repeated so the curve starts and ends on the data (as in 2D)
    const q = [p[0], p[0], ...p, p[n - 1], p[n - 1]];
    for (let i = 0; i + 3 < q.length; i++) {
      const [a, b, c, e] = [q[i], q[i + 1], q[i + 2], q[i + 3]];
      const piece: [number, number, number][] = [];
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const w0 = (1 - t) ** 3 / 6;
        const w1 = (3 * t ** 3 - 6 * t ** 2 + 4) / 6;
        const w2 = (-3 * t ** 3 + 3 * t ** 2 + 3 * t + 1) / 6;
        const w3 = t ** 3 / 6;
        piece.push([0, 1, 2].map((k) => w0 * a[k] + w1 * b[k] + w2 * c[k] + w3 * e[k]) as [number, number, number]);
      }
      pieces.push(piece);
    }
    return pieces;
  }
  const a = connect === "spline" ? Math.min(1, Math.max(0, smoothing)) : 0;
  const tt = a / 6;
  for (let i = 0; i < n - 1; i++) {
    const p1 = p[i];
    const p2 = p[i + 1];
    if (a === 0) {
      pieces.push([p1, p2]);
      continue;
    }
    const p0 = p[Math.max(0, i - 1)];
    const p3 = p[Math.min(n - 1, i + 2)];
    const c1 = [0, 1, 2].map((k) => p1[k] + (p2[k] - p0[k]) * tt);
    const c2 = [0, 1, 2].map((k) => p2[k] - (p3[k] - p1[k]) * tt);
    const piece: [number, number, number][] = [];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      // de Casteljau on the cubic Bézier p1, c1, c2, p2
      const ab = lerp(p1, c1, t);
      const bc = lerp(c1, c2, t);
      const cd = lerp(c2, p2, t);
      piece.push(lerp(lerp(ab, bc, t), lerp(bc, cd, t), t));
    }
    pieces.push(piece);
  }
  return pieces;
}

/** Centripetal Catmull-Rom spline through all points, emitted as cubic Béziers. */
function catmullRom(p: [number, number][]): string {
  let d = `M${f(p[0][0])} ${f(p[0][1])}`;
  const n = p.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = p[Math.max(0, i - 1)];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[Math.min(n - 1, i + 2)];
    const t = 1 / 6;
    const c1x = p1[0] + (p2[0] - p0[0]) * t;
    const c1y = p1[1] + (p2[1] - p0[1]) * t;
    const c2x = p2[0] - (p3[0] - p1[0]) * t;
    const c2y = p2[1] - (p3[1] - p1[1]) * t;
    d += `C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

/** Uniform cubic B-spline approximating the points (does not pass through them), clamped at the ends. */
function bSpline(p: [number, number][]): string {
  const pts = [p[0], p[0], ...p, p[p.length - 1], p[p.length - 1]];
  let d = `M${f(p[0][0])} ${f(p[0][1])}`;
  for (let i = 0; i + 3 < pts.length; i++) {
    const [a, b, c, e] = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3]];
    const c1x = (a[0] + 4 * b[0] + c[0]) / 6;
    const c1y = (a[1] + 4 * b[1] + c[1]) / 6;
    const c2x = (b[0] + 4 * c[0] + e[0]) / 6;
    const c2y = (b[1] + 4 * c[1] + e[1]) / 6;
    const ctrl1x = (2 * b[0] + c[0]) / 3;
    const ctrl1y = (2 * b[1] + c[1]) / 3;
    const ctrl2x = (b[0] + 2 * c[0]) / 3;
    const ctrl2y = (b[1] + 2 * c[1]) / 3;
    if (i === 0) d += `L${f(c1x)} ${f(c1y)}`;
    d += `C${f(ctrl1x)} ${f(ctrl1y)} ${f(ctrl2x)} ${f(ctrl2y)} ${f(c2x)} ${f(c2y)}`;
  }
  const last = p[p.length - 1];
  d += `L${f(last[0])} ${f(last[1])}`;
  return d;
}

/** stroke-dasharray (mm) for a line, or undefined for solid. */
export function dashArray(line: Pick<LineOptions, "style" | "dashPt">, lwMm: number): string | undefined {
  const w = Math.max(lwMm, 0.2);
  switch (line.style) {
    case "dash":
      return `${f(w * 4)} ${f(w * 2)}`;
    case "dot":
      return `${f(w)} ${f(w * 1.5)}`;
    case "dashdot":
      return `${f(w * 4)} ${f(w * 1.5)} ${f(w)} ${f(w * 1.5)}`;
    case "custom": {
      const arr = (line.dashPt ?? []).filter((v) => Number.isFinite(v) && v >= 0);
      if (!arr.length || arr.every((v) => v === 0)) return undefined;
      return arr.map((v) => f(ptToMm(v))).join(" ");
    }
    default:
      return undefined;
  }
}
