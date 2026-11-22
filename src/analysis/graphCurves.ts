import type { Graph, Layer, Plot, Project, Selection } from "../model/types";
import type { AnalysisOp } from "./ops";
import { isExcludedPlot } from "../model/exclude";

export interface GraphCurve {
  layer: Layer;
  plot: Plot;
}

/**
 * What a command reads from a plot:
 * - "curve": the x–y points of a symbol or line plot of sheet columns;
 * - "average": the same, and fitted curves (they hold points but no columns);
 * - "values": the numbers of the plot's data column, whatever draws them (also histograms, boxes, violins, bars).
 */
export type CurveUse = "curve" | "average" | "values";

export const useOfOp = (op: AnalysisOp): CurveUse => (op === "average" ? "average" : op === "cdf" ? "values" : "curve");

const XY_TYPES = ["scatter", "line", "lineScatter"];
const VALUE_TYPES = [...XY_TYPES, "histogram", "box", "bar"];

/** Can a command with this use read the plot? */
export function isDataCurve(project: Project, plot: Plot, use: CurveUse = "curve"): boolean {
  if (plot.type === "fitCurve") return use === "average" && !!plot.fit?.curveX?.length;
  if (!(use === "values" ? VALUE_TYPES : XY_TYPES).includes(plot.type)) return false;
  const sheet = project.sheets.find((s) => s.id === plot.source.sheetId);
  return !!sheet?.columns.some((c) => c.id === plot.source.yColId);
}

/** Every plot of a graph a command with this use can read, panel by panel. */
export function dataCurves(project: Project, graph: Graph, use: CurveUse = "curve"): GraphCurve[] {
  return graph.layers.flatMap((layer) => layer.plots.filter((plot) => isDataCurve(project, plot, use)).map((plot) => ({ layer, plot })));
}

/** Ids of the plots selected on a graph (the primary selection and the shift-selected ones). */
export function selectedPlotIds(selection: Selection, multi: Selection[], graphId: string): string[] {
  return [selection, ...multi].filter((x): x is Extract<Selection, { kind: "plot" }> => x.kind === "plot" && x.graphId === graphId).map((x) => x.plotId);
}

/**
 * The plots a command started from a graph acts on: the selected ones that it can read (none of them: nothing —
 * a command never moves on to plots that were not chosen); with no plot selected, the visible ones of the given
 * panel, or of the first panel that has any (plots that show excluded points and hidden panels aside).
 */
export function curvesForAnalysis(project: Project, graph: Graph, plotIds: string[], layerId?: string, use: CurveUse = "curve"): GraphCurve[] {
  const all = dataCurves(project, graph, use);
  if (plotIds.length) return all.filter((c) => plotIds.includes(c.plot.id));
  // plots of excluded points are left alone unless they are chosen
  const visible = all.filter((c) => c.plot.visible && !c.layer.hidden && !isExcludedPlot(project, c.plot));
  const inLayer = visible.filter((c) => c.layer.id === layerId);
  if (inLayer.length) return inLayer;
  return visible.filter((c) => c.layer.id === visible[0]?.layer.id);
}

/** What a plot is called when a command cannot read it, e.g. "a histogram". */
export function plotKindName(plot: Plot): string {
  const names: Partial<Record<Plot["type"], string>> = {
    histogram: "a histogram",
    box: "a box plot",
    bar: "a bar plot",
    fitCurve: "a fitted curve",
    function: "a function",
    heatmap: "a heatmap",
    contour: "a contour plot",
    surface3d: "a 3D surface",
    scatter3d: "a 3D scatter plot",
  };
  return names[plot.type] ?? "this plot";
}
