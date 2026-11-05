import { Matrix, inverse, pseudoInverse } from "ml-matrix";
import type { FitFunctionDef } from "./functions";

export interface FitData {
  x: number[];
  y: number[];
  /** Standard deviation of each y (used as weights 1/σ² when `weighted`). */
  sigma?: number[];
}

export interface FitOptions {
  weighted?: boolean;
  fixed?: boolean[];
  maxIterations?: number;
}

export interface FitResult {
  params: number[];
  errors: number[];
  cov: number[][];
  chi2: number;
  reducedChi2: number;
  rSquared: number;
  adjRSquared: number;
  n: number;
  dof: number;
  residuals: number[];
  fitted: number[];
  iterations: number;
  converged: boolean;
  message?: string;
}

function weightsOf(data: FitData, weighted: boolean | undefined): number[] {
  const n = data.x.length;
  if (!weighted || !data.sigma) return new Array(n).fill(1);
  return data.sigma.map((s) => (s > 0 && Number.isFinite(s) ? 1 / (s * s) : 1));
}

function evalModel(def: FitFunctionDef, p: number[], x: number[]): number[] {
  return x.map((xv) => def.fn(xv, p));
}

/** Numerical Jacobian ∂f(x_i)/∂p_k (central differences). */
function jacobian(def: FitFunctionDef, p: number[], x: number[], free: boolean[]): Matrix {
  const n = x.length;
  const m = p.length;
  const J = Matrix.zeros(n, m);
  for (let k = 0; k < m; k++) {
    if (!free[k]) continue;
    const h = Math.max(Math.abs(p[k]) * 1e-6, 1e-8);
    const pp = [...p];
    const pm = [...p];
    pp[k] += h;
    pm[k] -= h;
    const fp = evalModel(def, pp, x);
    const fm = evalModel(def, pm, x);
    for (let i = 0; i < n; i++) J.set(i, k, (fp[i] - fm[i]) / (2 * h));
  }
  return J;
}

function chiSquared(y: number[], f: number[], w: number[]): number {
  let s = 0;
  for (let i = 0; i < y.length; i++) {
    const r = y[i] - f[i];
    if (!Number.isFinite(r)) return Infinity;
    s += w[i] * r * r;
  }
  return s;
}

function safeInverse(A: Matrix): Matrix {
  try {
    const inv = inverse(A);
    if (inv.to2DArray().flat().every(Number.isFinite)) return inv;
  } catch {
    /* fall through */
  }
  return pseudoInverse(A);
}

function finish(def: FitFunctionDef, p: number[], data: FitData, w: number[], free: boolean[], iterations: number, converged: boolean, message?: string): FitResult {
  const n = data.x.length;
  const fitted = evalModel(def, p, data.x);
  const residuals = data.y.map((yv, i) => yv - fitted[i]);
  const nFree = free.filter(Boolean).length;
  const dof = Math.max(1, n - nFree);
  const chi2 = chiSquared(data.y, fitted, w);
  const reducedChi2 = chi2 / dof;

  // covariance = (JᵀWJ)⁻¹ · χ²_red (free parameters only)
  const J = jacobian(def, p, data.x, free);
  const freeIdx = free.map((f, i) => (f ? i : -1)).filter((i) => i >= 0);
  const Jf = new Matrix(n, freeIdx.length);
  for (let i = 0; i < n; i++) freeIdx.forEach((k, c) => Jf.set(i, c, J.get(i, k) * Math.sqrt(w[i])));
  const JtJ = Jf.transpose().mmul(Jf);
  const covFree = safeInverse(JtJ).mul(reducedChi2);
  const m = p.length;
  const cov: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));
  freeIdx.forEach((k, a) => freeIdx.forEach((l, b) => (cov[k][l] = covFree.get(a, b))));
  const errors = p.map((_, k) => (free[k] ? Math.sqrt(Math.max(0, cov[k][k])) : 0));

  const ymean = data.y.reduce((a, b) => a + b, 0) / n;
  const ssTot = data.y.reduce((a, b) => a + (b - ymean) ** 2, 0);
  const ssRes = residuals.reduce((a, b) => a + b * b, 0);
  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 1;
  const adjRSquared = n - nFree - 1 > 0 ? 1 - ((1 - rSquared) * (n - 1)) / (n - nFree - 1) : rSquared;

  return { params: p, errors, cov, chi2, reducedChi2, rSquared, adjRSquared, n, dof, residuals, fitted, iterations, converged, message };
}

/** Exact weighted least squares for models linear in the parameters. */
function fitLinear(def: FitFunctionDef, data: FitData, w: number[], free: boolean[], guess: number[]): FitResult {
  const n = data.x.length;
  const m = def.params.length;
  const freeIdx = free.map((f, i) => (f ? i : -1)).filter((i) => i >= 0);
  const X = new Matrix(n, freeIdx.length);
  const Y = new Matrix(n, 1);
  for (let i = 0; i < n; i++) {
    const b = def.basis!(data.x[i]);
    const sw = Math.sqrt(w[i]);
    // subtract fixed contributions
    let fixedPart = 0;
    for (let k = 0; k < m; k++) if (!free[k]) fixedPart += guess[k] * b[k];
    freeIdx.forEach((k, c) => X.set(i, c, b[k] * sw));
    Y.set(i, 0, (data.y[i] - fixedPart) * sw);
  }
  const XtX = X.transpose().mmul(X);
  const beta = safeInverse(XtX).mmul(X.transpose()).mmul(Y);
  const p = [...guess];
  freeIdx.forEach((k, c) => (p[k] = beta.get(c, 0)));
  return finish(def, p, data, w, free, 1, true);
}

/**
 * Levenberg–Marquardt non-linear least squares.
 */
export function fitCurve(def: FitFunctionDef, data: FitData, guess: number[], opts: FitOptions = {}): FitResult {
  const n = data.x.length;
  if (n < 2) throw new Error("Need at least two data points");
  const free = def.params.map((_, i) => !(opts.fixed?.[i] ?? false));
  const w = weightsOf(data, opts.weighted);
  if (def.linear && def.basis) return fitLinear(def, data, w, free, guess);

  let p = guess.map((g) => (Number.isFinite(g) ? g : 1));
  let f = evalModel(def, p, data.x);
  let chi2 = chiSquared(data.y, f, w);
  if (!Number.isFinite(chi2)) {
    // try to recover from a bad guess
    p = p.map(() => 1);
    f = evalModel(def, p, data.x);
    chi2 = chiSquared(data.y, f, w);
    if (!Number.isFinite(chi2)) throw new Error("The function is not finite at the initial parameters");
  }
  let lambda = 1e-3;
  const maxIter = opts.maxIterations ?? 300;
  let converged = false;
  let iter = 0;
  const freeIdx = free.map((fr, i) => (fr ? i : -1)).filter((i) => i >= 0);
  const nf = freeIdx.length;
  if (nf === 0) return finish(def, p, data, w, free, 0, true);

  for (iter = 0; iter < maxIter; iter++) {
    const J = jacobian(def, p, data.x, free);
    // A = JᵀWJ, g = JᵀW r
    const A = Matrix.zeros(nf, nf);
    const g = Matrix.zeros(nf, 1);
    for (let i = 0; i < n; i++) {
      const r = data.y[i] - f[i];
      for (let a = 0; a < nf; a++) {
        const Ja = J.get(i, freeIdx[a]);
        g.set(a, 0, g.get(a, 0) + w[i] * Ja * r);
        for (let b = 0; b < nf; b++) A.set(a, b, A.get(a, b) + w[i] * Ja * J.get(i, freeIdx[b]));
      }
    }
    let improved = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const Ad = A.clone();
      for (let a = 0; a < nf; a++) Ad.set(a, a, Ad.get(a, a) * (1 + lambda) + 1e-30);
      let delta: Matrix;
      try {
        delta = safeInverse(Ad).mmul(g);
      } catch {
        lambda *= 10;
        continue;
      }
      const pNew = [...p];
      freeIdx.forEach((k, a) => (pNew[k] = p[k] + delta.get(a, 0)));
      const fNew = evalModel(def, pNew, data.x);
      const chi2New = chiSquared(data.y, fNew, w);
      if (Number.isFinite(chi2New) && chi2New <= chi2) {
        const rel = (chi2 - chi2New) / Math.max(chi2, 1e-300);
        const step = Math.max(...freeIdx.map((k, a) => Math.abs(delta.get(a, 0)) / Math.max(Math.abs(p[k]), 1e-12)));
        p = pNew;
        f = fNew;
        chi2 = chi2New;
        lambda = Math.max(lambda / 10, 1e-15);
        improved = true;
        if (rel < 1e-12 || step < 1e-10) converged = true;
        break;
      }
      lambda *= 10;
      if (lambda > 1e12) break;
    }
    if (!improved) {
      converged = true; // no further improvement possible
      break;
    }
    if (converged) break;
  }
  return finish(def, p, data, w, free, iter + 1, converged, converged ? undefined : "Did not converge; results may be unreliable");
}

// ---- confidence band -----------------------------------------------------

function lnGamma(z: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let x = z;
  let y = z;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
export function ibeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** CDF of Student's t with `dof` degrees of freedom. */
export function tCdf(t: number, dof: number): number {
  const x = dof / (dof + t * t);
  const p = 0.5 * ibeta(dof / 2, 0.5, x);
  return t >= 0 ? 1 - p : p;
}

/** Quantile of Student's t (two-sided level `conf`, e.g. 0.95 → t for 97.5%). */
export function tQuantile(prob: number, dof: number): number {
  if (dof > 1e6) return normalQuantile(prob);
  let lo = 0;
  let hi = 1000;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, dof) < prob) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-10) break;
  }
  return (lo + hi) / 2;
}

function normalQuantile(p: number): number {
  // Acklam's approximation
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - pl) {
    const q = p - 0.5;
    const r = q * q;
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

/** Evaluate the fitted curve and its (1-α) confidence band at xs via the delta method. */
/**
 * Curve with its confidence band (delta method) and, when `residualVariance` is given, the prediction band
 * for new observations: ± t · sqrt(var(fit) + s²).
 */
export function predictWithBand(def: FitFunctionDef, params: number[], cov: number[][], dof: number, xs: number[], conf = 0.95, residualVariance = 0): { y: number[]; lower: number[]; upper: number[]; predLower: number[]; predUpper: number[] } {
  const t = tQuantile(1 - (1 - conf) / 2, dof);
  const m = params.length;
  const y: number[] = [];
  const lower: number[] = [];
  const upper: number[] = [];
  const predLower: number[] = [];
  const predUpper: number[] = [];
  for (const x of xs) {
    const fx = def.fn(x, params);
    const grad: number[] = [];
    for (let k = 0; k < m; k++) {
      const h = Math.max(Math.abs(params[k]) * 1e-6, 1e-8);
      const pp = [...params];
      const pm = [...params];
      pp[k] += h;
      pm[k] -= h;
      grad.push((def.fn(x, pp) - def.fn(x, pm)) / (2 * h));
    }
    let v = 0;
    for (let a = 0; a < m; a++) for (let b = 0; b < m; b++) v += grad[a] * cov[a][b] * grad[b];
    const half = t * Math.sqrt(Math.max(0, v));
    const halfPred = t * Math.sqrt(Math.max(0, v) + Math.max(0, residualVariance));
    y.push(fx);
    lower.push(fx - half);
    upper.push(fx + half);
    predLower.push(fx - halfPred);
    predUpper.push(fx + halfPred);
  }
  return { y, lower, upper, predLower, predUpper };
}

/** Evenly spaced x values for drawing a fitted curve (log-spaced when requested). */
export function curveXs(from: number, to: number, count = 300, log = false): number[] {
  if (!(to > from)) return [from];
  if (log && from > 0) {
    const l0 = Math.log10(from);
    const l1 = Math.log10(to);
    return Array.from({ length: count }, (_, i) => Math.pow(10, l0 + ((l1 - l0) * i) / (count - 1)));
  }
  return Array.from({ length: count }, (_, i) => from + ((to - from) * i) / (count - 1));
}
