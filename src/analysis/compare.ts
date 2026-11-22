// Statistical comparison of groups of values: t-test, one-way ANOVA with pairwise comparisons, the two-sample
// Kolmogorov–Smirnov test and the empirical cumulative distribution. Pure functions; the dialog is CompareDialog.tsx.

import { fUpperP, ksAsymptoticP, ksExactP, tCritical, tTwoSidedP, tukeyUpperP } from "./distributions";

const finite = (v: number[]) => v.filter((x) => Number.isFinite(x));

export function mean(v: number[]): number {
  let s = 0;
  for (const x of v) s += x;
  return v.length ? s / v.length : NaN;
}

/** Sample variance (n − 1 in the denominator). */
export function variance(v: number[]): number {
  if (v.length < 2) return NaN;
  const m = mean(v);
  let s = 0;
  for (const x of v) s += (x - m) ** 2;
  return s / (v.length - 1);
}

export type TTestKind = "welch" | "student" | "paired";

export interface TTestResult {
  kind: TTestKind;
  t: number;
  df: number;
  p: number;
  /** mean of a − mean of b (paired: mean of the differences) and its 95 % confidence interval */
  diff: number;
  ciLow: number;
  ciHigh: number;
  nA: number;
  nB: number;
}

/**
 * Two-sided t-test of two groups. "welch" (default) does not assume equal variances, "student" does, and "paired"
 * compares row by row: rows where either value is missing are left out, so pass the columns unfiltered.
 */
export function tTest(a: number[], b: number[], kind: TTestKind = "welch"): TTestResult | null {
  let t: number;
  let df: number;
  let diff: number;
  let se: number;
  let nA: number;
  let nB: number;
  if (kind === "paired") {
    const d: number[] = [];
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (Number.isFinite(a[i]) && Number.isFinite(b[i])) d.push(a[i] - b[i]);
    if (d.length < 2) return null;
    nA = nB = d.length;
    diff = mean(d);
    se = Math.sqrt(variance(d) / d.length);
    df = d.length - 1;
  } else {
    const x = finite(a);
    const y = finite(b);
    if (x.length < 2 || y.length < 2) return null;
    nA = x.length;
    nB = y.length;
    diff = mean(x) - mean(y);
    const vx = variance(x);
    const vy = variance(y);
    if (kind === "student") {
      df = nA + nB - 2;
      se = Math.sqrt((((nA - 1) * vx + (nB - 1) * vy) / df) * (1 / nA + 1 / nB));
    } else {
      const ex = vx / nA;
      const ey = vy / nB;
      se = Math.sqrt(ex + ey);
      df = (ex + ey) ** 2 / (ex ** 2 / (nA - 1) + ey ** 2 / (nB - 1));
    }
  }
  if (!(se > 0)) return null; // no spread at all: the test is undefined
  t = diff / se;
  const half = tCritical(0.05, df) * se;
  return { kind, t, df, p: tTwoSidedP(t, df), diff, ciLow: diff - half, ciHigh: diff + half, nA, nB };
}

export interface AnovaResult {
  f: number;
  dfBetween: number;
  dfWithin: number;
  p: number;
  ssBetween: number;
  ssWithin: number;
  /** mean square within groups (the pooled variance) */
  msWithin: number;
}

/** One-way analysis of variance of two or more groups. */
export function anova(groupsIn: number[][]): AnovaResult | null {
  const groups = groupsIn.map(finite);
  const k = groups.length;
  const n = groups.reduce((s, g) => s + g.length, 0);
  if (k < 2 || groups.some((g) => g.length < 1) || n - k < 1) return null;
  const grand = mean(groups.flat());
  let ssBetween = 0;
  let ssWithin = 0;
  for (const g of groups) {
    const m = mean(g);
    ssBetween += g.length * (m - grand) ** 2;
    for (const x of g) ssWithin += (x - m) ** 2;
  }
  const dfBetween = k - 1;
  const dfWithin = n - k;
  const msWithin = ssWithin / dfWithin;
  if (!(msWithin > 0)) return null;
  const f = ssBetween / dfBetween / msWithin;
  return { f, dfBetween, dfWithin, p: fUpperP(f, dfBetween, dfWithin), ssBetween, ssWithin, msWithin };
}

export interface PairResult {
  /** indices of the two groups */
  a: number;
  b: number;
  /** mean of a − mean of b (KS: the largest distance between the two cumulative distributions) */
  diff: number;
  /** test statistic of the pair: t, q (Tukey) or D (KS) */
  stat: number;
  p: number;
}

/** Tukey's honestly-significant-difference test for every pair of groups (Tukey–Kramer for unequal sizes). */
export function tukeyHsd(groupsIn: number[][]): PairResult[] | null {
  const groups = groupsIn.map(finite);
  const av = anova(groups);
  if (!av || groups.some((g) => g.length < 1)) return null;
  const out: PairResult[] = [];
  for (let a = 0; a < groups.length; a++) {
    for (let b = a + 1; b < groups.length; b++) {
      const diff = mean(groups[a]) - mean(groups[b]);
      const se = Math.sqrt((av.msWithin / 2) * (1 / groups[a].length + 1 / groups[b].length));
      const q = Math.abs(diff) / se;
      out.push({ a, b, diff, stat: q, p: tukeyUpperP(q, groups.length, av.dfWithin) });
    }
  }
  return out;
}

/** Holm's step-down correction of p values for several comparisons (same order as the input). */
export function holm(p: number[]): number[] {
  const order = p.map((_, i) => i).sort((i, j) => p[i] - p[j]);
  const out = new Array<number>(p.length);
  let running = 0;
  order.forEach((idx, rank) => {
    running = Math.max(running, Math.min(1, (p.length - rank) * p[idx]));
    out[idx] = running;
  });
  return out;
}

/** A t-test for every pair of groups, with Holm-corrected p values when there are more than two groups. */
export function pairwiseT(groups: number[][], kind: TTestKind = "welch"): PairResult[] {
  const pairs: PairResult[] = [];
  for (let a = 0; a < groups.length; a++) {
    for (let b = a + 1; b < groups.length; b++) {
      const r = tTest(groups[a], groups[b], kind);
      pairs.push({ a, b, diff: r?.diff ?? NaN, stat: r?.t ?? NaN, p: r?.p ?? NaN });
    }
  }
  return correct(pairs);
}

function correct(pairs: PairResult[]): PairResult[] {
  if (pairs.length < 2) return pairs;
  const ok = pairs.filter((x) => Number.isFinite(x.p));
  const adj = holm(ok.map((x) => x.p));
  ok.forEach((x, i) => (x.p = adj[i]));
  return pairs;
}

export interface KsResult {
  /** the largest vertical distance between the two cumulative distributions, and the value where it occurs */
  d: number;
  at: number;
  p: number;
  nA: number;
  nB: number;
  /** false when the p value comes from the large-sample formula */
  exact: boolean;
}

/** Two-sample Kolmogorov–Smirnov test: do the two groups come from the same distribution? (two-sided) */
export function ksTest(aIn: number[], bIn: number[]): KsResult | null {
  const a = finite(aIn).sort((x, y) => x - y);
  const b = finite(bIn).sort((x, y) => x - y);
  const n = a.length;
  const m = b.length;
  if (!n || !m) return null;
  // walk the pooled values; h is the distance in units of 1 / (n·m), so it stays an integer
  let i = 0;
  let j = 0;
  let h = 0;
  let at = a[0];
  while (i < n || j < m) {
    const v = i < n && (j >= m || a[i] <= b[j]) ? a[i] : b[j];
    while (i < n && a[i] === v) i++;
    while (j < m && b[j] === v) j++;
    const dist = Math.abs(i * m - j * n);
    if (dist > h) {
      h = dist;
      at = v;
    }
  }
  const exact = n * m <= 2.5e7;
  return { d: h / (n * m), at, p: exact ? ksExactP(h, n, m) : ksAsymptoticP(h / (n * m), (n * m) / (n + m)), nA: n, nB: m, exact };
}

/** A KS test for every pair of groups, with Holm-corrected p values when there are more than two groups. */
export function pairwiseKs(groups: number[][]): PairResult[] {
  const pairs: PairResult[] = [];
  for (let a = 0; a < groups.length; a++) {
    for (let b = a + 1; b < groups.length; b++) {
      const r = ksTest(groups[a], groups[b]);
      pairs.push({ a, b, diff: r?.d ?? NaN, stat: r?.d ?? NaN, p: r?.p ?? NaN });
    }
  }
  return correct(pairs);
}

export interface Ecdf {
  /** the distinct values, ascending */
  x: number[];
  /** how many values are ≤ x[i] */
  count: number[];
  n: number;
}

const ecdfCache = new WeakMap<number[], Ecdf>();

/** Empirical cumulative distribution of the values (cached on the array's identity). */
export function ecdf(values: number[]): Ecdf {
  const hit = ecdfCache.get(values);
  if (hit) return hit;
  const v = finite(values).sort((a, b) => a - b);
  const x: number[] = [];
  const count: number[] = [];
  for (let i = 0; i < v.length; i++) {
    if (i + 1 < v.length && v[i + 1] === v[i]) continue;
    x.push(v[i]);
    count.push(i + 1);
  }
  const r = { x, count, n: v.length };
  ecdfCache.set(values, r);
  return r;
}

/** Significance stars for a p value: ns, *, **, ***, ****. */
export function stars(p: number): string {
  if (!Number.isFinite(p)) return "";
  return p <= 0.0001 ? "****" : p <= 0.001 ? "***" : p <= 0.01 ? "**" : p <= 0.05 ? "*" : "ns";
}

/** A p value as text: "p = 0.012", "p < 0.0001". */
export function formatP(p: number): string {
  if (!Number.isFinite(p)) return "p = –";
  if (p < 0.0001) return "p < 0.0001";
  return `p = ${p >= 0.01 ? p.toFixed(p >= 0.1 ? 2 : 3) : p.toFixed(4)}`;
}
