import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MenuPanel, type MenuItem } from "../ui/ContextMenu";
import { useStore } from "../model/store";
import { accessKey, menusFor, type MenuEntry } from "./menuModel";
import { handleMenu } from "./menu";
import { keyHint, useShortcuts } from "./shortcuts";
import { listSamples, loadSample } from "./openFile";
import { recentFiles } from "../io/recent";
import { baseName, shell, stripExt } from "../io/platform";

/** File ▸ Open Recent (the Windows app; the Mac app has the same list in its native menu). */
function recentItems(): MenuItem[] {
  const list = recentFiles();
  if (!list.length) return [{ type: "label", label: "No Recent Projects" }];
  const folder = (path: string) => path.split(/[\\/]/).slice(-2, -1)[0] ?? "";
  return [
    ...list.map((p): MenuItem => ({ label: stripExt(baseName(p)), shortcut: folder(p) || undefined, onSelect: () => handleMenu(`recent:${p}`) })),
    { type: "sep" },
    { label: "Clear List", onSelect: () => handleMenu("recent:clear") },
  ];
}

/**
 * The menu bar PlotFolio draws inside the page: in the browser build and in the Windows app (the Mac app uses the
 * native menu bar instead). Click a title to open its menu; while one is open, moving over another title switches
 * to it, ← → do the same, and ↑ ↓ Enter work inside the menu.
 *
 * In the Windows app the menus also open the Windows way: Alt with the first letter of a title (the letters are
 * underlined while Alt is held), or F10 for the first menu.
 */
export function MenuBar() {
  const menus = menusFor();
  const windows = shell() === "windows";
  const [open, setOpen] = useState<number | null>(null);
  // opened or moved from the keyboard: the menu starts with its first row marked
  const [byKeys, setByKeys] = useState(false);
  const [altHeld, setAltHeld] = useState(false);
  const [samples, setSamples] = useState<{ file: string; name: string }[]>([]);
  const titles = useRef<(HTMLButtonElement | null)[]>([]);
  const activeKind = useStore((s) => s.ui.activeTab?.kind ?? null);
  const overrides = useShortcuts((s) => s.overrides); // the menu shows the shortcuts in use, not the defaults

  useEffect(() => {
    void listSamples().then(setSamples);
  }, []);

  useEffect(() => {
    if (open === null) return;
    const close = () => setOpen(null);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const step = e.key === "ArrowRight" ? 1 : menus.length - 1;
        setByKeys(true);
        setOpen((o) => (o === null ? o : (o + step) % menus.length));
      } else return;
      e.preventDefault();
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
  }, [open, menus.length]);

  // the Windows app: Alt + letter and F10
  useEffect(() => {
    if (!windows) return;
    const down = (e: KeyboardEvent) => {
      if (e.key === "Alt") return setAltHeld(true);
      if (document.querySelector(".modal-backdrop")) return; // a dialog is open: keys belong to it
      const plainAlt = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
      const letter = /^Key([A-Z])$/.exec(e.code)?.[1];
      const idx = plainAlt && letter ? menus.findIndex((m) => accessKey(m) === letter) : e.key === "F10" && !e.altKey && !e.ctrlKey && !e.shiftKey ? 0 : -1;
      if (idx < 0) return;
      e.preventDefault();
      e.stopPropagation();
      setByKeys(true);
      setOpen(idx);
    };
    const up = (e: KeyboardEvent) => e.key === "Alt" && setAltHeld(false);
    const blur = () => setAltHeld(false);
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", blur);
    };
  }, [windows, menus]);

  const toItems = (entries: MenuEntry[]): MenuItem[] =>
    entries.map((e): MenuItem => {
      if ("sep" in e) return { type: "sep" };
      if ("submenu" in e) {
        const items: MenuItem[] =
          e.submenu === "samples"
            ? samples.length
              ? samples.map((sm) => ({ label: sm.name, onSelect: () => void loadSample(sm.file, sm.name) }))
              : [{ type: "label", label: "No samples here" }]
            : e.submenu === "recent"
              ? recentItems()
              : toItems(e.submenu);
        return { type: "submenu", label: e.label, items };
      }
      return {
        label: e.label,
        shortcut: keyHint(e.id, overrides) || e.hint || undefined,
        disabled: !!e.when && e.when !== activeKind,
        onSelect: () => handleMenu(e.id),
      };
    });

  const underline = windows && (altHeld || (open !== null && byKeys));
  const rect = open !== null ? titles.current[open]?.getBoundingClientRect() : null;
  return (
    <nav className="menubar" aria-label="Menu bar">
      {menus.map((m, i) => (
        <button
          key={m.title}
          ref={(el) => void (titles.current[i] = el)}
          className={"menubar-title" + (m.app ? " app" : "") + (open === i ? " open" : "")}
          aria-haspopup="menu"
          aria-expanded={open === i}
          aria-keyshortcuts={windows ? `Alt+${accessKey(m)}` : undefined}
          onMouseDown={(e) => {
            // keep focus on the grid or field the command will act on, and keep the window listener from closing it again
            e.preventDefault();
            e.stopPropagation();
            setByKeys(false);
            setOpen(open === i ? null : i);
          }}
          onMouseEnter={() => open !== null && open !== i && setOpen(i)}
        >
          {underline ? (
            <>
              <u>{m.title[0]}</u>
              {m.title.slice(1)}
            </>
          ) : (
            m.title
          )}
        </button>
      ))}
      {open !== null &&
        rect &&
        createPortal(<MenuPanel key={open} x={rect.left} y={rect.bottom + 2} items={toItems(menus[open].items)} onClose={() => setOpen(null)} keyboard startActive={byKeys} />, document.body)}
    </nav>
  );
}
