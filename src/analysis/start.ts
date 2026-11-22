// Starting an Analysis command from a graph: from the menu bar, the right-click menu of a plot or of a panel.
// Each one works on the plots that are selected (or, with none selected, on the visible plots of the panel), says
// plainly when the selected plot is of a kind it cannot read, and never moves on to plots that were not chosen.

import { useDialogs } from "../app/dialogs";
import { useStore } from "../model/store";
import type { Graph, Plot } from "../model/types";
import { ANALYSIS_LABELS, type AnalysisOp } from "./ops";
import { curvesForAnalysis, dataCurves, isDataCurve, plotKindName, useOfOp } from "./graphCurves";

export type GraphOp = Exclude<AnalysisOp, "fill">;
/** The commands of a plot's Analyze menu, in menu order. */
export const GRAPH_OPS: GraphOp[] = ["smooth", "derivative", "integrate", "normalize", "math", "fft", "cdf", "average", "interpolate"];

const plotsOf = (graph: Graph, ids: string[]): Plot[] => graph.layers.flatMap((l) => l.plots.filter((p) => ids.includes(p.id)));

/** Can this command read at least one of these plots? (Decides what a plot's right-click menu offers.) */
export function opFits(op: GraphOp, graph: Graph, plotIds: string[]): boolean {
  const project = useStore.getState().project;
  return plotsOf(graph, plotIds).some((p) => isDataCurve(project, p, useOfOp(op)));
}

/** Smooth, Differentiate, …, Curve math, FFT, CDF, Average on the plots of a graph. */
export function startCurveAnalysis(op: GraphOp, graphId: string, plotIds: string[]): void {
  const st = useStore.getState();
  const d = useDialogs.getState();
  const graph = st.project.graphs.find((g) => g.id === graphId);
  if (!graph) return;
  const use = useOfOp(op);
  const label = ANALYSIS_LABELS[op];
  const what = use === "values" ? "plots that read a sheet column" : "symbol and line curves that read sheet columns";
  const all = dataCurves(st.project, graph, use);
  if (op === "average" && all.length < 2) return d.showToast("Average Curves needs at least two curves on the graph.");
  if (!all.length) return d.showToast(`${label} works on ${what}: this graph has none.`);
  const chosen = plotsOf(graph, plotIds);
  if (chosen.length && !chosen.some((p) => isDataCurve(st.project, p, use))) return d.showToast(`${label} works on ${what}; the selected plot is ${plotKindName(chosen[0])}.`);
  d.setCurveAnalysis({ op, graphId, plotIds });
}

/** Statistics of the selected plots (with none selected: the visible plots of the panel), shown over the figure. */
export function startStatistics(graphId: string, plotIds: string[], layerId?: string): void {
  const st = useStore.getState();
  const graph = st.project.graphs.find((g) => g.id === graphId);
  if (!graph) return;
  const curves = curvesForAnalysis(st.project, graph, plotIds, layerId, "values");
  if (!curves.length) return useDialogs.getState().showToast(plotIds.length ? "Statistics works on plots that read a sheet column; the selected plot does not." : "Statistics works on plots that read a sheet column: this graph has none.");
  useDialogs.getState().setStats({ graphId, plotIds: curves.map((c) => c.plot.id) });
}

/** Compare Groups on the plots of a graph: each plot is one group. */
export function startCompare(graphId: string, plotIds: string[], layerId?: string): void {
  const st = useStore.getState();
  const graph = st.project.graphs.find((g) => g.id === graphId);
  if (!graph) return;
  if (dataCurves(st.project, graph, "values").length < 2) return useDialogs.getState().showToast("Compare Groups needs at least two plots that read sheet columns on the graph.");
  useDialogs.getState().setCompare({ graphId, layerId, plotIds });
}
