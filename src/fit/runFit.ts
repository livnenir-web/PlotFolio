import { useStore } from "../model/store";
import { newColumn, newPlot, uid, uniqueName } from "../model/defaults";
import type { Column, FitSpec, Layer, Plot, Project, Sheet } from "../model/types";
import { getPlotData } from "../graph/data";
import { BUILTIN_FUNCTIONS, compileCustom, polynomialDef, type FitFunctionDef } from "./functions";
import { curveXs, fitCurve, predictWithBand, type FitResult } from "./engine";
import { isLogScale } from "../graph/ticks";

export function resolveFunction(functionId: string, expression: string): FitFunctionDef {
  if (functionId === "custom") return compileCustom(expression);
  const m = /^poly(\d+)$/.exec(functionId);
  if (m) return polynomialDef(parseInt(m[1], 10));
  const def = BUILTIN_FUNCTIONS.find((f) => f.id === functionId);
  if (!def) throw new Error(`Unknown function ${functionId}`);
  return def;
}

export interface FitRequest {
  graphId: string;
  layerId: string;
  /** plot to fit */
  plotId: string;
  functionId: string;
  expression: string;
  guess: number[];
  fixed: boolean[];
  rangeFrom: number | null;
  rangeTo: number | null;
  weighted: boolean;
  showBand: boolean;
  showPredBand?: boolean;
  /** existing fit-curve plot to replace (refit) */
  existingFitPlotId?: string;
}

export interface FitOutcome {
  result: FitResult;
  def: FitFunctionDef;
  x: number[];
  y: number[];
}

/** Collect the data of a plot restricted to the fit range. */
export function fitInput(project: Project, plot: Plot, rangeFrom: number | null, rangeTo: number | null) {
  const d = getPlotData(project, plot);
  const x: number[] = [];
  const y: number[] = [];
  const sigma: number[] = [];
  for (let i = 0; i < d.x.length; i++) {
    if (rangeFrom !== null && d.x[i] < rangeFrom) continue;
    if (rangeTo !== null && d.x[i] > rangeTo) continue;
    x.push(d.x[i]);
    y.push(d.y[i]);
    if (d.yErr) sigma.push(d.yErr[i]);
  }
  return { x, y, sigma: d.yErr ? sigma : undefined };
}

/** Run a fit without touching the project (used for previews). */
export function computeFit(project: Project, req: Omit<FitRequest, "graphId" | "layerId" | "existingFitPlotId">, layer: Layer): FitOutcome {
  const plot = layer.plots.find((p) => p.id === req.plotId);
  if (!plot) throw new Error("Plot not found");
  const def = resolveFunction(req.functionId, req.expression);
  const data = fitInput(project, plot, req.rangeFrom, req.rangeTo);
  if (data.x.length < def.params.length) throw new Error(`Need at least ${def.params.length} points in the range (have ${data.x.length})`);
  const guess = def.params.map((_, i) => (Number.isFinite(req.guess[i]) ? req.guess[i] : 1));
  const opts = { weighted: req.weighted && !!data.sigma, fixed: req.fixed };
  let result = fitCurve(def, data, guess, opts);
  // Non-linear fits can stall from a poor start: retry from scaled variants of the automatic guess and keep the best χ².
  if (!def.linear) {
    const auto = data.x.length >= 2 ? def.guess(data.x, data.y) : guess;
    const last = auto.length - 1;
    const variants: number[][] = [auto, auto.map((g, i) => (i === last ? g * 3 : g)), auto.map((g, i) => (i === last ? g / 3 : g)), auto.map((g, i) => (i === last ? g * 10 : g)), auto.map((g, i) => (i === last ? g / 10 : g))];
    // peak-type functions: also try the opposite extremum as the centre
    const xcIdx = def.params.indexOf("xc");
    if (xcIdx >= 0 && data.x.length) {
      const iMax = data.y.indexOf(Math.max(...data.y));
      const iMin = data.y.indexOf(Math.min(...data.y));
      for (const idx of [iMax, iMin]) {
        const v = [...auto];
        v[xcIdx] = data.x[idx];
        if (def.params[1] === "A") v[1] = -v[1] * (idx === iMin ? 1 : -1) * Math.sign(v[1] || 1);
        variants.push(v);
      }
    }
    for (const v of variants) {
      if (v.every((g, i) => g === guess[i])) continue;
      try {
        const r = fitCurve(def, data, v.map((g) => (Number.isFinite(g) ? g : 1)), opts);
        if (Number.isFinite(r.chi2) && (!Number.isFinite(result.chi2) || r.chi2 < result.chi2 * 0.999)) result = r;
      } catch {
        /* ignore failed variant */
      }
    }
  }
  return { result, def, x: data.x, y: data.y };
}

function buildSpec(req: FitRequest, out: FitOutcome, layer: Layer, logX: boolean): FitSpec {
  const { result, def, x, y } = out;
  const from = req.rangeFrom ?? Math.min(...x);
  const to = req.rangeTo ?? Math.max(...x);
  const xs = curveXs(from, to, 300, logX);
  // residual variance in y units (unweighted), for the prediction band
  let ss = 0;
  for (let i = 0; i < x.length; i++) {
    const r = y[i] - def.fn(x[i], result.params);
    if (Number.isFinite(r)) ss += r * r;
  }
  const residualVariance = result.dof > 0 ? ss / result.dof : 0;
  const band = predictWithBand(def, result.params, result.cov, result.dof, xs, 0.95, residualVariance);
  void layer;
  return {
    functionId: req.functionId,
    expression: def.expression,
    paramNames: def.params,
    params: result.params,
    errors: result.errors,
    rangeFrom: req.rangeFrom,
    rangeTo: req.rangeTo,
    weighted: req.weighted,
    frozen: false,
    showBand: req.showBand,
    showPredBand: !!req.showPredBand,
    sourcePlotId: req.plotId,
    stats: {
      n: result.n,
      dof: result.dof,
      rSquared: result.rSquared,
      adjRSquared: result.adjRSquared,
      chiSquared: result.chi2,
      reducedChiSquared: result.reducedChi2,
      covariance: result.cov,
    },
    curveX: xs,
    curveY: band.y,
    bandLower: band.lower,
    bandUpper: band.upper,
    predLower: band.predLower,
    predUpper: band.predUpper,
  };
}

function reportSheet(name: string, out: FitOutcome, req: FitRequest, sourcePlotName: string, existing?: Sheet): Sheet {
  const { result, def, x, y } = out;
  const col = (longName: string, designation: Column["designation"], values: Column["values"], units = ""): Column => {
    const c = newColumn(designation);
    c.longName = longName;
    c.units = units;
    c.values = values;
    return c;
  };
  const f6 = (v: number) => (Number.isFinite(v) ? Number(v.toPrecision(8)) : null);
  const names = [...def.params, "", "Function", "Fitted plot", "Range", "Weighting", "N", "DOF", "R²", "Adj. R²", "χ²", "Reduced χ²", "Converged"];
  const values: Column["values"] = [
    ...result.params.map(f6),
    null,
    def.expression,
    sourcePlotName,
    req.rangeFrom === null && req.rangeTo === null ? "all" : `${req.rangeFrom ?? "–"} … ${req.rangeTo ?? "–"}`,
    req.weighted ? "1/σ²" : "none",
    result.n,
    result.dof,
    f6(result.rSquared),
    f6(result.adjRSquared),
    f6(result.chi2),
    f6(result.reducedChi2),
    result.converged ? "yes" : "no",
  ];
  const errors: Column["values"] = [...result.errors.map(f6), ...new Array(names.length - result.errors.length).fill(null)];
  const columns = [
    col("Parameter", "label", names),
    col("Value", "none", values),
    col("Std. error", "none", errors),
    col("x", "X", x.map(f6)),
    col("y", "Y", y.map(f6)),
    col("Fit", "Y", result.fitted.map(f6)),
    col("Residual", "Y", result.residuals.map(f6)),
  ];
  if (existing) {
    // keep column ids stable so residual plots stay linked
    existing.columns.forEach((c, i) => {
      if (columns[i]) columns[i].id = c.id;
    });
    return { ...existing, columns };
  }
  return { id: uid(), name, columns };
}

/** Run the fit and write the fit curve plot + report sheet into the project. Returns the fit plot id. */
export function applyFit(req: FitRequest): { plotId: string; outcome: FitOutcome } {
  const st = useStore.getState();
  const graph = st.project.graphs.find((g) => g.id === req.graphId);
  const layer = graph?.layers.find((l) => l.id === req.layerId);
  if (!graph || !layer) throw new Error("Layer not found");
  const source = layer.plots.find((p) => p.id === req.plotId);
  if (!source) throw new Error("Plot not found");
  const outcome = computeFit(st.project, req, layer);
  const spec = buildSpec(req, outcome, layer, isLogScale(layer.axes.x.scale));
  const existingFit = req.existingFitPlotId ? layer.plots.find((p) => p.id === req.existingFitPlotId) : undefined;
  const existingReport = existingFit?.fit?.reportSheetId ? st.project.sheets.find((s) => s.id === existingFit.fit!.reportSheetId) : undefined;
  const defName = outcome.def.id === "custom" ? "custom" : outcome.def.name;
  const fitName = `Fit: ${source.name} (${defName})`;
  const report = reportSheet(uniqueName(`Fit of ${source.name}`, st.project.sheets.map((s) => s.name)), outcome, req, source.name, existingReport);
  spec.reportSheetId = report.id;

  let plotId = existingFit?.id ?? "";
  useStore.setState((s) => {
    const project = s.project;
    const g = project.graphs.find((x) => x.id === req.graphId)!;
    const l = g.layers.find((x) => x.id === req.layerId)!;
    const sheets = existingReport ? project.sheets.map((sh) => (sh.id === report.id ? report : sh)) : [...project.sheets, report];
    let plots: Plot[];
    if (existingFit) {
      plots = l.plots.map((p) => (p.id === existingFit.id ? { ...p, fit: spec, name: p.name.startsWith("Fit:") ? fitName : p.name } : p));
    } else {
      const p = newPlot(project.defaults, l, { ...source.source }, fitName, "fitCurve");
      p.color = "#d62728"; // fits default to red
      p.showMarkers = false;
      p.showLine = true;
      p.line = { ...p.line, widthPt: Math.max(1, source.line.widthPt), style: "solid" };
      p.fit = spec;
      plotId = p.id;
      plots = [...l.plots, p];
    }
    const layers = g.layers.map((x) => (x.id === l.id ? { ...l, plots } : x));
    const graphs = project.graphs.map((x) => (x.id === g.id ? { ...g, layers } : x));
    return { project: { ...project, sheets, graphs }, dirty: true };
  });
  return { plotId, outcome };
}

/** Re-run every unfrozen fit whose source data may have changed. */
let refitting = false;
export function refitAll(changedSheetIds?: Set<string>): void {
  if (refitting) return;
  refitting = true;
  try {
    const st = useStore.getState();
    for (const g of st.project.graphs) {
      for (const l of g.layers) {
        for (const p of l.plots) {
          if (p.type !== "fitCurve" || !p.fit || p.fit.frozen) continue;
          const src = l.plots.find((x) => x.id === p.fit!.sourcePlotId);
          if (!src) continue;
          if (changedSheetIds && !changedSheetIds.has(src.source.sheetId)) continue; // its data did not change
          try {
            applyFit({
              graphId: g.id,
              layerId: l.id,
              plotId: src.id,
              functionId: p.fit.functionId,
              expression: p.fit.functionId === "custom" ? p.fit.expression : "",
              guess: p.fit.params,
              fixed: p.fit.paramNames.map(() => false),
              rangeFrom: p.fit.rangeFrom,
              rangeTo: p.fit.rangeTo,
              weighted: p.fit.weighted,
              showBand: p.fit.showBand,
              showPredBand: p.fit.showPredBand,
              existingFitPlotId: p.id,
            });
          } catch (e) {
            console.warn("refit failed", e);
          }
        }
      }
    }
  } finally {
    refitting = false;
  }
}

/** Subscribe once: refit when sheet data changes. */
let subscribed = false;
export function installRefitWatcher(): void {
  if (subscribed) return;
  subscribed = true;
  let lastSheets = useStore.getState().project.sheets;
  let lastLoad = useStore.getState().loadSeq;
  useStore.subscribe((s) => {
    if (s.loadSeq !== lastLoad) {
      // a project was opened or reset: nothing to refit
      lastLoad = s.loadSeq;
      lastSheets = s.project.sheets;
      return;
    }
    if (s.project.sheets === lastSheets) return;
    const prev = lastSheets;
    lastSheets = s.project.sheets;
    // only data changes of non-report sheets should trigger a refit
    const reportIds = new Set(s.project.graphs.flatMap((g) => g.layers.flatMap((l) => l.plots.map((p) => p.fit?.reportSheetId).filter(Boolean))));
    const prevById = new Map(prev.map((p) => [p.id, p]));
    const changed = new Set(s.project.sheets.filter((sh) => !reportIds.has(sh.id) && prevById.get(sh.id) !== sh).map((sh) => sh.id));
    if (changed.size) setTimeout(() => refitAll(changed), 0);
  });
}

/** Create a residual plot (new graph) from a fit's report sheet. */
export function plotResiduals(graphId: string, layerId: string, fitPlotId: string): void {
  const st = useStore.getState();
  const layer = st.project.graphs.find((g) => g.id === graphId)?.layers.find((l) => l.id === layerId);
  const fit = layer?.plots.find((p) => p.id === fitPlotId)?.fit;
  const sheet = fit?.reportSheetId ? st.project.sheets.find((s) => s.id === fit.reportSheetId) : undefined;
  if (!sheet) return;
  const xCol = sheet.columns[3];
  const resCol = sheet.columns[6];
  const gid = st.plotColumns(sheet.id, [resCol.id], xCol.id, null, "scatter");
  useStore.getState().renameGraph(gid, uniqueName("Residuals", st.project.graphs.map((g) => g.name)));
  useStore.getState().updateGraph(gid, (g) => {
    g.layers[0].axes.y.title = "Residual";
    g.layers[0].axes.x.title = layer!.axes.x.title;
  });
}
