// Putting the result of a group comparison on a graph: significance brackets over box, violin or point plots,
// or a line of text on a graph of cumulative distributions.

import { newShape, uid } from "../model/defaults";
import type { Layer, Project, Shape, TextStyle } from "../model/types";
import { shownLayers } from "../model/figure";
import { bracketSpan } from "../model/brackets";
import { bracketLabelMm, layoutLayer } from "../graph/layout";

export interface BracketPair {
  /** ids of the two box-type plots the bracket joins */
  a: string;
  b: string;
  label: string;
}

/** A column of a sheet: one group of a comparison. The groups of one comparison may come from several sheets. */
export interface ColumnRef {
  sheetId: string;
  colId: string;
}

/** Shown layers whose visible box, violin or point plots show every one of the columns (each column once). */
export function groupLayers(project: Project, cols: ColumnRef[]): { graphId: string; layerId: string; name: string }[] {
  const out: { graphId: string; layerId: string; name: string }[] = [];
  for (const g of project.graphs) {
    for (const l of shownLayers(g)) {
      if (cols.every((c) => boxPlotOf(l, c.sheetId, c.colId))) out.push({ graphId: g.id, layerId: l.id, name: g.layers.length > 1 ? `${g.name} · ${l.name}` : g.name });
    }
  }
  return out;
}

/** Shown layers that show every one of the columns as a histogram or a cumulative curve. */
export function distributionLayers(project: Project, cols: ColumnRef[]): { graphId: string; layerId: string; name: string }[] {
  const out: { graphId: string; layerId: string; name: string }[] = [];
  for (const g of project.graphs) {
    for (const l of shownLayers(g)) {
      if (cols.every((c) => l.plots.some((p) => p.visible && p.type === "histogram" && p.source.sheetId === c.sheetId && p.source.yColId === c.colId))) out.push({ graphId: g.id, layerId: l.id, name: g.layers.length > 1 ? `${g.name} · ${l.name}` : g.name });
    }
  }
  return out;
}

export function boxPlotOf(layer: Layer, sheetId: string, colId: string) {
  return layer.plots.find((p) => p.visible && p.type === "box" && p.source.sheetId === sheetId && p.source.yColId === colId);
}

const GAP_MM = 1.5; // from the highest data point to the tips of the ticks
const INSET = 0.12; // of a category step, so neighboring brackets on one level do not touch

/**
 * Brackets for the pairs, attached to the layer's axes: each one above the groups it spans, narrow ones lowest,
 * stacked so that brackets and labels do not collide. Positions depend on the axis range, which in turn grows to
 * hold the brackets, so the layout is repeated until they settle. Returns the layer's shapes with the new brackets;
 * earlier brackets between the same groups are replaced.
 */
export function withBrackets(project: Project, layer: Layer, pairs: BracketPair[], labelStyle: TextStyle): Shape[] {
  const boxPlots = layer.plots.filter((p) => p.visible && p.type === "box");
  const indexOf = (plotId: string) => boxPlots.findIndex((p) => p.id === plotId);
  const spans = pairs
    .map((p) => ({ lo: Math.min(indexOf(p.a), indexOf(p.b)), hi: Math.max(indexOf(p.a), indexOf(p.b)), label: p.label }))
    .filter((s) => s.lo >= 0 && s.hi > s.lo)
    .sort((s, t) => s.hi - s.lo - (t.hi - t.lo) || s.lo - t.lo);
  const horizontal = layoutLayer(project, layer).horizontalBars;
  // where the brackets that are there stand now (those of hidden groups: nowhere, and they are kept as they are)
  const spanOf = new Map((layer.shapes ?? []).map((sh) => [sh.id, bracketSpan(layer, sh)]));
  // keep everything except brackets that join the same two groups as a new one
  const kept = (layer.shapes ?? []).filter((sh) => !spans.some((s) => spanOf.get(sh.id)?.lo === s.lo && spanOf.get(sh.id)?.hi === s.hi));
  // each new bracket knows its two plots, so it follows them when groups are hidden or reordered
  const made: Shape[] = spans.map((s) => ({ ...newShape("bracket", 0, 0, 0, 0), id: uid(), coord: "data" as const, label: s.label, labelStyle: { ...labelStyle }, between: [boxPlots[s.lo].id, boxPlots[s.hi].id] }));
  if (!made.length) return kept;
  const tick = made[0].headSizeMm;
  const step = bracketLabelMm(made[0]) + tick + 0.8;
  for (let pass = 0; pass < 5; pass++) {
    const ll = layoutLayer(project, { ...layer, shapes: pass === 0 ? kept : [...kept, ...made] });
    const val = horizontal ? ll.x.scale : ll.y.scale;
    // distance along the value axis, in mm, growing away from the groups
    const dir = (val.map(val.to) ?? 1) >= (val.map(val.from) ?? 0) ? 1 : -1;
    const tops = boxPlots.map((p) => {
      const st = ll.boxes.get(p.id);
      const mm = st ? val.map(st.values[st.values.length - 1]) : null;
      return mm === null ? -Infinity : mm * dir;
    });
    // the brackets that stay keep their places: new ones stack clear of them too
    const placed: { lo: number; hi: number; u: number }[] = kept.flatMap((sh) => {
      const span = spanOf.get(sh.id);
      const mm = span ? val.map(horizontal ? sh.x1 : sh.y1) : null;
      return !span || mm === null ? [] : [{ lo: span.lo, hi: span.hi, u: mm * dir }];
    });
    spans.forEach((s, i) => {
      let u = Math.max(...tops.slice(s.lo, s.hi + 1)) + GAP_MM + tick;
      for (;;) {
        const clash = placed.find((q) => s.lo < q.hi && s.hi > q.lo && Math.abs(q.u - u) < step - 1e-6);
        if (!clash) break;
        u = clash.u + step;
      }
      placed.push({ lo: s.lo, hi: s.hi, u });
      const v = val.invert(u * dir);
      const from = s.lo + 1 + INSET;
      const to = s.hi + 1 - INSET;
      Object.assign(made[i], horizontal ? { x1: v, x2: v, y1: from, y2: to } : { x1: from, x2: to, y1: v, y2: v });
    });
  }
  return [...kept, ...made];
}
