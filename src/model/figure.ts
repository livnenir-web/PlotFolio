// Edits that apply to a whole graph at once: every text style, every plot colour.
import type { Graph, Layer, Plot, Project, TextStyle } from "./types";

/** Call fn on every text style of the graph: axis titles, tick labels, legends, colour-scale titles and text labels. */
export function forEachTextStyle(graph: Graph, fn: (s: TextStyle) => void): void {
  for (const l of graph.layers) {
    for (const a of [l.axes.x, l.axes.y, l.axes.y2, l.axes.z]) {
      if (!a) continue;
      fn(a.titleStyle);
      fn(a.tickLabelStyle);
    }
    fn(l.legend.style);
    if (l.colorScale) fn(l.colorScale.style);
    for (const t of l.texts) fn(t.style);
  }
}

/** Every text style of the graph, for reading the common font. */
export function textStylesOf(graph: Graph): TextStyle[] {
  const out: TextStyle[] = [];
  forEachTextStyle(graph, (s) => out.push(s));
  return out;
}

/**
 * Give every plot of every layer a colour from the palette, in order (restarting the cycle in each layer).
 * Symbol fill/edge overrides stay as they are only when they differ from the old plot colour.
 */
export function applyPalette(graph: Graph, colors: string[]): void {
  if (!colors.length) return;
  for (const l of graph.layers) {
    l.plots.forEach((p, i) => {
      const c = colors[i % colors.length];
      const old = p.color;
      if (p.marker.fillColor && p.marker.fillColor === old) p.marker.fillColor = c;
      if (p.marker.edgeColor && p.marker.edgeColor === old) p.marker.edgeColor = c;
      p.color = c;
    });
    l.nextColorIndex = l.plots.length;
  }
}

/** The sheet and columns a plot reads: x, y, errors, z, or the matrix block / xyz columns. */
export function plotColumnIds(project: Project, plot: Plot): { sheetId: string; colIds: string[] } | null {
  const src = plot.source;
  if (!src?.sheetId) return null;
  const sheet = project.sheets.find((s) => s.id === src.sheetId);
  if (!sheet) return null;
  const ids: string[] = [];
  const add = (id?: string | null) => id && !ids.includes(id) && ids.push(id);
  const m = src.matrix;
  if (m) {
    if (m.mode === "block") {
      add(m.yColId);
      const a = sheet.columns.findIndex((c) => c.id === m.firstColId);
      const b = sheet.columns.findIndex((c) => c.id === m.lastColId);
      if (a >= 0 && b >= 0) for (let i = Math.min(a, b); i <= Math.max(a, b); i++) add(sheet.columns[i].id);
      else {
        add(m.firstColId);
        add(m.lastColId);
      }
    } else {
      add(src.xColId);
      add(src.yColId);
      add(m.zColId ?? src.zColId);
    }
  } else {
    add(src.xColId);
    add(src.yColId);
    add(src.yErrColId);
    add(src.xErrColId);
    add(src.zColId);
  }
  return ids.length ? { sheetId: src.sheetId, colIds: ids } : null;
}

// ---------------------------------------------------------------- plot style (apply to all, copy, paste)

/** The look of a plot without its data: symbols, line, error bars, labels, drop lines, bar options and, optionally, colour. */
export interface PlotStyle {
  color?: string;
  showMarkers: boolean;
  showLine: boolean;
  xyType?: "scatter" | "line" | "lineScatter";
  marker: Plot["marker"];
  line: Plot["line"];
  errorBars: Omit<Plot["errorBars"], "show">;
  labels?: Plot["labels"];
  dropLines?: Plot["dropLines"];
  bar?: Plot["bar"];
  histogramFilled?: boolean;
}

const clone = <T,>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
const XY_TYPES = new Set(["scatter", "line", "lineScatter"]);

export function plotStyleOf(p: Plot, withColor: boolean): PlotStyle {
  const { show: _show, ...eb } = p.errorBars;
  void _show;
  return {
    color: withColor ? p.color : undefined,
    showMarkers: p.showMarkers,
    showLine: p.showLine,
    xyType: XY_TYPES.has(p.type) ? (p.type as "scatter" | "line" | "lineScatter") : undefined,
    marker: clone(p.marker),
    line: clone(p.line),
    errorBars: clone(eb),
    labels: clone(p.labels),
    dropLines: clone(p.dropLines),
    bar: clone(p.bar),
    histogramFilled: p.histogram?.filled,
  };
}

/** Give a plot the style; data, name, source, fit and colormap stay. Options that do not fit the plot type are skipped. */
export function applyPlotStyle(p: Plot, s: PlotStyle): void {
  if (s.color) {
    // symbol colours that followed the old plot colour keep following
    if (p.marker.fillColor === p.color) p.marker.fillColor = s.color;
    if (p.marker.edgeColor === p.color) p.marker.edgeColor = s.color;
    p.color = s.color;
  }
  p.marker = { ...clone(s.marker), fillColor: s.marker.fillColor && !s.color ? s.marker.fillColor : s.marker.fillColor ?? null, edgeColor: s.marker.edgeColor ?? null };
  p.line = clone(s.line);
  p.errorBars = { ...clone(s.errorBars), show: p.errorBars.show };
  if (XY_TYPES.has(p.type)) {
    if (s.xyType) p.type = s.xyType;
    p.showMarkers = s.showMarkers;
    p.showLine = s.showLine;
    p.labels = clone(s.labels);
    p.dropLines = clone(s.dropLines);
  } else if (p.type === "function" || p.type === "scatter3d") {
    p.showMarkers = s.showMarkers;
    p.showLine = s.showLine;
  }
  if (p.type === "bar") {
    if (s.bar) p.bar = clone(s.bar);
    p.labels = clone(s.labels);
  }
  if (p.type === "histogram" && s.histogramFilled !== undefined && p.histogram) p.histogram.filled = s.histogramFilled;
}

/** Apply a style to every plot of a layer (or of every layer of the graph) except the source plot. */
export function applyStyleToPlots(target: Layer | Graph, s: PlotStyle, exceptId?: string): void {
  const layers = "layers" in target ? target.layers : [target];
  for (const l of layers) for (const p of l.plots) if (p.id !== exceptId) applyPlotStyle(p, s);
}

let styleClipboard: PlotStyle | null = null;
export const copyPlotStyle = (p: Plot, withColor = true): void => void (styleClipboard = plotStyleOf(p, withColor));
export const pastedPlotStyle = (): PlotStyle | null => styleClipboard;
