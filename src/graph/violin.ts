// Smoothed distribution of a group of values, for violin plots and for spreading data points sideways.

export interface Density {
  /** evenly spaced values from the smallest to the largest data value */
  v: number[];
  /** density at each value, scaled so the largest is 1 */
  d: number[];
}

const cache = new WeakMap<number[], Density>();
const POINTS = 80;

/**
 * Gaussian kernel density of the values (sorted ascending, finite) with Silverman's bandwidth, trimmed to the data
 * range. Cached on the array's identity; BoxStats.values is such an array.
 */
export function density(sorted: number[]): Density {
  const hit = cache.get(sorted);
  if (hit) return hit;
  const n = sorted.length;
  const lo = sorted[0];
  const hi = sorted[n - 1];
  let r: Density;
  if (n < 2 || !(hi > lo)) r = { v: [lo, hi], d: [1, 1] };
  else {
    // a regular sample of very long columns keeps the cost bounded without changing the shape
    const step = Math.max(1, Math.floor(n / 4000));
    const s = step > 1 ? sorted.filter((_, i) => i % step === 0) : sorted;
    const m = s.length;
    let mean = 0;
    for (const x of s) mean += x;
    mean /= m;
    let ss = 0;
    for (const x of s) ss += (x - mean) ** 2;
    const sd = Math.sqrt(ss / (m - 1));
    const q = (p: number) => {
      const pos = (m - 1) * p;
      const a = Math.floor(pos);
      return s[a] + (s[Math.min(m - 1, a + 1)] - s[a]) * (pos - a);
    };
    const iqr = (q(0.75) - q(0.25)) / 1.34;
    const spread = iqr > 0 ? Math.min(sd, iqr) : sd;
    const h = 0.9 * (spread > 0 ? spread : (hi - lo) / 4) * Math.pow(m, -0.2);
    const v: number[] = [];
    const d: number[] = [];
    let max = 0;
    for (let k = 0; k < POINTS; k++) {
      const x = lo + ((hi - lo) * k) / (POINTS - 1);
      let sum = 0;
      for (const xi of s) {
        const u = (x - xi) / h;
        if (u > 5) continue;
        if (u < -5) break; // sorted: every later value is further away
        sum += Math.exp(-0.5 * u * u);
      }
      v.push(x);
      d.push(sum);
      if (sum > max) max = sum;
    }
    r = { v, d: d.map((x) => (max > 0 ? x / max : 1)) };
  }
  cache.set(sorted, r);
  return r;
}

/** Density (0 … 1) at a value, by linear interpolation. */
export function densityAt(den: Density, value: number): number {
  const n = den.v.length;
  const lo = den.v[0];
  const hi = den.v[n - 1];
  if (!(hi > lo)) return 1;
  const pos = ((value - lo) / (hi - lo)) * (n - 1);
  if (pos <= 0) return den.d[0];
  if (pos >= n - 1) return den.d[n - 1];
  const a = Math.floor(pos);
  return den.d[a] + (den.d[a + 1] - den.d[a]) * (pos - a);
}

/** Sideways position of the i-th point, −1 … 1: evenly spread and the same on every redraw. */
export function spreadOf(i: number): number {
  return ((i * 0.6180339887498949) % 1) * 2 - 1;
}
