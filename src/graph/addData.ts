// Add sheet columns to an existing graph without changing its axis limits.
import { useStore } from "../model/store";
import type { Sheet } from "../model/types";
import { layoutLayer } from "./layout";

/** Origin convention: a Y column's X is the nearest X-designated column to its left (else the first X column). */
export function xColumnFor(sheet: Sheet, yIdx: number): string | null {
  for (let i = yIdx; i >= 0; i--) if (sheet.columns[i].designation === "X") return sheet.columns[i].id;
  return sheet.columns.find((c) => c.designation === "X")?.id ?? null;
}

/** Freeze a layer's automatic axes at their current range so new data does not rescale them. */
export function freezeLayerAxes(graphId: string, layerId: string): void {
  const st = useStore.getState();
  const graph = st.project.graphs.find((g) => g.id === graphId);
  const layer = graph?.layers.find((l) => l.id === layerId);
  if (!layer) return;
  const ll = layoutLayer(st.project, layer);
  st.updateLayer(graphId, layerId, (l) => {
    const pin = (which: "x" | "y" | "y2") => {
      const a = l.axes[which];
      const g = which === "x" ? ll.x : which === "y" ? ll.y : ll.y2;
      if (!a || !g || !a.auto || g.scale.categories) return;
      a.auto = false;
      a.from = g.scale.from;
      a.to = g.scale.to;
    };
    pin("x");
    pin("y");
    pin("y2");
  });
}

/**
 * Plot the given columns (sheet column indices; X/error columns are skipped) into a layer of a graph,
 * keeping the axis limits where they are.
 */
export function addColumnsToGraph(sheetId: string, cols: number[], graphId: string, layerId?: string): number {
  const st = useStore.getState();
  const sheet = st.project.sheets.find((s) => s.id === sheetId);
  const graph = st.project.graphs.find((g) => g.id === graphId);
  if (!sheet || !graph) return 0;
  const target = layerId ?? (st.ui.selection.kind !== "none" && "layerId" in st.ui.selection && st.ui.selection.graphId === graphId ? st.ui.selection.layerId : graph.layers[0]?.id);
  if (!target) return 0;
  const ys = cols.filter((i) => sheet.columns[i] && !["X", "xErr", "yErr", "label"].includes(sheet.columns[i].designation));
  if (!ys.length) return 0;
  freezeLayerAxes(graphId, target);
  // group by X column so each series keeps its own X
  const groups = new Map<string | null, string[]>();
  for (const i of ys) {
    const x = xColumnFor(sheet, i);
    groups.set(x, [...(groups.get(x) ?? []), sheet.columns[i].id]);
  }
  for (const [x, yIds] of groups) st.plotColumns(sheetId, yIds, x, { graphId, layerId: target }, "scatter");
  return ys.length;
}
