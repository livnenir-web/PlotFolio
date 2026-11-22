// Edits that apply to a whole graph at once: every text style, every plot color.
import type { Graph, Layer, Plot, Project, TextStyle } from "./types";

/** The layers that are drawn: all but the hidden ones (Layer.hidden). */
export function shownLayers(graph: Graph): Layer[] {
  return graph.layers.some((l) => l.hidden) ? graph.layers.filter((l) => !l.hidden) : graph.layers;
}

/** Where a new plot, label or shape goes when no layer is chosen: the first layer that is shown, else the first. */
export function defaultLayer(graph: Graph): Layer | undefined {
  return graph.layers.find((l) => !l.hidden) ?? graph.layers[0];
}

/**
 * Hide or show a plot together with the fit curves made from it. A fit curve keeps its own tick, so it can still be
 * shown or hidden by itself afterwards.
 */
export function setPlotShown(layer: Layer, plot: Plot, shown: boolean): void {
  plot.visible = shown;
  for (const p of layer.plots) if (p.type === "fitCurve" && p.fit?.sourcePlotId === plot.id) p.visible = shown;
}

/**
 * Give the plots of a copied layer new ids, and carry along what points at them by id: the fit curves' source plot
 * and the brackets' two plots.
 */
export function renewPlotIds(layer: Layer, newId: () => string): void {
  const ids = new Map<string, string>();
  for (const p of layer.plots) {
    const id = newId();
    ids.set(p.id, id);
    p.id = id;
  }
  for (const p of layer.plots) if (p.fit) p.fit.sourcePlotId = ids.get(p.fit.sourcePlotId) ?? p.fit.sourcePlotId;
  for (const sh of layer.shapes ?? []) if (sh.between) sh.between = [ids.get(sh.between[0]) ?? sh.between[0], ids.get(sh.between[1]) ?? sh.between[1]];
}

/** Hide or show a layer. The flag is only kept while the layer is hidden, so files of figures without hidden layers do not change. */
export function setLayerShown(layer: Layer, shown: boolean): void {
  if (shown) delete layer.hidden;
  else layer.hidden = true;
}

/** Show only this layer; when it is the only one shown already, show them all again. */
export function soloLayer(graph: Graph, layerId: string): void {
  const alone = graph.layers.every((l) => !!l.hidden === (l.id !== layerId));
  for (const l of graph.layers) setLayerShown(l, alone || l.id === layerId);
}

/** Call fn on every text style of the graph: axis titles, tick labels, legends, color-scale titles and text labels. */
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
 * Give every plot of every layer a color from the palette, in order (restarting the cycle in each layer).
 * Symbol fill/edge overrides stay as they are only when they differ from the old plot color.
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

// ---------------------------------------------------------------- legend order

/** The plots of a layer in legend order: by `legendRank`, plots without one last, in drawing order. */
export function legendOrder(plots: Plot[]): Plot[] {
  if (!plots.some((p) => p.legendRank != null)) return plots;
  return plots
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (a.p.legendRank ?? Infinity) - (b.p.legendRank ?? Infinity) || a.i - b.i)
    .map((x) => x.p);
}

/** True when the legend lists the plots in an order of its own. */
export const hasLegendOrder = (layer: Layer): boolean => layer.plots.some((p) => p.legendRank != null);

/** Move a plot's legend entry to place `to` in the legend, leaving the drawing order alone. */
export function placeLegendEntry(layer: Layer, plotId: string, to: number): void {
  const order = legendOrder(layer.plots).slice();
  const i = order.findIndex((p) => p.id === plotId);
  if (i < 0 || to < 0 || to >= order.length || to === i) return;
  const [p] = order.splice(i, 1);
  order.splice(to, 0, p);
  // back in drawing order: nothing to store
  if (order.every((x, k) => x === layer.plots[k])) resetLegendOrder(layer);
  else order.forEach((x, k) => (x.legendRank = k));
}

/** Move a plot's legend entry one place up (-1) or down (1) in the legend. */
export function moveLegendEntry(layer: Layer, plotId: string, delta: 1 | -1): void {
  placeLegendEntry(layer, plotId, legendOrder(layer.plots).findIndex((p) => p.id === plotId) + delta);
}

/** The legend follows the drawing order again. */
export function resetLegendOrder(layer: Layer): void {
  for (const p of layer.plots) delete p.legendRank;
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

/** The look of a plot without its data: symbols, line, error bars, labels, drop lines, bar options and, optionally, color. */
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
  joinPoints?: boolean;
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
    joinPoints: p.joinPoints,
    bar: clone(p.bar),
    histogramFilled: p.histogram?.filled,
  };
}

/** Give a plot the style; data, name, source, fit and colormap stay. Options that do not fit the plot type are skipped. */
export function applyPlotStyle(p: Plot, s: PlotStyle): void {
  if (s.color) {
    // symbol colors that followed the old plot color keep following
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
    if (p.type === "scatter3d") p.joinPoints = s.joinPoints;
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
