import { describe, expect, it } from "vitest";
import { buildScale, axisDomain } from "./scales";
import { formatTick, linearTicks, niceDomain, niceStep, logTicks } from "./ticks";
import { newAxis, defaultGraphDefaults } from "../model/defaults";

const d = defaultGraphDefaults();

describe("ticks", () => {
  it("picks nice steps", () => {
    expect(niceStep(10)).toBe(2);
    expect(niceStep(100)).toBe(20);
    expect(niceStep(7)).toBe(1);
    expect(niceStep(0.5)).toBe(0.1);
  });
  it("expands to a nice domain", () => {
    expect(niceDomain(0.3, 9.7)).toEqual({ from: 0, to: 10, step: 2 });
    expect(niceDomain(12, 187)).toEqual({ from: 0, to: 200, step: 50 });
  });
  it("generates linear ticks without float noise", () => {
    expect(linearTicks(0, 1, 0.2)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });
  it("generates log ticks", () => {
    const t = logTicks(1, 1000);
    expect(t.major).toEqual([1, 10, 100, 1000]);
    expect(t.minor).toContain(20);
    expect(t.minor).toContain(900);
  });
  it("formats ticks", () => {
    expect(formatTick(0.2, { numberFormat: "auto", decimals: 2, scale: "linear" }, 0.2)).toBe("0.2");
    expect(formatTick(1000, { numberFormat: "auto", decimals: 2, scale: "log" }, 1)).toBe("1000");
    expect(formatTick(1e5, { numberFormat: "auto", decimals: 2, scale: "log" }, 1)).toBe("10^{5}");
    expect(formatTick(2.5e7, { numberFormat: "scientific", decimals: 1, scale: "linear" }, 1)).toBe("2.5×10^{7}");
  });
});

describe("buildScale", () => {
  it("maps linearly over the range", () => {
    const axis = newAxis(d, "x");
    const s = buildScale(axis, [20, 70], [0, 10]);
    expect(s.from).toBe(0);
    expect(s.to).toBe(10);
    expect(s.map(0)).toBeCloseTo(20);
    expect(s.map(10)).toBeCloseTo(70);
    expect(s.map(5)).toBeCloseTo(45);
    expect(s.invert(45)).toBeCloseTo(5);
    expect(s.major).toEqual([0, 2, 4, 6, 8, 10]);
    expect(s.minor).toEqual([1, 3, 5, 7, 9]);
  });

  it("handles inverted ranges (y axis)", () => {
    const axis = newAxis(d, "y");
    const s = buildScale(axis, [55, 5], [0, 100]);
    expect(s.map(0)).toBeCloseTo(55);
    expect(s.map(100)).toBeCloseTo(5);
  });

  it("supports log scale", () => {
    const axis = { ...newAxis(d, "y"), scale: "log" as const };
    const s = buildScale(axis, [0, 30], [1, 1000]);
    expect(s.map(1)).toBeCloseTo(0);
    expect(s.map(1000)).toBeCloseTo(30);
    expect(s.map(10)).toBeCloseTo(10);
    expect(s.map(0)).toBeNull();
    expect(s.major).toEqual([1, 10, 100, 1000]);
  });

  it("splits the range around axis breaks", () => {
    const axis = { ...newAxis(d, "x"), auto: false, from: 0, to: 100, majorStep: 10, breaks: [{ id: "b", from: 20, to: 80, gapMm: 2 }] };
    const s = buildScale(axis, [0, 42], null);
    // usable = 40mm, pieces 0-20 and 80-100 (equal length) → 20 mm each
    expect(s.map(0)).toBeCloseTo(0);
    expect(s.map(20)).toBeCloseTo(20);
    expect(s.map(80)).toBeCloseTo(22);
    expect(s.map(100)).toBeCloseTo(42);
    expect(s.map(50)).toBeNull();
    expect(s.gaps).toEqual([[20, 22]]);
    expect(s.major).toEqual([0, 10, 20, 80, 90, 100]);
  });

  it("uses manual limits when auto is off", () => {
    const axis = { ...newAxis(d, "x"), auto: false, from: -5, to: 5 };
    expect(axisDomain(axis, [0, 100])).toEqual({ from: -5, to: 5, step: 2 });
  });
});

describe("log2 / ln scales and minor-tick control", () => {
  it("places log2 majors at powers of two and spaces minors evenly in log space", () => {
    const t = logTicks(1, 16, 2, 1);
    expect(t.major).toEqual([1, 2, 4, 8, 16]);
    expect(t.minor[0]).toBeCloseTo(Math.SQRT2, 10);
    expect(logTicks(1, 16, 2, 0).minor).toEqual([]);
  });
  it("maps a log2 axis and formats its labels", () => {
    const axis = { ...newAxis(d, "x"), scale: "log2" as const, minorCount: 0 };
    const s = buildScale(axis, [0, 40], [1, 16]);
    expect(s.map(1)).toBeCloseTo(0);
    expect(s.map(4)).toBeCloseTo(20);
    expect(s.map(16)).toBeCloseTo(40);
    expect(s.minor).toEqual([]);
    expect(formatTick(8, { numberFormat: "auto", decimals: 2, scale: "log2" }, 1)).toBe("8");
    expect(formatTick(65536, { numberFormat: "auto", decimals: 2, scale: "log2" }, 1)).toBe("2^{16}");
  });
  it("disables minors on log10 when the count is 0", () => {
    const axis = { ...newAxis(d, "y"), scale: "log" as const, minorCount: 0 };
    expect(buildScale(axis, [0, 30], [1, 1000]).minor).toEqual([]);
  });
});

describe("positioned breaks and per-segment scales", () => {
  it("centres the gap at the requested fraction of the axis", () => {
    const axis = { ...newAxis(d, "x"), auto: false, from: 0, to: 100, majorStep: 10, breaks: [{ id: "b", from: 20, to: 80, gapMm: 2, position: 0.25 }] };
    const s = buildScale(axis, [0, 42], null);
    // gap centred at 25 % of 42 mm = 10.5 mm → [9.5, 11.5]
    expect(s.gaps[0][0]).toBeCloseTo(9.5);
    expect(s.gaps[0][1]).toBeCloseTo(11.5);
    expect(s.map(20)).toBeCloseTo(9.5);
    expect(s.map(80)).toBeCloseTo(11.5);
    expect(s.map(100)).toBeCloseTo(42);
    expect(s.invert(42)).toBeCloseTo(100);
  });
  it("measures the position from the bottom of a y axis (reversed range)", () => {
    const axis = { ...newAxis(d, "y"), auto: false, from: 0, to: 100, majorStep: 10, breaks: [{ id: "b", from: 20, to: 80, gapMm: 2, position: 0.25 }] };
    const s = buildScale(axis, [50, 10], null); // bottom at 50 mm, top at 10 mm
    // 25 % up from the bottom: 50 - 10 = 40 mm; gap [41, 39] in the upward direction
    expect(s.gaps[0][0]).toBeCloseTo(41);
    expect(s.gaps[0][1]).toBeCloseTo(39);
  });
  it("lets the segment after the break use a log scale with its own ticks", () => {
    const axis = { ...newAxis(d, "x"), auto: false, from: 0, to: 1000, majorStep: 0.25, minorCount: 1, breaks: [{ id: "b", from: 1, to: 10, gapMm: 2, position: 0.5, after: { scale: "log" as const, minorCount: 0 } }] };
    const s = buildScale(axis, [0, 42], null);
    expect(s.major).toEqual([0, 0.25, 0.5, 0.75, 1, 10, 100, 1000]);
    expect(s.tickInfo(0.5).scale).toBe("linear");
    expect(s.tickInfo(100).scale).toBe("log");
    expect(s.map(5)).toBeNull(); // inside the gap
    // log segment spans [22, 42] mm; 100 sits in its middle
    expect(s.map(100)).toBeCloseTo(32);
    expect(s.invert(32)).toBeCloseTo(100);
    expect(s.minor.filter((v) => v > 10)).toEqual([]);
  });
  it("picks a nice step for the segment after the break when none is given", () => {
    const axis = { ...newAxis(d, "x"), auto: false, from: 0, to: 100, majorStep: null, breaks: [{ id: "b", from: 20, to: 80, gapMm: 2 }] };
    expect(buildScale(axis, [0, 42], null).major).toEqual([0, 5, 10, 15, 20, 80, 85, 90, 95, 100]);
  });
});

describe("layout caching", () => {
  it("returns the same layout for an unchanged graph and a new one after an edit", async () => {
    const { layoutGraph } = await import("./layout");
    const { newProject, newGraph } = await import("../model/defaults");
    const p = newProject();
    const g = newGraph(p.defaults, "G");
    p.graphs.push(g);
    const a = layoutGraph(p, g);
    expect(layoutGraph(p, g)).toBe(a);
    const g2 = { ...g, layers: [{ ...g.layers[0], frame: { ...g.layers[0].frame, xMm: 30 } }] };
    const b = layoutGraph(p, g2);
    expect(b).not.toBe(a);
    expect(b.layers[0].layer.frame.xMm).toBe(30);
    // the data of an unchanged plot source is shared
    expect(layoutGraph({ ...p, graphs: [g2] }, g2)).toBe(b);
  });
});

describe("custom ticks", () => {
  const d = defaultGraphDefaults();
  it("adds ticks at given values and keeps their labels", () => {
    const axis = { ...newAxis(d, "x"), auto: false, from: 0, to: 10, majorStep: 5, customTicks: [{ value: 3.3, label: "a" }, { value: 7 }] };
    const sc = buildScale(axis, [0, 50], null);
    expect(sc.major).toEqual([0, 3.3, 5, 7, 10]);
    expect(sc.customLabels?.get(3.3)).toBe("a");
    expect(sc.customLabels?.has(7)).toBe(false);
  });
  it("replaces the regular ticks when asked and drops minor ticks and out-of-range values", () => {
    const axis = { ...newAxis(d, "x"), auto: false, from: 0, to: 10, minorCount: 4, customTicks: [{ value: 2 }, { value: 8 }, { value: 12 }], customTicksMode: "replace" as const };
    const sc = buildScale(axis, [0, 50], null);
    expect(sc.major).toEqual([2, 8]);
    expect(sc.minor).toEqual([]);
  });
});

describe("reversed axes and number formats", () => {
  const d = defaultGraphDefaults();
  it("reverses the automatic and the manual range", () => {
    const auto = buildScale({ ...newAxis(d, "x"), reversed: true }, [0, 50], [0, 10]);
    expect(auto.from).toBeGreaterThan(auto.to);
    expect(auto.map(auto.from)).toBeCloseTo(0);
    const manual = buildScale({ ...newAxis(d, "x"), auto: false, from: 2, to: 8, reversed: true }, [0, 50], null);
    expect([manual.from, manual.to]).toEqual([8, 2]);
  });
  it("formats exponent, engineering and thousands", () => {
    const base = { decimals: 1, scale: "linear" as const };
    expect(formatTick(1500, { ...base, numberFormat: "exponent" }, 500)).toBe("1.5e3");
    expect(formatTick(1500, { ...base, numberFormat: "engineering" }, 500)).toBe("1.5k");
    expect(formatTick(0.002, { ...base, numberFormat: "engineering" }, 0.001)).toBe("2m");
    expect(formatTick(12345, { ...base, numberFormat: "fixed", decimals: 0, thousands: true }, 1)).toBe("12,345");
    expect(formatTick(-1234567.5, { ...base, numberFormat: "fixed", thousands: true }, 1)).toBe("-1,234,567.5");
    expect(formatTick(1e7, { ...base, numberFormat: "scientific", thousands: true }, 1)).toBe("10^{7}");
  });
});
