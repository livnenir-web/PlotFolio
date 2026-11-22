import { useMemo, useState } from "react";
import { Dialog } from "../ui/Dialog";
import { NumberField, Row, Segmented, SelectField } from "../ui/Fields";
import { useDialogs } from "../app/dialogs";
import { useStore } from "../model/store";
import { columnLetter, newColumn, uid, uniqueName } from "../model/defaults";
import type { Column, Sheet } from "../model/types";
import { sheetSelectionRef, DESIGNATION_LABEL } from "../sheet/SheetView";
import { ecdf } from "./compare";
import { averageCurves, fftSpectrum, fillValues, type FillMode } from "./signal";
import { averageNames, sameNumbers } from "./results";
import { ANALYSIS_LABELS, DEFAULT_OPTIONS, OptionFields, RESULT_SUFFIX, analysisInfo, applyCurveOp, freqUnits, isCurveOp, resultUnits, type AnalysisOp, type AnalysisOptions } from "./ops";

export { ANALYSIS_LABELS, freqUnits, type AnalysisOp } from "./ops";

const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : NaN);

function colLabel(sheet: Sheet, i: number): string {
  const c = sheet.columns[i];
  const d = DESIGNATION_LABEL[c.designation];
  return `${columnLetter(i)}${d ? ` (${d})` : ""}${c.longName ? ` — ${c.longName}` : ""}`;
}

/** X column for a Y column: the nearest X-designated column to its left (Origin convention). */
function xFor(sheet: Sheet, yIdx: number): number {
  for (let i = yIdx; i >= 0; i--) if (sheet.columns[i].designation === "X") return i;
  return sheet.columns.findIndex((c) => c.designation === "X");
}

/** An Analysis command on the columns of a sheet. (From a graph the same commands run on curves: CurveAnalysisDialog.) */
export function AnalysisDialog({ op, sheetId }: { op: Exclude<AnalysisOp, "math">; sheetId: string }) {
  const close = () => useDialogs.getState().setAnalysis(null);
  const sheet = useStore((s) => s.project.sheets.find((x) => x.id === sheetId));
  const selectedCols = sheetSelectionRef.sheetId === sheetId ? sheetSelectionRef.cols : [];

  const initialY = useMemo(() => {
    if (!sheet) return [];
    const sel = selectedCols.filter((i) => sheet.columns[i] && sheet.columns[i].designation !== "X" && sheet.columns[i].designation !== "label");
    if (sel.length) return sel;
    return sheet.columns.map((c, i) => (c.designation === "Y" ? i : -1)).filter((i) => i >= 0);
  }, [sheet, selectedCols]);

  const [yIdx, setYIdx] = useState<number[]>(initialY);
  const [o, setO] = useState<AnalysisOptions>(DEFAULT_OPTIONS);
  const [targetX, setTargetX] = useState<number>(() => (sheet ? Math.max(0, sheet.columns.findIndex((c) => c.designation === "X")) : 0));
  const [fillMode, setFillMode] = useState<FillMode>("rowNumbers");
  const [fillA, setFillA] = useState(0);
  const [fillB, setFillB] = useState(1);
  const [fillN, setFillN] = useState(100);
  const [output, setOutput] = useState<"columns" | "sheet">("columns");
  const [error, setError] = useState<string | null>(null);

  if (!sheet) return null;
  const st = useStore.getState();

  const mk = (name: string, units: string, d: Column["designation"], values: Column["values"]): Column => {
    const c = newColumn(d);
    c.longName = name;
    c.units = units;
    c.values = values;
    return c;
  };
  const r6 = (v: number) => (Number.isFinite(v) ? Number(v.toPrecision(10)) : null);
  const ys = (i: number) => sheet.columns[i].values.map(num);
  const xs = (i: number) => (i >= 0 ? sheet.columns[i].values.map(num) : sheet.columns[0].values.map((_, k) => k + 1));

  const run = () => {
    setError(null);
    try {
      const newCols: Column[] = [];
      let newSheet: Sheet | null = null;
      if (op === "fill") {
        const targets = yIdx.length ? yIdx : [sheet.columns.length];
        for (const t of targets) {
          st.ensureColumns(sheet.id, t + 1);
          const col = useStore.getState().project.sheets.find((s) => s.id === sheet.id)!.columns[t];
          st.updateColumn(sheet.id, col.id, { formula: undefined });
          st.setCells(sheet.id, fillValues(fillMode, Math.max(1, Math.round(fillN)), fillA, fillB).map((v, row) => ({ col: t, row, value: r6(v) })));
        }
        close();
        return;
      }
      if (!yIdx.length) throw new Error("Select at least one Y column");
      const nameOf = (i: number) => sheet.columns[i].longName || columnLetter(i);
      const sheetNamed = (what: string) => uniqueName(`${what} of ${sheet.name}`, st.project.sheets.map((s) => s.name));
      if (op === "average") {
        const curves = yIdx.map((i) => ({ x: xs(xFor(sheet, i)), y: ys(i) }));
        const a = averageCurves(curves, o.grid, o.points, o.overlapOnly);
        const xc = sheet.columns[xFor(sheet, yIdx[0])];
        const units = sheet.columns[yIdx[0]].units;
        const of = averageNames(yIdx.map(nameOf));
        // beside the data, the sheet's own X column serves when the mean sits on exactly its values
        const ownX = output === "columns" && xc && sameNumbers(xc.values, a.x);
        const cols = [
          ...(ownX ? [] : [mk(output === "columns" ? `${xc?.longName || "X"} (grid of the mean)` : xc?.longName || "X", xc?.units ?? "", "X", a.x.map(r6))]),
          mk(`Mean of ${of}`, units, "Y", a.mean.map(r6)),
          mk(`SD of ${of}`, units, "yErr", a.sd.map(r6)),
          mk(`SEM of ${of}`, units, "none", a.sem.map(r6)),
          mk(`N of ${of}`, "", "none", a.n),
        ];
        if (output === "sheet") newSheet = { id: uid(), name: sheetNamed("Average"), columns: cols };
        else newCols.push(...cols);
      } else if (op === "fft") {
        const cols: Column[] = [];
        const freqOf = new Set<number>();
        for (const i of yIdx) {
          const xi = xFor(sheet, i);
          const s = fftSpectrum(xs(xi), ys(i), o.fftWindow);
          const xc = sheet.columns[xi];
          // columns measured against the same X column share one frequency column
          if (!freqOf.has(xi)) {
            cols.push(mk(xc?.longName ? `Frequency (from ${xc.longName})` : "Frequency", freqUnits(xc?.units), "X", s.freq.map(r6)));
            freqOf.add(xi);
          }
          cols.push(mk(`${nameOf(i)} (FFT amplitude)`, sheet.columns[i].units, "Y", s.amplitude.map(r6)));
          cols.push(mk(`${nameOf(i)} (FFT power)`, "", "Y", s.power.map(r6)));
        }
        if (output === "sheet") newSheet = { id: uid(), name: sheetNamed("FFT"), columns: cols };
        else newCols.push(...cols);
      } else if (op === "cdf") {
        // per column: its distinct values in rising order and the fraction of values up to each of them
        const cols: Column[] = [];
        for (const i of yIdx) {
          const e = ecdf(ys(i));
          if (!e.n) continue;
          cols.push(mk(`${nameOf(i)} (sorted)`, sheet.columns[i].units, "X", e.x.map(r6)));
          cols.push(mk(`${nameOf(i)} (cumulative fraction)`, "", "Y", e.count.map((c) => r6(c / e.n))));
        }
        if (!cols.length) throw new Error("The selected columns hold no numbers");
        if (output === "sheet") newSheet = { id: uid(), name: sheetNamed("CDF"), columns: cols };
        else newCols.push(...cols);
      } else if (isCurveOp(op)) {
        for (const i of yIdx) {
          const col = sheet.columns[i];
          const v = applyCurveOp(op, xs(xFor(sheet, i)), ys(i), o, xs(targetX));
          newCols.push(mk(`${nameOf(i)} (${RESULT_SUFFIX[op]})`, resultUnits(op, col.units, sheet.columns[xFor(sheet, i)]?.units), "Y", v.map(r6)));
        }
        if (output === "sheet") {
          const xi = xFor(sheet, yIdx[0]);
          const xc = op === "interpolate" ? sheet.columns[targetX] : sheet.columns[xi];
          const xcol = xc ? mk(xc.longName || "X", xc.units, "X", [...xc.values]) : mk("Row", "", "X", newCols[0].values.map((_, k) => k + 1));
          newSheet = { id: uid(), name: sheetNamed(ANALYSIS_LABELS[op]), columns: [xcol, ...newCols] };
        }
      }
      if (newSheet) st.addSheetObject(newSheet);
      else if (newCols.length) st.appendColumns(sheet.id, newCols);
      close();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Dialog
      title={ANALYSIS_LABELS[op]}
      info={analysisInfo(op, false)}
      onClose={close}
      width={680}
      actions={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" onClick={run}>
            {op === "fill" ? "Fill" : "Run"}
          </button>
        </>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "270px minmax(0, 1fr)", gap: "0 20px" }}>
        <div>
          <div className="group-title">{op === "fill" ? "Target column(s)" : op === "average" ? "Curves (Y columns; X is the nearest X column to the left)" : op === "cdf" ? "Data columns" : "Y columns"}</div>
          <div style={{ border: "1px solid var(--border)", borderRadius: 3, padding: 4, maxHeight: 220, overflow: "auto", marginBottom: 8 }}>
            {sheet.columns.map((c, i) => (
              <label key={c.id} className="check" style={{ padding: "2px 4px" }}>
                <input type="checkbox" checked={yIdx.includes(i)} onChange={(e) => setYIdx(e.target.checked ? [...yIdx, i].sort((a, b) => a - b) : yIdx.filter((k) => k !== i))} />
                <span>{colLabel(sheet, i)}</span>
              </label>
            ))}
            {op === "fill" && <div className="note">Nothing selected: a new column is added.</div>}
          </div>
        </div>
        <div>
          <OptionFields op={op} o={o} set={(patch) => setO((cur) => ({ ...cur, ...patch }))} />
          {op === "interpolate" && (
            <Row label="Target X">
              <SelectField value={String(targetX)} options={sheet.columns.map((_, i) => ({ value: String(i), label: colLabel(sheet, i) }))} onChange={(v) => setTargetX(Number(v))} />
            </Row>
          )}
          {op === "fill" && (
            <>
              <Row label="Fill with">
                <SelectField<FillMode>
                  value={fillMode}
                  options={[
                    { value: "rowNumbers", label: "Row numbers" },
                    { value: "series", label: "Arithmetic series" },
                    { value: "uniform", label: "Uniform random" },
                    { value: "normal", label: "Normal random" },
                  ]}
                  onChange={setFillMode}
                />
              </Row>
              {fillMode !== "rowNumbers" && (
                <Row label={fillMode === "series" ? "Start · step" : fillMode === "uniform" ? "Min · max" : "Mean · SD"}>
                  <NumberField value={fillA} onCommit={setFillA} />
                  <NumberField value={fillB} onCommit={setFillB} />
                </Row>
              )}
              <Row label="Rows">
                <NumberField value={fillN} step={10} min={1} onCommit={(v) => setFillN(Math.round(v))} style={{ width: 80 }} />
              </Row>
            </>
          )}
          {op !== "fill" && (
            <Row label="Result" title="New columns here: at the end of this sheet, named after the columns they come from. New sheet: a sheet of its own.">
              <Segmented value={output} options={[{ value: "columns", label: "New columns here" }, { value: "sheet", label: "New sheet" }]} onChange={setOutput} />
            </Row>
          )}
          {error && <div style={{ color: "var(--danger)", fontSize: 11.5 }}>{error}</div>}
        </div>
      </div>
    </Dialog>
  );
}
