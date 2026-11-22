// Curve groups: plots that belong together (Graph.plotGroups, Plot.groupId). A group can span the layers of a figure.
// These functions change a graph in place; the store calls them inside one update (one undo step).

import type { ColormapName, Graph, Layer, Plot, PlotGroup } from "./types";
import { PALETTES } from "./palettes";
import { setPlotShown } from "./figure";
import { uid, uniqueName } from "./defaults";
import { colorAt } from "../graph/colormaps";

/** Colormaps offered for a group, with the part of the map that reads well as line colors on white. */
export const GROUP_GRADIENTS: { name: ColormapName; label: string; from: number; to: number }[] = [
  { name: "viridis", label: "Viridis", from: 0, to: 0.9 },
  { name: "plasma", label: "Plasma", from: 0, to: 0.88 },
  { name: "turbo", label: "Turbo", from: 0.05, to: 0.95 },
  { name: "blues", label: "Blues", from: 0.35, to: 1 },
  { name: "greens", label: "Greens", from: 0.35, to: 1 },
  { name: "reds", label: "Reds", from: 0.35, to: 1 },
  { name: "oranges", label: "Oranges", from: 0.35, to: 1 },
  { name: "purples", label: "Purples", from: 0.35, to: 1 },
];

const rgbOf = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.replace(/./g, "$&$&") : h.padEnd(6, "0");
  return [parseInt(full.slice(0, 2), 16) || 0, parseInt(full.slice(2, 4), 16) || 0, parseInt(full.slice(4, 6), 16) || 0];
};
const hexOf = (c: number[]) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
const mix = (a: number[], b: number[], f: number) => a.map((v, i) => v + (b[i] - v) * f);

/** Shade of a color for t = 0 (light) … 1 (dark); the color itself sits at t = 0.6. */
export function shadeOf(base: string, t: number): string {
  const c = rgbOf(base);
  const light = mix(c, [255, 255, 255], 0.62);
  const dark = mix(c, [0, 0, 0], 0.5);
  return hexOf(t <= 0.6 ? mix(light, c, t / 0.6) : mix(c, dark, (t - 0.6) / 0.4));
}

/** The colors of n curves of a group, in order; null when the group leaves the curves their own colors. */
export function groupColorList(group: PlotGroup, n: number): string[] | null {
  const spec = group.colors;
  if (!spec || n < 1) return null;
  let out: string[];
  if (spec.type === "palette") {
    const pal = PALETTES.find((p) => p.id === spec.paletteId)?.colors ?? PALETTES[0].colors;
    out = Array.from({ length: n }, (_, i) => pal[i % pal.length]);
  } else {
    const at = (i: number) => (n === 1 ? 0.6 : i / (n - 1));
    if (spec.type === "shades") out = Array.from({ length: n }, (_, i) => shadeOf(spec.base, at(i)));
    else {
      const g = GROUP_GRADIENTS.find((x) => x.name === spec.name) ?? { from: 0, to: 1 };
      out = Array.from({ length: n }, (_, i) => colorAt(spec.name, g.from + (g.to - g.from) * at(i)));
    }
  }
  return group.reverse ? out.reverse() : out;
}

/** Recolor a plot; symbol fill and edge follow when they were the plot color. */
function setColor(p: Plot, c: string): void {
  if (p.color === c) return;
  const old = p.color;
  if (p.marker.fillColor && p.marker.fillColor === old) p.marker.fillColor = c;
  if (p.marker.edgeColor && p.marker.edgeColor === old) p.marker.edgeColor = c;
  p.color = c;
}

export const groupOf = (graph: Graph, plot: Plot): PlotGroup | undefined => (plot.groupId ? graph.plotGroups?.find((g) => g.id === plot.groupId) : undefined);

/** Every plot of a group, layer by layer in drawing order. */
export function groupMembers(graph: Graph, groupId: string): { layer: Layer; plot: Plot }[] {
  return graph.layers.flatMap((layer) => layer.plots.filter((p) => p.groupId === groupId).map((plot) => ({ layer, plot })));
}

/**
 * Keep the groups of a graph consistent after any edit: plots pointing at a missing group leave it, the members of a
 * group sit together in each layer's plot list (at the place of the first), groups without members go, and groups
 * with a color scheme give their curves those colors. Writes only what differs.
 */
export function tidyGroups(graph: Graph): void {
  const ids = new Set((graph.plotGroups ?? []).map((g) => g.id));
  const used = new Set<string>();
  for (const l of graph.layers) {
    let grouped = false;
    for (const p of l.plots) {
      if (!p.groupId) continue;
      if (!ids.has(p.groupId)) delete p.groupId;
      else {
        used.add(p.groupId);
        grouped = true;
      }
    }
    if (!grouped) continue;
    const order: Plot[] = [];
    const seen = new Set<string>();
    for (const p of l.plots) {
      if (!p.groupId) order.push(p);
      else if (!seen.has(p.groupId)) {
        seen.add(p.groupId);
        order.push(...l.plots.filter((q) => q.groupId === p.groupId));
      }
    }
    if (order.some((p, i) => p.id !== l.plots[i].id)) l.plots = order;
  }
  if (!graph.plotGroups) return;
  if (used.size !== graph.plotGroups.length) graph.plotGroups = graph.plotGroups.filter((g) => used.has(g.id));
  if (!graph.plotGroups.length) {
    delete graph.plotGroups;
    return;
  }
  for (const g of graph.plotGroups) {
    if (!g.colors) continue;
    for (const l of graph.layers) {
      const members = l.plots.filter((p) => p.groupId === g.id);
      const colors = groupColorList(g, members.length);
      if (colors) members.forEach((p, i) => setColor(p, colors[i]));
    }
  }
}

/** Put these plots into a new group (they leave any group they were in). Returns the group id. */
export function createGroup(graph: Graph, plotIds: string[], name?: string): string {
  const id = uid();
  const ids = new Set(plotIds);
  const groups = (graph.plotGroups ??= []);
  groups.push({ id, name: uniqueName(name ?? "Group 1", groups.map((g) => g.name)) });
  for (const l of graph.layers) for (const p of l.plots) if (ids.has(p.id)) p.groupId = id;
  tidyGroups(graph);
  return id;
}

/** Plots outside any group whose name matches a curve of the group: the ones "Extend to all panels" would add. */
export function extendCandidates(graph: Graph, groupId: string): Plot[] {
  const names = new Set(groupMembers(graph, groupId).map((m) => m.plot.name));
  return graph.layers.flatMap((l) => l.plots.filter((p) => !p.groupId && names.has(p.name)));
}

/** Add the curves with the same names in the other layers to the group. Returns how many joined. */
export function extendGroup(graph: Graph, groupId: string): number {
  const add = extendCandidates(graph, groupId);
  for (const p of add) p.groupId = groupId;
  tidyGroups(graph);
  return add.length;
}

export function ungroup(graph: Graph, groupId: string): void {
  for (const l of graph.layers) for (const p of l.plots) if (p.groupId === groupId) delete p.groupId;
  tidyGroups(graph);
}

/**
 * Hide or show a group as a whole. Hiding remembers which curves were shown, so that showing the group again brings
 * those back (and not curves that were hidden one by one before).
 */
export function setGroupShown(graph: Graph, groupId: string, show: boolean): void {
  const g = graph.plotGroups?.find((x) => x.id === groupId);
  if (!g) return;
  const members = groupMembers(graph, groupId);
  const plots = members.map((m) => m.plot);
  const keep = new Set(g.shownIds ?? []);
  const some = plots.some((p) => keep.has(p.id));
  const want = (p: Plot) => (show ? (some ? keep.has(p.id) : true) : false);
  if (!show) g.shownIds = plots.filter((p) => p.visible).map((p) => p.id);
  else delete g.shownIds;
  // fit curves follow their plot; a fit curve that is itself in the group gets its own remembered state last
  for (const m of members) setPlotShown(m.layer, m.plot, want(m.plot));
  for (const p of plots) p.visible = want(p);
}

/** The plot list of a layer as blocks: a run of curves of one group, or a single plot outside any group. */
export function plotBlocks(graph: Graph, layer: Layer): { group: PlotGroup | null; plots: Plot[] }[] {
  const out: { group: PlotGroup | null; plots: Plot[] }[] = [];
  for (const p of layer.plots) {
    const g = groupOf(graph, p) ?? null;
    const last = out[out.length - 1];
    if (g && last && last.group?.id === g.id) last.plots.push(p);
    else out.push({ group: g, plots: [p] });
  }
  return out;
}

/** Move a block of the plot list (a plot outside any group, or a whole group) from place `from` to place `to` among the blocks. */
export function placeBlock(graph: Graph, layer: Layer, from: number, to: number): void {
  const blocks = plotBlocks(graph, layer);
  if (from < 0 || from >= blocks.length) return;
  const [b] = blocks.splice(from, 1);
  blocks.splice(Math.max(0, Math.min(blocks.length, to)), 0, b);
  layer.plots = blocks.flatMap((x) => x.plots);
}

/** Move a curve of a group to place `to` among the curves of its group in this layer. */
export function placeInGroup(graph: Graph, layer: Layer, plotId: string, to: number): void {
  const blocks = plotBlocks(graph, layer);
  const b = blocks.find((x) => x.group && x.plots.some((p) => p.id === plotId));
  if (!b) return;
  const [p] = b.plots.splice(b.plots.findIndex((x) => x.id === plotId), 1);
  b.plots.splice(Math.max(0, Math.min(b.plots.length, to)), 0, p);
  layer.plots = blocks.flatMap((x) => x.plots);
}

/** Move a whole group one place in the drawing order of a layer (past the neighboring plot or group). */
export function moveGroup(graph: Graph, layerId: string, groupId: string, delta: 1 | -1): void {
  const l = graph.layers.find((x) => x.id === layerId);
  if (!l) return;
  const blocks = plotBlocks(graph, l);
  const i = blocks.findIndex((b) => b.group?.id === groupId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= blocks.length) return;
  [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
  l.plots = blocks.flatMap((b) => b.plots);
}

/**
 * Move a plot one place in the drawing order of its layer: a curve of a group moves among the curves of its group,
 * any other plot moves past the neighboring plot or past a whole group.
 */
export function stepPlot(graph: Graph, layer: Layer, plotId: string, delta: 1 | -1): void {
  const blocks = plotBlocks(graph, layer);
  const bi = blocks.findIndex((b) => b.plots.some((p) => p.id === plotId));
  if (bi < 0) return;
  const b = blocks[bi];
  if (b.group) {
    const i = b.plots.findIndex((p) => p.id === plotId);
    const j = i + delta;
    if (j < 0 || j >= b.plots.length) return;
    [b.plots[i], b.plots[j]] = [b.plots[j], b.plots[i]];
  } else {
    const j = bi + delta;
    if (j < 0 || j >= blocks.length) return;
    [blocks[bi], blocks[j]] = [blocks[j], blocks[bi]];
  }
  layer.plots = blocks.flatMap((x) => x.plots);
}
