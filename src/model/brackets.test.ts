import { describe, expect, it } from "vitest";
import { newGraph, newPlot, newProject, uid } from "./defaults";
import type { Graph, Layer, Project } from "./types";
import { layoutLayer } from "../graph/layout";
import { withBrackets } from "../analysis/compareGraph";
import { dropOrphanBrackets, linkBrackets } from "./brackets";
import { renewPlotIds, setPlotShown } from "./figure";
import { createGroup, setGroupShown } from "./plotGroups";
import { deserializeProject, serializeProject } from "../io/project";

/** Three groups A, B, C as box plots in one layer, with brackets A–B ("ab") and A–C ("ac"). */
function setup(): { p: Project; g: Graph; l: Layer } {
  const p = newProject("brackets");
  const sh = p.sheets[0];
  sh.columns = [
    { id: "a", longName: "A", units: "", designation: "Y", values: [1, 2, 3, 4, 5] },
    { id: "b", longName: "B", units: "", designation: "Y", values: [2, 3, 4, 5, 9] },
    { id: "c", longName: "C", units: "", designation: "Y", values: [6, 7, 8, 9, 10] },
  ];
  const g = newGraph(p.defaults, "G");
  const l = g.layers[0];
  for (const c of sh.columns) l.plots.push(newPlot(p.defaults, l, { sheetId: sh.id, xColId: null, yColId: c.id }, c.longName, "box"));
  const [a, b, c] = l.plots.map((x) => x.id);
  l.shapes = withBrackets(p, l, [{ a, b, label: "ab" }, { a, b: c, label: "ac" }], p.defaults.tickLabel);
  p.graphs.push(g);
  return { p, g, l };
}

/** The brackets that are drawn, by label, with the groups (1-based places on the category axis) their ends stand over. */
const drawn = (p: Project, l: Layer) => Object.fromEntries((layoutLayer(p, { ...l }).layer.shapes ?? []).map((s) => [s.label, [Math.round(s.x1), Math.round(s.x2)]]));

describe("brackets that belong to two plots", () => {
  it("are left out while one of their plots is hidden, and come back with it", () => {
    const { p, l } = setup();
    expect(drawn(p, l)).toEqual({ ab: [1, 2], ac: [1, 3] });
    setPlotShown(l, l.plots[1], false); // hide B
    // A–B is gone; A–C now stands over the first and second group, which are A and C
    expect(drawn(p, l)).toEqual({ ac: [1, 2] });
    expect(l.shapes).toHaveLength(2); // nothing is deleted
    setPlotShown(l, l.plots[0], false);
    expect(drawn(p, l)).toEqual({});
    setPlotShown(l, l.plots[0], true);
    setPlotShown(l, l.plots[1], true);
    expect(drawn(p, l)).toEqual({ ab: [1, 2], ac: [1, 3] });
  });

  it("keep the ends a little inside their groups, also when the groups swap sides", () => {
    const { p, l } = setup();
    const ab = () => layoutLayer(p, { ...l }).layer.shapes!.find((s) => s.label === "ab")!;
    const before = ab();
    expect(before.x1).toBeGreaterThan(1);
    expect(before.x2).toBeLessThan(2);
    l.plots = [l.plots[1], l.plots[0], l.plots[2]]; // B, A, C
    const after = ab();
    // the end that belongs to A is over the second group now, and still points inward
    expect(after.x1).toBeLessThan(2);
    expect(after.x1).toBeGreaterThan(1.5);
    expect(after.x2).toBeGreaterThan(1);
    expect(after.x2).toBeLessThan(1.5);
    expect(after.y1).toBe(before.y1);
  });

  it("do not make room on the value axis while they are hidden", () => {
    const { p, l } = setup();
    const top = () => layoutLayer(p, { ...l }).y.scale.to;
    const withAll = top();
    setPlotShown(l, l.plots[0], false); // both brackets go
    expect(top()).toBeLessThan(withAll);
  });

  it("go with a deleted plot, follow a copied layer, and are found for brackets of older files", () => {
    const { p, g, l } = setup();
    // an older file: brackets without their plots
    for (const sh of l.shapes!) delete sh.between;
    const old = deserializeProject(serializeProject(p, null));
    const ol = old.graphs[0].layers[0];
    expect(ol.shapes!.map((s) => s.between)).toEqual([
      [ol.plots[0].id, ol.plots[1].id],
      [ol.plots[0].id, ol.plots[2].id],
    ]);
    linkBrackets(l);
    // a copy of the layer: the brackets point at the copied plots
    const copy: Layer = JSON.parse(JSON.stringify(l));
    renewPlotIds(copy, uid);
    expect(copy.shapes![1].between).toEqual([copy.plots[0].id, copy.plots[2].id]);
    expect(drawn(p, copy)).toEqual({ ab: [1, 2], ac: [1, 3] });
    // deleting C takes A–C along
    l.plots = l.plots.slice(0, 2);
    dropOrphanBrackets(g);
    expect(l.shapes!.map((s) => s.label)).toEqual(["ab"]);
  });

  it("are replaced by a new comparison of the same groups, also while another group is hidden", () => {
    const { p, l } = setup();
    setPlotShown(l, l.plots[1], false); // B hidden: A and C are neighbors
    const [a, , c] = l.plots.map((x) => x.id);
    const shapes = withBrackets(p, l, [{ a, b: c, label: "new" }], p.defaults.tickLabel);
    // A–C is replaced; A–B (not shown now) is kept for when B comes back
    expect(shapes.map((s) => s.label).sort()).toEqual(["ab", "new"]);
  });
});

describe("fit curves", () => {
  /** A scatter with a fit curve made from it, and a second scatter. */
  function fitSetup() {
    const p = newProject("fit");
    const sh = p.sheets[0];
    const g = newGraph(p.defaults, "G");
    const l = g.layers[0];
    const src = { sheetId: sh.id, xColId: sh.columns[0].id, yColId: sh.columns[1].id };
    const data = newPlot(p.defaults, l, src, "data", "scatter");
    const other = newPlot(p.defaults, l, src, "other", "scatter");
    const fit = newPlot(p.defaults, l, src, "fit", "fitCurve");
    fit.fit = { functionId: "line", expression: "a*x+b", paramNames: ["a", "b"], params: [1, 0], errors: [0, 0], rangeFrom: null, rangeTo: null, weighted: false, frozen: false, showBand: false, sourcePlotId: data.id };
    l.plots.push(data, other, fit);
    p.graphs.push(g);
    return { g, l, data, other, fit };
  }

  it("are hidden and shown with their plot, and can still be shown by themselves", () => {
    const { l, data, other, fit } = fitSetup();
    setPlotShown(l, data, false);
    expect([data.visible, other.visible, fit.visible]).toEqual([false, true, false]);
    // the fit alone: its own tick
    setPlotShown(l, fit, true);
    expect([data.visible, fit.visible]).toEqual([false, true]);
    setPlotShown(l, fit, false);
    setPlotShown(l, data, true);
    expect([data.visible, fit.visible]).toEqual([true, true]);
    setPlotShown(l, other, false);
    expect(fit.visible).toBe(true);
  });

  it("follow a group that is hidden as a whole, and a copied layer", () => {
    const { g, l, data, other, fit } = fitSetup();
    const id = createGroup(g, [data.id, other.id]);
    setGroupShown(g, id, false);
    expect([data.visible, other.visible, fit.visible]).toEqual([false, false, false]);
    setGroupShown(g, id, true);
    expect([data.visible, other.visible, fit.visible]).toEqual([true, true, true]);
    const copy: Layer = JSON.parse(JSON.stringify(l));
    renewPlotIds(copy, uid);
    expect(copy.plots[2].fit!.sourcePlotId).toBe(copy.plots[0].id);
  });
});
