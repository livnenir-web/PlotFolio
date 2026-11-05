import type { Axis } from "../model/types";

/** A "nice" step (1, 2, 5 × 10^n) giving roughly `target` intervals over `span`. */
export function niceStep(span: number, target = 5): number {
  if (!(span > 0) || !Number.isFinite(span)) return 1;
  const raw = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const r = raw / mag;
  const nice = r < 1.5 ? 1 : r < 3.5 ? 2 : r < 7.5 ? 5 : 10;
  return nice * mag;
}

/** Expand [min,max] outward to multiples of a nice step (Origin-style auto range). */
export function niceDomain(min: number, max: number, target = 5): { from: number; to: number; step: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { from: 0, to: 10, step: 2 };
  if (min === max) {
    const pad = min === 0 ? 1 : Math.abs(min) * 0.1;
    min -= pad;
    max += pad;
  }
  const step = niceStep(max - min, target);
  const from = Math.floor(min / step + 1e-9) * step;
  const to = Math.ceil(max / step - 1e-9) * step;
  return { from: fix(from), to: fix(to), step };
}

function fix(v: number): number {
  return Number(v.toPrecision(12));
}

export function linearTicks(from: number, to: number, step: number): number[] {
  if (!(step > 0) || !Number.isFinite(step)) return [];
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const start = Math.ceil(lo / step - 1e-9) * step;
  const out: number[] = [];
  for (let v = start, i = 0; v <= hi + step * 1e-9 && i < 1000; i++, v = start + i * step) out.push(fix(v));
  return out;
}

export function linearMinorTicks(majors: number[], step: number, minorCount: number, from: number, to: number): number[] {
  if (minorCount <= 0 || majors.length === 0) return [];
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const sub = step / (minorCount + 1);
  const out: number[] = [];
  const first = majors[0] - step;
  const last = majors[majors.length - 1] + step;
  for (let m = first; m <= last + 1e-9; m += step) {
    for (let k = 1; k <= minorCount; k++) {
      const v = fix(m + k * sub);
      if (v >= lo - 1e-9 && v <= hi + 1e-9) out.push(v);
    }
  }
  return out;
}

import type { AxisScale } from "../model/types";

export const isLogScale = (s: AxisScale | undefined): boolean => s === "log" || s === "log2" || s === "ln";
export const logBase = (s: AxisScale | undefined): number => (s === "log2" ? 2 : s === "ln" ? Math.E : 10);
const logB = (v: number, b: number) => Math.log(v) / Math.log(b);

/**
 * Major ticks for a log axis: integer powers of the base (every n-th power when the span is large).
 * `minorCount` minor ticks between majors: for base 10 the value 8 gives the classic 2…9 marks;
 * otherwise minors are evenly spaced in log space. 0 disables them.
 */
export function logTicks(from: number, to: number, base = 10, minorCount = 8): { major: number[]; minor: number[] } {
  const lo = Math.max(Math.min(from, to), Number.MIN_VALUE);
  const hi = Math.max(from, to);
  const e0 = Math.floor(logB(lo, base) + 1e-9);
  const e1 = Math.ceil(logB(hi, base) - 1e-9);
  const spanE = e1 - e0;
  const maxMajors = base === 10 ? 12 : 16;
  const every = spanE > maxMajors ? Math.ceil(spanE / 8) : 1;
  const major: number[] = [];
  const minor: number[] = [];
  const inRange = (v: number) => v >= lo * (1 - 1e-9) && v <= hi * (1 + 1e-9);
  for (let e = e0; e <= e1; e++) {
    const p = Math.pow(base, e);
    if ((e - e0) % every === 0 && inRange(p)) major.push(p);
    if (every === 1 && minorCount > 0) {
      if (base === 10 && minorCount === 8) {
        for (let k = 2; k <= 9; k++) if (inRange(k * p)) minor.push(k * p);
      } else {
        for (let k = 1; k <= minorCount; k++) {
          const v = Math.pow(base, e + k / (minorCount + 1));
          if (inRange(v)) minor.push(v);
        }
      }
    }
  }
  return { major, minor };
}

export function logNiceDomain(min: number, max: number, base = 10): { from: number; to: number } {
  if (!(min > 0)) min = 1;
  if (!(max > 0)) max = min * base;
  return { from: Math.pow(base, Math.floor(logB(min, base) + 1e-9)), to: Math.pow(base, Math.ceil(logB(max, base) - 1e-9)) };
}

function decimalsForStep(step: number): number {
  if (!(step > 0)) return 0;
  const d = -Math.floor(Math.log10(step) + 1e-9);
  return Math.max(0, Math.min(10, d));
}

/**
 * Format a tick value. Returns markup text (so 10^{3} renders as a superscript).
 */
export function formatTick(v: number, axis: Pick<Axis, "numberFormat" | "decimals" | "scale" | "thousands">, step: number): string {
  const t = formatTickCore(v, axis, step);
  return axis.thousands ? groupThousands(t) : t;
}

/** Insert thousands separators into the integer part of every plain number in the text (not inside exponents). */
export function groupThousands(text: string): string {
  return text.replace(/(^|[^\d.^{])(-?\d{4,})(?=(?:\.\d+)?(?![\d}]))/g, (_m, pre: string, int: string) => pre + int.replace(/\B(?=(\d{3})+(?!\d))/g, ","));
}

const SI_PREFIXES: Record<number, string> = { [-24]: "y", [-21]: "z", [-18]: "a", [-15]: "f", [-12]: "p", [-9]: "n", [-6]: "µ", [-3]: "m", 0: "", 3: "k", 6: "M", 9: "G", 12: "T", 15: "P", 18: "E" };

/** 1.5e3 style. */
function expo(v: number, decimals: number): string {
  if (v === 0) return "0";
  const e = Math.floor(Math.log10(Math.abs(v)));
  const m = v / Math.pow(10, e);
  return `${Number(m.toFixed(decimals))}e${e}`;
}

/** Engineering notation with an SI prefix: 1500 → 1.5k, 0.002 → 2m. Exponents without a prefix fall back to 1.5e3. */
function engineering(v: number, decimals: number): string {
  if (v === 0) return "0";
  const e3 = Math.floor(Math.log10(Math.abs(v)) / 3) * 3;
  const m = v / Math.pow(10, e3);
  const ms = Number(m.toFixed(decimals));
  const prefix = SI_PREFIXES[e3];
  return prefix === undefined ? `${ms}e${e3}` : `${ms}${prefix}`;
}

function formatTickCore(v: number, axis: Pick<Axis, "numberFormat" | "decimals" | "scale">, step: number): string {
  if (isLogScale(axis.scale)) {
    const base = logBase(axis.scale);
    const e = Math.log(Math.abs(v)) / Math.log(base);
    const n = Math.round(e);
    const isPower = Math.abs(e - n) < 1e-9;
    if (axis.scale === "log") {
      if (isPower) {
        if (axis.numberFormat === "fixed" || (n >= -3 && n <= 3 && axis.numberFormat === "auto")) return plain(v, n < 0 ? -n : 0);
        return `10^{${n}}`;
      }
      return plain(v, Math.max(0, -Math.floor(e)));
    }
    // log2 / ln: show the power notation for large or small values, plain numbers otherwise
    if (isPower && axis.numberFormat !== "fixed" && (Math.abs(v) >= 1e4 || Math.abs(v) < 1e-3)) return axis.scale === "log2" ? `2^{${n}}` : `e^{${n}}`;
    const decimals = Number.isInteger(v) ? 0 : Math.abs(v) >= 10 ? 1 : Math.abs(v) >= 1 ? 2 : Math.max(2, -Math.floor(Math.log10(Math.abs(v))) + 1);
    return plain(v, axis.numberFormat === "fixed" ? axis.decimals : decimals);
  }
  if (axis.numberFormat === "scientific") return sci(v, axis.decimals);
  if (axis.numberFormat === "exponent") return expo(v, axis.decimals);
  if (axis.numberFormat === "engineering") return engineering(v, axis.decimals);
  if (axis.numberFormat === "fixed") return plain(v, axis.decimals);
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e6 || a < 1e-4)) return sci(v, Math.max(0, decimalsForStep(step / Math.pow(10, Math.floor(Math.log10(a))))));
  return plain(v, decimalsForStep(step));
}

function plain(v: number, decimals: number): string {
  const s = v.toFixed(decimals);
  return s === "-0" || /^-0\.0*$/.test(s) ? s.slice(1) : s;
}

function sci(v: number, decimals: number): string {
  if (v === 0) return "0";
  const e = Math.floor(Math.log10(Math.abs(v)));
  const m = v / Math.pow(10, e);
  const ms = Number(m.toFixed(decimals));
  return ms === 1 ? `10^{${e}}` : `${ms}×10^{${e}}`;
}
