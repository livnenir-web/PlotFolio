import { useEffect, useMemo, useState } from "react";
import { CheckField, NumberField, Row, SelectField, TextField } from "../ui/Fields";
import { useDialogs } from "../app/dialogs";
import { useStore } from "../model/store";
import { BUILTIN_FUNCTIONS, type FitFunctionDef } from "./functions";
import { applyFit, computeFit, fitInput, plotResiduals, resolveFunction, type FitOutcome } from "./runFit";
import { getPlotData } from "../graph/data";
import { Icon } from "../ui/Icon";

const FUNCTION_OPTIONS = [...BUILTIN_FUNCTIONS.map((f) => ({ value: f.id, label: f.name })), { value: "poly4", label: "Polynomial (degree 4)" }, { value: "poly5", label: "Polynomial (degree 5)" }, { value: "custom", label: "Custom expression…" }];

/**
 * Fitting panel docked under the graph. The graph stays interactive while it is open:
 * selecting another plot in the graph switches the data, and "Pick on graph" enables range dragging.
 */
export function FitPanel({ graphId, layerId, plotId }: { graphId: string; layerId: string; plotId: string | null }) {
  const close = () => {
    useDialogs.getState().setRangePick(null);
    useDialogs.getState().setFitDialog(null);
  };
  const sheets = useStore((s) => s.project.sheets); // re-render on data changes; the project itself is read on demand
  const graphs = useStore((s) => s.project.graphs);
  const project = useStore.getState().project;
  void sheets;
  void graphs;
  const selection = useStore((s) => s.ui.selection);
  const graph = project.graphs.find((g) => g.id === graphId);
  const layer = graph?.layers.find((l) => l.id === layerId);
  const candidates = useMemo(() => layer?.plots.filter((p) => p.type !== "fitCurve" && !["histogram", "heatmap", "contour", "bar", "box", "surface3d", "scatter3d"].includes(p.type)) ?? [], [layer]);

  const [srcId, setSrcId] = useState<string>(plotId && candidates.some((c) => c.id === plotId) ? plotId : (candidates[0]?.id ?? ""));
  // follow plot selection on the graph
  useEffect(() => {
    if (selection.kind === "plot" && selection.layerId === layerId && candidates.some((c) => c.id === selection.plotId)) setSrcId(selection.plotId);
  }, [selection, layerId, candidates]);

  const existingFit = layer?.plots.find((p) => p.type === "fitCurve" && p.fit?.sourcePlotId === srcId);
  const prefill = existingFit?.fit;

  const [functionId, setFunctionId] = useState<string>(prefill?.functionId ?? "linear");
  const [expression, setExpression] = useState<string>(prefill?.functionId === "custom" ? prefill.expression : "a*exp(-x/t) + y0");
  const [guess, setGuess] = useState<number[]>([]);
  const [fixed, setFixed] = useState<boolean[]>([]);
  const [useRange, setUseRange] = useState<boolean>(prefill ? prefill.rangeFrom !== null || prefill.rangeTo !== null : false);
  const [rangeFrom, setRangeFrom] = useState<number | null>(prefill?.rangeFrom ?? null);
  const [rangeTo, setRangeTo] = useState<number | null>(prefill?.rangeTo ?? null);
  const [weighted, setWeighted] = useState<boolean>(prefill?.weighted ?? false);
  const [showBand, setShowBand] = useState<boolean>(prefill?.showBand ?? false);
  const [showPredBand, setShowPredBand] = useState<boolean>(prefill?.showPredBand ?? false);
  const [outcome, setOutcome] = useState<FitOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fitPlotIdDone, setFitPlotIdDone] = useState<string | null>(existingFit?.id ?? null);
  const picking = useDialogs((s) => s.rangePick);

  const source = candidates.find((p) => p.id === srcId);
  const hasErr = source ? !!getPlotData(project, source).yErr : false;

  let def: FitFunctionDef | null = null;
  let defError: string | null = null;
  try {
    def = resolveFunction(functionId, expression);
  } catch (e) {
    defError = (e as Error).message;
  }

  // reset guesses when the function or source changes
  useEffect(() => {
    if (!def || !source) return;
    const data = fitInput(project, source, useRange ? rangeFrom : null, useRange ? rangeTo : null);
    const samePrefill = prefill && prefill.functionId === functionId && prefill.params.length === def.params.length;
    const g = samePrefill ? prefill.params : data.x.length >= 2 ? def.guess(data.x, data.y) : def.params.map(() => 1);
    setGuess(g.map((v) => (Number.isFinite(v) ? Number(v.toPrecision(6)) : 1)));
    setFixed(def.params.map(() => false));
    setOutcome(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [functionId, expression, srcId]);

  const dataRange = useMemo(() => {
    if (!source) return null;
    const d = getPlotData(project, source);
    return d.x.length ? [Math.min(...d.x), Math.max(...d.x)] : null;
  }, [project, source, sheets]);

  const request = () => ({ plotId: source!.id, functionId, expression, guess, fixed, rangeFrom: useRange ? rangeFrom : null, rangeTo: useRange ? rangeTo : null, weighted, showBand, showPredBand });

  const runPreview = () => {
    if (!def || !source || !layer) return;
    setError(null);
    try {
      const out = computeFit(project, request(), layer);
      setOutcome(out);
      setGuess(out.result.params.map((v) => Number(v.toPrecision(6))));
    } catch (e) {
      setError((e as Error).message);
      setOutcome(null);
    }
  };

  const commit = () => {
    if (!def || !source) return;
    setError(null);
    try {
      const { plotId: fitPlotId, outcome: out } = applyFit({ graphId, layerId, ...request(), existingFitPlotId: existingFit?.id });
      const id = fitPlotId || existingFit?.id || null;
      setFitPlotIdDone(id);
      setOutcome(out);
      setGuess(out.result.params.map((v) => Number(v.toPrecision(6))));
      useDialogs.getState().showToast(existingFit ? "Fit updated" : "Fit curve and report sheet added");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const pickRange = () => {
    if (picking) {
      useDialogs.getState().setRangePick(null);
      return;
    }
    useDialogs.getState().setRangePick({
      graphId,
      layerId,
      onPick: (from, to) => {
        useDialogs.getState().setRangePick(null);
        setUseRange(true);
        setRangeFrom(Number(from.toPrecision(6)));
        setRangeTo(Number(to.toPrecision(6)));
      },
    });
  };

  if (!graph || !layer) return null;
  const f = (v: number) => (Number.isFinite(v) ? Number(v.toPrecision(5)).toString() : "–");

  return (
    <div className="fit-panel">
      <div className="panel-head">
        <Icon name="fit" size={14} />
        <span>Fit a curve</span>
        <span className="hint" style={{ fontWeight: 400 }}>
          {layer.name} · click a plot on the graph to fit it
        </span>
        <span style={{ flex: 1 }} />
        {fitPlotIdDone && (
          <button className="btn small" onClick={() => plotResiduals(graphId, layerId, fitPlotIdDone)}>
            Residual plot
          </button>
        )}
        <button className="btn small" onClick={runPreview} disabled={!def || !source}>
          Fit (preview)
        </button>
        <button className="btn small primary" onClick={commit} disabled={!def || !source}>
          {existingFit ? "Update fit on graph" : "Add fit to graph"}
        </button>
        <button className="icon-btn" title="Close" onClick={close}>
          <Icon name="close" size={14} />
        </button>
      </div>
      {candidates.length === 0 ? (
        <div className="hint" style={{ padding: 12 }}>
          This layer has no XY data plots to fit.
        </div>
      ) : (
        <div className="panel-body">
          <div>
            <Row label="Data">
              <SelectField value={srcId} options={candidates.map((p) => ({ value: p.id, label: p.name }))} onChange={setSrcId} />
            </Row>
            <Row label="Function">
              <SelectField value={functionId} options={FUNCTION_OPTIONS} onChange={setFunctionId} />
            </Row>
            {functionId === "custom" ? (
              <Row label="y =">
                <TextField value={expression} onCommit={setExpression} mono placeholder="a*exp(-x/t) + y0" />
              </Row>
            ) : (
              <div className="mono hint" style={{ margin: "2px 0 6px 88px", color: "var(--text-2)" }}>
                y = {def?.expression}
              </div>
            )}
            {defError && <div style={{ color: "var(--danger)", fontSize: 11.5, marginLeft: 88 }}>{defError}</div>}
            <Row label="">
              <CheckField label="Restrict x range" checked={useRange} onChange={setUseRange} />
              <button className={"btn small" + (picking ? " primary" : "")} onClick={pickRange} title="Drag across the graph to choose the range">
                {picking ? "Drag on the graph…" : "Pick on graph"}
              </button>
            </Row>
            <Row label="From · To">
              <NumberField value={rangeFrom} disabled={!useRange} placeholder={dataRange ? f(dataRange[0]) : ""} onCommit={setRangeFrom} />
              <NumberField value={rangeTo} disabled={!useRange} placeholder={dataRange ? f(dataRange[1]) : ""} onCommit={setRangeTo} />
            </Row>
            <Row label="">
              <CheckField label="Weight by Y errors (1/σ²)" checked={weighted} disabled={!hasErr} onChange={setWeighted} />
            </Row>
            <Row label="">
              <CheckField label="Draw 95% confidence band" checked={showBand} onChange={setShowBand} />
            </Row>
            <Row label="">
              <CheckField label="Draw 95% prediction band" checked={showPredBand} onChange={setShowPredBand} />
            </Row>
          </div>
          <div>
            <table className="preview-table" style={{ marginBottom: 6 }}>
              <thead>
                <tr>
                  <th>Parameter</th>
                  <th>Initial / value</th>
                  <th>Fixed</th>
                  <th>± error</th>
                </tr>
              </thead>
              <tbody>
                {def?.params.map((name, i) => (
                  <tr key={name}>
                    <td className="mono">{name}</td>
                    <td style={{ padding: 1 }}>
                      <NumberField value={guess[i] ?? 1} onCommit={(v) => setGuess(guess.map((g, j) => (j === i ? v : g)))} />
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <input type="checkbox" checked={fixed[i] ?? false} onChange={(e) => setFixed(fixed.map((fx, j) => (j === i ? e.target.checked : fx)))} />
                    </td>
                    <td className="mono" style={{ color: "var(--text-2)" }}>
                      {outcome ? f(outcome.result.errors[i]) : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {outcome && (
              <div style={{ fontSize: 12, display: "grid", gridTemplateColumns: "auto 1fr auto 1fr", gap: "1px 10px", fontVariantNumeric: "tabular-nums" }}>
                <span style={{ color: "var(--text-2)" }}>R²</span>
                <span>{f(outcome.result.rSquared)}</span>
                <span style={{ color: "var(--text-2)" }}>Adj. R²</span>
                <span>{f(outcome.result.adjRSquared)}</span>
                <span style={{ color: "var(--text-2)" }}>Reduced χ²</span>
                <span>{f(outcome.result.reducedChi2)}</span>
                <span style={{ color: "var(--text-2)" }}>N · DOF</span>
                <span>
                  {outcome.result.n} · {outcome.result.dof}
                </span>
                {outcome.result.message && <span style={{ gridColumn: "1 / -1", color: "var(--danger)" }}>{outcome.result.message}</span>}
              </div>
            )}
            {error && <div style={{ color: "var(--danger)", fontSize: 11.5 }}>{error}</div>}
            {!outcome && !error && <div className="hint">Press Fit (preview) to see parameters before adding the curve. Initial values come from the data.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
