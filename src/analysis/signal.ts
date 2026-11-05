// Signal-processing style operations on columns (Origin's Analysis menu basics).
import { Matrix, pseudoInverse } from "ml-matrix";

const finite = (v: number) => Number.isFinite(v);

/** Moving average with a centered window (odd size); edges use the available neighbours. */
export function movingAverage(y: number[], window: number): number[] {
  const w = Math.max(1, Math.round(window));
  const half = Math.floor(w / 2);
  return y.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(y.length - 1, i + half); j++) {
      if (finite(y[j])) {
        s += y[j];
        n++;
      }
    }
    return n ? s / n : NaN;
  });
}

/** Savitzky–Golay smoothing: least-squares polynomial of `order` over an odd `window`. */
export function savitzkyGolay(y: number[], window: number, order: number, derivative = 0): number[] {
  let w = Math.max(3, Math.round(window));
  if (w % 2 === 0) w++;
  const half = (w - 1) / 2;
  const p = Math.max(0, Math.min(order, w - 1));
  // design matrix A[i][k] = i^k for i in -half..half
  const A = new Matrix(w, p + 1);
  for (let i = -half; i <= half; i++) for (let k = 0; k <= p; k++) A.set(i + half, k, Math.pow(i, k));
  const C = pseudoInverse(A); // (p+1) × w ; row d gives the coefficients for the d-th derivative / d!
  const coeff = Array.from({ length: w }, (_, j) => C.get(derivative, j) * factorial(derivative));
  const out: number[] = new Array(y.length).fill(NaN);
  for (let i = 0; i < y.length; i++) {
    let s = 0;
    let ok = true;
    for (let j = -half; j <= half; j++) {
      const idx = Math.min(y.length - 1, Math.max(0, i + j)); // mirror-less edge: clamp
      if (!finite(y[idx])) {
        ok = false;
        break;
      }
      s += coeff[j + half] * y[idx];
    }
    out[i] = ok ? s : NaN;
  }
  return out;
}

function factorial(n: number): number {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

/** dy/dx by central differences (one-sided at the ends). */
export function derivative(x: number[], y: number[]): number[] {
  const n = Math.min(x.length, y.length);
  const out = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const a = i === 0 ? 0 : i - 1;
    const b = i === n - 1 ? n - 1 : i + 1;
    if (a === b) continue;
    const dx = x[b] - x[a];
    out[i] = dx !== 0 ? (y[b] - y[a]) / dx : NaN;
  }
  return out;
}

/** Cumulative trapezoidal integral. */
export function integrate(x: number[], y: number[]): number[] {
  const n = Math.min(x.length, y.length);
  const out = new Array(n).fill(NaN);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0 && finite(y[i]) && finite(y[i - 1])) acc += ((y[i] + y[i - 1]) / 2) * (x[i] - x[i - 1]);
    out[i] = acc;
  }
  return out;
}

export type NormalizeMode = "max" | "sum" | "range" | "zscore" | "first";

export function normalize(y: number[], mode: NormalizeMode): number[] {
  const v = y.filter(finite);
  if (!v.length) return y.map(() => NaN);
  const max = Math.max(...v);
  const min = Math.min(...v);
  const sum = v.reduce((a, b) => a + b, 0);
  const mean = sum / v.length;
  const sd = v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1)) : 1;
  const first = v[0];
  return y.map((val) => {
    if (!finite(val)) return NaN;
    switch (mode) {
      case "max":
        return max !== 0 ? val / max : NaN;
      case "sum":
        return sum !== 0 ? val / sum : NaN;
      case "range":
        return max !== min ? (val - min) / (max - min) : 0;
      case "zscore":
        return sd ? (val - mean) / sd : 0;
      case "first":
        return first !== 0 ? val / first : NaN;
    }
  });
}

/** Linear interpolation of (x, y) at xs; NaN outside the covered range. Requires x sorted ascending (sorted here). */
export function interpolate(x: number[], y: number[], xs: number[]): number[] {
  const pts = x.map((xv, i) => [xv, y[i]] as [number, number]).filter((p) => finite(p[0]) && finite(p[1])).sort((a, b) => a[0] - b[0]);
  if (pts.length < 2) return xs.map(() => NaN);
  return xs.map((xv) => {
    if (xv < pts[0][0] || xv > pts[pts.length - 1][0]) return NaN;
    let lo = 0;
    let hi = pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid][0] <= xv) lo = mid;
      else hi = mid;
    }
    const [x0, y0] = pts[lo];
    const [x1, y1] = pts[hi];
    if (x1 === x0) return y0;
    return y0 + ((y1 - y0) * (xv - x0)) / (x1 - x0);
  });
}

export interface AveragedCurves {
  x: number[];
  mean: number[];
  sd: number[];
  sem: number[];
  n: number[];
}

/**
 * Average several (x, y) curves measured on different grids: each curve is interpolated onto a
 * common x grid. `grid`: "union" uses every x value of every curve, "first" the first curve's x,
 * "uniform" `points` evenly spaced values over the overlap of all curves.
 */
export function averageCurves(curves: { x: number[]; y: number[] }[], grid: "union" | "first" | "uniform" = "union", points = 200, overlapOnly = false): AveragedCurves {
  const valid = curves.filter((c) => c.x.length > 1);
  if (!valid.length) return { x: [], mean: [], sd: [], sem: [], n: [] };
  const ranges = valid.map((c) => {
    const xs = c.x.filter(finite);
    return [Math.min(...xs), Math.max(...xs)];
  });
  let xs: number[];
  if (grid === "first") xs = [...valid[0].x].filter(finite).sort((a, b) => a - b);
  else if (grid === "uniform") {
    const lo = overlapOnly ? Math.max(...ranges.map((r) => r[0])) : Math.min(...ranges.map((r) => r[0]));
    const hi = overlapOnly ? Math.min(...ranges.map((r) => r[1])) : Math.max(...ranges.map((r) => r[1]));
    const n = Math.max(2, Math.round(points));
    xs = Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
  } else xs = [...new Set(valid.flatMap((c) => c.x.filter(finite)))].sort((a, b) => a - b);
  if (overlapOnly && grid !== "uniform") {
    const lo = Math.max(...ranges.map((r) => r[0]));
    const hi = Math.min(...ranges.map((r) => r[1]));
    xs = xs.filter((v) => v >= lo && v <= hi);
  }
  const ys = valid.map((c) => interpolate(c.x, c.y, xs));
  const mean: number[] = [];
  const sd: number[] = [];
  const sem: number[] = [];
  const n: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    const vals = ys.map((y) => y[i]).filter(finite);
    const k = vals.length;
    n.push(k);
    if (!k) {
      mean.push(NaN);
      sd.push(NaN);
      sem.push(NaN);
      continue;
    }
    const m = vals.reduce((a, b) => a + b, 0) / k;
    const s = k > 1 ? Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / (k - 1)) : NaN;
    mean.push(m);
    sd.push(s);
    sem.push(k > 1 ? s / Math.sqrt(k) : NaN);
  }
  return { x: xs, mean, sd, sem, n };
}

/** FFT magnitude spectrum of a uniformly sampled signal. Returns one-sided frequency and amplitude. */
export function fftSpectrum(x: number[], y: number[], windowFn: "none" | "hann" = "none"): { freq: number[]; amplitude: number[]; power: number[] } {
  const n0 = Math.min(x.length, y.length);
  const vals = y.slice(0, n0).map((v) => (finite(v) ? v : 0));
  const dt = n0 > 1 ? (x[n0 - 1] - x[0]) / (n0 - 1) : 1;
  let n = 1;
  while (n < n0) n <<= 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n0; i++) {
    const w = windowFn === "hann" ? 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n0 - 1 || 1)) : 1;
    re[i] = vals[i] * w;
  }
  fftInPlace(re, im);
  const half = n / 2;
  const freq: number[] = [];
  const amplitude: number[] = [];
  const power: number[] = [];
  const fs = 1 / dt;
  for (let k = 0; k <= half; k++) {
    freq.push((k * fs) / n);
    const mag = Math.hypot(re[k], im[k]) / n0;
    amplitude.push(k === 0 || k === half ? mag : 2 * mag);
    power.push(amplitude[k] ** 2);
  }
  return { freq, amplitude, power };
}

function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j];
        const ui = im[i + j];
        const vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
        const vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ur + vr;
        im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr;
        im[i + j + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

export type FillMode = "rowNumbers" | "series" | "uniform" | "normal";

export function fillValues(mode: FillMode, n: number, a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    switch (mode) {
      case "rowNumbers":
        out.push(i + 1);
        break;
      case "series":
        out.push(a + b * i);
        break;
      case "uniform":
        out.push(a + (b - a) * Math.random());
        break;
      case "normal": {
        let u = 0;
        let v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        out.push(a + b * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
        break;
      }
    }
  }
  return out;
}
