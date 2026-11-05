import { create, all } from "mathjs";

const math = create(all, { number: "number" });

export type FitFn = (x: number, p: number[]) => number;

export interface FitFunctionDef {
  id: string;
  name: string;
  /** Human readable formula, using parameter names and x. */
  expression: string;
  params: string[];
  fn: FitFn;
  /** Initial parameter guesses from the data. */
  guess: (x: number[], y: number[]) => number[];
  /** Linear in the parameters (solved exactly). */
  linear?: boolean;
  /** Basis functions for linear models: y = Σ p_k · basis_k(x). */
  basis?: (x: number) => number[];
}

function stats(x: number[], y: number[]) {
  const n = x.length;
  const xmin = Math.min(...x);
  const xmax = Math.max(...x);
  const ymin = Math.min(...y);
  const ymax = Math.max(...y);
  const ymean = y.reduce((a, b) => a + b, 0) / n;
  const iMax = y.indexOf(ymax);
  const iMin = y.indexOf(ymin);
  return { n, xmin, xmax, ymin, ymax, ymean, iMax, iMin, xspan: xmax - xmin || 1 };
}

function linReg(x: number[], y: number[]): [number, number] {
  const n = x.length;
  const sx = x.reduce((a, b) => a + b, 0);
  const sy = y.reduce((a, b) => a + b, 0);
  const sxx = x.reduce((a, b) => a + b * b, 0);
  const sxy = x.reduce((a, b, i) => a + b * y[i], 0);
  const d = n * sxx - sx * sx || 1e-12;
  const a = (n * sxy - sx * sy) / d;
  return [a, (sy - a * sx) / n];
}

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Peak (or dip) description: baseline from the median, extremum index, FWHM measured in x. */
function peakGuess(x: number[], y: number[]): { base: number; idx: number; height: number; fwhm: number } {
  const base = median(y);
  let idx = 0;
  let best = -Infinity;
  for (let i = 0; i < y.length; i++) {
    const dev = Math.abs(y[i] - base);
    if (dev > best) {
      best = dev;
      idx = i;
    }
  }
  const height = y[idx] - base;
  const half = base + height / 2;
  const above = (v: number) => (height >= 0 ? v > half : v < half);
  let l = idx;
  let r = idx;
  while (l > 0 && above(y[l])) l--;
  while (r < y.length - 1 && above(y[r])) r++;
  let fwhm = Math.abs(x[r] - x[l]);
  const span = Math.max(...x) - Math.min(...x) || 1;
  if (!(fwhm > 0) || fwhm > span) fwhm = span / 5;
  return { base, idx, height, fwhm };
}

export function polynomialDef(degree: number): FitFunctionDef {
  const params = Array.from({ length: degree + 1 }, (_, i) => `a${i}`);
  return {
    id: `poly${degree}`,
    name: `Polynomial (degree ${degree})`,
    expression: params.map((p, i) => (i === 0 ? p : i === 1 ? `${p}*x` : `${p}*x^${i}`)).join(" + "),
    params,
    linear: true,
    basis: (x) => params.map((_, i) => Math.pow(x, i)),
    fn: (x, p) => p.reduce((s, c, i) => s + c * Math.pow(x, i), 0),
    guess: () => new Array(degree + 1).fill(0),
  };
}

export const BUILTIN_FUNCTIONS: FitFunctionDef[] = [
  {
    id: "linear",
    name: "Linear",
    expression: "a*x + b",
    params: ["a", "b"],
    linear: true,
    basis: (x) => [x, 1],
    fn: (x, [a, b]) => a * x + b,
    guess: (x, y) => linReg(x, y),
  },
  polynomialDef(2),
  polynomialDef(3),
  {
    id: "expDecay",
    name: "Exponential decay",
    expression: "y0 + A*exp(-x/t)",
    params: ["y0", "A", "t"],
    fn: (x, [y0, A, t]) => y0 + A * Math.exp(-x / t),
    guess: (x, y) => {
      const s = stats(x, y);
      const decreasing = y[0] > y[y.length - 1];
      const y0 = decreasing ? s.ymin : s.ymax;
      return [y0, y[0] - y0 || s.ymax - s.ymin || 1, s.xspan / 3];
    },
  },
  {
    id: "expGrowth",
    name: "Exponential growth",
    expression: "y0 + A*exp(x/t)",
    params: ["y0", "A", "t"],
    fn: (x, [y0, A, t]) => y0 + A * Math.exp(x / t),
    guess: (x, y) => {
      const s = stats(x, y);
      return [s.ymin, (y[0] - s.ymin) || 1e-3 * Math.abs(s.ymax || 1), s.xspan / 3];
    },
  },
  {
    id: "gaussian",
    name: "Gaussian",
    expression: "y0 + A*exp(-(x-xc)^2/(2*w^2))",
    params: ["y0", "A", "xc", "w"],
    fn: (x, [y0, A, xc, w]) => y0 + A * Math.exp(-((x - xc) ** 2) / (2 * w * w)),
    guess: (x, y) => {
      const p = peakGuess(x, y);
      return [p.base, p.height, x[p.idx], p.fwhm / 2.3548];
    },
  },
  {
    id: "lorentzian",
    name: "Lorentzian",
    expression: "y0 + (2*A/pi)*w/(4*(x-xc)^2 + w^2)",
    params: ["y0", "A", "xc", "w"],
    fn: (x, [y0, A, xc, w]) => y0 + ((2 * A) / Math.PI) * (w / (4 * (x - xc) ** 2 + w * w)),
    guess: (x, y) => {
      const p = peakGuess(x, y);
      return [p.base, (p.height * Math.PI * p.fwhm) / 2, x[p.idx], p.fwhm];
    },
  },
  {
    id: "power",
    name: "Power law",
    expression: "a*x^b",
    params: ["a", "b"],
    fn: (x, [a, b]) => a * Math.pow(x, b),
    guess: (x, y) => {
      const pts = x.map((xv, i) => [xv, y[i]]).filter(([a, b]) => a > 0 && b > 0);
      if (pts.length < 2) return [1, 1];
      const [b, loga] = linReg(pts.map((p) => Math.log(p[0])), pts.map((p) => Math.log(p[1])));
      return [Math.exp(loga), b];
    },
  },
  {
    id: "boltzmann",
    name: "Sigmoid (Boltzmann)",
    expression: "A2 + (A1-A2)/(1+exp((x-x0)/dx))",
    params: ["A1", "A2", "x0", "dx"],
    fn: (x, [A1, A2, x0, dx]) => A2 + (A1 - A2) / (1 + Math.exp((x - x0) / dx)),
    guess: (x, y) => {
      const s = stats(x, y);
      const mid = (y[0] + y[y.length - 1]) / 2;
      let i = 0;
      while (i < y.length - 1 && (y[i] - mid) * (y[0] - mid) > 0) i++;
      return [y[0], y[y.length - 1], x[i], s.xspan / 10];
    },
  },
  {
    id: "hill",
    name: "Hill",
    expression: "Vmax*x^n/(k^n + x^n)",
    params: ["Vmax", "k", "n"],
    fn: (x, [Vmax, k, n]) => (Vmax * Math.pow(x, n)) / (Math.pow(k, n) + Math.pow(x, n)),
    guess: (x, y) => {
      const s = stats(x, y);
      const half = s.ymax / 2;
      let i = 0;
      while (i < y.length - 1 && y[i] < half) i++;
      return [s.ymax, x[i] || s.xspan / 2, 1];
    },
  },
  {
    id: "sine",
    name: "Sine",
    expression: "y0 + A*sin(2*pi*x/T + phi)",
    params: ["y0", "A", "T", "phi"],
    fn: (x, [y0, A, T, phi]) => y0 + A * Math.sin((2 * Math.PI * x) / T + phi),
    guess: (x, y) => {
      const s = stats(x, y);
      // crude period estimate from zero crossings of (y - mean)
      let crossings = 0;
      for (let i = 1; i < y.length; i++) if ((y[i] - s.ymean) * (y[i - 1] - s.ymean) < 0) crossings++;
      const T = crossings > 1 ? (2 * s.xspan) / crossings : s.xspan;
      return [s.ymean, (s.ymax - s.ymin) / 2, T, 0];
    },
  },
];

const RESERVED = new Set(["x", "pi", "e", "E", "PI", "i", "Infinity", "NaN", "true", "false"]);

/** Compile a user expression such as "a*exp(-x/t) + y0" into a fit function; parameters are the free symbols. */
export function compileCustom(expression: string): FitFunctionDef {
  const node = math.parse(expression);
  const params: string[] = [];
  node.traverse((n, _path, parent) => {
    if (n.type !== "SymbolNode") return;
    const name = (n as unknown as { name: string }).name;
    if (RESERVED.has(name)) return;
    // skip function names (FunctionNode.fn is a SymbolNode)
    if (parent && parent.type === "FunctionNode" && (parent as unknown as { fn: unknown }).fn === n) return;
    if (!params.includes(name)) params.push(name);
  });
  if (params.length === 0) throw new Error("The expression has no parameters (use names like a, b, t besides x)");
  const compiled = node.compile();
  const scope: Record<string, number> = {};
  const fn: FitFn = (x, p) => {
    scope.x = x;
    params.forEach((name, i) => (scope[name] = p[i]));
    const v = compiled.evaluate(scope);
    return typeof v === "number" ? v : NaN;
  };
  return {
    id: "custom",
    name: "Custom",
    expression,
    params,
    fn,
    guess: () => params.map(() => 1),
  };
}
