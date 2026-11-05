import { describe, expect, it } from "vitest";
import { averageCurves, derivative, fftSpectrum, integrate, interpolate, movingAverage, normalize, savitzkyGolay } from "./signal";
import { isolines, autoLevels } from "../graph/contour";
import { colorAt, makeColorMapper } from "../graph/colormaps";

describe("signal math", () => {
  it("moving average and Savitzky-Golay preserve a straight line", () => {
    const y = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(movingAverage(y, 3).slice(1, 9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const sg = savitzkyGolay(y, 5, 2);
    sg.slice(2, 8).forEach((v, i) => expect(v).toBeCloseTo(i + 2, 10));
  });

  it("differentiates and integrates", () => {
    const x = [0, 1, 2, 3, 4];
    const y = x.map((v) => v * v);
    const d = derivative(x, y);
    expect(d[2]).toBe(4);
    const I = integrate(x, y);
    expect(I[4]).toBeCloseTo(22, 10); // trapezoid of x² on 0..4
  });

  it("normalizes", () => {
    expect(normalize([1, 2, 4], "max")).toEqual([0.25, 0.5, 1]);
    expect(normalize([1, 2, 3], "range")).toEqual([0, 0.5, 1]);
  });

  it("interpolates and averages curves on different grids", () => {
    expect(interpolate([0, 2], [0, 4], [1])).toEqual([2]);
    const a = { x: [0, 1, 2, 3], y: [0, 1, 2, 3] };
    const b = { x: [0.5, 1.5, 2.5], y: [2.5, 3.5, 4.5] }; // y = x + 2
    const r = averageCurves([a, b], "union");
    const i = r.x.indexOf(1.5);
    expect(r.mean[i]).toBeCloseTo(2.5, 10); // (1.5 + 3.5)/2
    expect(r.n[i]).toBe(2);
    expect(r.sd[i]).toBeCloseTo(Math.SQRT2, 10);
  });

  it("finds the frequency of a sine with the FFT", () => {
    const n = 256;
    const x = Array.from({ length: n }, (_, i) => i / 100); // 100 Hz sampling
    const y = x.map((t) => Math.sin(2 * Math.PI * 10 * t));
    const s = fftSpectrum(x, y);
    const k = s.amplitude.indexOf(Math.max(...s.amplitude));
    expect(s.freq[k]).toBeCloseTo(10, 0);
  });
});

describe("contours and colormaps", () => {
  it("draws a circle-like isoline of r² at level 1", () => {
    const x = Array.from({ length: 21 }, (_, i) => -2 + i * 0.2);
    const y = x;
    const z = y.map((yy) => x.map((xx) => xx * xx + yy * yy));
    const lines = isolines(x, y, z, 1);
    expect(lines.length).toBeGreaterThan(0);
    const longest = lines.reduce((a, b) => (b.length > a.length ? b : a));
    for (const [px, py] of longest) expect(Math.hypot(px, py)).toBeCloseTo(1, 1);
  });

  it("spaces levels and maps colors", () => {
    expect(autoLevels(0, 10, 4)).toEqual([2, 4, 6, 8]);
    expect(colorAt("gray", 0)).toBe("#000000");
    expect(colorAt("gray", 1)).toBe("#ffffff");
    const m = makeColorMapper({ name: "gray", reverse: false, min: null, max: null, log: false }, 0, 10);
    expect(m(5)).toBe("#808080");
  });
});
