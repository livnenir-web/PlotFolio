// Smoothed heatmap rendering. The matrix is resampled on a fine pixel grid covering its extent in mm;
// every pixel is mapped back to data coordinates through the axis scales (so log axes, reversed axes and
// axis breaks are honoured), the matrix is interpolated there (bilinear or bicubic Catmull-Rom) and the
// value is coloured through a 256-entry lookup of the colormap. The result is an <image> in the SVG.

import type { HeatmapInterpolation, Plot } from "../../model/types";
import type { LayerLayout } from "../layout";
import type { AxisScale } from "../scales";
import type { ColorMapper } from "../colormaps";
import { colorAt } from "../colormaps";
import type { MatrixData } from "../matrix";

export interface HeatmapImage {
  href: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const PX_PER_MM = 6; // ≈150 dpi on screen; export rasters at higher dpi still look smooth because the source is interpolated
const MAX_SIDE = 1600;

// cache keyed by everything the image depends on, so re-renders (drags, selection) do not resample
const cache = new Map<string, HeatmapImage | null>();
const matrixIds = new WeakMap<MatrixData, number>();
let nextMatrixId = 1;
function matrixId(m: MatrixData): number {
  let id = matrixIds.get(m);
  if (!id) {
    id = nextMatrixId++;
    matrixIds.set(m, id);
  }
  return id;
}

/**
 * Key of everything about an axis that changes the picture, independent of where the axis sits on the
 * canvas: segment ranges and scale kinds, and segment/gap positions as fractions of the axis length.
 */
function scaleKey(s: AxisScale): string {
  const R0 = s.segments[0].r0;
  const R1 = s.segments[s.segments.length - 1].r1;
  const len = R1 - R0 || 1;
  const f = (r: number) => ((r - R0) / len).toFixed(6);
  return s.segments.map((g) => `${g.from},${g.to},${g.scale},${f(g.r0)},${f(g.r1)}`).join(";") + "|" + s.gaps.map(([a, b]) => `${f(a)},${f(b)}`).join(";");
}

/** Index i such that xs[i] <= v < xs[i+1] (xs ascending), clamped to [0, n-2]; -1 when v is outside the outer edges. */
function locate(xs: number[], v: number): number {
  const n = xs.length;
  if (n === 1) return Math.abs(v - xs[0]) <= 0.5 ? 0 : -1;
  const first = xs[0] - (xs[1] - xs[0]) / 2;
  const last = xs[n - 1] + (xs[n - 1] - xs[n - 2]) / 2;
  if (v < first || v > last) return -1;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= v) lo = mid;
    else hi = mid;
  }
  return Math.min(n - 2, lo);
}

function cubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  // Catmull-Rom spline
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

function inGap(s: AxisScale, r: number): boolean {
  for (const [g0, g1] of s.gaps) if (r > Math.min(g0, g1) && r < Math.max(g0, g1)) return true;
  return false;
}

/** Build (or fetch from cache) the interpolated image for a heatmap plot. Returns null when it cannot be rasterised. */
export function heatmapImage(ll: LayerLayout, plot: Plot, mapper: ColorMapper, method: HeatmapInterpolation): HeatmapImage | null {
  if (typeof document === "undefined") return null;
  const m = ll.matrices.get(plot.id);
  if (!m || m.x.length < 2 || m.y.length < 2) return null;
  const xs = ll.x.scale;
  const ys = plot.yAxis === "y2" && ll.y2 ? ll.y2.scale : ll.y.scale;
  const cm = plot.colormap!;

  // extent of the matrix in mm (outer cell edges), clipped to the data area
  const xAsc = m.x[0] <= m.x[m.x.length - 1];
  const yAsc = m.y[0] <= m.y[m.y.length - 1];
  const gx = xAsc ? m.x : [...m.x].reverse();
  const gy = yAsc ? m.y : [...m.y].reverse();
  const xEdge0 = gx[0] - (gx[1] - gx[0]) / 2;
  const xEdge1 = gx[gx.length - 1] + (gx[gx.length - 1] - gx[gx.length - 2]) / 2;
  const yEdge0 = gy[0] - (gy[1] - gy[0]) / 2;
  const yEdge1 = gy[gy.length - 1] + (gy[gy.length - 1] - gy[gy.length - 2]) / 2;
  const f = ll.layer.frame;
  const rx = [xs.map(xEdge0), xs.map(xEdge1)].filter((v): v is number => v !== null);
  const ry = [ys.map(yEdge0), ys.map(yEdge1)].filter((v): v is number => v !== null);
  const x0 = Math.max(f.xMm, rx.length ? Math.min(...rx) : f.xMm);
  const x1 = Math.min(f.xMm + f.wMm, rx.length ? Math.max(...rx) : f.xMm + f.wMm);
  const y0 = Math.max(f.yMm, ry.length ? Math.min(...ry) : f.yMm);
  const y1 = Math.min(f.yMm + f.hMm, ry.length ? Math.max(...ry) : f.yMm + f.hMm);
  if (!(x1 > x0 && y1 > y0)) return null;
  const w = Math.max(2, Math.min(MAX_SIDE, Math.round((x1 - x0) * PX_PER_MM)));
  const h = Math.max(2, Math.min(MAX_SIDE, Math.round((y1 - y0) * PX_PER_MM)));
  // the picture depends on the data domain, the pixel size and where the clipped extent sits within the
  // axes, but not on the layer's position: moving a layer reuses it
  const fx = (v: number) => ((v - f.xMm) / f.wMm).toFixed(5);
  const fy = (v: number) => ((v - f.yMm) / f.hMm).toFixed(5);
  const key = [plot.id, matrixId(m), method, cm.name, cm.reverse, mapper.min, mapper.max, mapper.log, scaleKey(xs), scaleKey(ys), w, h, fx(x0), fx(x1), fy(y0), fy(y1)].join("|");
  const hit = cache.get(key);
  if (hit !== undefined) return hit ? { ...hit, x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;

  // colour lookup table over the mapper range
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const hex = colorAt(cm.name, i / 255, cm.reverse);
    lut[i * 3] = parseInt(hex.slice(1, 3), 16);
    lut[i * 3 + 1] = parseInt(hex.slice(3, 5), 16);
    lut[i * 3 + 2] = parseInt(hex.slice(5, 7), 16);
  }

  const nx = gx.length;
  const ny = gy.length;
  const zAt = (r: number, c: number) => {
    const rr = yAsc ? r : ny - 1 - r;
    const cc = xAsc ? c : nx - 1 - c;
    return m.z[rr][cc];
  };
  const clampR = (r: number) => Math.max(0, Math.min(ny - 1, r));
  const clampC = (c: number) => Math.max(0, Math.min(nx - 1, c));

  const sample = (x: number, y: number): number => {
    const ci = locate(gx, x);
    const ri = locate(gy, y);
    if (ci < 0 || ri < 0) return NaN;
    const tx = Math.max(0, Math.min(1, (x - gx[ci]) / (gx[ci + 1] - gx[ci] || 1)));
    const ty = Math.max(0, Math.min(1, (y - gy[ri]) / (gy[ri + 1] - gy[ri] || 1)));
    if (method === "bicubic") {
      const rows: number[] = [];
      for (let dr = -1; dr <= 2; dr++) {
        const r = clampR(ri + dr);
        const p = [zAt(r, clampC(ci - 1)), zAt(r, ci), zAt(r, ci + 1), zAt(r, clampC(ci + 2))];
        if (p.some((v) => !Number.isFinite(v))) return bilinear(ri, ci, tx, ty);
        rows.push(cubic(p[0], p[1], p[2], p[3], tx));
      }
      return cubic(rows[0], rows[1], rows[2], rows[3], ty);
    }
    return bilinear(ri, ci, tx, ty);
  };
  const bilinear = (ri: number, ci: number, tx: number, ty: number): number => {
    const z00 = zAt(ri, ci);
    const z01 = zAt(ri, ci + 1);
    const z10 = zAt(ri + 1, ci);
    const z11 = zAt(ri + 1, ci + 1);
    if (![z00, z01, z10, z11].every(Number.isFinite)) {
      // missing neighbours: fall back to the nearest finite point
      const near = zAt(ty < 0.5 ? ri : ri + 1, tx < 0.5 ? ci : ci + 1);
      return Number.isFinite(near) ? near : NaN;
    }
    return (z00 * (1 - tx) + z01 * tx) * (1 - ty) + (z10 * (1 - tx) + z11 * tx) * ty;
  };

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(w, h);
  const data = img.data;
  // data coordinate of every column / row of pixels (pixel centres)
  const colX = new Float64Array(w);
  const colGap = new Uint8Array(w);
  for (let i = 0; i < w; i++) {
    const r = x0 + ((i + 0.5) / w) * (x1 - x0);
    colGap[i] = inGap(xs, r) ? 1 : 0;
    colX[i] = xs.invert(r);
  }
  const rowY = new Float64Array(h);
  const rowGap = new Uint8Array(h);
  for (let j = 0; j < h; j++) {
    const r = y0 + ((j + 0.5) / h) * (y1 - y0);
    rowGap[j] = inGap(ys, r) ? 1 : 0;
    rowY[j] = ys.invert(r);
  }
  for (let j = 0; j < h; j++) {
    if (rowGap[j]) continue;
    const y = rowY[j];
    for (let i = 0; i < w; i++) {
      if (colGap[i]) continue;
      const z = sample(colX[i], y);
      if (!Number.isFinite(z)) continue;
      const t = mapper.t(z);
      if (!Number.isFinite(t)) continue;
      const k = Math.max(0, Math.min(255, Math.round(t * 255))) * 3;
      const o = (j * w + i) * 4;
      data[o] = lut[k];
      data[o + 1] = lut[k + 1];
      data[o + 2] = lut[k + 2];
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const out: HeatmapImage = { href: canvas.toDataURL("image/png"), x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  if (cache.size > 24) cache.delete(cache.keys().next().value!);
  cache.set(key, { ...out, x: 0, y: 0, width: 0, height: 0 });
  return out;
}
