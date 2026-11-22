// Probability functions behind the statistical tests (compare.ts): normal, Student t, F, Kolmogorov–Smirnov and the
// studentized range (Tukey). Pure functions, checked against SciPy in compare.test.ts.

/** ln Γ(x) for x > 0 (Lanczos, g = 7, n = 9; about 15 significant digits). */
export function logGamma(x: number): number {
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1;
  let a = c[0];
  const t = z + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Regularized upper incomplete gamma Q(a, x) = Γ(a, x) / Γ(a). */
export function gammaQ(a: number, x: number): number {
  if (!(x > 0)) return 1;
  if (x < a + 1) {
    // series for P(a, x)
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 0; n < 500; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-16) break;
    }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }
  // continued fraction (modified Lentz)
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/** Standard normal cumulative distribution Φ(z). */
export function normalCdf(z: number): number {
  const q = 0.5 * gammaQ(0.5, (z * z) / 2); // upper tail of |z|
  return z >= 0 ? 1 - q : q;
}

/** Regularized incomplete beta I_x(a, b). */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (!(x > 0)) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (front * betaCf(x, a, b)) / a : 1 - (front * betaCf(1 - x, b, a)) / b;
}

function betaCf(x: number, a: number, b: number): number {
  const tiny = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m < 1000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h;
}

/** Two-sided p value of a Student t statistic with `df` degrees of freedom. */
export function tTwoSidedP(t: number, df: number): number {
  if (!Number.isFinite(t)) return Number.isNaN(t) ? NaN : 0;
  if (!(df > 0)) return NaN;
  return incompleteBeta(df / (df + t * t), df / 2, 0.5);
}

/** t value that leaves `p` in the two tails together (e.g. p = 0.05 for a 95 % interval). */
export function tCritical(p: number, df: number): number {
  if (!(df > 0) || !(p > 0) || p >= 1) return NaN;
  let lo = 0;
  let hi = 1;
  while (tTwoSidedP(hi, df) > p && hi < 1e8) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tTwoSidedP(mid, df) > p) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-12 * Math.max(1, hi)) break;
  }
  return (lo + hi) / 2;
}

/** Upper-tail p value of an F statistic with (d1, d2) degrees of freedom. */
export function fUpperP(f: number, d1: number, d2: number): number {
  if (!(d1 > 0) || !(d2 > 0) || Number.isNaN(f)) return NaN;
  if (f <= 0) return 1;
  if (!Number.isFinite(f)) return 0;
  return incompleteBeta(d2 / (d2 + d1 * f), d2 / 2, d1 / 2);
}

/** Asymptotic Kolmogorov distribution: P(D > d) for the two-sample test with effective size ne = n·m / (n + m). */
export function ksAsymptoticP(d: number, ne: number): number {
  const lambda = (Math.sqrt(ne) + 0.12 + 0.11 / Math.sqrt(ne)) * d;
  if (lambda < 0.2) return 1;
  let sum = 0;
  for (let j = 1; j <= 100; j++) {
    const term = 2 * (j % 2 ? 1 : -1) * Math.exp(-2 * j * j * lambda * lambda);
    sum += term;
    if (Math.abs(term) < 1e-12) break;
  }
  return Math.min(1, Math.max(0, sum));
}

/**
 * Exact two-sided p value of the two-sample Kolmogorov–Smirnov statistic for sample sizes n and m, where the
 * statistic is h / (n·m) with h an integer: the fraction of orderings of the pooled sample whose two empirical
 * distributions come at least that far apart (exact when the data have no ties).
 */
export function ksExactP(h: number, n: number, m: number): number {
  if (h <= 0) return 1;
  // inside[j] = fraction of the paths to (i, j) that stayed strictly within the band |i·m − j·n| < h
  const inside = new Float64Array(m + 1);
  for (let j = 0; j <= m; j++) inside[j] = j * n < h ? 1 : 0;
  for (let i = 1; i <= n; i++) {
    inside[0] = i * m < h ? inside[0] : 0;
    for (let j = 1; j <= m; j++) {
      inside[j] = Math.abs(i * m - j * n) < h ? (inside[j] * i + inside[j - 1] * j) / (i + j) : 0;
    }
  }
  return Math.min(1, Math.max(0, 1 - inside[m]));
}

// ---- studentized range (Tukey) ----

function gaussLegendre(n: number): { x: number[]; w: number[] } {
  const x = new Array<number>(n);
  const w = new Array<number>(n);
  const half = Math.floor((n + 1) / 2);
  for (let i = 0; i < half; i++) {
    let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5));
    let pp = 1;
    for (let it = 0; it < 100; it++) {
      let p1 = 1;
      let p2 = 0;
      for (let j = 0; j < n; j++) {
        const p3 = p2;
        p2 = p1;
        p1 = ((2 * j + 1) * z * p2 - j * p3) / (j + 1);
      }
      pp = (n * (z * p1 - p2)) / (z * z - 1);
      const dz = p1 / pp;
      z -= dz;
      if (Math.abs(dz) < 1e-15) break;
    }
    x[i] = -z;
    x[n - 1 - i] = z;
    w[i] = w[n - 1 - i] = 2 / ((1 - z * z) * pp * pp);
  }
  return { x, w };
}

const GL = gaussLegendre(16);

/** ∫ f over [a, b], split into `parts` panels of 16-point Gauss–Legendre. */
function integrate(f: (x: number) => number, a: number, b: number, parts: number): number {
  const step = (b - a) / parts;
  let total = 0;
  for (let k = 0; k < parts; k++) {
    const mid = a + (k + 0.5) * step;
    const hw = step / 2;
    let s = 0;
    for (let i = 0; i < 16; i++) s += GL.w[i] * f(mid + hw * GL.x[i]);
    total += s * hw;
  }
  return total;
}

/** P(range of k standard normal values ≤ w). */
function rangeCdf(w: number, k: number): number {
  if (w <= 0) return 0;
  const f = (z: number) => {
    const d = normalCdf(z) - normalCdf(z - w);
    return d <= 0 ? 0 : (Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI)) * Math.pow(d, k - 1);
  };
  return Math.min(1, k * integrate(f, -8.5, 8.5 + Math.min(w, 8.5), 24));
}

/** Upper-tail p value of the studentized range statistic q for k groups and `df` error degrees of freedom. */
export function tukeyUpperP(q: number, k: number, df: number): number {
  if (!(q >= 0) || k < 2 || !(df > 0)) return NaN;
  if (q === 0) return 1;
  if (df > 20000) return Math.max(0, 1 - rangeCdf(q, k));
  // s = sqrt(χ²_df / df): density 2 (df/2)^(df/2) / Γ(df/2) · s^(df−1) · exp(−df s² / 2)
  const logC = Math.log(2) + (df / 2) * Math.log(df / 2) - logGamma(df / 2);
  const dens = (s: number) => (s <= 0 ? 0 : Math.exp(logC + (df - 1) * Math.log(s) - (df * s * s) / 2));
  const spread = 9 / Math.sqrt(df);
  const lo = Math.max(0, 1 - spread);
  const hi = 1 + spread;
  const cdf = integrate((s) => dens(s) * rangeCdf(q * s, k), lo, hi, 16);
  return Math.min(1, Math.max(0, 1 - cdf));
}
