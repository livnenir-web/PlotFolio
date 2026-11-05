import type { Axis } from "../model/types";
import { isLogScale, linearMinorTicks, linearTicks, logBase, logNiceDomain, logTicks, niceDomain, niceStep } from "./ticks";
import type { AxisScale as ScaleKind } from "../model/types";

export interface ScaleSegment {
  from: number;
  to: number;
  r0: number;
  r1: number;
  /** Scale kind and major step used inside this segment (segments after a break may differ from the axis). */
  scale: ScaleKind;
  step: number;
}

export interface AxisScale {
  from: number;
  to: number;
  step: number;
  scale: ScaleKind;
  /** Category labels for bar/box axes (ticks at 1..n). */
  categories?: string[];
  segments: ScaleSegment[];
  /** Positions (in range units) of the gaps: [start, end] per break. */
  gaps: [number, number][];
  major: number[];
  minor: number[];
  /** Map a data value to range units; null inside a gap or for non-positive log values. */
  map: (v: number) => number | null;
  /** Inverse map (range → data), ignoring gaps. */
  invert: (r: number) => number;
  /** Scale kind and step of the segment a value falls in (for formatting its tick label). */
  tickInfo: (v: number) => { scale: ScaleKind; step: number };
  /** Labels given explicitly for custom ticks, by value. */
  customLabels?: Map<number, string>;
}

const tf = (scale: ScaleKind) => {
  if (!isLogScale(scale)) return (v: number) => v;
  const b = Math.log(logBase(scale));
  return (v: number) => Math.log(v) / b;
};
const itf = (scale: ScaleKind) => {
  if (!isLogScale(scale)) return (v: number) => v;
  const base = logBase(scale);
  return (v: number) => Math.pow(base, v);
};

/** Effective domain of an axis given the data extent (auto) or the manual limits. */
export function axisDomain(axis: Axis, dataExtent: [number, number] | null): { from: number; to: number; step: number } {
  const d = rawDomain(axis, dataExtent);
  // "reversed" flips the stored or automatic range; a manual range typed high-to-low is reversed already
  return axis.reversed ? { from: d.to, to: d.from, step: d.step } : d;
}

function rawDomain(axis: Axis, dataExtent: [number, number] | null): { from: number; to: number; step: number } {
  if (isLogScale(axis.scale)) {
    let from: number;
    let to: number;
    if (axis.auto || !(axis.from > 0) || !(axis.to > 0)) {
      const d = logNiceDomain(dataExtent?.[0] ?? 1, dataExtent?.[1] ?? 1000, logBase(axis.scale));
      from = d.from;
      to = d.to;
    } else {
      from = axis.from;
      to = axis.to;
    }
    return { from, to, step: 1 };
  }
  const byCount = axis.majorMode === "count" && axis.majorCount && axis.majorCount >= 2 ? axis.majorCount : null;
  if (axis.auto) {
    const d = niceDomain(dataExtent?.[0] ?? 0, dataExtent?.[1] ?? 10);
    return { from: d.from, to: d.to, step: byCount ? Math.abs(d.to - d.from) / (byCount - 1) : (axis.majorStep ?? d.step) };
  }
  const from = axis.from;
  const to = axis.to === axis.from ? axis.from + 1 : axis.to;
  return { from, to, step: byCount ? Math.abs(to - from) / (byCount - 1) : (axis.majorStep ?? niceStep(Math.abs(to - from))) };
}

export function buildScale(axis: Axis, range: [number, number], dataExtent: [number, number] | null, categories?: string[]): AxisScale {
  if (categories) {
    const n = Math.max(1, categories.length);
    const [r0, r1] = range;
    const from = 0.5;
    const to = n + 0.5;
    const map = (v: number) => (Number.isFinite(v) ? r0 + ((v - from) / (to - from)) * (r1 - r0) : null);
    return {
      from,
      to,
      step: 1,
      scale: "linear",
      categories,
      segments: [{ from, to, r0, r1, scale: "linear", step: 1 }],
      gaps: [],
      major: Array.from({ length: n }, (_, i) => i + 1),
      minor: [],
      map,
      invert: (r) => from + ((r - r0) / (r1 - r0 || 1e-12)) * (to - from),
      tickInfo: () => ({ scale: "linear", step: 1 }),
    };
  }
  const { from, to, step } = axisDomain(axis, dataExtent);
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const reversed = from > to;

  // valid, sorted, non-overlapping breaks inside the domain
  const breaks = [...axis.breaks]
    .map((b) => ({ ...b, from: Math.min(b.from, b.to), to: Math.max(b.from, b.to), gapMm: Math.max(0.5, b.gapMm) }))
    .filter((b) => b.from > lo && b.to < hi && b.to > b.from && (!isLogScale(axis.scale) || b.from > 0))
    .sort((a, b) => a.from - b.from)
    .filter((b, i, arr) => i === 0 || b.from >= arr[i - 1].to);

  const [r0, r1] = range;
  const dir = r1 >= r0 ? 1 : -1;
  const totalRange = Math.abs(r1 - r0);
  const totalGap = breaks.reduce((s, b) => s + b.gapMm, 0);
  const usable = Math.max(1e-6, totalRange - totalGap);

  // domain pieces, each with its own scale kind and tick settings
  const pieces: { from: number; to: number; scale: ScaleKind; step: number; minor: number }[] = [];
  let cursor = lo;
  const pushPiece = (pf: number, pt: number, b: (typeof breaks)[number] | null) => {
    let sc: ScaleKind = b ? (b.after?.scale ?? axis.scale) : axis.scale;
    if (isLogScale(sc) && pf <= 0) sc = "linear"; // a log segment needs positive values
    let st: number;
    if (isLogScale(sc)) st = 1;
    else if (!b) st = breaks.length && !(axis.majorStep && axis.majorStep > 0) ? niceStep(Math.abs(pt - pf)) : step; // with breaks, each segment gets its own nice step
    else if (b.after?.majorStep && b.after.majorStep > 0) st = b.after.majorStep;
    else if (axis.majorStep && axis.majorStep > 0) st = axis.majorStep; // an explicit axis step applies to every linear segment
    else st = niceStep(Math.abs(pt - pf));
    const minor = b && b.after?.minorCount != null ? Math.max(0, Math.round(b.after.minorCount)) : isLogScale(sc) !== isLogScale(axis.scale) ? (sc === "log" ? 8 : 1) : axis.minorCount;
    pieces.push({ from: pf, to: pt, scale: sc, step: st, minor });
  };
  breaks.forEach((b, i) => {
    pushPiece(cursor, b.from, i === 0 ? null : breaks[i - 1]);
    cursor = b.to;
  });
  pushPiece(cursor, hi, breaks.length ? breaks[breaks.length - 1] : null);

  const lens = pieces.map((p) => Math.max(1e-12, tf(p.scale)(p.to) - tf(p.scale)(p.from)));
  const totalLen = lens.reduce((a, b) => a + b, 0);

  // where each gap starts, as an offset along the axis in the domain-increasing direction
  const gapStart: number[] = [];
  let off = 0;
  pieces.forEach((_p, i) => {
    off += (lens[i] / totalLen) * usable;
    if (i < breaks.length) {
      gapStart.push(off);
      off += breaks[i].gapMm;
    }
  });
  // breaks with an explicit position: the gap is centred at that fraction of the axis (0 = left/bottom end)
  breaks.forEach((b, i) => {
    if (b.position == null || !Number.isFinite(b.position)) return;
    const frac = Math.min(1, Math.max(0, reversed ? 1 - b.position : b.position));
    gapStart[i] = frac * totalRange - b.gapMm / 2;
  });
  // keep the gaps ordered and leave every segment at least 1 mm
  const MIN_SEG = Math.min(1, usable / (pieces.length * 2));
  for (let i = 0; i < gapStart.length; i++) gapStart[i] = Math.max(gapStart[i], (i === 0 ? 0 : gapStart[i - 1] + breaks[i - 1].gapMm) + MIN_SEG);
  for (let i = gapStart.length - 1; i >= 0; i--) gapStart[i] = Math.min(gapStart[i], (i === gapStart.length - 1 ? totalRange : gapStart[i + 1]) - breaks[i].gapMm - MIN_SEG);

  const segments: ScaleSegment[] = [];
  const gaps: [number, number][] = [];
  const base = reversed ? r1 : r0; // start of range in the "domain increasing" direction
  const stepDir = reversed ? -dir : dir;
  let start = 0;
  pieces.forEach((p, i) => {
    const s1 = i < breaks.length ? gapStart[i] : totalRange;
    segments.push({ from: p.from, to: p.to, r0: base + stepDir * start, r1: base + stepDir * s1, scale: p.scale, step: p.step });
    if (i < breaks.length) {
      gaps.push([base + stepDir * gapStart[i], base + stepDir * (gapStart[i] + breaks[i].gapMm)]);
      start = gapStart[i] + breaks[i].gapMm;
    }
  });

  const segmentOf = (v: number): ScaleSegment | null => {
    if (v <= segments[0].to) return segments[0];
    if (v >= segments[segments.length - 1].from) return segments[segments.length - 1];
    for (const s of segments) if (v >= s.from && v <= s.to) return s;
    return null; // in a gap
  };

  const map = (v: number): number | null => {
    if (!Number.isFinite(v)) return null;
    const seg = segmentOf(v);
    if (!seg) return null;
    if (isLogScale(seg.scale) && v <= 0) return null;
    const t = tf(seg.scale);
    const span = t(seg.to) - t(seg.from) || 1e-12;
    return seg.r0 + ((t(v) - t(seg.from)) / span) * (seg.r1 - seg.r0);
  };

  const invert = (r: number): number => {
    let seg = segments[0];
    for (const s of segments) {
      const a = Math.min(s.r0, s.r1);
      const b = Math.max(s.r0, s.r1);
      if (r >= a && r <= b) seg = s;
    }
    const t = tf(seg.scale);
    const frac = (r - seg.r0) / (seg.r1 - seg.r0 || 1e-12);
    return itf(seg.scale)(t(seg.from) + frac * (t(seg.to) - t(seg.from)));
  };

  let major: number[] = [];
  let minor: number[] = [];
  pieces.forEach((p) => {
    if (isLogScale(p.scale)) {
      const lt = logTicks(p.from, p.to, logBase(p.scale), p.minor);
      major.push(...lt.major);
      minor.push(...lt.minor);
    } else {
      const m = linearTicks(p.from, p.to, p.step);
      major.push(...m);
      minor.push(...linearMinorTicks(m, p.step, p.minor, p.from, p.to));
    }
  });
  major = [...new Set(major)];
  minor = [...new Set(minor)].filter((v) => !major.includes(v));

  // ticks at user-given values: added to the regular ones, or replacing them
  let customLabels: Map<number, string> | undefined;
  const custom = (axis.customTicks ?? []).filter((t) => Number.isFinite(t.value) && t.value >= lo - 1e-9 && t.value <= hi + 1e-9 && (!isLogScale(axis.scale) || t.value > 0));
  if (custom.length) {
    customLabels = new Map();
    for (const t of custom) if (t.label != null && t.label !== "") customLabels.set(t.value, t.label);
    const values = custom.map((t) => t.value);
    if (axis.customTicksMode === "replace") {
      major = [...new Set(values)].sort((a, b) => a - b);
      minor = [];
    } else {
      major = [...new Set([...major, ...values])].sort((a, b) => a - b);
      minor = minor.filter((v) => !major.includes(v));
    }
  }

  const tickInfo = (v: number) => {
    const seg = segmentOf(v) ?? segments[0];
    return { scale: seg.scale, step: seg.step };
  };

  return { from, to, step, scale: axis.scale, segments, gaps, major, minor, map, invert, tickInfo, customLabels };
}
