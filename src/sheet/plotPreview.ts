// A throw-away graph of the columns chosen in the Plot Columns dialog, for its preview. It is built the way the
// store builds the real one (store.plotColumns / addPlot) but never enters the project.

import { defaultColorScale, make3D, newGraph, newPlot } from "../model/defaults";
import { axisTitleFor, columnDisplayName } from "../model/store";
import type { Graph, PlotSource, Project, Sheet } from "../model/types";
import { defaultMatrixSource } from "../graph/matrix";
import type { PlotKind } from "../graph/plotKinds";

export interface PlotChoice {
  kind: PlotKind;
  yIds: string[];
  xId: string | null;
  zId: string | null;
  matrixMode: "block" | "xyz";
}

export function previewGraph(project: Project, sheet: Sheet, c: PlotChoice): Graph | null {
  const d = project.defaults;
  const type = c.kind.type;
  const g = newGraph(d, "Preview");
  const l = g.layers[0];
  const col = (id: string | null) => (id ? sheet.columns.find((x) => x.id === id) : undefined);
  const title = (id: string | null) => {
    const x = col(id);
    return x ? axisTitleFor(x, sheet.columns.indexOf(x)) : "";
  };
  const isMatrix = type === "heatmap" || type === "contour" || type === "surface3d";
  const noXy = type === "histogram" || type === "box";
  const ys = isMatrix && c.matrixMode === "block" ? [c.yIds[0] ?? ""] : isMatrix || type === "scatter3d" ? c.yIds.slice(0, 1) : c.yIds;
  if (!isMatrix && !ys.length) return null;
  if ((type === "scatter3d" || (isMatrix && c.matrixMode === "xyz")) && (!c.zId || !ys.length)) return null;
  for (const yId of ys) {
    const yc = col(yId);
    const src: PlotSource = { sheetId: sheet.id, xColId: noXy ? null : c.xId, yColId: yId, zColId: c.zId };
    if (isMatrix) src.matrix = { ...defaultMatrixSource(sheet), mode: c.matrixMode, zColId: c.zId };
    else {
      const next = yc ? sheet.columns[sheet.columns.indexOf(yc) + 1] : undefined;
      if (next?.designation === "yErr") src.yErrColId = next.id;
    }
    const plot = newPlot(d, l, src, yc ? columnDisplayName(yc, sheet.columns.indexOf(yc)) : sheet.name, type);
    c.kind.apply?.(plot);
    if (plot.colormap && !l.colorScale) l.colorScale = defaultColorScale(d, l.frame);
    l.plots.push(plot);
    l.nextColorIndex++;
  }
  const first = l.plots[0];
  if (type === "surface3d" || type === "scatter3d") {
    make3D(d, l);
    l.frame.hMm = Math.max(l.frame.hMm, l.frame.wMm);
    l.axes.x.title = type === "surface3d" ? "X" : title(c.xId);
    l.axes.y.title = type === "surface3d" ? "Y" : title(ys[0]);
    l.axes.z!.title = type === "scatter3d" ? title(c.zId) : "Z";
  } else if (isMatrix) {
    l.axes.x.title = "X";
    l.axes.y.title = "Y";
  } else if (type === "box") {
    l.axes.x.title = "";
    l.axes.y.title = "Value";
  } else if (type === "histogram") {
    l.axes.x.title = ys.length > 1 ? "Value" : title(ys[0]);
    l.axes.y.title = first.histogram?.display === "cdf" ? "Cumulative fraction" : "Count";
    if (first.histogram?.display === "cdf") Object.assign(l.legend, { xMm: Math.round(l.frame.wMm * 0.5), yMm: Math.round((l.frame.hMm - 2.5 - 3.4 * ys.length) * 2) / 2 });
  } else {
    l.axes.x.title = title(c.xId);
    l.axes.y.title = title(ys[0]);
  }
  return g;
}
