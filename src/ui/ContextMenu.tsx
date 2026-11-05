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

function MenuPanel({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [sub, setSub] = useState<{ idx: number; x: number; y: number } | null>(null);
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
    <div ref={ref} className="menu" style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.stopPropagation()}>
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
              className="mi"
              onMouseEnter={(e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setSub({ idx: i, x: r.right + 2, y: r.top - 4 });
              }}
            >
              <span>{it.label}</span>
              <span className="sc">›</span>
              {sub?.idx === i && <MenuPanel x={sub.x} y={sub.y} items={it.items} onClose={onClose} />}
            </div>
          );
        return (
          <div
            key={i}
            className={"mi" + (it.disabled ? " disabled" : "") + (it.checked ? " checked" : "")}
            onMouseEnter={() => setSub(null)}
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
