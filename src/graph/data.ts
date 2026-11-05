import type { Column, HistogramOptions, Plot, Project, Sheet } from "../model/types";

export interface XYData {
  x: number[];
  y: number[];
  yErr?: number[];
  xErr?: number[];
  /** text of a label column, per kept row */
  labels?: (string | number | null)[];
  /** values of the colour-by column, per kept row */
  colorVals?: number[];
}

function col(sheet: Sheet | undefined, id: string | null | undefined): Column | undefined {
  if (!sheet || !id) return undefined;
  return sheet.columns.find((c) => c.id === id);
}

const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : NaN);

// Caches. Immer keeps the identity of untouched objects, so a plot's source (and the sheet columns it
// points at) only change identity when they really change. Everything derived from them is cached on
// those identities and reused by every layout of every layer that did not change.
interface PlotDataEntry {
  yc?: Column;
  xc?: Column;
  yec?: Column;
  xec?: Column;
  lc?: Column;
  cc?: Column;
  ignoreX: boolean;
  result: XYData;
}
const plotDataCache = new WeakMap<object, PlotDataEntry>();
const fitDataCache = new WeakMap<object, XYData>();

/** Resolve a plot's data from the project, dropping rows where x or y is missing. Cached per plot source. */
export function getPlotData(project: Project, plot: Plot, opts?: { ignoreX?: boolean }): XYData {
  if (plot.type === "fitCurve" && plot.fit?.curveX && plot.fit.curveY) {
    const hit = fitDataCache.get(plot.fit);
    if (hit && hit.x === plot.fit.curveX && hit.y === plot.fit.curveY) return hit;
    const r = { x: plot.fit.curveX, y: plot.fit.curveY };
    fitDataCache.set(plot.fit, r);
    return r;
  }
  const ignoreX = !!opts?.ignoreX;
  const sheet = project.sheets.find((s) => s.id === plot.source.sheetId);
  const yc = col(sheet, plot.source.yColId);
  const xc = ignoreX ? undefined : col(sheet, plot.source.xColId);
  const yec = col(sheet, plot.source.yErrColId);
  const xec = col(sheet, plot.source.xErrColId);
  const lc = plot.labels?.source === "column" ? col(sheet, plot.labels.colId) : undefined;
  const cc = col(sheet, plot.colorBy?.colId);
  const key = plot.source;
  const hit = plotDataCache.get(key);
  if (hit && hit.yc === yc && hit.xc === xc && hit.yec === yec && hit.xec === xec && hit.lc === lc && hit.cc === cc && hit.ignoreX === ignoreX) return hit.result;
  const result = computePlotData(sheet, yc, xc, yec, xec, lc, cc);
  plotDataCache.set(key, { yc, xc, yec, xec, lc, cc, ignoreX, result });
  return result;
}

function computePlotData(sheet: Sheet | undefined, yc?: Column, xc?: Column, yec?: Column, xec?: Column, lc?: Column, cc?: Column): XYData {
  if (!sheet || !yc) return { x: [], y: [] };
  const n = Math.max(yc.values.length, xc?.values.length ?? 0);
  const x: number[] = [];
  const y: number[] = [];
  const yErr: number[] = [];
  const xErr: number[] = [];
  const labels: (string | number | null)[] = [];
  const colorVals: number[] = [];
  for (let i = 0; i < n; i++) {
    const yv = num(yc.values[i]);
    const xv = xc ? num(xc.values[i]) : i + 1;
    if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue;
    x.push(xv);
    y.push(yv);
    if (yec) yErr.push(Math.abs(num(yec.values[i])) || 0);
    if (xec) xErr.push(Math.abs(num(xec.values[i])) || 0);
    if (lc) labels.push(lc.values[i] ?? null);
    if (cc) colorVals.push(num(cc.values[i]));
  }
  return { x, y, yErr: yec ? yErr : undefined, xErr: xec ? xErr : undefined, labels: lc ? labels : undefined, colorVals: cc ? colorVals : undefined };
}

export interface XYZData extends XYData {
  z: number[];
}
const xyzCache = new WeakMap<object, { xc?: Column; yc?: Column; zc?: Column; result: XYZData }>();

/** Aligned x/y/z triples for 3D scatter plots. Cached per plot source. */
export function getScatter3dData(project: Project, plot: Plot): XYZData {
  const sheet = project.sheets.find((s) => s.id === plot.source.sheetId);
  const xc = col(sheet, plot.source.xColId);
  const yc = col(sheet, plot.source.yColId);
  const zc = col(sheet, plot.source.zColId);
  const hit = xyzCache.get(plot.source);
  if (hit && hit.xc === xc && hit.yc === yc && hit.zc === zc) return hit.result;
  const n = Math.max(xc?.values.length ?? 0, yc?.values.length ?? 0, zc?.values.length ?? 0);
  const numOnly = (v: unknown) => (typeof v === "number" ? v : NaN);
  const x: number[] = [];
  const y: number[] = [];
  const z: number[] = [];
  for (let i = 0; i < n; i++) {
    const xv = xc ? numOnly(xc.values[i]) : i + 1;
    const yv = numOnly(yc?.values[i]);
    const zv = numOnly(zc?.values[i]);
    if (Number.isFinite(xv) && Number.isFinite(yv) && Number.isFinite(zv)) {
      x.push(xv);
      y.push(yv);
      z.push(zv);
    }
  }
  const result = { x, y, z };
  xyzCache.set(plot.source, { xc, yc, zc, result });
  return result;
}

export interface Bin {
  x0: number;
  x1: number;
  count: number;
  value: number;
}

const binCache = new WeakMap<number[], Map<HistogramOptions, Bin[]>>();

/** Histogram bins for the values. Cached per (values array, options object) identity. */
export function histogramBins(values: number[], opts: HistogramOptions): Bin[] {
  let byOpts = binCache.get(values);
  const hit = byOpts?.get(opts);
  if (hit) return hit;
  const r = computeBins(values, opts);
  if (!byOpts) binCache.set(values, (byOpts = new Map()));
  byOpts.set(opts, r);
  return r;
}

function computeBins(values: number[], opts: HistogramOptions): Bin[] {
  const v = values.filter((x) => Number.isFinite(x));
  if (!v.length) return [];
  const ext = extent(v)!;
  let lo = opts.rangeAuto ? ext[0] : opts.from;
  let hi = opts.rangeAuto ? ext[1] : opts.to;
  if (hi <= lo) hi = lo + 1;
  let width: number;
  let count: number;
  if (opts.binMode === "width" && opts.binWidth > 0) {
    width = opts.binWidth;
    if (opts.rangeAuto) {
      lo = Math.floor(lo / width) * width;
      hi = Math.ceil(hi / width) * width;
      if (hi <= lo) hi = lo + width;
    }
    count = Math.max(1, Math.round((hi - lo) / width));
  } else {
    count = Math.max(1, Math.round(opts.binCount) || 10);
    width = (hi - lo) / count;
  }
  const bins: Bin[] = Array.from({ length: count }, (_, i) => ({ x0: lo + i * width, x1: lo + (i + 1) * width, count: 0, value: 0 }));
  for (const x of v) {
    let i = Math.floor((x - lo) / width);
    if (i === count && x === hi) i = count - 1;
    if (i >= 0 && i < count) bins[i].count++;
  }
  const total = v.length;
  for (const b of bins) {
    b.value = opts.normalization === "density" ? b.count / (total * width) : opts.normalization === "probability" ? b.count / total : b.count;
  }
  return bins;
}

export function defaultHistogramOptions(): HistogramOptions {
  return { binMode: "count", binCount: 10, binWidth: 1, rangeAuto: true, from: 0, to: 1, normalization: "count", filled: true };
}
/** Shared default options object, so layouts of plots without explicit options hit the bin cache. */
export const DEFAULT_HISTOGRAM: HistogramOptions = Object.freeze(defaultHistogramOptions()) as HistogramOptions;

/** Numeric extent of an array, ignoring non-finite values. */
export function extent(values: number[], positiveOnly = false): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (positiveOnly && v <= 0) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo <= hi ? [lo, hi] : null;
}
