import type { Axis, Graph, Layer, Legend, Plot, Project, TextStyle } from "../model/types";
import { buildScale, type AxisScale } from "./scales";
import { DEFAULT_HISTOGRAM, extent, getPlotData, getScatter3dData, histogramBins, type Bin, type XYData } from "./data";
import { formatTick, isLogScale } from "./ticks";
import { fontGeneration, lineHeightMm, measureTextMm, onFontsChanged, ptToMm } from "./units";
import { markupToPlain, measureMarkupMm } from "./textMarkup";
import { getMatrixData, type MatrixData } from "./matrix";
import { makeColorMapper, type ColorMapper } from "./colormaps";
import { makeProjector, type Projector } from "./projection3d";
import { sampleFunction } from "./functionPlot";

export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface TickLabel {
  value: number;
  r: number;
  text: string;
  /** Labels next to an axis break are nudged away from the gap. */
  anchor?: "start" | "middle" | "end";
  shift?: number;
}

export interface AxisGeom {
  which: "x" | "y" | "y2";
  axis: Axis; // effective (after "same as X")
  scale: AxisScale;
  /** Coordinate of the axis line: y for x-axis, x for y-axes (mm). */
  line: number;
  /** +1 if ticks/labels go towards increasing coordinate (down / right), -1 otherwise. */
  side: 1 | -1;
  tickOut: number; // tick length drawn outside the frame (mm)
  tickIn: number; // tick length drawn inside the frame (mm)
  labels: TickLabel[];
  labelPos: number; // coordinate of label anchor (mm)
  labelExtent: number; // size of label block (height for x, width for y)
  titlePos: number; // coordinate of title baseline/anchor
  titleExtent: number;
  bbox: BBox;
  minorLen: number;
}

export interface LegendGeom {
  x: number;
  y: number;
  w: number;
  h: number;
  rowH: number;
  pad: number;
  entries: { plot: Plot; text: string; x: number; y: number }[];
}

export interface BoxStats {
  q1: number;
  median: number;
  q3: number;
  whiskerLo: number;
  whiskerHi: number;
  mean: number;
  outliers: number[];
  values: number[];
}

export interface ColorScaleGeom {
  x: number;
  y: number;
  w: number;
  h: number;
  mapper: ColorMapper;
  ticks: { value: number; r: number; text: string }[];
  plotId: string;
}

export interface LayerLayout {
  layer: Layer;
  x: AxisGeom;
  y: AxisGeom;
  y2?: AxisGeom;
  data: Map<string, XYData>;
  bins: Map<string, Bin[]>;
  matrices: Map<string, MatrixData>;
  colors: Map<string, ColorMapper>;
  boxes: Map<string, BoxStats>;
  /** category labels when the layer holds bar/box plots */
  categories?: string[];
  /** bar plots in drawing order (for grouping / stacking) */
  barPlots: Plot[];
  horizontalBars: boolean;
  /** the project's plot colour cycle (bars coloured per category use it) */
  palette: string[];
  legend: LegendGeom;
  colorScale?: ColorScaleGeom;
  is3d: boolean;
  projector?: Projector;
  zScale?: AxisScale;
  /** shapes and texts resolved to canvas mm (data-anchored ones converted through the axes) */
  shapeMm: Map<string, { x1: number; y1: number; x2: number; y2: number }>;
  /** vertices of polyline / polygon / freehand shapes in canvas mm */
  shapePointsMm: Map<string, { x: number; y: number }[]>;
  textMm: Map<string, { x: number; y: number }>;
  /** canvas mm → axis units (x, y) */
  toData: (xMm: number, yMm: number) => { x: number; y: number };
  /** axis units → canvas mm */
  toMm: (x: number, y: number) => { x: number; y: number };
  bbox: BBox;
}

export interface GraphLayout {
  graph: Graph;
  layers: LayerLayout[];
  widthMm: number;
  heightMm: number;
  content: BBox;
}

const AXIS_STYLE_KEYS = ["titleStyle", "tickLabelStyle", "tickDir", "majorTickMm", "minorTickMm", "lineWidthPt", "color", "titleGapMm"] as const;

/** Y axes can inherit their styling from the X axis. */
export function effectiveAxis(layer: Layer, which: "x" | "y" | "y2" | "z"): Axis {
  const a = layer.axes[which];
  if (!a) throw new Error("axis missing");
  if (which === "x" || !a.sameAsX) return a;
  const out: Axis = { ...a };
  for (const k of AXIS_STYLE_KEYS) (out as unknown as Record<string, unknown>)[k] = layer.axes.x[k];
  return out;
}

interface ExtentCtx {
  data: Map<string, XYData>;
  bins: Map<string, Bin[]>;
  matrices: Map<string, MatrixData>;
  boxes: Map<string, BoxStats>;
  barPlots: Plot[];
  horizontalBars: boolean;
}

function matrixEdges(vals: number[]): [number, number] | null {
  if (!vals.length) return null;
  if (vals.length === 1) return [vals[0] - 0.5, vals[0] + 0.5];
  const d0 = (vals[1] - vals[0]) / 2;
  const d1 = (vals[vals.length - 1] - vals[vals.length - 2]) / 2;
  return [Math.min(vals[0] - d0, vals[vals.length - 1] + d1), Math.max(vals[0] - d0, vals[vals.length - 1] + d1)];
}

export function plotAxisExtent(layer: Layer, which: "x" | "y" | "y2" | "z", ctx: ExtentCtx, positiveOnly: boolean): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  const push = (a: number, b: number) => {
    if (Number.isFinite(a)) lo = Math.min(lo, a);
    if (Number.isFinite(b)) hi = Math.max(hi, b);
  };
  // value axis for bars: the axis that is not categorical
  const barValueAxis = ctx.horizontalBars ? "x" : "y";
  if (ctx.barPlots.length && which === barValueAxis) {
    push(0, 0);
    const stacked = ctx.barPlots[0].bar?.stacked;
    const n = Math.max(...ctx.barPlots.map((p) => ctx.data.get(p.id)?.y.length ?? 0));
    for (let i = 0; i < n; i++) {
      let pos = 0;
      let neg = 0;
      for (const p of ctx.barPlots) {
        const d = ctx.data.get(p.id);
        const v = d?.y[i];
        if (v === undefined || !Number.isFinite(v)) continue;
        const e = p.errorBars.show && d?.yErr ? (d.yErr[i] ?? 0) : 0;
        if (stacked) {
          if (v >= 0) {
            pos += v;
            push(pos, pos + e);
          } else {
            neg += v;
            push(neg - e, neg);
          }
        } else push(v - e, v + e);
      }
    }
  }
  for (const p of layer.plots) {
    if (!p.visible) continue;
    if ((which === "y" || which === "y2") && p.yAxis !== which && !layer.view3d) continue;
    if (p.type === "bar") continue; // handled above (categories for the other axis)
    if (p.type === "box") {
      if (which === (ctx.horizontalBars ? "x" : "y")) {
        const st = ctx.boxes.get(p.id);
        if (st) push(Math.min(st.whiskerLo, ...st.outliers), Math.max(st.whiskerHi, ...st.outliers));
      }
      continue;
    }
    if (p.type === "histogram") {
      const b = ctx.bins.get(p.id) ?? [];
      if (!b.length) continue;
      if (which === "x") push(b[0].x0, b[b.length - 1].x1);
      else push(0, Math.max(...b.map((x) => x.value)));
      continue;
    }
    if (p.type === "heatmap" || p.type === "contour" || p.type === "surface3d") {
      const m = ctx.matrices.get(p.id);
      if (!m) continue;
      if (which === "x") {
        const e = p.type === "surface3d" ? extent(m.x) : matrixEdges(m.x);
        if (e) push(e[0], e[1]);
      } else if (which === "y") {
        const e = p.type === "surface3d" ? extent(m.y) : matrixEdges(m.y);
        if (e) push(e[0], e[1]);
      } else if (which === "z") push(m.zMin, m.zMax);
      continue;
    }
    const d = ctx.data.get(p.id);
    if (!d) continue;
    if (which === "z") {
      const zs = (d as XYData & { z?: number[] }).z;
      if (zs) {
        const e = extent(zs, positiveOnly);
        if (e) push(e[0], e[1]);
      }
      continue;
    }
    const vals = which === "x" ? d.x : d.y;
    const errs = which === "x" ? d.xErr : d.yErr;
    const ext = extent(vals, positiveOnly);
    if (!ext) continue;
    let [a, b] = ext;
    if (errs && errs.length && p.errorBars.show) {
      for (let i = 0; i < vals.length; i++) {
        const e = errs[i] ?? 0;
        if (!Number.isFinite(vals[i])) continue;
        if (!positiveOnly || vals[i] - e > 0) a = Math.min(a, vals[i] - e);
        b = Math.max(b, vals[i] + e);
      }
    }
    push(a, b);
  }
  return lo <= hi ? [lo, hi] : null;
}

function tickLabelTexts(scale: AxisScale, axis: Axis): TickLabel[] {
  if (!axis.showTickLabels) return [];
  const pre = axis.labelPrefix ?? "";
  const suf = axis.labelSuffix ?? "";
  const labels = scale.major
    .map((v, i) => {
      const info = scale.tickInfo(v);
      const own = scale.customLabels?.get(v);
      if (own != null) return { value: v, r: scale.map(v), text: own }; // an explicit label is used as typed, without prefix/suffix
      const core = scale.categories ? (scale.categories[i] ?? "") : formatTick(v, { ...axis, scale: info.scale }, info.step);
      return { value: v, r: scale.map(v), text: pre || suf ? `${pre}${core}${suf}` : core };
    })
    .filter((t): t is TickLabel => t.r !== null);
  for (const [g0, g1] of scale.gaps) {
    const lo = Math.min(g0, g1);
    const hi = Math.max(g0, g1);
    for (const t of labels) {
      if (Math.abs(t.r - lo) < 1e-6) {
        t.anchor = "end";
        t.shift = -0.4;
      } else if (Math.abs(t.r - hi) < 1e-6) {
        t.anchor = "start";
        t.shift = 0.4;
      }
    }
  }
  return labels;
}

/** Size of a (possibly rotated) label block across the axis and along it. */
function rotatedExtent(wMm: number, hMm: number, deg: number): { across: number; along: number } {
  const a = (Math.abs(deg) * Math.PI) / 180;
  return { across: wMm * Math.sin(a) + hMm * Math.cos(a), along: wMm * Math.cos(a) + hMm * Math.sin(a) };
}

function axisGeom(which: "x" | "y" | "y2", layer: Layer, scale: AxisScale, cross?: number | null): AxisGeom {
  const axis = effectiveAxis(layer, which);
  const f = layer.frame;
  const tickOut = axis.tickDir === "out" ? axis.majorTickMm : 0;
  const tickIn = axis.tickDir === "in" ? axis.majorTickMm : 0;
  const minorLen = axis.tickDir === "none" ? 0 : axis.minorTickMm;
  let labels = tickLabelTexts(scale, axis);
  if (axis.labelEvery && axis.labelEvery > 1) labels = labels.filter((_, i) => i % axis.labelEvery! === 0);
  const labelGap = axis.labelGapMm ?? 0.8;
  const lh = lineHeightMm(axis.tickLabelStyle);
  if (which === "x" && labels.length > 2) {
    // thin out labels that would overlap along the axis (keep every n-th); ticks stay.
    // Each segment between breaks is thinned on its own, so a crowded segment does not hide labels elsewhere.
    const thin = (group: TickLabel[]) => {
      if (group.length <= 2) return group;
      const widths = group.map((t) => measureMarkupMm(t.text, axis.tickLabelStyle).width);
      const fits = (n: number) => {
        for (let i = n; i < group.length; i += n) if (Math.abs(group[i].r - group[i - n].r) < (widths[i] + widths[i - n]) / 2 + 0.6) return false;
        return true;
      };
      let n = 1;
      while (n < group.length && !fits(n)) n++;
      return n > 1 ? group.filter((_, i) => i % n === 0) : group;
    };
    const segOf = (v: number) => {
      const idx = scale.segments.findIndex((sg) => v >= Math.min(sg.from, sg.to) - 1e-9 && v <= Math.max(sg.from, sg.to) + 1e-9);
      return idx < 0 ? 0 : idx;
    };
    const groups = new Map<number, TickLabel[]>();
    for (const t of labels) {
      const k = segOf(t.value);
      groups.set(k, [...(groups.get(k) ?? []), t]);
    }
    labels = [...groups.keys()].sort((a, b) => a - b).flatMap((k) => thin(groups.get(k)!));
  }
  const rot = axis.labelRotation ?? 0;
  if (which === "x") {
    const line = cross ?? f.yMm + f.hMm;
    const labelPos = line + tickOut + labelGap;
    const maxW = labels.reduce((m, t) => Math.max(m, measureMarkupMm(t.text, axis.tickLabelStyle).width), 0);
    const labelExtent = labels.length ? (rot ? rotatedExtent(maxW, lh, rot).across : lh) : 0;
    const titleH = axis.showTitle && axis.title ? lineHeightMm(axis.titleStyle) * measureMarkupMm(axis.title, axis.titleStyle).lines : 0;
    const titlePos = labelPos + labelExtent + (titleH ? axis.titleGapMm : 0);
    const bottom = titlePos + titleH;
    // label overhang left/right
    let overL = 0;
    let overR = 0;
    if (labels.length) {
      const first = labels[0];
      const last = labels[labels.length - 1];
      overL = Math.max(0, f.xMm - (first.r - measureMarkupMm(first.text, axis.tickLabelStyle).width / 2));
      overR = Math.max(0, last.r + measureMarkupMm(last.text, axis.tickLabelStyle).width / 2 - (f.xMm + f.wMm));
    }
    return {
      which,
      axis,
      scale,
      line,
      side: 1,
      tickOut,
      tickIn,
      labels,
      labelPos,
      labelExtent,
      titlePos,
      titleExtent: titleH,
      minorLen,
      bbox: { x0: f.xMm - overL, y0: f.yMm, x1: f.xMm + f.wMm + overR, y1: axis.visible ? Math.max(bottom, f.yMm + f.hMm) : f.yMm + f.hMm },
    };
  }
  const isLeft = which === "y";
  const side: 1 | -1 = isLeft ? -1 : 1;
  const line = cross ?? (isLeft ? f.xMm : f.xMm + f.wMm);
  const rawW = labels.reduce((m, t) => Math.max(m, measureMarkupMm(t.text, axis.tickLabelStyle).width), 0);
  const labelW = rot ? rotatedExtent(rawW, lh, rot).along : rawW;
  const labelPos = line + side * (tickOut + labelGap);
  const titleH = axis.showTitle && axis.title ? lineHeightMm(axis.titleStyle) * measureMarkupMm(axis.title, axis.titleStyle).lines : 0;
  const titlePos = labelPos + side * (labelW + (titleH ? axis.titleGapMm : 0));
  const outer = titlePos + side * titleH;
  let overT = 0;
  let overB = 0;
  if (labels.length) {
    overT = Math.max(0, f.yMm - (Math.min(...labels.map((l) => l.r)) - lh / 2));
    overB = Math.max(0, Math.max(...labels.map((l) => l.r)) + lh / 2 - (f.yMm + f.hMm));
  }
  return {
    which,
    axis,
    scale,
    line,
    side,
    tickOut,
    tickIn,
    labels,
    labelPos,
    labelExtent: labelW,
    titlePos,
    titleExtent: titleH,
    minorLen,
    bbox: isLeft
      ? { x0: axis.visible ? Math.min(outer, f.xMm) : f.xMm, y0: f.yMm - overT, x1: f.xMm, y1: f.yMm + f.hMm + overB }
      : { x0: f.xMm + f.wMm, y0: f.yMm - overT, x1: axis.visible ? Math.max(outer, f.xMm + f.wMm) : f.xMm + f.wMm, y1: f.yMm + f.hMm + overB },
  };
}

export function legendGeom(layer: Layer, legend: Legend, style: TextStyle): LegendGeom {
  const f = layer.frame;
  const plots = layer.plots.filter((p) => p.visible && p.showInLegend !== false && !["heatmap", "contour", "surface3d", "box"].includes(p.type));
  const rowH = lineHeightMm(style) * 1.05;
  const pad = legend.paddingMm ?? 1;
  const columns = Math.max(1, Math.min(plots.length || 1, Math.round(legend.columns ?? 1)));
  const rows = Math.ceil(plots.length / columns);
  const textW = plots.reduce((m, p) => Math.max(m, measureMarkupMm(p.name, style).width), 0);
  const colW = legend.symbolWidthMm + 1.2 + textW;
  const colGap = 2;
  const entries = plots.map((p, i) => ({ plot: p, text: p.name, x: Math.floor(i / rows) * (colW + colGap), y: pad + (i % rows) * rowH }));
  const w = pad * 2 + columns * colW + (columns - 1) * colGap;
  const h = pad * 2 + rowH * rows;
  return { x: f.xMm + legend.xMm, y: f.yMm + legend.yMm, w, h, rowH, pad, entries };
}

export function textItemBBox(text: { text: string; xMm: number; yMm: number; style: TextStyle; anchor: "start" | "middle" | "end"; rotation: number }): BBox {
  const m = measureMarkupMm(text.text, text.style);
  const h = lineHeightMm(text.style) * m.lines;
  const w = m.width;
  const x0 = text.anchor === "start" ? text.xMm : text.anchor === "middle" ? text.xMm - w / 2 : text.xMm - w;
  if (text.rotation % 180 !== 0) {
    const cx = text.xMm;
    const cy = text.yMm;
    return { x0: cx - h, y0: cy - w, x1: cx + h, y1: cy + w };
  }
  return { x0, y0: text.yMm - h * 0.8, x1: x0 + w, y1: text.yMm + h * 0.25 };
}

export function unionBBox(boxes: BBox[]): BBox {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const x of boxes) {
    b.x0 = Math.min(b.x0, x.x0);
    b.y0 = Math.min(b.y0, x.y0);
    b.x1 = Math.max(b.x1, x.x1);
    b.y1 = Math.max(b.y1, x.y1);
  }
  return Number.isFinite(b.x0) ? b : { x0: 0, y0: 0, x1: 10, y1: 10 };
}

const boxCache = new WeakMap<number[], Map<string, BoxStats | null>>();
function boxStats(values: number[], whisker: "iqr" | "minmax" | "sd"): BoxStats | null {
  let m = boxCache.get(values);
  if (m?.has(whisker)) return m.get(whisker)!;
  const r = computeBoxStats(values, whisker);
  if (!m) boxCache.set(values, (m = new Map()));
  m.set(whisker, r);
  return r;
}
function computeBoxStats(values: number[], whisker: "iqr" | "minmax" | "sd"): BoxStats | null {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const q = (p: number) => {
    const pos = (v.length - 1) * p;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return v[lo] + (v[hi] - v[lo]) * (pos - lo);
  };
  const q1 = q(0.25);
  const median = q(0.5);
  const q3 = q(0.75);
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1)) : 0;
  let whiskerLo: number;
  let whiskerHi: number;
  let outliers: number[] = [];
  if (whisker === "minmax") {
    whiskerLo = v[0];
    whiskerHi = v[v.length - 1];
  } else if (whisker === "sd") {
    whiskerLo = Math.max(v[0], mean - sd);
    whiskerHi = Math.min(v[v.length - 1], mean + sd);
    outliers = v.filter((x) => x < whiskerLo || x > whiskerHi);
  } else {
    const iqr = q3 - q1;
    const loFence = q1 - 1.5 * iqr;
    const hiFence = q3 + 1.5 * iqr;
    const inside = v.filter((x) => x >= loFence && x <= hiFence);
    whiskerLo = inside.length ? inside[0] : q1;
    whiskerHi = inside.length ? inside[inside.length - 1] : q3;
    outliers = v.filter((x) => x < loFence || x > hiFence);
  }
  return { q1, median, q3, whiskerLo, whiskerHi, mean, outliers, values: v };
}

function categoryLabels(project: Project, barPlots: Plot[], boxPlots: Plot[]): string[] | undefined {
  if (boxPlots.length && !barPlots.length) return boxPlots.map((p) => p.name);
  if (!barPlots.length) return undefined;
  const first = barPlots[0];
  const sheet = project.sheets.find((s) => s.id === first.source.sheetId);
  const n = Math.max(...barPlots.map((p) => {
    const sh = project.sheets.find((s) => s.id === p.source.sheetId);
    return sh?.columns.find((c) => c.id === p.source.yColId)?.values.length ?? 0;
  }));
  const xc = sheet?.columns.find((c) => c.id === first.source.xColId);
  return Array.from({ length: n }, (_, i) => {
    const v = xc?.values[i];
    return v === null || v === undefined ? String(i + 1) : String(v);
  });
}

// Layout caches. A layer's layout depends only on the layer object and the project's sheets (plus text
// metrics, hence the font generation). Immer keeps untouched objects' identity, so during a drag only the
// moved layer is laid out again; every other layer, and every graph that did not change, is served from here.
const layerLayoutCache = new WeakMap<Layer, { sheets: Project["sheets"]; gen: number; ll: LayerLayout }>();
const graphLayoutCache = new WeakMap<Graph, { sheets: Project["sheets"]; gen: number; layout: GraphLayout }>();
let layoutGen = 0;
onFontsChanged(() => layoutGen++);
/** Dev-only counters to verify that caching works (window.__layoutStats). */
export const layoutStats = { layerHits: 0, layerMisses: 0, graphHits: 0, graphMisses: 0 };

export function layoutLayer(project: Project, layer: Layer): LayerLayout {
  const gen = layoutGen + fontGeneration;
  const hit = layerLayoutCache.get(layer);
  if (hit && hit.sheets === project.sheets && hit.gen === gen) {
    layoutStats.layerHits++;
    return hit.ll;
  }
  layoutStats.layerMisses++;
  const ll = computeLayerLayout(project, layer);
  layerLayoutCache.set(layer, { sheets: project.sheets, gen, ll });
  return ll;
}

function computeLayerLayout(project: Project, layer: Layer): LayerLayout {
  const data = new Map<string, XYData>();
  const bins = new Map<string, Bin[]>();
  const matrices = new Map<string, MatrixData>();
  const colors = new Map<string, ColorMapper>();
  const boxes = new Map<string, BoxStats>();
  const is3d = !!layer.view3d && !!layer.axes.z;
  for (const p of layer.plots) {
    if (p.type === "heatmap" || p.type === "contour" || p.type === "surface3d") {
      const m = getMatrixData(project, p);
      if (m) {
        matrices.set(p.id, m);
        if (p.colormap) colors.set(p.id, makeColorMapper(p.colormap, m.zMin, m.zMax));
      }
      continue;
    }
    if (p.type === "function") {
      // sampled after the x range is known; an explicit range still counts towards the x extent
      const f = p.func;
      data.set(p.id, { x: f && f.from !== null && f.to !== null ? [f.from, f.to] : [], y: [] });
      continue;
    }
    if (p.type === "scatter3d") {
      const d3 = getScatter3dData(project, p);
      data.set(p.id, d3);
      const e = extent(d3.z);
      if (p.colormap && e) colors.set(p.id, makeColorMapper(p.colormap, e[0], e[1]));
      continue;
    }
    const d = getPlotData(project, p, p.type === "bar" || p.type === "box" ? { ignoreX: true } : undefined);
    data.set(p.id, d);
    if (p.colorBy?.colId && p.colormap && d.colorVals) {
      const e = extent(d.colorVals);
      if (e) colors.set(p.id, makeColorMapper(p.colormap, e[0], e[1]));
    }
    if (p.type === "histogram") bins.set(p.id, histogramBins(d.y, p.histogram ?? DEFAULT_HISTOGRAM));
    if (p.type === "box") {
      const st = boxStats(d.y, p.box?.whisker ?? "iqr");
      if (st) boxes.set(p.id, st);
    }
  }
  const barPlots = layer.plots.filter((p) => p.visible && p.type === "bar");
  const boxPlots = layer.plots.filter((p) => p.visible && p.type === "box");
  const horizontalBars = !!(barPlots[0]?.bar?.horizontal ?? boxPlots[0]?.bar?.horizontal);
  const categories = categoryLabels(project, barPlots, boxPlots);
  const ctx: ExtentCtx = { data, bins, matrices, boxes, barPlots, horizontalBars };

  const f = layer.frame;
  const xa = effectiveAxis(layer, "x");
  const ya = effectiveAxis(layer, "y");
  const catX = categories && !horizontalBars ? categories : undefined;
  const catY = categories && horizontalBars ? categories : undefined;
  // matrix plots fill the data area exactly (no "nice" padding) unless the range is set manually
  const matrixOnly = !is3d && layer.plots.some((p) => p.visible && (p.type === "heatmap" || p.type === "contour")) && !layer.plots.some((p) => p.visible && !["heatmap", "contour"].includes(p.type));
  const tight = (a: Axis, ext: [number, number] | null): Axis => (matrixOnly && a.auto && ext ? { ...a, auto: false, from: ext[0], to: ext[1] } : a);
  const xExt = plotAxisExtent(layer, "x", ctx, isLogScale(xa.scale));
  const xScale = buildScale(tight(xa, xExt), [f.xMm, f.xMm + f.wMm], xExt, catX);
  // sample function plots over the final x range, then let them influence the y range
  for (const p of layer.plots) {
    if (p.type !== "function" || !p.func || !p.visible) continue;
    const from = p.func.from ?? Math.min(xScale.from, xScale.to);
    const to = p.func.to ?? Math.max(xScale.from, xScale.to);
    const s = sampleFunction(p.func, from, to, isLogScale(xScale.scale));
    data.set(p.id, { x: s.x, y: s.y });
  }
  const yExt = plotAxisExtent(layer, "y", ctx, isLogScale(ya.scale));
  const yScale = buildScale(tight(ya, yExt), [f.yMm + f.hMm, f.yMm], yExt, catY);
  // an axis may cross the other one at a value instead of sitting on the frame edge
  const crossX = xa.crossAt != null && Number.isFinite(xa.crossAt) ? yScale.map(xa.crossAt) : null;
  const crossY = ya.crossAt != null && Number.isFinite(ya.crossAt) ? xScale.map(ya.crossAt) : null;
  const x = axisGeom("x", layer, xScale, crossX);
  const y = axisGeom("y", layer, yScale, crossY);
  let y2: AxisGeom | undefined;
  if (layer.axes.y2 && !is3d) {
    const y2a = effectiveAxis(layer, "y2");
    const y2Scale = buildScale(y2a, [f.yMm + f.hMm, f.yMm], plotAxisExtent(layer, "y2", ctx, isLogScale(y2a.scale)));
    y2 = axisGeom("y2", layer, y2Scale);
  }

  // 3D: unit-cube scales and projector
  let projector: Projector | undefined;
  let zScale: AxisScale | undefined;
  if (is3d) {
    projector = makeProjector(layer.view3d!, f);
    const za = effectiveAxis(layer, "z");
    zScale = buildScale(za, [0, 1], plotAxisExtent(layer, "z", ctx, isLogScale(za.scale)));
  }

  const legend = legendGeom(layer, layer.legend, layer.legend.style);

  // color scale: first colormapped plot
  let colorScale: ColorScaleGeom | undefined;
  const cs = layer.colorScale;
  const cmPlot = layer.plots.find((p) => p.visible && colors.has(p.id));
  if (cs && cs.visible && cmPlot) {
    const mapper = colors.get(cmPlot.id)!;
    const csAxis: Axis = { ...xa, scale: mapper.log ? "log" : "linear", auto: false, from: mapper.min, to: mapper.max, majorStep: null, breaks: [] };
    const sc = buildScale(csAxis, [cs.lengthMm, 0], [mapper.min, mapper.max]);
    let ticks = sc.major.map((v) => ({ value: v, r: sc.map(v)!, text: formatTick(v, csAxis, sc.step) })).filter((t) => t.r !== null);
    if (mapper.discrete) {
      // label the band boundaries instead of nice ticks
      const n = mapper.discrete;
      const bound = (k: number) => (mapper.log ? Math.pow(10, Math.log10(mapper.min) + ((Math.log10(mapper.max) - Math.log10(mapper.min)) * k) / n) : mapper.min + ((mapper.max - mapper.min) * k) / n);
      const step = (mapper.max - mapper.min) / n;
      ticks = Array.from({ length: n + 1 }, (_, k) => bound(k)).map((v) => ({ value: v, r: sc.map(v)!, text: formatTick(v, csAxis, step) })).filter((t) => t.r !== null);
    }
    colorScale = { x: f.xMm + cs.xMm, y: f.yMm + cs.yMm, w: cs.widthMm, h: cs.lengthMm, mapper, ticks, plotId: cmPlot.id };
  }

  const boxesB: BBox[] = [{ x0: f.xMm, y0: f.yMm, x1: f.xMm + f.wMm, y1: f.yMm + f.hMm }];
  if (is3d) boxesB.push({ x0: f.xMm - 10, y0: f.yMm - 3, x1: f.xMm + f.wMm + 10, y1: f.yMm + f.hMm + 10 });
  else {
    boxesB.push(x.bbox, y.bbox);
    if (y2) boxesB.push(y2.bbox);
  }
  if (layer.legend.visible && legend.entries.length) boxesB.push({ x0: legend.x, y0: legend.y, x1: legend.x + legend.w, y1: legend.y + legend.h });
  if (colorScale) {
    const labelW = colorScale.ticks.reduce((m, t) => Math.max(m, measureMarkupMm(t.text, cs!.style).width), 0);
    boxesB.push({ x0: colorScale.x, y0: colorScale.y - 1, x1: colorScale.x + colorScale.w + 1.5 + labelW + (cs!.title ? lineHeightMm(cs!.style) + 1 : 0), y1: colorScale.y + colorScale.h + 1 });
  }
  const toMmFn = (vx: number, vy: number) => ({ x: xScale.map(vx) ?? f.xMm, y: yScale.map(vy) ?? f.yMm + f.hMm });
  const toDataFn = (mx: number, my: number) => ({ x: xScale.invert(mx), y: yScale.invert(my) });
  const shapeMm = new Map<string, { x1: number; y1: number; x2: number; y2: number }>();
  const shapePointsMm = new Map<string, { x: number; y: number }[]>();
  for (const sh of layer.shapes ?? []) {
    if (sh.points) {
      const pts = sh.points.map((p) => (sh.coord === "data" ? toMmFn(p.x, p.y) : { x: p.x, y: p.y }));
      shapePointsMm.set(sh.id, pts);
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      shapeMm.set(sh.id, { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) });
      continue;
    }
    if (sh.coord === "data") {
      const a = toMmFn(sh.x1, sh.y1);
      const b = toMmFn(sh.x2, sh.y2);
      shapeMm.set(sh.id, { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    } else shapeMm.set(sh.id, { x1: sh.x1, y1: sh.y1, x2: sh.x2, y2: sh.y2 });
  }
  const textMm = new Map<string, { x: number; y: number }>();
  for (const t of layer.texts) {
    if (t.coord === "data") {
      const p = toMmFn(t.xMm, t.yMm);
      textMm.set(t.id, { x: p.x, y: p.y });
    } else textMm.set(t.id, { x: t.xMm, y: t.yMm });
  }
  for (const t of layer.texts) {
    const p = textMm.get(t.id)!;
    boxesB.push(textItemBBox({ ...t, xMm: p.x, yMm: p.y }));
  }
  for (const sh of layer.shapes ?? []) {
    const m = shapeMm.get(sh.id)!;
    boxesB.push({ x0: Math.min(m.x1, m.x2), y0: Math.min(m.y1, m.y2), x1: Math.max(m.x1, m.x2), y1: Math.max(m.y1, m.y2) });
  }
  return { layer, x, y, y2, data, bins, matrices, colors, boxes, categories, barPlots, horizontalBars, palette: project.defaults.colors, legend, colorScale, is3d, projector, zScale, shapeMm, shapePointsMm, textMm, toData: toDataFn, toMm: toMmFn, bbox: unionBBox(boxesB) };
}

export const CANVAS_MARGIN_MM = 2;

export function layoutGraph(project: Project, graph: Graph): GraphLayout {
  const gen = layoutGen + fontGeneration;
  const hit = graphLayoutCache.get(graph);
  if (hit && hit.sheets === project.sheets && hit.gen === gen) {
    layoutStats.graphHits++;
    return hit.layout;
  }
  layoutStats.graphMisses++;
  const layout = computeGraphLayout(project, graph);
  graphLayoutCache.set(graph, { sheets: project.sheets, gen, layout });
  return layout;
}

function computeGraphLayout(project: Project, graph: Graph): GraphLayout {
  const layers = graph.layers.map((l) => layoutLayer(project, l));
  const content = unionBBox(layers.map((l) => l.bbox));
  const widthMm = graph.canvas.widthMm;
  const heightMm = graph.canvas.autoHeight ? Math.max(20, Math.ceil((content.y1 + CANVAS_MARGIN_MM) * 2) / 2) : graph.canvas.heightMm;
  return { graph, layers, widthMm, heightMm, content };
}

/** Marker radius in mm for a plot. */
export function markerRadiusMm(p: Plot): number {
  return ptToMm(p.marker.sizePt) / 2;
}

export function plainTitle(axis: Axis): string {
  return markupToPlain(axis.title);
}

export { measureTextMm };
