import { useMemo, useState } from "react";
import { Dialog } from "../ui/Dialog";
import { CheckField, NumberField, Row, Segmented, SelectField } from "../ui/Fields";
import { useDialogs } from "../app/dialogs";
import { oneUndoStep, useStore } from "../model/store";
import { newColumn, uid, uniqueName } from "../model/defaults";
import type { Column, PlotSource, PlotType, Project, Sheet } from "../model/types";
import { getPlotData } from "../graph/data";
import { ecdf } from "./compare";
import { averageCurves, fftSpectrum } from "./signal";
import { curvesForAnalysis, dataCurves, useOfOp, type GraphCurve } from "./graphCurves";
import { ANALYSIS_LABELS, DEFAULT_OPTIONS, MATH_SIGN, OptionFields, RESULT_SUFFIX, analysisInfo, applyCurveOp, curveMath, freqUnits, isCurveOp, mathName, mathUnits, resultUnits, type AnalysisOp, type AnalysisOptions, type MathOp } from "./ops";
import { averageNames, sameNumbers } from "./results";

/** An Analysis command started from a graph: which one, and the plots that were selected when it was chosen. */
export interface CurveAnalysisInit {
  op: Exclude<AnalysisOp, "fill">;
  graphId: string;
  plotIds: string[];
}

type AddMean = "sd" | "sem" | "mean" | "none";
/** Where a result with axes of its own (a spectrum, a cumulative distribution) is drawn. */
type Place = "panel" | "figure" | "none";

const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : NaN);
const r6 = (v: number) => (Number.isFinite(v) ? Number(v.toPrecision(10)) : null);
const mk = (name: string, units: string, d: Column["designation"], values: Column["values"]): Column => {
  const c = newColumn(d);
  c.longName = name;
  c.units = units;
  c.values = values;
  return c;
};
const titled = (name: string, units: string) => (units ? `${name} (${units})` : name);

/** The sheet columns a curve reads, row for row (missing cells are NaN; a curve without an X column counts its rows). */
function curveColumns(project: Project, c: GraphCurve) {
  const sheet = project.sheets.find((s) => s.id === c.plot.source.sheetId);
  const yc = sheet?.columns.find((col) => col.id === c.plot.source.yColId);
  const xc = sheet?.columns.find((col) => col.id === c.plot.source.xColId);
  const y = (yc?.values ?? []).map(num);
  const x = xc ? xc.values.map(num) : y.map((_, k) => k + 1);
  return { sheet, xc, yc, x, y, xKey: `${sheet?.id}:${xc?.id ?? ""}` };
}

/**
 * An Analysis command on the plots of a graph: the selected ones are ticked, and they may read different sheets
 * and sit in different panels. Each one is computed from its own columns. The results become new columns in the
 * sheet the data came from (or a new sheet, on request) and are drawn on the figure, which stays in front.
 * (From a sheet the same commands run on columns: AnalysisDialog.)
 */
export function CurveAnalysisDialog({ op, graphId, plotIds }: CurveAnalysisInit) {
  const close = () => useDialogs.getState().setCurveAnalysis(null);
  const project = useStore((s) => s.project);
  const graph = project.graphs.find((g) => g.id === graphId);
  const use = useOfOp(op);
  const curves = useMemo(() => (graph ? dataCurves(project, graph, use) : []), [project, graph, use]);
  // the second curve of curve math may also be a fitted curve (a baseline to subtract)
  const others = useMemo(() => (graph && op === "math" ? dataCurves(project, graph, "average") : curves), [project, graph, op, curves]);

  const initial = useMemo(() => {
    if (!graph) return { picked: [] as string[], other: "" };
    const sel = useStore.getState().ui.selection;
    const start = curvesForAnalysis(project, graph, plotIds, "layerId" in sel ? sel.layerId : undefined, use).map((c) => c.plot.id);
    // curve math with two curves selected: the first one, with the second
    const second = op === "math" ? plotIds.find((id) => id !== start[0] && others.some((c) => c.plot.id === id)) : undefined;
    if (second) return { picked: start.filter((id) => id !== second), other: second };
    return { picked: start, other: (others.find((c) => !start.includes(c.plot.id)) ?? others[0])?.plot.id ?? "" };
    // the starting state only: later changes of the project do not re-tick the list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [picked, setPicked] = useState<string[]>(initial.picked);
  const [o, setO] = useState<AnalysisOptions>(() => ({ ...DEFAULT_OPTIONS, mathWith: op === "math" && plotIds.length > 1 && initial.other && plotIds.includes(initial.other) ? "curve" : "number" }));
  const [target, setTarget] = useState<string>(initial.other);
  const [output, setOutput] = useState<"columns" | "sheet">("columns");
  const [toGraph, setToGraph] = useState(true);
  const [addMean, setAddMean] = useState<AddMean>("sd");
  const [place, setPlace] = useState<Place>("panel");
  const [error, setError] = useState<string | null>(null);

  if (!graph) return null;
  const manyPanels = new Set(curves.map((c) => c.layer.id)).size > 1;
  const label = (c: GraphCurve) => `${c.plot.name}${manyPanels ? ` — ${c.layer.name}` : ""}`;

  const run = () => {
    setError(null);
    const st = useStore.getState();
    const p = st.project;
    const chosen = curves.filter((c) => picked.includes(c.plot.id));
    const sheetName = (what: string) => uniqueName(`${what} of ${graph.name}`, p.sheets.map((s) => s.name));
    const toast = (msg: string) => useDialogs.getState().showToast(msg);
    // read when the message is made: the sheet may be one this command has just added
    const quoted = (ids: Iterable<string>) => [...new Set(ids)].map((id) => `“${useStore.getState().project.sheets.find((s) => s.id === id)?.name ?? "?"}”`).join(", ");
    const n = chosen.length;
    if (!n) return setError(use === "values" ? "Tick at least one plot." : "Tick at least one curve.");

    if (op === "average") {
      if (n < 2) return setError("Tick at least two curves.");
      const a = averageCurves(chosen.map((c) => getPlotData(p, c.plot)), o.grid, o.points, o.overlapOnly);
      if (!a.x.length) return setError(o.overlapOnly ? "The ticked curves do not overlap in x." : "The ticked curves hold no data.");
      // names and units follow the columns of the first curve that reads a sheet; its sheet takes the result
      const first = curveColumns(p, chosen.find((c) => c.plot.type !== "fitCurve") ?? chosen[0]);
      const yUnits = first.yc?.units ?? "";
      const of = averageNames(chosen.map((c) => c.plot.name));
      const xName = first.xc?.longName || "X";
      const beside = output === "columns" && !!first.sheet;
      // the first curve's own X column serves when the mean sits on exactly its values
      const reuseX = beside && first.xc && sameNumbers(first.xc.values, a.x) ? first.xc : null;
      const x = reuseX ?? mk(beside ? `${xName} (grid of the mean)` : xName, first.xc?.units ?? "", "X", a.x.map(r6));
      const mean = mk(`Mean of ${of}`, yUnits, "Y", a.mean.map(r6));
      const sd = mk(`SD of ${of}`, yUnits, "yErr", a.sd.map(r6));
      const sem = mk(`SEM of ${of}`, yUnits, "none", a.sem.map(r6));
      const cols = [...(reuseX ? [] : [x]), mean, sd, sem, mk(`N of ${of}`, "", "none", a.n)];
      oneUndoStep(() => {
        let sheetId: string;
        if (beside) {
          sheetId = first.sheet!.id;
          st.appendColumns(sheetId, cols);
        } else {
          const sheet: Sheet = { id: uid(), name: sheetName("Average"), columns: cols };
          sheetId = sheet.id;
          st.addSheetObject(sheet);
        }
        // the mean joins the panel of the first ticked curve; adding a plot brings the graph back to the front
        if (addMean !== "none")
          st.addPlot(graphId, chosen[0].layer.id, "line", { sheetId, xColId: x.id, yColId: mean.id, yErrColId: addMean === "sd" ? sd.id : addMean === "sem" ? sem.id : null }, `Mean of ${of}`, (pl) => {
            if (addMean !== "mean") pl.errorBars = { ...pl.errorBars, show: true, style: "band" };
          });
        toast(`Mean of ${n} curves: new columns in ${quoted([sheetId])}`);
      });
      return close();
    }

    if (op === "fft" || op === "cdf") {
      // per plot: the new columns, the sheet they belong to, and what is drawn of them
      const made: { sheetId: string; cols: Column[]; x: Column; y: Column; name: string; xTitle: string; yTitle: string }[] = [];
      const freqOf = new Map<string, Column>();
      for (const c of chosen) {
        const { sheet, xc, yc, y, xKey } = curveColumns(p, c);
        if (!sheet) continue;
        if (op === "fft") {
          const d = getPlotData(p, c.plot);
          if (d.x.length < 2) continue;
          const s = fftSpectrum(d.x, d.y, o.fftWindow);
          // curves drawn against the same X column share one frequency column
          let freq = freqOf.get(xKey);
          const cols: Column[] = [];
          if (!freq) {
            freq = mk(xc?.longName ? `Frequency (from ${xc.longName})` : "Frequency", freqUnits(xc?.units), "X", s.freq.map(r6));
            freqOf.set(xKey, freq);
            cols.push(freq);
          }
          const amp = mk(`${c.plot.name} (FFT amplitude)`, yc?.units ?? "", "Y", s.amplitude.map(r6));
          cols.push(amp, mk(`${c.plot.name} (FFT power)`, "", "Y", s.power.map(r6)));
          made.push({ sheetId: sheet.id, cols, x: freq, y: amp, name: `${c.plot.name} (FFT amplitude)`, xTitle: titled("Frequency", freq.units), yTitle: titled("Amplitude", amp.units) });
        } else {
          const e = ecdf(y.filter(Number.isFinite));
          if (!e.n) continue;
          const xs = mk(`${c.plot.name} (sorted)`, yc?.units ?? "", "X", e.x.map(r6));
          const frac = mk(`${c.plot.name} (cumulative fraction)`, "", "Y", e.count.map((k) => r6(k / e.n)));
          made.push({ sheetId: sheet.id, cols: [xs, frac], x: xs, y: frac, name: c.plot.name, xTitle: titled(n === 1 ? yc?.longName || c.plot.name : "Value", yc?.units ?? ""), yTitle: "Cumulative fraction" });
        }
      }
      if (!made.length) return setError("The ticked plots hold no data.");
      const what = op === "fft" ? "FFT" : "CDF";
      oneUndoStep(() => {
        const newSheet: Sheet | null = output === "sheet" ? { id: uid(), name: sheetName(what), columns: made.flatMap((m) => m.cols) } : null;
        if (newSheet) {
          st.addSheetObject(newSheet);
          for (const m of made) m.sheetId = newSheet.id;
        } else {
          const bySheet = new Map<string, Column[]>();
          for (const m of made) bySheet.set(m.sheetId, [...(bySheet.get(m.sheetId) ?? []), ...m.cols]);
          for (const [sheetId, cols] of bySheet) st.appendColumns(sheetId, cols);
        }
        const where = quoted(made.map((m) => m.sheetId));
        if (place === "none") {
          if (!newSheet) toast(`${what}: new columns in ${where}`);
          return;
        }
        // a spectrum or a distribution has axes of its own: a new panel below the others, or a figure of its own
        const g = place === "figure" ? useStore.getState().addGraph(`${what} of ${graph.name}`) : graphId;
        const layerId = place === "figure" ? useStore.getState().project.graphs.find((x) => x.id === g)!.layers[0].id : useStore.getState().addLayer(g);
        for (const m of made)
          useStore.getState().addPlot(g, layerId, "line", { sheetId: m.sheetId, xColId: m.x.id, yColId: m.y.id }, m.name, (pl) => {
            if (op === "cdf") pl.line = { ...pl.line, connect: "stepH" };
          });
        useStore.getState().updateLayer(g, layerId, (l) => {
          l.axes.x.title = made[0].xTitle;
          l.axes.y.title = made[0].yTitle;
          if (place === "panel") l.name = uniqueName(op === "fft" ? "Spectrum" : "CDF", graph.layers.map((x) => x.name));
        });
        useStore.getState().setSelection({ kind: "layer", graphId: g, layerId });
        toast(`${what} drawn in ${place === "panel" ? "a new panel" : "a new figure"}; the columns are in ${where}`);
      });
      return close();
    }

    if (!isCurveOp(op) && op !== "math") return;
    const onto = op === "interpolate" ? curves.find((c) => c.plot.id === target) : undefined;
    if (op === "interpolate" && !onto) return setError("Choose the curve whose x values to interpolate onto.");
    const ontoCols = onto ? curveColumns(p, onto) : undefined;
    const withCurve = op === "math" && o.mathWith === "curve" ? others.find((c) => c.plot.id === target) : undefined;
    if (op === "math" && o.mathWith === "curve") {
      if (!withCurve) return setError("Choose the other curve.");
      if (chosen.some((c) => c.plot.id === withCurve.plot.id)) return setError(`“${withCurve.plot.name}” is the other curve: untick it in the list.`);
    }
    if (op === "math" && o.mathWith === "number" && !Number.isFinite(o.mathValue)) return setError("Type the number.");
    if (op === "math" && o.mathWith === "number" && o.mathOp === "div" && o.mathValue === 0) return setError("Dividing by zero leaves no values.");
    const withData = withCurve ? getPlotData(p, withCurve.plot) : undefined;
    const withUnits = withCurve ? (curveColumns(p, withCurve).yc?.units ?? "") : null;

    // one result per curve, with the sheet and X column it lines up with row for row
    const results = chosen.map((c) => {
      const src = curveColumns(p, c);
      const home = ontoCols ?? src;
      const yUnits = src.yc?.units ?? "";
      const col =
        op === "math"
          ? mk(mathName(c.plot.name, o.mathOp, withCurve ? withCurve.plot.name : o.mathValue), mathUnits(o.mathOp, yUnits, withUnits), "Y", curveMath(src.x, src.y, o.mathOp, withData ?? o.mathValue).map(r6))
          : mk(`${c.plot.name} (${RESULT_SUFFIX[op]})`, resultUnits(op, yUnits, src.xc?.units), "Y", applyCurveOp(op, src.x, src.y, o, ontoCols?.x).map(r6));
      return { c, col, home };
    });
    if (results.every((r) => r.col.values.every((v) => v === null))) return setError(withCurve ? "The curves do not overlap in x: nothing to compute." : "The ticked curves hold no data.");

    oneUndoStep(() => {
      const sources: PlotSource[] = [];
      let newSheet: Sheet | null = null;
      if (output === "sheet") {
        // a new sheet: each X column once, followed by the results that go with it
        const cols: Column[] = [];
        const xOf = new Map<string, Column>();
        for (const r of results) {
          let x = xOf.get(r.home.xKey);
          if (!x) {
            x = r.home.xc ? mk(r.home.xc.longName || "X", r.home.xc.units, "X", [...r.home.xc.values]) : mk("Row", "", "X", r.home.x);
            xOf.set(r.home.xKey, x);
            cols.push(x);
          }
          cols.push(r.col);
          sources.push({ sheetId: "", xColId: x.id, yColId: r.col.id });
        }
        newSheet = { id: uid(), name: sheetName(ANALYSIS_LABELS[op]), columns: cols };
        for (const s of sources) s.sheetId = newSheet.id;
        st.addSheetObject(newSheet);
      } else {
        // beside the data: each result goes to the sheet whose rows it follows
        const bySheet = new Map<string, Column[]>();
        for (const r of results) {
          if (!r.home.sheet) continue;
          bySheet.set(r.home.sheet.id, [...(bySheet.get(r.home.sheet.id) ?? []), r.col]);
          sources.push({ sheetId: r.home.sheet.id, xColId: r.home.xc?.id ?? null, yColId: r.col.id });
        }
        for (const [sheetId, cols] of bySheet) st.appendColumns(sheetId, cols);
      }
      if (toGraph) {
        // each result joins the panel of its curve; adding a plot brings the graph back to the front
        const typeOf = (t: PlotType): PlotType => (op === "normalize" || op === "math" ? t : "line");
        results.forEach((r, k) => sources[k] && st.addPlot(graphId, r.c.layer.id, typeOf(r.c.plot.type), sources[k], r.col.longName));
        if (!newSheet) toast(`${n === 1 ? `“${results[0].col.longName}”` : `${n} curves`} added to the graph; the ${n === 1 ? "column is" : "columns are"} in ${quoted(sources.map((s) => s.sheetId))}`);
      } else if (!newSheet) {
        toast(`${n} ${n === 1 ? "column" : "columns"} added to ${quoted(sources.map((s) => s.sheetId))}`);
      }
    });
    close();
  };

  const ownAxes = op === "fft" || op === "cdf";
  return (
    <Dialog
      title={ANALYSIS_LABELS[op]}
      info={analysisInfo(op, true)}
      onClose={close}
      width={660}
      actions={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" onClick={run}>
            Run
          </button>
        </>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "230px minmax(0, 1fr)", gap: "0 20px" }}>
        <div>
          <div className="group-title">{use === "values" ? "Plots" : "Curves"} of “{graph.name}”</div>
          <div style={{ border: "1px solid var(--border)", borderRadius: 3, padding: 4, maxHeight: 220, overflow: "auto", marginBottom: 8 }}>
            {curves.map((c) => (
              <label key={c.plot.id} className="check" style={{ padding: "2px 4px" }}>
                <input type="checkbox" checked={picked.includes(c.plot.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, c.plot.id] : picked.filter((k) => k !== c.plot.id))} />
                <span style={{ width: 9, height: 9, borderRadius: 2, background: c.plot.color, flex: "none" }} />
                <span>{label(c)}</span>
              </label>
            ))}
            {!curves.length && <div className="note">This graph has no {use === "values" ? "plots" : "curves"} that read sheet columns.</div>}
          </div>
        </div>
        <div>
          <OptionFields op={op} o={o} set={(patch) => setO((cur) => ({ ...cur, ...patch }))} />
          {op === "math" && (
            <>
              <Row label="Operation" title="What is done to every y value of each ticked curve">
                <Segmented<MathOp> value={o.mathOp} options={(["add", "sub", "mul", "div"] as const).map((m) => ({ value: m, label: MATH_SIGN[m] }))} onChange={(mathOp) => setO((cur) => ({ ...cur, mathOp }))} />
              </Row>
              <Row label="With">
                <Segmented value={o.mathWith} options={[{ value: "number", label: "A number" }, { value: "curve", label: "Another curve" }]} onChange={(mathWith) => setO((cur) => ({ ...cur, mathWith }))} />
              </Row>
              {o.mathWith === "number" ? (
                <Row label="Number">
                  <NumberField value={o.mathValue} onCommit={(mathValue) => setO((cur) => ({ ...cur, mathValue }))} style={{ width: 90 }} />
                </Row>
              ) : (
                <Row label="Curve" title="Read at the x values of each ticked curve (linear interpolation). A fitted curve can be chosen, for example a baseline.">
                  <SelectField value={target} options={others.map((c) => ({ value: c.plot.id, label: label(c) }))} onChange={setTarget} />
                </Row>
              )}
            </>
          )}
          {op === "interpolate" && (
            <Row label="Onto the x of" title="The ticked curves are evaluated at the x values of this curve">
              <SelectField value={target} options={curves.map((c) => ({ value: c.plot.id, label: label(c) }))} onChange={setTarget} />
            </Row>
          )}
          <Row label="Result" title="Beside the data: new columns in the sheet the data came from, named after the curve. New sheet: a sheet of its own.">
            <Segmented value={output} options={[{ value: "columns", label: "Beside the data" }, { value: "sheet", label: "New sheet" }]} onChange={setOutput} />
          </Row>
          {op === "average" && (
            <Row label="On the graph">
              <SelectField<AddMean>
                value={addMean}
                options={[
                  { value: "sd", label: "Mean with SD band" },
                  { value: "sem", label: "Mean with SEM band" },
                  { value: "mean", label: "Mean only" },
                  { value: "none", label: "Nothing (columns only)" },
                ]}
                onChange={setAddMean}
              />
            </Row>
          )}
          {ownAxes && (
            <Row label="On the graph" title={op === "fft" ? "A spectrum has a frequency axis, so it cannot share the panel of its curve." : "A cumulative distribution has axes of its own, so it cannot share the panel of its plot."}>
              <SelectField<Place>
                value={place}
                options={[
                  { value: "panel", label: "A new panel of this figure" },
                  { value: "figure", label: "A new figure" },
                  { value: "none", label: "Nothing (columns only)" },
                ]}
                onChange={setPlace}
              />
            </Row>
          )}
          {(isCurveOp(op) || op === "math") && (
            <Row label="">
              <CheckField label="Add the result to the graph" checked={toGraph} onChange={setToGraph} />
            </Row>
          )}
          {error && <div style={{ color: "var(--danger)", fontSize: 11.5 }}>{error}</div>}
        </div>
      </div>
    </Dialog>
  );
}
