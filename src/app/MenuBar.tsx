import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MenuPanel, type MenuItem } from "../ui/ContextMenu";
import { useStore } from "../model/store";
import { formatKeys, WEB_MENUS, type MenuEntry } from "./menuModel";
import { handleMenu } from "./menu";
import { listSamples, loadSample } from "./openFile";

/**
 * The menu bar of the browser build, drawn inside the page (the Mac app uses the native menu bar instead).
 * Click a title to open its menu; while one is open, moving over another title switches to it, as on macOS.
 */
export function MenuBar() {
  const [open, setOpen] = useState<number | null>(null);
  const [samples, setSamples] = useState<{ file: string; name: string }[]>([]);
  const titles = useRef<(HTMLButtonElement | null)[]>([]);
  const activeKind = useStore((s) => s.ui.activeTab?.kind ?? null);

  useEffect(() => {
    void listSamples().then(setSamples);
  }, []);

  useEffect(() => {
    if (open === null) return;
    const close = () => setOpen(null);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") setOpen((o) => (o === null ? o : (o + 1) % WEB_MENUS.length));
      else if (e.key === "ArrowLeft") setOpen((o) => (o === null ? o : (o + WEB_MENUS.length - 1) % WEB_MENUS.length));
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  const toItems = (entries: MenuEntry[]): MenuItem[] =>
    entries.map((e): MenuItem => {
      if ("sep" in e) return { type: "sep" };
      if ("submenu" in e) {
        const items: MenuItem[] =
          e.submenu === "samples"
            ? samples.length
              ? samples.map((sm) => ({ label: sm.name, onSelect: () => void loadSample(sm.file, sm.name) }))
              : [{ type: "label", label: "No samples here" }]
            : toItems(e.submenu);
        return { type: "submenu", label: e.label, items };
      }
      return {
        label: e.label,
        shortcut: e.keys ? formatKeys(e.keys) : undefined,
        disabled: !!e.when && e.when !== activeKind,
        onSelect: () => handleMenu(e.id),
      };
    });

  const rect = open !== null ? titles.current[open]?.getBoundingClientRect() : null;
  return (
    <nav className="menubar" aria-label="Menu bar">
      {WEB_MENUS.map((m, i) => (
        <button
          key={m.title}
          ref={(el) => void (titles.current[i] = el)}
          className={"menubar-title" + (i === 0 ? " app" : "") + (open === i ? " open" : "")}
          aria-haspopup="menu"
          aria-expanded={open === i}
          onMouseDown={(e) => {
            // keep focus on the grid or field the command will act on, and keep the window listener from closing it again
            e.preventDefault();
            e.stopPropagation();
            setOpen(open === i ? null : i);
          }}
          onMouseEnter={() => open !== null && open !== i && setOpen(i)}
        >
          {m.title}
        </button>
      ))}
      {open !== null && rect && createPortal(<MenuPanel key={open} x={rect.left} y={rect.bottom + 2} items={toItems(WEB_MENUS[open].items)} onClose={() => setOpen(null)} />, document.body)}
    </nav>
  );
}
