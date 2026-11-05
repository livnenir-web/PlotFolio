import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { create } from "zustand";
import { pauseHistory, resumeHistory } from "../model/store";
import { applyMarkupShortcut } from "./markupKeys";
import { Icon } from "./Icon";

// ---------------------------------------------------------------- inspector accordion
//
// Inside an <InspectorPanel kind="plot"> every titled Group is a collapsible section and only one of them is open
// at a time; which one is remembered per panel kind for the whole session (and across restarts). Groups outside a
// panel (dialogs) render as before.

interface SectionsState {
  /** open section id per panel kind */
  open: Record<string, string | undefined>;
  setOpen: (panel: string, id: string | undefined) => void;
}
const SECTIONS_KEY = "plotkit.inspectorSections";
const loadSections = (): Record<string, string | undefined> => {
  try {
    return JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? "{}") as Record<string, string | undefined>;
  } catch {
    return {};
  }
};
export const useInspectorSections = create<SectionsState>((set) => ({
  open: loadSections(),
  setOpen: (panel, id) =>
    set((s) => {
      const open = { ...s.open, [panel]: id };
      try {
        localStorage.setItem(SECTIONS_KEY, JSON.stringify(open));
      } catch {
        /* private mode etc. */
      }
      return { open };
    }),
}));

interface PanelCtx {
  kind: string;
  defaultOpen?: string;
  /** ids of the sections currently rendered, in order */
  register: (id: string) => () => void;
  mounted: string[];
}
const PanelContext = createContext<PanelCtx | null>(null);

/** The inspector column for one kind of selection; its titled Groups become an accordion. */
export function InspectorPanel({ kind, defaultOpen, children }: { kind: string; defaultOpen?: string; children: ReactNode }) {
  const [mounted, setMounted] = useState<string[]>([]);
  const ref = useRef<string[]>([]);
  const register = (id: string) => {
    ref.current = [...ref.current, id];
    setMounted(ref.current);
    return () => {
      ref.current = ref.current.filter((x) => x !== id);
      setMounted(ref.current);
    };
  };
  const ctx = useRef<PanelCtx>({ kind, defaultOpen, register, mounted });
  ctx.current = { kind, defaultOpen, register, mounted };
  return (
    <PanelContext.Provider value={ctx.current}>
      <div className="inspector">{children}</div>
    </PanelContext.Provider>
  );
}

export function Row({ label, children, title }: { label: ReactNode; children: ReactNode; title?: string }) {
  return (
    <div className="row" title={title}>
      <label>{label}</label>
      <div style={{ display: "flex", gap: 4, alignItems: "center", minWidth: 0 }}>{children}</div>
    </div>
  );
}

/**
 * A titled block of controls. Inside an InspectorPanel it is a collapsible section (give it an `id` when the title
 * changes with the selection); `right` holds a control shown in the header, such as an Add button.
 */
export function Group({ title, children, right, id }: { title?: ReactNode; children: ReactNode; right?: ReactNode; id?: string }) {
  const panel = useContext(PanelContext);
  const sid = id ?? (typeof title === "string" ? title : undefined);
  const collapsible = !!panel && !!sid;
  const openId = useInspectorSections((s) => (panel ? s.open[panel.kind] : undefined));
  useLayoutEffect(() => (collapsible ? panel!.register(sid!) : undefined), [collapsible, sid, panel?.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!collapsible) {
    return (
      <div className="group">
        {title && (
          <div className="group-title">
            <span>{title}</span>
            {right}
          </div>
        )}
        {children}
      </div>
    );
  }
  // the remembered section if it is on screen, else the panel's default, else the first section
  const mounted = panel!.mounted;
  // ("-" = the user collapsed every section)
  const effective = openId === "-" ? undefined : openId && mounted.includes(openId) ? openId : panel!.defaultOpen && mounted.includes(panel!.defaultOpen) ? panel!.defaultOpen : mounted[0];
  const open = effective === sid;
  return (
    <div className={"group collapsible" + (open ? " open" : "")}>
      <div className="group-title" onClick={() => useInspectorSections.getState().setOpen(panel!.kind, open ? "-" : sid!)} role="button" title={open ? "Collapse" : "Expand"}>
        <Icon name="chevron" size={11} style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .12s", color: "var(--text-3)", flex: "none" }} />
        <span style={{ flex: 1 }}>{title}</span>
        {right && <span onClick={(e) => e.stopPropagation()}>{right}</span>}
      </div>
      {open && children}
    </div>
  );
}


/** Text input that commits on blur / Enter and keeps local state while typing. */
export function TextField({
  value,
  onCommit,
  placeholder,
  mono,
  style,
  autoFocus,
  multiline,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  style?: React.CSSProperties;
  autoFocus?: boolean;
  multiline?: boolean;
}) {
  const [v, setV] = useState(value);
  const start = useRef<string | null>(null);
  useEffect(() => setV(value), [value]);
  // Live editing: every keystroke is applied with history paused; blur records one undo step.
  const onFocus = () => {
    start.current = value;
    pauseHistory();
  };
  const live = (next: string) => {
    setV(next);
    if (start.current === null) {
      start.current = value;
      pauseHistory();
    }
    onCommit(next);
  };
  const commit = () => {
    if (start.current !== null) {
      const s0 = start.current;
      start.current = null;
      if (v !== s0) {
        onCommit(s0);
        resumeHistory();
        onCommit(v);
      } else resumeHistory();
    } else if (v !== value) onCommit(v);
  };
  if (multiline)
    return (
      <textarea
        className={"input" + (mono ? " mono" : "")}
        value={v}
        rows={2}
        style={style}
        placeholder={placeholder}
        onFocus={onFocus}
        onChange={(e) => live(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (applyMarkupShortcut(e, live)) return;
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            commit();
            (e.target as HTMLTextAreaElement).blur();
          }
          e.stopPropagation();
        }}
      />
    );
  return (
    <input
      className={"input" + (mono ? " mono" : "")}
      value={v}
      style={style}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onFocus={onFocus}
      onChange={(e) => live(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (applyMarkupShortcut(e, live)) return;
        if (e.key === "Enter") {
          commit();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          if (start.current !== null) live(start.current);
          setV(start.current ?? value);
          (e.target as HTMLInputElement).blur();
        }
        e.stopPropagation();
      }}
    />
  );
}

export function NumberField({
  value,
  onCommit,
  step,
  min,
  max,
  style,
  disabled,
  placeholder,
}: {
  value: number | null;
  onCommit: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  style?: React.CSSProperties;
  disabled?: boolean;
  placeholder?: string;
}) {
  const fmt = (n: number | null) => (n === null || n === undefined ? "" : String(Number(n.toPrecision(8))));
  const [v, setV] = useState(fmt(value));
  const start = useRef<number | null | undefined>(undefined);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setV(fmt(value));
  }, [value]);
  const onFocus = () => {
    focused.current = true;
    start.current = value;
    pauseHistory();
  };
  const live = (text: string) => {
    setV(text);
    const n = Number(text);
    if (text.trim() !== "" && Number.isFinite(n) && n !== value) onCommit(n);
  };
  const commit = () => {
    focused.current = false;
    const n = Number(v);
    const valid = v.trim() !== "" && Number.isFinite(n);
    if (start.current !== undefined) {
      const s0 = start.current;
      start.current = undefined;
      if (valid && n !== s0) {
        if (s0 !== null) onCommit(s0);
        resumeHistory();
        onCommit(n);
      } else {
        if (s0 !== null && s0 !== value) onCommit(s0); // revert live edits (invalid text or Escape)
        resumeHistory();
        setV(fmt(s0 ?? value));
      }
    } else if (valid && n !== value) onCommit(n);
    else setV(fmt(value));
  };
  return (
    <input
      className="input"
      type="number"
      value={v}
      step={step ?? "any"}
      min={min}
      max={max}
      style={style}
      disabled={disabled}
      placeholder={placeholder}
      onFocus={onFocus}
      onChange={(e) => live(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commit();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          setV(fmt(start.current ?? value));
          (e.target as HTMLInputElement).blur();
        }
        e.stopPropagation();
      }}
    />
  );
}

export function SelectField<T extends string>({
  value,
  options,
  onChange,
  style,
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  style?: React.CSSProperties;
  disabled?: boolean;
}) {
  return (
    <select className="input" value={value} style={style} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function CheckField({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, style }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; style?: React.CSSProperties }) {
  return (
    <div className="seg" style={style}>
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? "on" : ""} onClick={() => onChange(o.value)} type="button">
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <>
      <input className="input" type="color" value={toHex(value)} onChange={(e) => onChange(e.target.value)} />
      <TextField value={value} onCommit={onChange} mono style={{ flex: 1 }} />
    </>
  );
}

function toHex(c: string): string {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) return "#" + [...c.slice(1)].map((x) => x + x).join("");
  return "#000000";
}

/** Font families offered in the font pickers. */
export const FONT_FAMILIES = ["Arial", "Helvetica", "Helvetica Neue", "Times New Roman", "Georgia", "Courier New", "Verdana", "Calibri"];

export function FontFields({
  style,
  onChange,
  showColor = true,
}: {
  style: { font: string; sizePt: number; bold: boolean; italic: boolean; color: string };
  onChange: (patch: Partial<typeof style>) => void;
  showColor?: boolean;
}) {
  return (
    <>
      <Row label="Font">
        <SelectField
          value={style.font}
          options={FONT_FAMILIES.map((f) => ({ value: f, label: f }))}
          onChange={(font) => onChange({ font })}
        />
      </Row>
      <Row label="Size (pt)">
        <NumberField value={style.sizePt} step={0.5} min={1} onCommit={(sizePt) => onChange({ sizePt })} style={{ width: 64 }} />
        <CheckField label="Bold" checked={style.bold} onChange={(bold) => onChange({ bold })} />
        <CheckField label="Italic" checked={style.italic} onChange={(italic) => onChange({ italic })} />
      </Row>
      {showColor && (
        <Row label="Color">
          <ColorField value={style.color} onChange={(color) => onChange({ color })} />
        </Row>
      )}
    </>
  );
}

/** Slider plus percent field for an opacity (0 … 1). */
export function OpacityField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <>
      <input type="range" min={0} max={100} step={5} value={pct} onChange={(e) => onChange(Number(e.target.value) / 100)} style={{ width: 90 }} />
      <NumberField value={pct} step={5} min={0} max={100} onCommit={(v) => onChange(Math.min(100, Math.max(0, v)) / 100)} style={{ width: 52 }} />
      <span className="hint">%</span>
    </>
  );
}
