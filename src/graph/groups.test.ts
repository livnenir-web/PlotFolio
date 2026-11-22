import { describe, expect, it } from "vitest";
import { newGraph, newPlot, newProject } from "../model/defaults";
import type { Layer, Project } from "../model/types";
import { histogramBins, defaultHistogramOptions } from "./data";
import { colorScaleStep, layoutLayer, legendEntryAt, legendGeom } from "./layout";
import { hasLegendOrder, moveLegendEntry, placeLegendEntry, resetLegendOrder } from "../model/figure";
import { density, densityAt } from "./violin";
import { withBrackets } from "../analysis/compareGraph";
import { PLOT_KINDS } from "./plotKinds";
import { previewGraph } from "../sheet/plotPreview";

/** Three groups of values in columns a, b, c, drawn as box plots in one layer. */
function setup(): { p: Project; l: Layer } {
  const p = newProject("groups");
  const sh = p.sheets[0];
  sh.columns = [
    { id: "a", longName: "A", units: "", designation: "Y", values: [1, 2, 3, 4, 5] },
    { id: "b", longName: "B", units: "", designation: "Y", values: [2, 3, 4, 5, 9] },
    { id: "c", longName: "C", units: "", designation: "Y", values: [6, 7, 8, 9, 10] },
  ];
  const g = newGraph(p.defaults, "G");
  const l = g.layers[0];
  for (const c of sh.columns) l.plots.push(newPlot(p.defaults, l, { sheetId: sh.id, xColId: null, yColId: c.id }, c.longName, "box"));
  p.graphs.push(g);
  return { p, l };
}

describe("cumulative distribution plot", () => {
  it("steps at every distinct value, up to 1 (or to the number of values)", () => {
    const v = [3, 1, 2, 2];
    const frac = histogramBins(v, { ...defaultHistogramOptions(), display: "cdf", normalization: "probability" });
    expect(frac.map((b) => [b.x0, b.x1, b.value])).toEqual([[1, 2, 0.25], [2, 3, 0.75], [3, 3, 1]]);
    const count = histogramBins(v, { ...defaultHistogramOptions(), display: "cdf" });
    expect(count.map((b) => b.value)).toEqual([1, 3, 4]);
  });
  it("leaves ordinary histograms as they were", () => {
    const bins = histogramBins([1, 2, 3, 4], { ...defaultHistogramOptions(), binCount: 2 });
    expect(bins.map((b) => b.count)).toEqual([2, 2]);
  });
});

describe("violin density", () => {
  it("is scaled to a largest value of 1 over the data range", () => {
    const d = density([1, 2, 2, 2.1, 3, 5]);
    expect(d.v[0]).toBe(1);
    expect(d.v[d.v.length - 1]).toBe(5);
    expect(Math.max(...d.d)).toBeCloseTo(1, 12);
    expect(densityAt(d, 2)).toBeGreaterThan(densityAt(d, 4.5));
  });
  it("copes with a single value", () => {
    expect(densityAt(density([4, 4, 4]), 4)).toBe(1);
  });
});

describe("legend", () => {
  it("lists every shown plot when 'show active plots' is on", () => {
    const { l } = setup();
    for (const p of l.plots) p.type = "line";
    l.plots[1].showInLegend = false;
    const names = (layer: Layer) => legendGeom(layer, layer.legend, layer.legend.style).entries.map((e) => e.text);
    expect(names(l)).toEqual(["A", "C"]);
    l.legend.showActive = true;
    expect(names(l)).toEqual(["A", "B", "C"]);
    l.plots[1].visible = false;
    expect(names(l)).toEqual(["A", "C"]);
  });
});

describe("color scale ticks", () => {
  it("widens the step to the next round one until the labels are clear of each other", () => {
    // 0.75 … 1.5 on a 14 mm bar, labels 3.4 mm high: 0.1 (1.9 mm apart) is too dense, 0.2 fits
    expect(colorScaleStep(0.1, 14 / 0.75, 3.4)).toBe(0.2);
    expect(colorScaleStep(0.1, 60 / 0.75, 3.4)).toBe(0.1);
    expect(colorScaleStep(2, 0.5, 3.4)).toBe(10);
    expect(colorScaleStep(5, 0.5, 3.4)).toBe(10);
    expect(colorScaleStep(0, 1, 3)).toBe(0);
  });
});

describe("legend order", () => {
  const names = (layer: Layer) => legendGeom(layer, layer.legend, layer.legend.style).entries.map((e) => e.text);
  it("moves an entry without touching the drawing order", () => {
    const { l } = setup();
    for (const p of l.plots) p.type = "line";
    const [a, b, c] = l.plots;
    moveLegendEntry(l, a.id, 1);
    moveLegendEntry(l, a.id, 1);
    expect(names(l)).toEqual(["B", "C", "A"]);
    expect(l.plots).toEqual([a, b, c]);
    expect(hasLegendOrder(l)).toBe(true);
    // a hidden plot keeps its place for when it is shown again
    c.visible = false;
    expect(names(l)).toEqual(["B", "A"]);
    c.visible = true;
    // a plot added later goes to the end
    const d = { ...structuredClone(a), id: "new", name: "D", legendRank: undefined };
    l.plots.unshift(d);
    expect(names(l)).toEqual(["B", "C", "A", "D"]);
  });
  it("drops an entry at any place", () => {
    const { l } = setup();
    for (const p of l.plots) p.type = "line";
    placeLegendEntry(l, l.plots[0].id, 2);
    expect(names(l)).toEqual(["B", "C", "A"]);
    placeLegendEntry(l, l.plots[2].id, 0);
    expect(names(l)).toEqual(["C", "B", "A"]);
    placeLegendEntry(l, l.plots[2].id, 9); // out of range: nothing
    expect(names(l)).toEqual(["C", "B", "A"]);
    expect(l.plots.map((p) => p.name)).toEqual(["A", "B", "C"]);
  });
  it("finds the entry under a point, in one column or several", () => {
    const { l } = setup();
    for (const p of l.plots) p.type = "line";
    const lg = legendGeom(l, l.legend, l.legend.style);
    const mid = (i: number) => [lg.x + lg.pad + lg.entries[i].x + 3, lg.y + lg.entries[i].y + lg.rowH / 2] as const;
    expect([0, 1, 2].map((i) => legendEntryAt(lg, ...mid(i))?.text)).toEqual(["A", "B", "C"]);
    expect(legendEntryAt(lg, lg.x - 5, lg.y - 5)?.text).toBe("A"); // off the corner: the nearest
    expect(legendEntryAt(lg, lg.x + 2, lg.y + lg.h + 5)?.text).toBe("C");
    l.legend.columns = 3;
    const wide = legendGeom(l, l.legend, l.legend.style);
    expect([0, 1, 2].map((i) => legendEntryAt(wide, wide.x + wide.pad + wide.entries[i].x + 1, wide.y + wide.pad + 1)?.text)).toEqual(["A", "B", "C"]);
  });
  it("stores nothing once the entries are back in drawing order", () => {
    const { l } = setup();
    for (const p of l.plots) p.type = "line";
    moveLegendEntry(l, l.plots[0].id, 1);
    expect(names(l)).toEqual(["B", "A", "C"]);
    moveLegendEntry(l, l.plots[0].id, -1);
    expect(names(l)).toEqual(["A", "B", "C"]);
    expect(hasLegendOrder(l)).toBe(false);
    moveLegendEntry(l, l.plots[2].id, -1);
    resetLegendOrder(l);
    expect(names(l)).toEqual(["A", "B", "C"]);
    expect(l.plots.every((p) => !("legendRank" in p))).toBe(true);
  });
});

describe("significance brackets", () => {
  it("sit above the groups they join, without colliding, inside the automatic axis range", () => {
    const { p, l } = setup();
    const [a, b, c] = l.plots.map((x) => x.id);
    const shapes = withBrackets(p, l, [{ a, b: c, label: "***" }, { a, b, label: "ns" }, { a: b, b: c, label: "*" }], p.defaults.tickLabel);
    expect(shapes.map((s) => s.kind)).toEqual(["bracket", "bracket", "bracket"]);
    // narrow brackets first; A–B and B–C share a level's worth of room only if they do not overlap sideways
    const [ab, bc, ac] = shapes;
    expect([ab.label, bc.label, ac.label]).toEqual(["ns", "*", "***"]);
    expect(ab.x2).toBeLessThan(bc.x1);
    expect(ab.y1).toBeGreaterThan(9); // above the highest value of A and B
    expect(bc.y1).toBeGreaterThan(10);
    expect(ac.y1).toBeGreaterThan(Math.max(ab.y1, bc.y1));
    const ll = layoutLayer(p, { ...l, shapes });
    expect(Math.max(ll.y.scale.from, ll.y.scale.to)).toBeGreaterThan(ac.y1);
    // at least a label's height between the wide bracket and the ones below it
    const mm = (v: number) => ll.y.scale.map(v)!;
    expect(mm(Math.max(ab.y1, bc.y1)) - mm(ac.y1)).toBeGreaterThan(3);
  });
  it("replaces an earlier bracket between the same groups and keeps other shapes", () => {
    const { p, l } = setup();
    const [a, b] = l.plots.map((x) => x.id);
    const first = withBrackets(p, l, [{ a, b, label: "*" }], p.defaults.tickLabel);
    const again = withBrackets(p, { ...l, shapes: first }, [{ a, b, label: "**" }], p.defaults.tickLabel);
    expect(again.map((s) => s.label)).toEqual(["**"]);
  });
  it("stacks a bracket added later clear of the ones that stay", () => {
    const { p, l } = setup();
    const [a, b, c] = l.plots.map((x) => x.id);
    const all = withBrackets(p, l, [{ a, b: c, label: "***" }, { a, b, label: "ns" }, { a: b, b: c, label: "*" }], p.defaults.tickLabel);
    // compare A with C once more (two plots selected on the figure): only that bracket is replaced
    const again = withBrackets(p, { ...l, shapes: all }, [{ a, b: c, label: "**" }], p.defaults.tickLabel);
    expect(again.map((s) => s.label)).toEqual(["ns", "*", "**"]);
    const [ab, bc, ac] = again;
    const ll = layoutLayer(p, { ...l, shapes: again });
    const mm = (v: number) => ll.y.scale.map(v)!;
    expect(mm(Math.max(ab.y1, bc.y1)) - mm(ac.y1)).toBeGreaterThan(3);
  });
  it("do not change a layer without brackets", () => {
    const { p, l } = setup();
    const before = layoutLayer(p, l);
    const after = layoutLayer(p, { ...l, shapes: [] });
    expect([after.y.scale.from, after.y.scale.to]).toEqual([before.y.scale.from, before.y.scale.to]);
  });
});

describe("plot gallery", () => {
  it("builds a preview for every kind that only needs Y columns, without touching the project", () => {
    const { p } = setup();
    const sheet = p.sheets[0];
    const graphs = p.graphs.length;
    for (const kind of PLOT_KINDS.filter((k) => ["Basic", "Distributions and groups"].includes(k.group))) {
      const g = previewGraph(p, sheet, { kind, yIds: ["a", "b"], xId: null, zId: null, matrixMode: "block" });
      expect(g, kind.id).not.toBeNull();
      expect(g!.layers[0].plots).toHaveLength(2);
      expect(layoutLayer(p, g!.layers[0]).bbox.x1).toBeGreaterThan(0);
    }
    expect(previewGraph(p, sheet, { kind: PLOT_KINDS.find((k) => k.id === "violin")!, yIds: ["a"], xId: null, zId: null, matrixMode: "block" })!.layers[0].plots[0].box?.style).toBe("violin");
    expect(previewGraph(p, sheet, { kind: PLOT_KINDS[0], yIds: [], xId: null, zId: null, matrixMode: "block" })).toBeNull();
    expect(p.graphs).toHaveLength(graphs);
  });
});
