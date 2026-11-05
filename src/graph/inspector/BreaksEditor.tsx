// Axis breaks as a list of segments and gaps: every segment has its own limits, scale type, major step
// and minor ticks; every gap has a value range, a drawn width and an optional position along the axis.

import type { Axis, AxisBreak, AxisScale } from "../../model/types";
import { uid } from "../../model/defaults";
import { Group, NumberField, Row, SelectField } from "../../ui/Fields";
import { Icon } from "../../ui/Icon";
import { isLogScale } from "../ticks";

const SCALE_OPTIONS: { value: AxisScale; label: string }[] = [
  { value: "linear", label: "Linear" },
  { value: "log", label: "Log₁₀" },
  { value: "log2", label: "Log₂" },
  { value: "ln", label: "ln" },
];

/** Default minor-tick count when the scale family changes. */
export function defaultMinorFor(scale: AxisScale): number {
  return scale === "log" ? 8 : 1;
}

export function BreaksEditor({ axis, eff, upd }: { axis: Axis; eff: { from: number; to: number; step: number }; upd: (fn: (a: Axis) => void) => void }) {
  const sorted = [...axis.breaks].sort((a, b) => Math.min(a.from, a.to) - Math.min(b.from, b.to));
  const updBreak = (id: string, fn: (b: AxisBreak) => void) =>
    upd((a) => {
      const b = a.breaks.find((x) => x.id === id);
      if (b) fn(b);
    });
  /** Editing an outer limit switches the axis to manual limits. */
  const fixLimits = (a: Axis) => {
    if (a.auto) {
      a.auto = false;
      a.from = eff.from;
      a.to = eff.to;
    }
  };
  const addBreak = () =>
    upd((a) => {
      fixLimits(a);
      const lo = Math.min(a.from, a.to);
      const hi = Math.max(a.from, a.to);
      // place the new gap in the middle of the last segment
      const last = [...a.breaks].sort((x, y) => x.from - y.from).pop();
      const s0 = last ? Math.max(last.from, last.to) : lo;
      const mid = (s0 + hi) / 2;
      const w = (hi - s0) * 0.1;
      a.breaks.push({ id: uid(), from: mid - w, to: mid + w, gapMm: 2, position: null, after: {} });
    });

  const outerFrom = axis.auto ? eff.from : axis.from;
  const outerTo = axis.auto ? eff.to : axis.to;
  const n = sorted.length + 1;

  const segmentRows = (i: number) => {
    const before = i > 0 ? sorted[i - 1] : null; // the break that starts this segment
    const next = i < sorted.length ? sorted[i] : null; // the break that ends it
    const from = before ? Math.max(before.from, before.to) : outerFrom;
    const to = next ? Math.min(next.from, next.to) : outerTo;
    const scale: AxisScale = before ? (before.after?.scale ?? axis.scale) : axis.scale;
    const majorStep = before ? (before.after?.majorStep ?? null) : axis.majorStep;
    const minor = before ? (before.after?.minorCount ?? null) : axis.minorCount;
    const setFrom = (v: number) => (before ? updBreak(before.id, (b) => void (b.to = v)) : upd((a) => void (fixLimits(a), (a.from = v))));
    const setTo = (v: number) => (next ? updBreak(next.id, (b) => void (b.from = v)) : upd((a) => void (fixLimits(a), (a.to = v))));
    const setScale = (v: AxisScale) => {
      if (before) {
        updBreak(before.id, (b) => {
          const was = b.after?.scale ?? axis.scale;
          b.after = { ...(b.after ?? {}), scale: v };
          if (isLogScale(v) !== isLogScale(was)) b.after.minorCount = defaultMinorFor(v);
        });
      } else {
        upd((a) => {
          const wasLog = isLogScale(a.scale);
          a.scale = v;
          if (isLogScale(v) !== wasLog) a.minorCount = defaultMinorFor(v);
        });
      }
    };
    const setStep = (v: number) => {
      const val = v > 0 ? v : null;
      if (before) updBreak(before.id, (b) => void (b.after = { ...(b.after ?? {}), majorStep: val }));
      else upd((a) => void (a.majorStep = val));
    };
    const setMinor = (v: number) => {
      const val = Math.max(0, Math.round(v));
      if (before) updBreak(before.id, (b) => void (b.after = { ...(b.after ?? {}), minorCount: val }));
      else upd((a) => void (a.minorCount = val));
    };
    return (
      <div key={`seg${i}`} className="break-segment">
        <div className="hint" style={{ fontWeight: 600, marginTop: i === 0 ? 0 : 6 }}>
          Segment {i + 1}
          {i === 0 && n > 1 && <span style={{ fontWeight: 400 }}> · uses the Scale settings above</span>}
        </div>
        <Row label="From · To">
          <NumberField value={from} onCommit={setFrom} />
          <NumberField value={to} onCommit={setTo} />
        </Row>
        <Row label="Scale">
          <SelectField<AxisScale> value={scale} options={SCALE_OPTIONS} onChange={setScale} />
        </Row>
        <Row label="Step · Minor" title="Major step (empty = auto) · minor ticks between majors">
          <NumberField value={majorStep} placeholder={isLogScale(scale) ? "powers" : "auto"} disabled={isLogScale(scale)} onCommit={setStep} />
          <NumberField value={minor} placeholder={String(before ? (isLogScale(scale) !== isLogScale(axis.scale) ? defaultMinorFor(scale) : axis.minorCount) : axis.minorCount)} step={1} min={0} max={20} onCommit={setMinor} />
        </Row>
      </div>
    );
  };

  const gapRows = (b: AxisBreak, i: number) => (
    <div key={b.id} className="break-gap">
      <div className="hint" style={{ fontWeight: 600, marginTop: 6, display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ flex: 1 }}>
          Break {i + 1} <span style={{ fontWeight: 400 }}>· skips {Number(Math.min(b.from, b.to).toPrecision(6))} … {Number(Math.max(b.from, b.to).toPrecision(6))}</span>
        </span>
        <button className="icon-btn tiny" title="Remove break (the segments merge)" onClick={() => upd((a) => void a.breaks.splice(a.breaks.findIndex((x) => x.id === b.id), 1))}>
          <Icon name="close" size={12} />
        </button>
      </div>
      <Row label="Gap width">
        <NumberField value={b.gapMm} min={0.5} step={0.5} style={{ width: 56 }} onCommit={(v) => updBreak(b.id, (x) => void (x.gapMm = v))} />
        <span className="hint">mm</span>
      </Row>
      <Row label="Position" title="Where the gap sits along the axis: 0 % = left/bottom end, 100 % = right/top end. Empty = proportional to the value ranges.">
        <NumberField value={b.position == null ? null : Number((b.position * 100).toPrecision(6))} placeholder="proportional" min={0} max={100} step={5} style={{ width: 90 }} onCommit={(v) => updBreak(b.id, (x) => void (x.position = Math.min(1, Math.max(0, v / 100))))} />
        <span className="hint">% of axis</span>
        <button className="btn small" disabled={b.position == null} onClick={() => updBreak(b.id, (x) => void (x.position = null))}>
          Auto
        </button>
      </Row>
    </div>
  );

  return (
    <Group
      title="Axis breaks"
      right={
        <button className="btn small" onClick={addBreak}>
          Add break
        </button>
      }
    >
      {sorted.length === 0 && <div className="hint">No breaks. A break skips a range of values; each segment then gets its own limits, scale type and ticks, and the gap can be placed anywhere along the axis.</div>}
      {sorted.length > 0 &&
        Array.from({ length: n }, (_, i) => (
          <div key={i}>
            {segmentRows(i)}
            {i < sorted.length && gapRows(sorted[i], i)}
          </div>
        ))}
    </Group>
  );
}
