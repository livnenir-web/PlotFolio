import { useMemo, useState } from "react";
import { Dialog } from "../ui/Dialog";
import { CheckField, NumberField, Row, Segmented, SelectField } from "../ui/Fields";
import { useDialogs } from "../app/dialogs";
import { useStore } from "../model/store";
import { columnLetter, newColumn, uid, uniqueName } from "../model/defaults";
import type { Column, Sheet } from "../model/types";
import { sheetSelectionRef, DESIGNATION_LABEL } from "../sheet/SheetView";
import { averageCurves, derivative, fftSpectrum, fillValues, integrate, interpolate, movingAverage, normalize, savitzkyGolay, type FillMode, type NormalizeMode } from "./signal";

export type AnalysisOp = "smooth" | "derivative" | "integrate" | "normalize" | "fft" | "average" | "interpolate" | "fill";

export const ANALYSIS_LABELS: Record<AnalysisOp, string> = {
  smooth: "Smooth",
  derivative: "Differentiate",
  integrate: "Integrate",
  normalize: "Normalize",
  fft: "FFT",
  average: "Average curves",
  interpolate: "Interpolate onto X",
  fill: "Fill column with…",
};

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

export function AnalysisDialog({ op, sheetId }: { op: AnalysisOp; sheetId: string }) {
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
  const [window, setWindow] = useState(5);
  const [method, setMethod] = useState<"moving" | "sg">("sg");
  const [order, setOrder] = useState(2);
  const [normMode, setNormMode] = useState<NormalizeMode>("max");
  const [fftWindow, setFftWindow] = useState<"none" | "hann">("none");
  const [grid, setGrid] = useState<"union" | "first" | "uniform">("union");
  const [points, setPoints] = useState(200);
  const [overlapOnly, setOverlapOnly] = useState(false);
  const [targetX, setTargetX] = useState<number>(() => (sheet ? Math.max(0, sheet.columns.findIndex((c) => c.designation === "X")) : 0));
  const [fillMode, setFillMode] = useState<FillMode>("rowNumbers");
  const [fillA, setFillA] = useState(0);
  const [fillB, setFillB] = useState(1);
  const [fillN, setFillN] = useState(100);
  const [output, setOutput] = useState<"columns" | "sheet">(op === "fft" || op === "average" ? "sheet" : "columns");
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
      const suffix: Record<string, string> = { smooth: "smoothed", derivative: "d/dx", integrate: "integral", normalize: "normalized", interpolate: "interp" };
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
      if (op === "average") {
        const curves = yIdx.map((i) => ({ x: xs(xFor(sheet, i)), y: ys(i) }));
        const a = averageCurves(curves, grid, points, overlapOnly);
        const xc = sheet.columns[xFor(sheet, yIdx[0])];
        newSheet = {
          id: uid(),
          name: uniqueName(`Average of ${sheet.name}`, st.project.sheets.map((s) => s.name)),
          columns: [
            mk(xc?.longName || "X", xc?.units ?? "", "X", a.x.map(r6)),
            mk("Mean", sheet.columns[yIdx[0]].units, "Y", a.mean.map(r6)),
            mk("SD", sheet.columns[yIdx[0]].units, "yErr", a.sd.map(r6)),
            mk("SEM", sheet.columns[yIdx[0]].units, "none", a.sem.map(r6)),
            mk("N", "", "none", a.n),
          ],
        };
      } else if (op === "fft") {
        const cols: Column[] = [];
        let freqDone = false;
        for (const i of yIdx) {
          const s = fftSpectrum(xs(xFor(sheet, i)), ys(i), fftWindow);
          const xu = sheet.columns[xFor(sheet, i)]?.units;
          if (!freqDone) {
            cols.push(mk("Frequency", xu ? `1/${xu}` : "", "X", s.freq.map(r6)));
            freqDone = true;
          }
          const name = sheet.columns[i].longName || columnLetter(i);
          cols.push(mk(`${name} amplitude`, sheet.columns[i].units, "Y", s.amplitude.map(r6)));
          cols.push(mk(`${name} power`, "", "Y", s.power.map(r6)));
        }
        newSheet = { id: uid(), name: uniqueName(`FFT of ${sheet.name}`, st.project.sheets.map((s) => s.name)), columns: cols };
      } else {
        for (const i of yIdx) {
          const col = sheet.columns[i];
          const x = xs(xFor(sheet, i));
          const y = ys(i);
          let v: number[];
          if (op === "smooth") v = method === "sg" ? savitzkyGolay(y, window, order) : movingAverage(y, window);
          else if (op === "derivative") v = derivative(x, y);
          else if (op === "integrate") v = integrate(x, y);
          else if (op === "normalize") v = normalize(y, normMode);
          else v = interpolate(x, y, xs(targetX));
          const name = `${col.longName || columnLetter(i)} (${suffix[op]})`;
          const units = op === "derivative" ? `${col.units}/${sheet.columns[xFor(sheet, i)]?.units ?? "x"}` : op === "integrate" ? `${col.units}·${sheet.columns[xFor(sheet, i)]?.units ?? "x"}` : op === "normalize" ? "" : col.units;
          newCols.push(mk(name, units, "Y", v.map(r6)));
        }
        if (output === "sheet") {
          const xi = xFor(sheet, yIdx[0]);
          const xc = op === "interpolate" ? sheet.columns[targetX] : sheet.columns[xi];
          const xcol = xc ? mk(xc.longName || "X", xc.units, "X", [...xc.values]) : mk("Row", "", "X", newCols[0].values.map((_, k) => k + 1));
          newSheet = { id: uid(), name: uniqueName(`${ANALYSIS_LABELS[op]} of ${sheet.name}`, st.project.sheets.map((s) => s.name)), columns: [xcol, ...newCols] };
        }
      }
      if (newSheet) st.addSheetObject(newSheet);
      else if (newCols.length) st.appendColumns(sheet.id, newCols);
      close();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const perColumn = op !== "fft" && op !== "average";
  return (
    <Dialog
      title={ANALYSIS_LABELS[op]}
      onClose={close}
      width={560}
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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px" }}>
        <div>
          <div className="group-title">{op === "fill" ? "Target column(s)" : op === "average" ? "Curves (Y columns; X is the nearest X column to the left)" : "Y columns"}</div>
          <div style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 4, maxHeight: 220, overflow: "auto", marginBottom: 8 }}>
            {sheet.columns.map((c, i) => (
              <label key={c.id} className="check" style={{ padding: "2px 4px" }}>
                <input type="checkbox" checked={yIdx.includes(i)} onChange={(e) => setYIdx(e.target.checked ? [...yIdx, i].sort((a, b) => a - b) : yIdx.filter((k) => k !== i))} />
                <span>{colLabel(sheet, i)}</span>
              </label>
            ))}
            {op === "fill" && <div className="hint">Nothing selected: a new column is added.</div>}
          </div>
        </div>
        <div>
          {op === "smooth" && (
            <>
              <Row label="Method">
                <Segmented value={method} options={[{ value: "sg", label: "Savitzky–Golay" }, { value: "moving", label: "Moving average" }]} onChange={setMethod} />
              </Row>
              <Row label="Window (pts)">
                <NumberField value={window} step={2} min={3} onCommit={(v) => setWindow(Math.round(v))} style={{ width: 70 }} />
              </Row>
              {method === "sg" && (
                <Row label="Poly order">
                  <NumberField value={order} step={1} min={1} max={6} onCommit={(v) => setOrder(Math.round(v))} style={{ width: 70 }} />
                </Row>
              )}
            </>
          )}
          {op === "normalize" && (
            <Row label="Divide by">
              <SelectField<NormalizeMode>
                value={normMode}
                options={[
                  { value: "max", label: "Maximum" },
                  { value: "sum", label: "Sum" },
                  { value: "range", label: "Range → 0..1" },
                  { value: "zscore", label: "Z-score (mean 0, SD 1)" },
                  { value: "first", label: "First value" },
                ]}
                onChange={setNormMode}
              />
            </Row>
          )}
          {op === "fft" && (
            <>
              <Row label="Window">
                <Segmented value={fftWindow} options={[{ value: "none", label: "None" }, { value: "hann", label: "Hann" }]} onChange={setFftWindow} />
              </Row>
              <div className="hint">Assumes uniform sampling; the sampling rate is taken from the X column. Output: one-sided amplitude and power spectra in a new sheet.</div>
            </>
          )}
          {op === "average" && (
            <>
              <Row label="Common grid">
                <SelectField
                  value={grid}
                  options={[
                    { value: "union", label: "All x values of all curves" },
                    { value: "first", label: "X of the first curve" },
                    { value: "uniform", label: "Uniform, N points" },
                  ]}
                  onChange={setGrid}
                />
              </Row>
              {grid === "uniform" && (
                <Row label="Points">
                  <NumberField value={points} step={10} min={2} onCommit={(v) => setPoints(Math.round(v))} style={{ width: 70 }} />
                </Row>
              )}
              <Row label="">
                <CheckField label="Only where all curves overlap" checked={overlapOnly} onChange={setOverlapOnly} />
              </Row>
              <div className="hint">Each curve is linearly interpolated onto the common grid; mean, SD, SEM and N per point go to a new sheet.</div>
            </>
          )}
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
          {perColumn && op !== "fill" && (
            <Row label="Output">
              <Segmented value={output} options={[{ value: "columns", label: "New columns here" }, { value: "sheet", label: "New sheet" }]} onChange={setOutput} />
            </Row>
          )}
          {(op === "derivative" || op === "integrate") && <div className="hint">Uses the nearest X column to the left of each Y column; central differences / trapezoid rule.</div>}
          {error && <div style={{ color: "var(--danger)", fontSize: 11.5 }}>{error}</div>}
        </div>
      </div>
    </Dialog>
  );
}
