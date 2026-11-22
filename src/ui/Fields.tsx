import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { create } from "zustand";
import { beginEdit, endEdit } from "../model/store";
import { applyMarkupShortcut } from "./markupKeys";
import { Icon } from "./Icon";
import { Info } from "./Tooltip";

// ---------------------------------------------------------------- inspector accordion
//
// Objects with many settings (figure, layer, axis, plot) get an <InspectorPanel> with tabs: under a tab every titled
// Group is a collapsible section and only one of them is open at a time; which one is remembered per panel kind and
// tab for the whole session and across restarts. Objects with few settings (text, legend, shape, column) have no
// tabs and show all their Groups at once, as do Groups outside a panel (dialogs).

interface SectionsState {
  /** open section id per "kind/tab" of a panel with tabs */
  open: Record<string, string | undefined>;
  setOpen: (panel: string, id: string | undefined) => void;
  /** chosen tab per panel kind, for panels with tabs (kept while the app runs) */
  tab: Record<string, string | undefined>;
  setTab: (panel: string, id: string) => void;
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
  tab: {},
  setTab: (panel, id) => set((s) => ({ tab: { ...s.tab, [panel]: id } })),
}));

/** Bring a tab of a panel to the front from elsewhere in the app (the Animate button shows the animation's settings). */
export function showInspectorTab(panel: string, tab: string): void {
  useInspectorSections.getState().setTab(panel, tab);
}

export interface PanelTab {
  id: string;
  label: string;
}

interface PanelCtx {
  kind: string;
  defaultOpen?: string;
  /** ids of the sections currently rendered, in order */
  register: (id: string) => () => void;
  mounted: string[];
  /** tabs of the panel and the one showing (panels without tabs: none) */
  tabs?: PanelTab[];
  tab?: string;
}
const PanelContext = createContext<PanelCtx | null>(null);
/** The tab that sections inside belong to when they name none (see InTab). */
const TabContext = createContext<string | undefined>(undefined);

/** Sections rendered inside (also by other components) show under this tab of the panel. */
export function InTab({ tab, children }: { tab: string; children: ReactNode }) {
  return <TabContext.Provider value={tab}>{children}</TabContext.Provider>;
}

/** The inspector column for one kind of selection; with `tabs`, the titled Groups under each tab become an accordion. */
export function InspectorPanel({ kind, defaultOpen, tabs, children }: { kind: string; defaultOpen?: string; tabs?: PanelTab[]; children: ReactNode }) {
  const chosen = useInspectorSections((s) => s.tab[kind]);
  const tab = tabs?.length ? (tabs.some((t) => t.id === chosen) ? chosen : tabs[0].id) : undefined;
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
  const ctx = useRef<PanelCtx>({ kind, defaultOpen, register, mounted, tabs, tab });
  ctx.current = { kind, defaultOpen, register, mounted, tabs, tab };
  return (
    <PanelContext.Provider value={ctx.current}>
      <div className="inspector">{children}</div>
    </PanelContext.Provider>
  );
}

/** The tab strip of an InspectorPanel with tabs; place it under the panel's header. */
export function PanelTabs() {
  const panel = useContext(PanelContext);
  if (!panel?.tabs?.length) return null;
  return (
    <div className="panel-tabs" role="tablist">
      {panel.tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={t.id === panel.tab} className={t.id === panel.tab ? "on" : ""} onClick={() => useInspectorSections.getState().setTab(panel.kind, t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/**
 * One labeled line of controls. Fields with a set width keep it and the others share what is left (see `.row` in
 * styles.css). `wrap` lets a line of buttons or checkboxes continue on a second line instead of running off the panel.
 */
export function Row({ label, children, title, wrap }: { label: ReactNode; children: ReactNode; title?: string; wrap?: boolean }) {
  return (
    <div className="row" title={title}>
      <label>{label}</label>
      <div style={{ display: "flex", gap: 4, alignItems: "center", minWidth: 0, flexWrap: wrap ? "wrap" : undefined }}>{children}</div>
    </div>
  );
}

/**
 * A titled block of controls. Inside an InspectorPanel it is a collapsible section (give it an `id` when the title
 * changes with the selection); `right` holds a control shown in the header, such as an Add button.
 */
export function Group({ title, children, right, id, info, tab }: { title?: ReactNode; children: ReactNode; right?: ReactNode; id?: string; info?: string; tab?: string }) {
  const panel = useContext(PanelContext);
  const sid = id ?? (typeof title === "string" ? title : undefined);
  // in a panel with tabs a section shows under its tab (the first tab when it names none; "*" = under every tab)
  const inherited = useContext(TabContext);
  const own = tab ?? inherited;
  const shown = !panel?.tabs?.length || own === "*" || (own ?? panel.tabs[0].id) === panel.tab;
  // sections fold only in a panel with tabs; a short panel (text, legend, shape, column) shows everything at once
  const collapsible = !!panel?.tabs?.length && !!sid && shown;
  const openId = useInspectorSections((s) => (panel?.tab ? s.open[`${panel.kind}/${panel.tab}`] : undefined));
  useLayoutEffect(() => (collapsible ? panel!.register(sid!) : undefined), [collapsible, sid, panel?.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!shown) return null;
  if (!collapsible) {
    return (
      <div className="group">
        {title && (
          <div className="group-title">
            <span>{title}</span>
            {info && <Info text={info} />}
            {right}
          </div>
        )}
        {children}
      </div>
    );
  }
  // the remembered section if it is on screen, else the panel's default, else the first section
  const mounted = panel!.mounted;
  const key = `${panel!.kind}/${panel!.tab}`;
  // a tab's only section is always open, and drops a title that would only repeat the tab's name
  const solo = mounted.length === 1 && mounted[0] === sid;
  if (solo) {
    const label = panel!.tabs!.find((t) => t.id === panel!.tab)?.label;
    const bare = !info && !right && typeof title === "string" && title.toLowerCase() === label?.toLowerCase();
    return (
      <div className={"group collapsible open solo" + (bare ? " bare" : "")}>
        {!bare && (
          <div className="group-title">
            <span style={{ flex: 1 }}>{title}</span>
            {info && <Info text={info} />}
            {right}
          </div>
        )}
        {children}
      </div>
    );
  }
  // ("-" = the user collapsed every section)
  const effective = openId === "-" ? undefined : openId && mounted.includes(openId) ? openId : panel!.defaultOpen && mounted.includes(panel!.defaultOpen) ? panel!.defaultOpen : mounted[0];
  const open = effective === sid;
  return (
    <div className={"group collapsible" + (open ? " open" : "")}>
      <div className="group-title" onClick={() => useInspectorSections.getState().setOpen(key, open ? "-" : sid!)} role="button" title={open ? "Collapse" : "Expand"}>
        <Icon name="chevron" size={11} style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .12s", color: "var(--text-3)", flex: "none" }} />
        <span style={{ flex: 1 }}>{title}</span>
        {info && <Info text={info} />}
        {right && <span onClick={(e) => e.stopPropagation()}>{right}</span>}
      </div>
      {open && children}
    </div>
  );
}


/**
 * One live edit of a field, from the first keystroke (or focus) to blur, Enter, Escape, or to the moment the app
 * moves on (see `beginEdit` in the store). The edit keeps the `onCommit` it started with, so its values go to the
 * object that was selected then, whatever the field is showing by the time it ends.
 */
interface FieldEdit<T> {
  start: T;
  commit: (v: T) => void;
  end: () => boolean | void;
  cancelled?: boolean;
}

/** Text input that applies every keystroke and keeps local state while typing; the whole edit is one undo step. */
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
  const edit = useRef<FieldEdit<string> | null>(null);
  useEffect(() => setV(value), [value]);
  const begin = (): FieldEdit<string> => {
    if (edit.current) return edit.current;
    const e: FieldEdit<string> = {
      start: value,
      commit: onCommit,
      end: () => {
        edit.current = null;
        return !e.cancelled;
      },
    };
    edit.current = e;
    beginEdit(e.end);
    return e;
  };
  const live = (next: string) => {
    const e = begin();
    setV(next);
    e.commit(next);
  };
  const commit = () => {
    if (edit.current) endEdit(edit.current.end);
  };
  const cancel = () => {
    const e = edit.current;
    if (!e) return;
    e.cancelled = true;
    setV(e.start);
    endEdit(e.end);
  };
  // the field goes away while it is being edited (another object was selected): the edit ends with it
  useEffect(() => () => void (edit.current && endEdit(edit.current.end)), []);
  const onFocus = () => void begin();
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
          cancel();
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
  const text = useRef(v);
  text.current = v;
  const edit = useRef<FieldEdit<number | null> | null>(null);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setV(fmt(value));
  }, [value]);
  const begin = (): FieldEdit<number | null> => {
    if (edit.current) return edit.current;
    const e: FieldEdit<number | null> = {
      start: value,
      commit: (n) => n !== null && onCommit(n),
      end: () => {
        edit.current = null;
        const n = Number(text.current);
        // Escape, or text that is no number: the edit is thrown away
        if (e.cancelled || text.current.trim() === "" || !Number.isFinite(n)) {
          setV(fmt(e.start));
          return false;
        }
      },
    };
    edit.current = e;
    beginEdit(e.end);
    return e;
  };
  const onFocus = () => {
    focused.current = true;
    begin();
  };
  const live = (next: string) => {
    const e = begin();
    text.current = next;
    setV(next);
    const n = Number(next);
    if (next.trim() !== "" && Number.isFinite(n) && n !== value) e.commit(n);
  };
  const commit = () => {
    focused.current = false;
    if (edit.current) endEdit(edit.current.end);
    else setV(fmt(value));
  };
  // the field goes away while it is being edited (another object was selected): the edit ends with it
  useEffect(() => () => void (edit.current && endEdit(edit.current.end)), []);
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
          if (edit.current) edit.current.cancelled = true;
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
      <Row wrap label="Size (pt)">
        <NumberField value={style.sizePt} step={0.5} min={1} onCommit={(sizePt) => onChange({ sizePt })} style={{ width: 46 }} />
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
      <input type="range" min={0} max={100} step={5} value={pct} onChange={(e) => onChange(Number(e.target.value) / 100)} style={{ flex: 1, minWidth: 30 }} />
      <NumberField value={pct} step={5} min={0} max={100} onCommit={(v) => onChange(Math.min(100, Math.max(0, v)) / 100)} style={{ width: 52 }} />
      <span className="hint">%</span>
    </>
  );
}
