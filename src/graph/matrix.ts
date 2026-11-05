import type { Column, Plot, Project, Sheet } from "../model/types";
import { columnLetter } from "../model/defaults";

export interface MatrixData {
  /** x coordinate of each column (length nx) */
  x: number[];
  /** y coordinate of each row (length ny) */
  y: number[];
  /** z[row][col] */
  z: number[][];
  zMin: number;
  zMax: number;
}

const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : NaN);

function finiteRange(z: number[][]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const row of z)
    for (const v of row) {
      if (!Number.isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  return lo <= hi ? [lo, hi] : [0, 1];
}

/** Default block for a sheet: all Y-ish columns after the first X column. */
export function defaultMatrixSource(sheet: Sheet): NonNullable<Plot["source"]["matrix"]> {
  const xIdx = sheet.columns.findIndex((c) => c.designation === "X");
  const start = xIdx >= 0 ? xIdx + 1 : 0;
  const cols = sheet.columns.slice(start);
  const numericNames = cols.length > 0 && cols.every((c) => Number.isFinite(Number(c.longName)) && c.longName.trim() !== "");
  return {
    mode: "block",
    firstColId: cols[0]?.id ?? null,
    lastColId: cols[cols.length - 1]?.id ?? null,
    yColId: xIdx >= 0 ? sheet.columns[xIdx].id : null,
    xFromNames: numericNames,
    gridN: 50,
  };
}

function blockMatrix(sheet: Sheet, m: NonNullable<Plot["source"]["matrix"]>): MatrixData | null {
  const cols = sheet.columns;
  let a = cols.findIndex((c) => c.id === m.firstColId);
  let b = cols.findIndex((c) => c.id === m.lastColId);
  if (a < 0) a = 0;
  if (b < 0) b = cols.length - 1;
  if (a > b) [a, b] = [b, a];
  const yCol: Column | undefined = m.yColId ? cols.find((c) => c.id === m.yColId) : undefined;
  const block = cols.slice(a, b + 1).filter((c) => c !== yCol);
  if (!block.length) return null;
  const ny = block.reduce((mx, c) => Math.max(mx, c.values.length), 0);
  if (!ny) return null;
  const x = block.map((c, i) => (m.xFromNames && Number.isFinite(Number(c.longName)) && c.longName.trim() !== "" ? Number(c.longName) : i + 1));
  const y = Array.from({ length: ny }, (_, r) => (yCol ? num(yCol.values[r]) : r + 1));
  const z = Array.from({ length: ny }, (_, r) => block.map((c) => num(c.values[r])));
  // drop rows with a non-finite y
  const keep = y.map((v) => Number.isFinite(v));
  const yk = y.filter((_, i) => keep[i]);
  const zk = z.filter((_, i) => keep[i]);
  const [zMin, zMax] = finiteRange(zk);
  return { x, y: yk, z: zk, zMin, zMax };
}

function xyzMatrix(sheet: Sheet, src: Plot["source"], gridN: number): MatrixData | null {
  const xc = sheet.columns.find((c) => c.id === src.xColId);
  const yc = sheet.columns.find((c) => c.id === src.yColId);
  const zc = sheet.columns.find((c) => c.id === (src.zColId ?? src.matrix?.zColId));
  if (!xc || !yc || !zc) return null;
  const n = Math.min(xc.values.length, yc.values.length, zc.values.length);
  const pts: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p: [number, number, number] = [num(xc.values[i]), num(yc.values[i]), num(zc.values[i])];
    if (p.every(Number.isFinite)) pts.push(p);
  }
  if (pts.length < 3) return null;
  const xs = [...new Set(pts.map((p) => p[0]))].sort((p, q) => p - q);
  const ys = [...new Set(pts.map((p) => p[1]))].sort((p, q) => p - q);
  // regular grid: every (x,y) combination present
  if (xs.length * ys.length === pts.length && xs.length > 1 && ys.length > 1) {
    const xi = new Map(xs.map((v, i) => [v, i]));
    const yi = new Map(ys.map((v, i) => [v, i]));
    const z = Array.from({ length: ys.length }, () => new Array(xs.length).fill(NaN));
    for (const p of pts) z[yi.get(p[1])!][xi.get(p[0])!] = p[2];
    const [zMin, zMax] = finiteRange(z);
    return { x: xs, y: ys, z, zMin, zMax };
  }
  // scattered: inverse-distance weighting onto a gridN × gridN grid
  const N = Math.max(5, Math.min(200, Math.round(gridN) || 50));
  const x0 = xs[0];
  const x1 = xs[xs.length - 1];
  const y0 = ys[0];
  const y1 = ys[ys.length - 1];
  const gx = Array.from({ length: N }, (_, i) => x0 + ((x1 - x0) * i) / (N - 1));
  const gy = Array.from({ length: N }, (_, i) => y0 + ((y1 - y0) * i) / (N - 1));
  const sx = (x1 - x0) / N || 1;
  const sy = (y1 - y0) / N || 1;
  const z = gy.map((yv) =>
    gx.map((xv) => {
      let num0 = 0;
      let den = 0;
      for (const p of pts) {
        const dx = (p[0] - xv) / sx;
        const dy = (p[1] - yv) / sy;
        const d2 = dx * dx + dy * dy;
        if (d2 < 1e-12) return p[2];
        const w = 1 / (d2 * d2);
        num0 += w * p[2];
        den += w;
      }
      return den ? num0 / den : NaN;
    }),
  );
  const [zMin, zMax] = finiteRange(z);
  return { x: gx, y: gy, z, zMin, zMax };
}

const matrixCache = new WeakMap<object, { sheet: Sheet; result: MatrixData | null }>();

/** Resolve matrix data for heatmap / contour / surface plots. Cached per (plot source, sheet) identity. */
export function getMatrixData(project: Project, plot: Plot): MatrixData | null {
  const sheet = project.sheets.find((s) => s.id === plot.source.sheetId);
  if (!sheet) return null;
  const hit = matrixCache.get(plot.source);
  if (hit && hit.sheet === sheet) return hit.result;
  const m = plot.source.matrix ?? defaultMatrixSource(sheet);
  const result = m.mode === "xyz" ? xyzMatrix(sheet, plot.source, m.gridN ?? 50) : blockMatrix(sheet, m);
  matrixCache.set(plot.source, { sheet, result });
  return result;
}

export function columnLabel(sheet: Sheet, id: string | null | undefined): string {
  const i = sheet.columns.findIndex((c) => c.id === id);
  if (i < 0) return "–";
  return sheet.columns[i].longName || columnLetter(i);
}
