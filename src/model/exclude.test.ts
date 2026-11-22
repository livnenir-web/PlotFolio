import { describe, expect, it } from "vitest";
import { newGraph, newPlot, newProject } from "./defaults";
import type { Project } from "./types";
import { canExclude, excludeRows, includeRows, isExcludedPlot } from "./exclude";
import { getPlotData, plotRowIndices } from "../graph/data";
import { curveMath, mathName, mathUnits } from "../analysis/ops";
import { curvesForAnalysis, dataCurves, isDataCurve } from "../analysis/graphCurves";
import { averageNames, sameNumbers } from "../analysis/results";

/** Time against Voltage (with one empty cell), drawn as symbols; a histogram of Voltage in a second panel. */
function setup(): { p: Project; gid: string; lid: string; pid: string } {
  const p = newProject("exclude");
  const sh = p.sheets[0];
  sh.columns = [
    { id: "t", longName: "Time", units: "s", designation: "X", values: [0, 1, 2, 3, 4] },
    { id: "v", longName: "Voltage", units: "mV", designation: "Y", values: [10, 11, null, 99, 12] },
  ];
  const g = newGraph(p.defaults, "G");
  const l = g.layers[0];
  const plot = newPlot(p.defaults, l, { sheetId: sh.id, xColId: "t", yColId: "v" }, "Voltage", "scatter");
  l.plots.push(plot, newPlot(p.defaults, l, { sheetId: sh.id, xColId: null, yColId: "v" }, "Voltage hist", "histogram"));
  p.graphs.push(g);
  return { p, gid: g.id, lid: l.id, pid: plot.id };
}

describe("excluding points", () => {
  it("maps the points of a plot to their sheet rows (the empty cell is skipped)", () => {
    const { p } = setup();
    const plot = p.graphs[0].layers[0].plots[0];
    expect(plotRowIndices(p, plot)).toEqual([0, 1, 3, 4]);
    expect(plotRowIndices(p, plot).length).toBe(getPlotData(p, plot).x.length);
  });

  it("moves the value to an (excluded) column of the same sheet, on the same row, and draws it", () => {
    const { p, gid, lid, pid } = setup();
    const res = excludeRows(p, gid, lid, pid, [3]);
    expect(res).toMatchObject({ moved: 1, column: "Voltage (excluded)" });
    const cols = p.sheets[0].columns;
    expect(cols.map((c) => c.longName)).toEqual(["Time", "Voltage", "Voltage (excluded)"]);
    expect(cols[1].values).toEqual([10, 11, null, null, 12]);
    expect(cols[2].values).toEqual([null, null, null, 99]);
    expect(cols[2]).toMatchObject({ units: "mV", excludedFrom: "v", designation: "Y" });
    // the plot of the excluded points sits right above its plot, gray, hollow, out of the legend, on the same x
    const plots = p.graphs[0].layers[0].plots;
    expect(plots.map((x) => x.name)).toEqual(["Voltage", "Voltage (excluded)", "Voltage hist"]);
    expect(plots[1]).toMatchObject({ type: "scatter", showInLegend: false, visible: true, source: { xColId: "t", yColId: cols[2].id } });
    expect(plots[1].marker.filled).toBe(false);
    expect(getPlotData(p, plots[1])).toMatchObject({ x: [3], y: [99] });
    expect(getPlotData(p, plots[0]).y).toEqual([10, 11, 12]);
    expect(isExcludedPlot(p, plots[1])).toBe(true);
    expect(canExclude(p, plots[1])).toBe(false);
    expect(canExclude(p, plots[0])).toBe(true);
    expect(canExclude(p, plots[2])).toBe(false);
  });

  it("reuses the column and the plot for further points, and ignores empty cells", () => {
    const { p, gid, lid, pid } = setup();
    excludeRows(p, gid, lid, pid, [3]);
    expect(excludeRows(p, gid, lid, pid, [0, 2, 3]).moved).toBe(1);
    expect(p.sheets[0].columns.length).toBe(3);
    expect(p.graphs[0].layers[0].plots.length).toBe(3);
    expect(p.sheets[0].columns[2].values).toEqual([10, null, null, 99]);
  });

  it("brings points back, and removes the column and its plot with the last one", () => {
    const { p, gid, lid, pid } = setup();
    excludeRows(p, gid, lid, pid, [0, 3]);
    const exPlot = p.graphs[0].layers[0].plots[1];
    expect(includeRows(p, gid, lid, exPlot.id, [3])).toMatchObject({ moved: 1, column: "Voltage" });
    expect(p.sheets[0].columns[1].values).toEqual([null, 11, null, 99, 12]);
    expect(p.sheets[0].columns.length).toBe(3);
    const res = includeRows(p, gid, lid, exPlot.id, "all");
    expect(res).toMatchObject({ moved: 1, select: { layerId: lid, plotId: pid } });
    expect(p.sheets[0].columns.map((c) => c.longName)).toEqual(["Time", "Voltage"]);
    expect(p.sheets[0].columns[1].values).toEqual([10, 11, null, 99, 12]);
    expect(p.graphs[0].layers[0].plots.map((x) => x.name)).toEqual(["Voltage", "Voltage hist"]);
  });

  it("does not overwrite a cell that was filled again, and refuses formula columns", () => {
    const { p, gid, lid, pid } = setup();
    excludeRows(p, gid, lid, pid, [3]);
    p.sheets[0].columns[1].values[3] = 50;
    const exPlot = p.graphs[0].layers[0].plots[1];
    expect(includeRows(p, gid, lid, exPlot.id, "all").moved).toBe(0);
    expect(p.sheets[0].columns[1].values[3]).toBe(50);
    const q = setup();
    q.p.sheets[0].columns[1].formula = "A*2";
    const res = excludeRows(q.p, q.gid, q.lid, q.pid, [0]);
    expect(res.moved).toBe(0);
    expect(res.error).toMatch(/formula/);
    expect(q.p.sheets[0].columns.length).toBe(2);
  });
});

describe("which plots a command reads", () => {
  it("curve commands take symbol and line plots; statistics and CDF also histograms", () => {
    const { p } = setup();
    const [scatter, hist] = p.graphs[0].layers[0].plots;
    expect(isDataCurve(p, scatter)).toBe(true);
    expect(isDataCurve(p, hist)).toBe(false);
    expect(isDataCurve(p, hist, "values")).toBe(true);
    expect(dataCurves(p, p.graphs[0], "values").length).toBe(2);
  });

  it("never moves on from a selected plot it cannot read, and leaves excluded points out unless chosen", () => {
    const { p, gid, lid, pid } = setup();
    const g = p.graphs[0];
    const hist = g.layers[0].plots[1];
    // a histogram is selected: a curve command gets nothing, not the other curves of the panel
    expect(curvesForAnalysis(p, g, [hist.id], lid)).toEqual([]);
    expect(curvesForAnalysis(p, g, [], lid).map((c) => c.plot.id)).toEqual([pid]);
    excludeRows(p, gid, lid, pid, [3]);
    const ex = g.layers[0].plots[1];
    expect(curvesForAnalysis(p, g, [], lid).map((c) => c.plot.id)).toEqual([pid]);
    expect(curvesForAnalysis(p, g, [ex.id], lid).map((c) => c.plot.id)).toEqual([ex.id]);
  });
});

describe("curve math", () => {
  it("works with a number", () => {
    expect(curveMath([0, 1, 2], [2, 4, NaN], "mul", 3)).toEqual([6, 12, NaN]);
    expect(curveMath([0, 1], [2, 4], "sub", 1)).toEqual([1, 3]);
    expect(curveMath([0, 1], [2, 4], "div", 0)).toEqual([NaN, NaN]);
  });

  it("reads the other curve at each x, and leaves gaps where it does not reach", () => {
    // the background is sampled on another grid: 0 → 1, 2 → 3
    const r = curveMath([0, 1, 2, 3], [10, 10, 10, 10], "sub", { x: [0, 2], y: [1, 3] });
    expect(r.slice(0, 3)).toEqual([9, 8, 7]);
    expect(r[3]).toBeNaN();
    expect(curveMath([1], [8], "div", { x: [0, 2], y: [2, 6] })).toEqual([2]);
  });

  it("names the result and its units", () => {
    expect(mathName("Signal", "sub", "Background")).toBe("Signal − Background");
    expect(mathName("Signal", "mul", 2)).toBe("Signal × 2");
    expect(mathUnits("sub", "mV", "mV")).toBe("mV");
    expect(mathUnits("div", "mV", "mV")).toBe("");
    expect(mathUnits("div", "mV", "s")).toBe("mV/s");
    expect(mathUnits("mul", "mV", null)).toBe("mV");
  });
});

describe("results beside the data", () => {
  it("recognizes a column that already holds the grid of a mean", () => {
    expect(sameNumbers([0, 1, 2, null], [0, 1, 2])).toBe(true);
    expect(sameNumbers([0, 1, 2], [0, 1])).toBe(false);
    expect(sameNumbers([0, 1, "2"], [0, 1, 2])).toBe(false);
  });

  it("titles an average after its curves", () => {
    expect(averageNames(["A", "B"])).toBe("A and B");
    expect(averageNames(["A", "B", "C"])).toBe("A, B, C");
    expect(averageNames(["A", "B", "C", "D"])).toBe("4 curves");
  });
});
