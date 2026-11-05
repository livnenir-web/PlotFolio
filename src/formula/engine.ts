import { create, all, type MathNode } from "mathjs";
import type { CellValue, Column, Sheet } from "../model/types";
import { columnLetter } from "../model/defaults";

const math = create(all, { number: "number" });

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED = new Set(["i", "n", "pi", "e", "true", "false", "null", "Infinity", "NaN"]);

function finite(xs: number[]): number[] {
  return xs.filter((v) => Number.isFinite(v));
}

const AGGREGATES: Record<string, (xs: number[]) => number> = {
  mean: (xs) => {
    const f = finite(xs);
    return f.length ? f.reduce((a, b) => a + b, 0) / f.length : NaN;
  },
  sum: (xs) => finite(xs).reduce((a, b) => a + b, 0),
  max: (xs) => {
    const f = finite(xs);
    return f.length ? f.reduce((a, b) => (b > a ? b : a), -Infinity) : NaN;
  },
  min: (xs) => {
    const f = finite(xs);
    return f.length ? f.reduce((a, b) => (b < a ? b : a), Infinity) : NaN;
  },
  count: (xs) => finite(xs).length,
  std: (xs) => {
    const f = finite(xs);
    if (f.length < 2) return NaN;
    const m = f.reduce((a, b) => a + b, 0) / f.length;
    return Math.sqrt(f.reduce((a, b) => a + (b - m) ** 2, 0) / (f.length - 1));
  },
  variance: (xs) => {
    const f = finite(xs);
    if (f.length < 2) return NaN;
    const m = f.reduce((a, b) => a + b, 0) / f.length;
    return f.reduce((a, b) => a + (b - m) ** 2, 0) / (f.length - 1);
  },
  median: (xs) => {
    const f = finite(xs).sort((a, b) => a - b);
    if (!f.length) return NaN;
    const mid = Math.floor(f.length / 2);
    return f.length % 2 ? f[mid] : (f[mid - 1] + f[mid]) / 2;
  },
  first: (xs) => {
    const f = finite(xs);
    return f.length ? f[0] : NaN;
  },
  last: (xs) => {
    const f = finite(xs);
    return f.length ? f[f.length - 1] : NaN;
  },
};

export interface NameMap {
  /** symbol name → column index */
  byName: Map<string, number>;
}

/** Builds the symbol table: column letters always, long names when they are valid identifiers. */
export function buildNameMap(columns: Column[]): NameMap {
  const byName = new Map<string, number>();
  columns.forEach((_, idx) => byName.set(columnLetter(idx), idx));
  columns.forEach((c, idx) => {
    const name = c.longName.trim();
    if (IDENT.test(name) && !byName.has(name) && !RESERVED.has(name)) byName.set(name, idx);
  });
  return { byName };
}

const parseCache = new Map<string, MathNode>();
/** Parse an expression; parsed trees are cached by text (syntax errors are thrown and not cached). */
export function parseFormula(expr: string): MathNode {
  const hit = parseCache.get(expr);
  if (hit) return hit;
  const node = math.parse(expr);
  if (parseCache.size > 500) parseCache.clear();
  parseCache.set(expr, node);
  return node;
}
const compiledCache = new WeakMap<MathNode, { evaluate: (scope: Record<string, unknown>) => unknown }>();
function compileNode(node: MathNode): { evaluate: (scope: Record<string, unknown>) => unknown } {
  let c = compiledCache.get(node);
  if (!c) {
    c = node.compile();
    compiledCache.set(node, c);
  }
  return c;
}

/** Column indices referenced by the expression. Throws on syntax error. */
export function referencedColumnIndices(expr: string, names: NameMap): Set<number> {
  const node = parseFormula(expr);
  return collectRefs(node, names);
}

function collectRefs(node: MathNode, names: NameMap): Set<number> {
  const refs = new Set<number>();
  node.traverse((n) => {
    if (n.type === "SymbolNode") {
      const idx = names.byName.get((n as unknown as { name: string }).name);
      if (idx !== undefined) refs.add(idx);
    }
  });
  return refs;
}

function cellToScope(v: CellValue): number | string {
  if (v === null || v === undefined) return NaN;
  if (typeof v === "number") return v;
  const t = v.trim();
  if (t === "") return NaN;
  const num = Number(t);
  return Number.isFinite(num) ? num : v;
}

interface EvalContext {
  columns: Column[];
  names: NameMap;
  rows: number;
}

function evalPerRow(node: MathNode, ctx: EvalContext): { values: CellValue[]; error?: string } {
  const refs = [...collectRefs(node, ctx.names)];
  const symbolNames: { name: string; idx: number }[] = [];
  for (const [name, idx] of ctx.names.byName) if (refs.includes(idx)) symbolNames.push({ name, idx });
  const compiled = compileNode(node);
  const out: CellValue[] = new Array(ctx.rows);
  let error: string | undefined;
  const scope: Record<string, unknown> = { n: ctx.rows };
  for (let r = 0; r < ctx.rows; r++) {
    scope.i = r + 1;
    for (const s of symbolNames) scope[s.name] = cellToScope(ctx.columns[s.idx].values[r] ?? null);
    try {
      const v = compiled.evaluate(scope);
      out[r] = normalizeResult(v);
    } catch (e) {
      out[r] = null;
      if (!error) error = (e as Error).message;
    }
  }
  return { values: out, error };
}

function normalizeResult(v: unknown): CellValue {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") return v;
  if (typeof v === "bigint") return Number(v);
  return null;
}

function hasAggregate(node: MathNode, ctx: EvalContext): boolean {
  let found = false;
  node.traverse((n) => {
    if (found || n.type !== "FunctionNode") return;
    const fn = n as unknown as { fn: { name: string }; args: MathNode[] };
    if (AGGREGATES[fn.fn.name] && fn.args.length === 1 && collectRefs(fn.args[0], ctx.names).size > 0) found = true;
  });
  return found;
}

/** Replace aggregate calls over columns (mean(B), max(A*2) …) with constants. Returns the same node when there are none. */
function foldAggregates(node: MathNode, ctx: EvalContext): MathNode {
  if (!hasAggregate(node, ctx)) return node;
  return node.transform((n) => {
    if (n.type === "FunctionNode") {
      const fn = n as unknown as { fn: { name: string }; args: MathNode[] };
      const agg = AGGREGATES[fn.fn.name];
      if (agg && fn.args.length === 1 && collectRefs(fn.args[0], ctx.names).size > 0) {
        const inner = foldAggregates(fn.args[0], ctx);
        const { values } = evalPerRow(inner, ctx);
        const nums = values.map((v) => (typeof v === "number" ? v : NaN));
        return new math.ConstantNode(agg(nums));
      }
    }
    return n;
  });
}

export interface FormulaResult {
  values: CellValue[];
  error?: string;
}

/**
 * Evaluate a column formula against the sheet's columns.
 * `rows` is the number of rows to produce (normally the sheet's row count).
 */
export function evaluateFormula(expr: string, columns: Column[], rows: number): FormulaResult {
  const names = buildNameMap(columns);
  let node: MathNode;
  try {
    node = parseFormula(expr);
  } catch (e) {
    return { values: new Array(rows).fill(null), error: (e as Error).message };
  }
  const ctx: EvalContext = { columns, names, rows };
  try {
    const folded = foldAggregates(node, ctx);
    return evalPerRow(folded, ctx);
  } catch (e) {
    return { values: new Array(rows).fill(null), error: (e as Error).message };
  }
}

export function sheetRowCount(sheet: Sheet): number {
  return sheet.columns.reduce((m, c) => Math.max(m, c.values.length), 0);
}

/**
 * Recalculate the formula columns of the sheet in dependency order.
 * Mutates the columns in place (intended for use inside an immer producer).
 * With `changed` (column indices whose values or formula were edited) only the formulas that depend on
 * them, transitively, are re-evaluated; the other columns keep their values untouched.
 */
export function recalculateSheet(sheet: Sheet, changed?: Set<number>): void {
  const cols = sheet.columns;
  const names = buildNameMap(cols);
  const formulaIdx = cols.map((c, i) => (c.formula?.trim() ? i : -1)).filter((i) => i >= 0);
  if (formulaIdx.length === 0) return;

  const deps = new Map<number, Set<number>>();
  for (const i of formulaIdx) {
    try {
      deps.set(i, referencedColumnIndices(cols[i].formula!, names));
      cols[i].formulaError = undefined;
    } catch (e) {
      deps.set(i, new Set());
      cols[i].formulaError = (e as Error).message;
    }
  }

  // Topological order (Kahn) among formula columns only.
  const formulaSet = new Set(formulaIdx);
  const indeg = new Map<number, number>();
  for (const i of formulaIdx) indeg.set(i, [...deps.get(i)!].filter((d) => formulaSet.has(d)).length);
  const queue = formulaIdx.filter((i) => indeg.get(i) === 0);
  const order: number[] = [];
  while (queue.length) {
    const i = queue.shift()!;
    order.push(i);
    for (const j of formulaIdx) {
      if (deps.get(j)!.has(i)) {
        indeg.set(j, indeg.get(j)! - 1);
        if (indeg.get(j) === 0) queue.push(j);
      }
    }
  }
  // which formula columns need re-evaluation
  let dirty: Set<number>;
  if (!changed) dirty = new Set(formulaIdx);
  else {
    // edited formulas, formulas without column references (they depend on the row count), and dependents
    dirty = new Set(formulaIdx.filter((i) => changed.has(i) || deps.get(i)!.size === 0));
    let grew = true;
    while (grew) {
      grew = false;
      for (const i of formulaIdx) {
        if (dirty.has(i)) continue;
        for (const d of deps.get(i)!) {
          if (changed.has(d) || dirty.has(d)) {
            dirty.add(i);
            grew = true;
            break;
          }
        }
      }
    }
  }
  const rows = sheetRowCount(sheet);
  for (const i of order) {
    const col = cols[i];
    if (col.formulaError || !dirty.has(i)) continue;
    const refs = deps.get(i)!;
    const refRows = [...refs].reduce((m, r) => Math.max(m, cols[r].values.length), 0);
    const n = refs.size ? refRows : rows;
    const res = evaluateFormula(col.formula!, cols, n);
    col.values = res.values;
    col.formulaError = res.error;
  }
  for (const i of formulaIdx) {
    if (!order.includes(i)) cols[i].formulaError = "Circular reference";
  }
}
