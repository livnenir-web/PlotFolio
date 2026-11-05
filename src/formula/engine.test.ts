import { describe, expect, it } from "vitest";
import { evaluateFormula, recalculateSheet } from "./engine";
import { newColumn, newSheet } from "../model/defaults";
import type { Sheet } from "../model/types";

function sheetWith(values: Record<string, (number | string | null)[]>, longNames: string[] = []): Sheet {
  const s = newSheet("t");
  s.columns = Object.values(values).map((v, i) => {
    const c = newColumn("Y");
    c.values = v;
    c.longName = longNames[i] ?? "";
    return c;
  });
  return s;
}

describe("evaluateFormula", () => {
  it("evaluates per-row arithmetic on column letters", () => {
    const s = sheetWith({ A: [1, 2, 3], B: [10, 20, 30] });
    expect(evaluateFormula("A*2 + B", s.columns, 3).values).toEqual([12, 24, 36]);
  });

  it("supports long names, row index i and row count n", () => {
    const s = sheetWith({ A: [60, 120, 180] }, ["Time"]);
    expect(evaluateFormula("Time/60", s.columns, 3).values).toEqual([1, 2, 3]);
    expect(evaluateFormula("i", s.columns, 3).values).toEqual([1, 2, 3]);
    expect(evaluateFormula("n", s.columns, 3).values).toEqual([3, 3, 3]);
  });

  it("folds aggregates over whole columns", () => {
    const s = sheetWith({ A: [1, 2, 3, 4] });
    expect(evaluateFormula("A/max(A)", s.columns, 4).values).toEqual([0.25, 0.5, 0.75, 1]);
    expect(evaluateFormula("A - mean(A)", s.columns, 4).values).toEqual([-1.5, -0.5, 0.5, 1.5]);
    expect(evaluateFormula("mean(A*2)", s.columns, 4).values).toEqual([5, 5, 5, 5]);
  });

  it("handles nested aggregates and std", () => {
    const s = sheetWith({ A: [2, 4, 4, 4, 5, 5, 7, 9] });
    const r = evaluateFormula("(A - mean(A))/std(A)", s.columns, 8).values as number[];
    expect(r[0]).toBeCloseTo((2 - 5) / Math.sqrt(32 / 7), 10);
  });

  it("returns null for missing cells and reports syntax errors", () => {
    const s = sheetWith({ A: [1, null, 3] });
    expect(evaluateFormula("A*2", s.columns, 3).values).toEqual([2, null, 6]);
    const bad = evaluateFormula("A*(2", s.columns, 3);
    expect(bad.error).toBeTruthy();
    expect(bad.values).toEqual([null, null, null]);
  });

  it("applies math functions", () => {
    const s = sheetWith({ A: [1, 10, 100] });
    expect(evaluateFormula("log10(A)", s.columns, 3).values).toEqual([0, 1, 2]);
    expect(evaluateFormula("sqrt(A)", s.columns, 3).values).toEqual([1, Math.sqrt(10), 10]);
  });
});

describe("recalculateSheet", () => {
  it("recalculates dependent formula columns in order", () => {
    const s = sheetWith({ A: [1, 2, 3], B: [], C: [] });
    s.columns[1].formula = "A*10";
    s.columns[2].formula = "B+1";
    recalculateSheet(s);
    expect(s.columns[1].values).toEqual([10, 20, 30]);
    expect(s.columns[2].values).toEqual([11, 21, 31]);
  });

  it("flags circular references", () => {
    const s = sheetWith({ A: [1], B: [], C: [] });
    s.columns[1].formula = "C+1";
    s.columns[2].formula = "B+1";
    recalculateSheet(s);
    expect(s.columns[1].formulaError).toBe("Circular reference");
    expect(s.columns[2].formulaError).toBe("Circular reference");
  });

  it("uses sheet row count when no columns are referenced", () => {
    const s = sheetWith({ A: [1, 2, 3, 4], B: [] });
    s.columns[1].formula = "i^2";
    recalculateSheet(s);
    expect(s.columns[1].values).toEqual([1, 4, 9, 16]);
  });
});
