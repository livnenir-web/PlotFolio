// Excluding points from the figure. An excluded point is not hidden by a mask: its value moves from its column to
// a column of its own in the same sheet ("Voltage (excluded)"), on the same row, and that column is drawn as a plot
// of its own (gray, hollow, not in the legend) that can be hidden like any plot. Fits, statistics and every other
// command read the data column and so leave the point out without knowing about exclusions; the sheet shows plainly
// what was taken out, and "Include again" moves the value back.
//
// The functions here change the project they are given (the store calls them on its draft).

import { columnLetter, newColumn, newPlot } from "./defaults";
import type { CellValue, Column, Layer, Plot, Project, Sheet } from "./types";

/** Color of the plot that shows excluded points. */
export const EXCLUDED_COLOR = "#9a9a9a";

const XY_TYPES = ["scatter", "line", "lineScatter"];
const empty = (v: CellValue | undefined) => v === null || v === undefined || v === "";

export interface ExcludeResult {
  /** how many values moved */
  moved: number;
  /** why nothing could be done (shown to the user) */
  error?: string;
  /** name of the column the values moved to */
  column?: string;
  /** the plot to select afterwards, when the one acted on is gone */
  select?: { layerId: string; plotId: string | null };
}

interface Found {
  layer: Layer;
  plot: Plot;
  sheet: Sheet;
  yc: Column;
}

function find(project: Project, graphId: string, layerId: string, plotId: string): Found | string {
  const layer = project.graphs.find((g) => g.id === graphId)?.layers.find((l) => l.id === layerId);
  const plot = layer?.plots.find((p) => p.id === plotId);
  if (!layer || !plot) return "The plot is gone.";
  if (!XY_TYPES.includes(plot.type)) return "Points can be excluded from symbol and line plots.";
  const sheet = project.sheets.find((s) => s.id === plot.source.sheetId);
  const yc = sheet?.columns.find((c) => c.id === plot.source.yColId);
  if (!sheet || !yc) return "This plot reads no sheet column.";
  return { layer, plot, sheet, yc };
}

const nameOf = (sheet: Sheet, c: Column) => c.longName || columnLetter(sheet.columns.indexOf(c));

function trim(c: Column): void {
  let n = c.values.length;
  while (n > 0 && c.values[n - 1] === null) n--;
  if (n !== c.values.length) c.values.length = n;
}

/** Does this plot show excluded points (its data column holds what was taken out of another column)? */
export function isExcludedPlot(project: Project, plot: Plot): boolean {
  const sheet = project.sheets.find((s) => s.id === plot.source.sheetId);
  return !!sheet?.columns.find((c) => c.id === plot.source.yColId)?.excludedFrom;
}

/** Can points of this plot be excluded (a symbol or line plot of a sheet column that is not itself excluded points)? */
export function canExclude(project: Project, plot: Plot): boolean {
  if (!XY_TYPES.includes(plot.type)) return false;
  const sheet = project.sheets.find((s) => s.id === plot.source.sheetId);
  const yc = sheet?.columns.find((c) => c.id === plot.source.yColId);
  return !!yc && !yc.excludedFrom;
}

/**
 * Exclude the points of a plot that sit on these sheet rows: their y values move to the plot's "(excluded)" column
 * (made on first use, at the end of the same sheet), and a plot of that column joins the panel.
 */
export function excludeRows(project: Project, graphId: string, layerId: string, plotId: string, rows: number[]): ExcludeResult {
  const f = find(project, graphId, layerId, plotId);
  if (typeof f === "string") return { moved: 0, error: f };
  const { layer, plot, sheet, yc } = f;
  if (yc.excludedFrom) return { moved: 0, error: "These points are excluded already." };
  if (yc.formula) return { moved: 0, error: `“${nameOf(sheet, yc)}” is computed by a formula, so its values cannot be taken out. Exclude the point in the column the formula reads.` };
  const todo = [...new Set(rows)].filter((r) => r >= 0 && !empty(yc.values[r]));
  if (!todo.length) return { moved: 0 };
  let ex = sheet.columns.find((c) => c.excludedFrom === yc.id);
  if (!ex) {
    ex = newColumn("Y");
    ex.longName = `${nameOf(sheet, yc)} (excluded)`;
    ex.units = yc.units;
    ex.excludedFrom = yc.id;
    ex.comment = `Points excluded from ${nameOf(sheet, yc)} on the figure`;
    sheet.columns.push(ex);
    ex = sheet.columns[sheet.columns.length - 1];
  }
  for (const r of todo) {
    while (ex.values.length <= r) ex.values.push(null);
    ex.values[r] = yc.values[r];
    yc.values[r] = null;
  }
  trim(yc);
  const exId = ex.id;
  if (!layer.plots.some((p) => p.source.sheetId === sheet.id && p.source.yColId === exId)) {
    // drawn where the points were (same x, same errors, same axis), right above the plot they came from
    const shown = newPlot(project.defaults, layer, { ...plot.source, yColId: exId, matrix: undefined }, `${plot.name} (excluded)`, "scatter");
    shown.color = EXCLUDED_COLOR;
    shown.marker = { shape: plot.marker.shape === "none" ? "circle" : plot.marker.shape, sizePt: plot.marker.sizePt, filled: false };
    shown.errorBars = { ...plot.errorBars };
    shown.yAxis = plot.yAxis;
    shown.showInLegend = false;
    layer.plots.splice(layer.plots.indexOf(plot) + 1, 0, shown);
  }
  return { moved: todo.length, column: ex.longName };
}

/**
 * Bring excluded points back: the values on these rows (or all of them) return to the column they came from. An
 * "(excluded)" column left empty is removed, together with the plots that showed it.
 */
export function includeRows(project: Project, graphId: string, layerId: string, plotId: string, rows: number[] | "all"): ExcludeResult {
  const f = find(project, graphId, layerId, plotId);
  if (typeof f === "string") return { moved: 0, error: f };
  const { layer, sheet, yc: ex } = f;
  const src = sheet.columns.find((c) => c.id === ex.excludedFrom);
  if (!ex.excludedFrom) return { moved: 0, error: "These points are not excluded." };
  if (!src) return { moved: 0, error: "The column these points came from is gone. Their values stay in this column." };
  if (src.formula) return { moved: 0, error: `“${nameOf(sheet, src)}” is now computed by a formula, so the values cannot go back into it.` };
  const all = rows === "all" ? ex.values.map((_, i) => i) : [...new Set(rows)];
  let moved = 0;
  for (const r of all) {
    // a cell that was filled again in the meantime keeps its new value
    if (r < 0 || empty(ex.values[r]) || !empty(src.values[r])) continue;
    while (src.values.length <= r) src.values.push(null);
    src.values[r] = ex.values[r];
    ex.values[r] = null;
    moved++;
  }
  trim(ex);
  const result: ExcludeResult = { moved, column: nameOf(sheet, src) };
  if (ex.values.every(empty)) {
    const srcPlot = layer.plots.find((p) => p.source.sheetId === sheet.id && p.source.yColId === src.id);
    for (const g of project.graphs) for (const l of g.layers) l.plots = l.plots.filter((p) => !(p.source.sheetId === sheet.id && p.source.yColId === ex.id));
    sheet.columns = sheet.columns.filter((c) => c.id !== ex.id);
    result.select = { layerId, plotId: srcPlot?.id ?? null };
  }
  return result;
}
