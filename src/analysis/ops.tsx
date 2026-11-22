import { CheckField, NumberField, Row, Segmented, SelectField } from "../ui/Fields";
import { derivative, integrate, interpolate, movingAverage, normalize, savitzkyGolay, type NormalizeMode } from "./signal";

// What the Analysis commands share whether they start from a sheet (columns) or from a graph (curves): the
// command names, their settings with the fields that edit them, and the per-curve math.

export type AnalysisOp = "smooth" | "derivative" | "integrate" | "normalize" | "fft" | "average" | "interpolate" | "fill" | "cdf" | "math";

export const ANALYSIS_LABELS: Record<AnalysisOp, string> = {
  smooth: "Smooth",
  derivative: "Differentiate",
  integrate: "Integrate",
  normalize: "Normalize",
  fft: "FFT",
  average: "Average curves",
  interpolate: "Interpolate onto X",
  fill: "Fill column with…",
  cdf: "Cumulative distribution",
  math: "Curve math",
};

/** Commands that turn each curve into one new curve of the same kind (a new Y column per Y column). */
export type CurveOp = "smooth" | "derivative" | "integrate" | "normalize" | "interpolate";
export const isCurveOp = (op: AnalysisOp): op is CurveOp => op === "smooth" || op === "derivative" || op === "integrate" || op === "normalize" || op === "interpolate";

export type AverageGrid = "union" | "first" | "uniform";

/** Curve math: what is done to each curve, with a number or with another curve. */
export type MathOp = "add" | "sub" | "mul" | "div";
export const MATH_SIGN: Record<MathOp, string> = { add: "+", sub: "−", mul: "×", div: "÷" };

export interface AnalysisOptions {
  mathOp: MathOp;
  mathWith: "number" | "curve";
  mathValue: number;
  window: number;
  method: "moving" | "sg";
  order: number;
  normMode: NormalizeMode;
  fftWindow: "none" | "hann";
  grid: AverageGrid;
  points: number;
  overlapOnly: boolean;
}

export const DEFAULT_OPTIONS: AnalysisOptions = { mathOp: "sub", mathWith: "number", mathValue: 1, window: 5, method: "sg", order: 2, normMode: "max", fftWindow: "none", grid: "union", points: 200, overlapOnly: false };

/** Added to a curve's name for its result, e.g. "Voltage (smoothed)". */
export const RESULT_SUFFIX: Record<CurveOp, string> = { smooth: "smoothed", derivative: "d/dx", integrate: "integral", normalize: "normalized", interpolate: "interp" };

/** Units of a result, from the units of the curve's y and x. */
export function resultUnits(op: CurveOp, yUnits: string, xUnits: string | undefined): string {
  if (op === "derivative") return `${yUnits}/${xUnits ?? "x"}`;
  if (op === "integrate") return `${yUnits}·${xUnits ?? "x"}`;
  return op === "normalize" ? "" : yUnits;
}

/** One curve through a command: y on the same x, or — for "interpolate" — y at the x values of `targetX`. */
export function applyCurveOp(op: CurveOp, x: number[], y: number[], o: AnalysisOptions, targetX: number[] = x): number[] {
  if (op === "smooth") return o.method === "sg" ? savitzkyGolay(y, o.window, o.order) : movingAverage(y, o.window);
  if (op === "derivative") return derivative(x, y);
  if (op === "integrate") return integrate(x, y);
  if (op === "normalize") return normalize(y, o.normMode);
  return interpolate(x, y, targetX);
}

/**
 * Curve math on one curve: every y with a number, or with another curve read at the same x (linear interpolation;
 * no value where the other curve does not reach, or when dividing by zero).
 */
export function curveMath(x: number[], y: number[], op: MathOp, operand: number | { x: number[]; y: number[] }): number[] {
  const other = typeof operand === "number" ? null : interpolate(operand.x, operand.y, x);
  return y.map((v, i) => {
    const b = other ? other[i] : (operand as number);
    if (!Number.isFinite(v) || !Number.isFinite(b)) return NaN;
    const r = op === "add" ? v + b : op === "sub" ? v - b : op === "mul" ? v * b : v / b;
    return Number.isFinite(r) ? r : NaN;
  });
}

/** Name of a curve math result, e.g. "Signal − Background" or "Signal × 2". */
export function mathName(name: string, op: MathOp, operand: number | string): string {
  return `${name} ${MATH_SIGN[op]} ${typeof operand === "number" ? Number(operand.toPrecision(6)) : operand}`;
}

/** Units of a curve math result: kept, except when two curves are multiplied or divided. */
export function mathUnits(op: MathOp, yUnits: string, otherUnits: string | null): string {
  if (otherUnits === null || op === "add" || op === "sub") return yUnits;
  if (op === "div") return yUnits === otherUnits ? "" : yUnits && otherUnits ? `${yUnits}/${otherUnits}` : yUnits;
  return yUnits && otherUnits ? `${yUnits}·${otherUnits}` : yUnits || otherUnits;
}

/** Units of the frequency axis for a time axis in the given units: seconds give Hz, milliseconds kHz, and so on. */
export function freqUnits(timeUnits: string | undefined): string {
  const u = (timeUnits ?? "").trim();
  const map: Record<string, string> = { s: "Hz", sec: "Hz", ms: "kHz", "µs": "MHz", us: "MHz", ns: "GHz", min: "1/min", h: "1/h" };
  if (!u) return "";
  return map[u] ?? `1/${u}`;
}

/** What the "i" next to a dialog's title explains. */
export function analysisInfo(op: AnalysisOp, fromGraph: boolean): string | undefined {
  if (op === "fft") return "Assumes uniform sampling; the sampling rate is taken from the X values. Output: a frequency column and the one-sided amplitude and power spectra, as new columns in the same sheet.";
  if (op === "average") return `Each curve is linearly interpolated onto the common grid; mean, SD, SEM and N per point become new columns in the sheet of the first curve.${fromGraph ? " The curves may come from different sheets and panels." : ""}`;
  if (op === "cdf")
    return fromGraph
      ? "For each plot, two new columns in its sheet: the values in rising order and the fraction of values up to each one (the empirical CDF)."
      : 'For each column, two new columns: its values in rising order and the fraction of values up to each one (the empirical CDF). Plot the pair as a line with "Step" connection, or pick the CDF tile in Plot Columns for a curve that follows the data.';
  if (op === "math") return "Adds, subtracts, multiplies or divides each ticked curve by a number or by another curve. The other curve is read at the x values of each ticked curve (linear interpolation), so the two need not share a sheet or a grid. A fitted curve can be the other curve, for example to subtract a baseline.";
  if (op === "derivative" || op === "integrate") return fromGraph ? "Central differences / trapezoid rule over each curve's own x values." : "Uses the nearest X column to the left of each Y column; central differences / trapezoid rule.";
  return undefined;
}

/** The settings of a command (smoothing window, normalization, FFT window, averaging grid); nothing for the others. */
export function OptionFields({ op, o, set }: { op: AnalysisOp; o: AnalysisOptions; set: (patch: Partial<AnalysisOptions>) => void }) {
  if (op === "smooth")
    return (
      <>
        <Row label="Method">
          <Segmented value={o.method} options={[{ value: "sg", label: "Savitzky–Golay" }, { value: "moving", label: "Moving average" }]} onChange={(method) => set({ method })} />
        </Row>
        <Row label="Window (pts)">
          <NumberField value={o.window} step={2} min={3} onCommit={(v) => set({ window: Math.round(v) })} style={{ width: 70 }} />
        </Row>
        {o.method === "sg" && (
          <Row label="Poly order">
            <NumberField value={o.order} step={1} min={1} max={6} onCommit={(v) => set({ order: Math.round(v) })} style={{ width: 70 }} />
          </Row>
        )}
      </>
    );
  if (op === "normalize")
    return (
      <Row label="Divide by">
        <SelectField<NormalizeMode>
          value={o.normMode}
          options={[
            { value: "max", label: "Maximum" },
            { value: "sum", label: "Sum" },
            { value: "range", label: "Range → 0..1" },
            { value: "zscore", label: "Z-score (mean 0, SD 1)" },
            { value: "first", label: "First value" },
          ]}
          onChange={(normMode) => set({ normMode })}
        />
      </Row>
    );
  if (op === "fft")
    return (
      <Row label="Window">
        <Segmented value={o.fftWindow} options={[{ value: "none", label: "None" }, { value: "hann", label: "Hann" }]} onChange={(fftWindow) => set({ fftWindow })} />
      </Row>
    );
  if (op === "average")
    return (
      <>
        <Row label="Common grid">
          <SelectField<AverageGrid>
            value={o.grid}
            options={[
              { value: "union", label: "All x values of all curves" },
              { value: "first", label: "X of the first curve" },
              { value: "uniform", label: "Uniform, N points" },
            ]}
            onChange={(grid) => set({ grid })}
          />
        </Row>
        {o.grid === "uniform" && (
          <Row label="Points">
            <NumberField value={o.points} step={10} min={2} onCommit={(v) => set({ points: Math.round(v) })} style={{ width: 70 }} />
          </Row>
        )}
        <Row label="">
          <CheckField label="Only where all curves overlap" checked={o.overlapOnly} onChange={(overlapOnly) => set({ overlapOnly })} />
        </Row>
      </>
    );
  return null;
}
