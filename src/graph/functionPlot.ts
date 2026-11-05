import { create, all } from "mathjs";
import type { FunctionOptions } from "../model/types";

const math = create(all, { number: "number" });

export interface Sampled {
  x: number[];
  y: number[];
  error?: string;
}

const sampleCache = new WeakMap<FunctionOptions, { from: number; to: number; log: boolean; result: Sampled }>();
const compiledCache = new Map<string, { evaluate: (scope: Record<string, number>) => unknown } | Error>();

/** Sample y = f(x) at `points` positions over [from, to] (log-spaced when `log`). Cached per options object and range. */
export function sampleFunction(opts: FunctionOptions, from: number, to: number, log = false): Sampled {
  const hit = sampleCache.get(opts);
  if (hit && hit.from === from && hit.to === to && hit.log === log) return hit.result;
  const result = computeSamples(opts, from, to, log);
  sampleCache.set(opts, { from, to, log, result });
  return result;
}

function compileExpression(expression: string): { evaluate: (scope: Record<string, number>) => unknown } | Error {
  let c = compiledCache.get(expression);
  if (c === undefined) {
    try {
      c = math.parse(expression).compile();
    } catch (e) {
      c = e as Error;
    }
    if (compiledCache.size > 200) compiledCache.clear();
    compiledCache.set(expression, c);
  }
  return c;
}

function computeSamples(opts: FunctionOptions, from: number, to: number, log: boolean): Sampled {
  const n = Math.max(2, Math.min(5000, Math.round(opts.points) || 400));
  const compiled = compileExpression(opts.expression);
  if (compiled instanceof Error) return { x: [], y: [], error: compiled.message };
  const xs: number[] = [];
  if (log && from > 0 && to > 0) {
    const l0 = Math.log10(from);
    const l1 = Math.log10(to);
    for (let i = 0; i < n; i++) xs.push(Math.pow(10, l0 + ((l1 - l0) * i) / (n - 1)));
  } else for (let i = 0; i < n; i++) xs.push(from + ((to - from) * i) / (n - 1));
  const scope: Record<string, number> = {};
  const y: number[] = [];
  let error: string | undefined;
  for (const x of xs) {
    scope.x = x;
    try {
      const v = compiled.evaluate(scope);
      y.push(typeof v === "number" && Number.isFinite(v) ? v : NaN);
    } catch (e) {
      if (!error) error = (e as Error).message;
      y.push(NaN);
    }
  }
  // drop leading/trailing NaNs but keep inner gaps (rendered as breaks)
  return { x: xs, y, error };
}

/** Check an expression without sampling. Returns an error message or null. */
export function validateFunction(expression: string): string | null {
  try {
    const node = math.parse(expression);
    const free = new Set<string>();
    node.traverse((n, _p, parent) => {
      if (n.type === "SymbolNode" && !(parent && parent.type === "FunctionNode" && (parent as unknown as { fn: unknown }).fn === n)) free.add((n as unknown as { name: string }).name);
    });
    for (const name of free) if (!["x", "pi", "e", "E", "PI", "Infinity"].includes(name)) return `Unknown symbol "${name}" (only x is allowed; write numbers for constants)`;
    node.compile().evaluate({ x: 1 });
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
