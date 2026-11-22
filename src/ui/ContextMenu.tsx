import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type MenuItem =
  | { type?: "item"; label: string; onSelect: () => void; disabled?: boolean; checked?: boolean; shortcut?: string }
  | { type: "sep" }
  | { type: "label"; label: string }
  | { type: "submenu"; label: string; items: MenuItem[] };

export interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

export function ContextMenu({ menu, onClose }: { menu: MenuState | null; onClose: () => void }) {
  useEffect(() => {
    if (!menu) return;
    const close = () => onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", key);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", close);
    };
  }, [menu, onClose]);
  if (!menu) return null;
  return createPortal(<MenuPanel x={menu.x} y={menu.y} items={menu.items} onClose={onClose} />, document.body);
}

/** Rows the arrow keys can stop on. */
const selectable = (it: MenuItem) => it.type === "submenu" || ((it.type === undefined || it.type === "item") && !it.disabled);

interface MenuPanelProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
  /** the menus of the menu bar: ↑ ↓ move through the rows, Enter chooses, → opens a submenu and ← leaves it */
  keyboard?: boolean;
  /** with `keyboard`: start with the first row marked (the menu was opened from the keyboard) */
  startActive?: boolean;
  /** a submenu opened from the keyboard: ← gives the keys back to the menu it belongs to */
  onBack?: () => void;
}

export function MenuPanel({ x, y, items, onClose, keyboard, startActive, onBack }: MenuPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [sub, setSub] = useState<{ idx: number; x: number; y: number; keys?: boolean } | null>(null);
  const [active, setActive] = useState<number | null>(() => (keyboard && startActive ? Math.max(0, items.findIndex(selectable)) : null));
  // the latest state for the key listener, which is installed once
  const live = useRef({ items, active, sub, onClose, onBack });
  live.current = { items, active, sub, onClose, onBack };
  useEffect(() => {
    if (!keyboard) return;
    const onKey = (e: KeyboardEvent) => {
      const { items, active, sub, onClose, onBack } = live.current;
      if (sub?.keys) return; // the open submenu has the keys
      const rows = items.map((it, i) => (selectable(it) ? i : -1)).filter((i) => i >= 0);
      const openSub = (i: number) => {
        const r = (ref.current?.children[i] as HTMLElement | undefined)?.getBoundingClientRect();
        if (r) setSub({ idx: i, x: r.right + 2, y: r.top - 4, keys: true });
      };
      const at = active === null ? -1 : rows.indexOf(active);
      const it = active === null ? undefined : items[active];
      // (a submenu may hold no row to stop on, "No Recent Projects": ← still leaves it)
      if (e.key === "ArrowLeft" && onBack) onBack();
      else if (!rows.length) return;
      else if (e.key === "ArrowDown") setActive(rows[(at + 1) % rows.length]);
      else if (e.key === "ArrowUp") setActive(rows[(at <= 0 ? rows.length : at) - 1]);
      else if (e.key === "Home") setActive(rows[0]);
      else if (e.key === "End") setActive(rows[rows.length - 1]);
      else if (e.key === "ArrowRight" && it?.type === "submenu") openSub(active!);
      else if ((e.key === "Enter" || e.key === " ") && it) {
        if (it.type === "submenu") openSub(active!);
        else if (it.type === undefined || it.type === "item") {
          onClose();
          it.onSelect();
        }
      } else return; // ← → otherwise move along the menu bar; other keys are not the menu's
      e.preventDefault();
      e.stopPropagation();
    };
    // before anything in the page: while a menu is open these keys belong to it, not to the sheet or graph behind
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [keyboard]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (nx + r.width > window.innerWidth - 8) nx = Math.max(8, window.innerWidth - r.width - 8);
    if (ny + r.height > window.innerHeight - 8) ny = Math.max(8, window.innerHeight - r.height - 8);
    setPos({ x: nx, y: ny });
  }, [x, y]);
  return (
    <div
      ref={ref}
      className="menu"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => {
        // clicking a menu must not take focus away from the grid or text field the command acts on
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {items.map((it, i) => {
        if (it.type === "sep") return <div key={i} className="msep" />;
        if (it.type === "label")
          return (
            <div key={i} className="mlabel">
              {it.label}
            </div>
          );
        if (it.type === "submenu")
          return (
            <div
              key={i}
              className={"mi" + (active === i ? " active" : "")}
              onMouseEnter={(e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setSub({ idx: i, x: r.right + 2, y: r.top - 4 });
                if (keyboard) setActive(i);
              }}
            >
              <span>{it.label}</span>
              <span className="sc">›</span>
              {sub?.idx === i && <MenuPanel x={sub.x} y={sub.y} items={it.items} onClose={onClose} keyboard={keyboard} startActive={sub.keys} onBack={sub.keys ? () => setSub(null) : undefined} />}
            </div>
          );
        return (
          <div
            key={i}
            className={"mi" + (it.disabled ? " disabled" : "") + (it.checked ? " checked" : "") + (active === i ? " active" : "")}
            onMouseEnter={() => {
              setSub(null);
              if (keyboard && !it.disabled) setActive(i);
            }}
            onClick={() => {
              if (it.disabled) return;
              onClose();
              it.onSelect();
            }}
          >
            <span>{it.label}</span>
            {it.shortcut && <span className="sc">{it.shortcut}</span>}
          </div>
        );
      })}
    </div>
  );
}

/** Hook returning [menuElement, open(e, items)] */
export function useContextMenu(): [ReactNode, (e: { clientX: number; clientY: number; preventDefault?: () => void }, items: MenuItem[]) => void, () => void] {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const open = (e: { clientX: number; clientY: number; preventDefault?: () => void }, items: MenuItem[]) => {
    e.preventDefault?.();
    setMenu({ x: e.clientX, y: e.clientY, items });
  };
  const close = () => setMenu(null);
  return [<ContextMenu key="menu" menu={menu} onClose={close} />, open, close];
}
