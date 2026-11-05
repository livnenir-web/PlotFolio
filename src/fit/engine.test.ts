import { describe, expect, it } from "vitest";
import { fitCurve, predictWithBand, tQuantile } from "./engine";
import { BUILTIN_FUNCTIONS, compileCustom, polynomialDef } from "./functions";

const byId = (id: string) => BUILTIN_FUNCTIONS.find((f) => f.id === id)!;

describe("fitCurve", () => {
  it("recovers an exact exponential decay", () => {
    const def = byId("expDecay");
    const x = Array.from({ length: 50 }, (_, i) => i * 0.2);
    const y = x.map((v) => 0.5 + 3 * Math.exp(-v / 2.5));
    const r = fitCurve(def, { x, y }, def.guess(x, y));
    expect(r.converged).toBe(true);
    expect(r.params[0]).toBeCloseTo(0.5, 6);
    expect(r.params[1]).toBeCloseTo(3, 6);
    expect(r.params[2]).toBeCloseTo(2.5, 6);
    expect(r.rSquared).toBeCloseTo(1, 8);
  });

  it("matches the closed-form linear regression and its standard errors", () => {
    const def = byId("linear");
    const x = [1, 2, 3, 4, 5];
    const y = [2.1, 3.9, 6.2, 7.8, 10.1];
    const r = fitCurve(def, { x, y }, def.guess(x, y));
    // slope 1.99, intercept 0.05 (from normal equations)
    expect(r.params[0]).toBeCloseTo(1.99, 10);
    expect(r.params[1]).toBeCloseTo(0.05, 10);
    // standard error of slope = sqrt(s² / Sxx), s² = SSres/(n-2)
    const ssRes = r.residuals.reduce((a, b) => a + b * b, 0);
    const s2 = ssRes / 3;
    const sxx = 10;
    expect(r.errors[0]).toBeCloseTo(Math.sqrt(s2 / sxx), 8);
    expect(r.dof).toBe(3);
  });

  it("fits a gaussian with noise reasonably", () => {
    const def = byId("gaussian");
    const x = Array.from({ length: 101 }, (_, i) => -5 + i * 0.1);
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.02;
    const y = x.map((v) => 0.1 + 2 * Math.exp(-((v - 0.7) ** 2) / (2 * 0.8 ** 2)) + rnd());
    const r = fitCurve(def, { x, y }, def.guess(x, y));
    expect(r.params[2]).toBeCloseTo(0.7, 2);
    expect(Math.abs(r.params[3])).toBeCloseTo(0.8, 2);
    expect(r.params[1]).toBeCloseTo(2, 1);
  });

  it("uses weights when requested", () => {
    const def = byId("linear");
    const x = [0, 1, 2, 3];
    const y = [0, 1, 2, 10];
    const sigma = [0.1, 0.1, 0.1, 100];
    const r = fitCurve(def, { x, y, sigma }, [0, 0], { weighted: true });
    expect(r.params[0]).toBeCloseTo(1, 3);
    expect(r.params[1]).toBeCloseTo(0, 3);
  });

  it("supports polynomial and custom expressions", () => {
    const poly = polynomialDef(2);
    const x = [0, 1, 2, 3, 4];
    const y = x.map((v) => 1 + 2 * v + 0.5 * v * v);
    const r = fitCurve(poly, { x, y }, poly.guess(x, y));
    expect(r.params.map((p) => Number(p.toFixed(8)))).toEqual([1, 2, 0.5]);

    const custom = compileCustom("a*exp(-x/t) + y0");
    expect(custom.params).toEqual(["a", "t", "y0"]);
    const yc = x.map((v) => 4 * Math.exp(-v / 1.5) + 1);
    const rc = fitCurve(custom, { x, y: yc }, [1, 1, 0]);
    expect(rc.params[0]).toBeCloseTo(4, 4);
    expect(rc.params[1]).toBeCloseTo(1.5, 4);
    expect(rc.params[2]).toBeCloseTo(1, 4);
  });

  it("keeps fixed parameters fixed", () => {
    const def = byId("linear");
    const r = fitCurve(def, { x: [0, 1, 2], y: [1, 3, 5] }, [0, 0.5], { fixed: [false, true] });
    expect(r.params[1]).toBe(0.5);
    expect(r.errors[1]).toBe(0);
  });
});

describe("statistics helpers", () => {
  it("computes t quantiles", () => {
    expect(tQuantile(0.975, 10)).toBeCloseTo(2.228, 3);
    expect(tQuantile(0.975, 3)).toBeCloseTo(3.182, 3);
    expect(tQuantile(0.975, 1e7)).toBeCloseTo(1.96, 2);
  });

  it("builds a confidence band around the fit", () => {
    const def = byId("linear");
    const x = [1, 2, 3, 4, 5];
    const y = [2.1, 3.9, 6.2, 7.8, 10.1];
    const r = fitCurve(def, { x, y }, def.guess(x, y));
    const b = predictWithBand(def, r.params, r.cov, r.dof, [3]);
    expect(b.y[0]).toBeCloseTo(6.02, 10);
    expect(b.upper[0]).toBeGreaterThan(b.y[0]);
    expect(b.lower[0]).toBeLessThan(b.y[0]);
    // band at the mean x = t * s / sqrt(n)
    const ssRes = r.residuals.reduce((a, c) => a + c * c, 0);
    const s = Math.sqrt(ssRes / 3);
    expect(b.upper[0] - b.y[0]).toBeCloseTo((tQuantile(0.975, 3) * s) / Math.sqrt(5), 6);
  });
});

describe("peak fits from automatic guesses", () => {
  const noisy = (fn: (x: number) => number, n = 120, x0 = -5, x1 = 5) => {
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.05;
    const x = Array.from({ length: n }, (_, i) => x0 + ((x1 - x0) * i) / (n - 1));
    return { x, y: x.map((v) => fn(v) + rnd()) };
  };
  it("fits a Lorentzian peak on a baseline", () => {
    const def = byId("lorentzian");
    const { x, y } = noisy((v) => 1 + (2 * 1.5 / Math.PI) * (0.8 / (4 * (v - 0.6) ** 2 + 0.64)));
    const r = fitCurve(def, { x, y }, def.guess(x, y));
    expect(r.params[2]).toBeCloseTo(0.6, 1);
    expect(Math.abs(r.params[3])).toBeCloseTo(0.8, 1);
    expect(r.rSquared).toBeGreaterThan(0.95);
  });
  it("fits a Gaussian dip (negative amplitude)", () => {
    const def = byId("gaussian");
    const { x, y } = noisy((v) => 3 - 2 * Math.exp(-((v + 1) ** 2) / (2 * 0.5 ** 2)));
    const r = fitCurve(def, { x, y }, def.guess(x, y));
    expect(r.params[1]).toBeCloseTo(-2, 1);
    expect(r.params[2]).toBeCloseTo(-1, 1);
    expect(r.rSquared).toBeGreaterThan(0.95);
  });
});
