// Keyboard shortcuts. Every command that can have a shortcut is listed here once, with its default key; the
// user's own choices are kept on this computer (localStorage), not in the project, and can be restored to the
// defaults. The in-page menu bar, the key handler (shortcutKeys.ts), tooltips and the Mac menu bar all read from here.
// The list depends on the build (see shell() in io/platform.ts): the Mac app and the browser take the commands of
// the browser menus, the Windows app those of its own menus; the desktop apps add keys a browser keeps for itself.
import { create } from "zustand";
import { hasNativeMenu, shell, type Shell } from "../io/platform";
import { accessKey, formatKeys, IS_MAC, menusFor, WINDOWS_MENUS, type MenuContext, type MenuEntry } from "./menuModel";

export interface Command {
  id: string;
  label: string;
  /** heading it is listed under (the menu it lives in) */
  group: string;
  /** default shortcut in this build ("Mod+Shift+E"), or null */
  keys: string | null;
  /** only while a graph / sheet is in front */
  when?: MenuContext;
  /** system conventions (copy, paste, undo …): shown, but not changeable */
  fixed?: boolean;
  /** has an item in the Mac menu bar, which then handles its shortcut */
  native: boolean;
  /** also works while the cursor is in a text field (only with ⌘ / Ctrl) */
  whileTyping?: boolean;
}

/** Keys that work in the desktop apps (Mac and Windows) but that a browser keeps for itself. */
const DESKTOP_DEFAULTS: Record<string, string> = {
  settings: "Mod+,",
  new: "Mod+N",
  newSheet: "Mod+T",
  newGraph: "Mod+Shift+N",
  addLayer: "Mod+L",
  rescale: "Mod+R",
  toggleInspector: "Mod+Alt+I",
};
const FIXED = new Set(["undo", "redo", "cut", "copy", "paste", "selectAll", "delete"]);
/** menu commands that the Mac menu provides itself (predefined items) */
const NOT_NATIVE = new Set(["cut", "copy", "paste", "selectAll", "fullscreen"]);
const WHILE_TYPING = new Set(["save", "saveAs", "open", "exportGraph", "toggleSidebar", "toggleInspector", "settings"]);

/** Commands without a menu item in the browser build (handled in the graph view, or only in the desktop apps). */
const EXTRA: (Omit<Command, "native" | "keys"> & { keys?: string; native?: boolean; desktopOnly?: boolean })[] = [
  { id: "group", label: "Group Selection", group: "Graph", keys: "Mod+G", when: "graph" },
  { id: "ungroup", label: "Ungroup", group: "Graph", keys: "Mod+Shift+G", when: "graph" },
  { id: "duplicate", label: "Duplicate Selection", group: "Graph", keys: "Mod+D", when: "graph" },
  { id: "animStepBack", label: "Animation: Previous Frame", group: "Graph", keys: ",", when: "graph" },
  { id: "animStepForward", label: "Animation: Next Frame", group: "Graph", keys: ".", when: "graph" },
  { id: "animFirst", label: "Animation: First Frame", group: "Graph", keys: "Home", when: "graph" },
  { id: "animLast", label: "Animation: Last Frame", group: "Graph", keys: "End", when: "graph" },
  { id: "popOut", label: "Open in New Window", group: "View", keys: "Mod+Shift+O", native: true, desktopOnly: true },
];

function build(s: Shell): Command[] {
  const desktop = s !== "browser";
  const out: Command[] = [];
  const seen = new Set<string>();
  const add = (c: Command) => {
    if (seen.has(c.id)) return;
    seen.add(c.id);
    out.push(c);
  };
  const walk = (entries: MenuEntry[], group: string, prefix = "") => {
    for (const e of entries) {
      if ("sep" in e) continue;
      if ("submenu" in e) {
        if (Array.isArray(e.submenu)) walk(e.submenu, group, `${e.label}: `); // "Import: Data (CSV, TSV, Excel)…"
        continue;
      }
      add({
        id: e.id,
        label: prefix + e.label,
        group,
        keys: (desktop ? DESKTOP_DEFAULTS[e.id] : undefined) ?? e.keys ?? null,
        when: e.when,
        fixed: FIXED.has(e.id) || undefined,
        native: s !== "windows" && !NOT_NATIVE.has(e.id), // the Windows app has no native menu
        whileTyping: WHILE_TYPING.has(e.id) || undefined,
      });
    }
  };
  for (const m of menusFor(s)) walk(m.items, m.title);
  for (const x of EXTRA) {
    if (x.desktopOnly && !desktop) continue;
    add({ id: x.id, label: x.label, group: x.group, keys: x.keys ?? null, when: x.when, native: s !== "windows" && !!x.native });
  }
  return out;
}

let cached: { shell: Shell; list: Command[]; byId: Map<string, Command> } | null = null;
/** Every command of a build (this one unless another is asked for), in menu order. */
export function commands(s: Shell = shell()): Command[] {
  if (!cached || cached.shell !== s) {
    const list = build(s);
    cached = { shell: s, list, byId: new Map(list.map((c) => [c.id, c])) };
  }
  return cached.list;
}
export function commandById(id: string): Command | undefined {
  commands();
  return cached!.byId.get(id);
}

// ---------------------------------------------------------------- keys

const CODE_KEYS: Record<string, string> = {
  Minus: "-",
  Equal: "=",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Backquote: "`",
  Space: "Space",
  Enter: "Enter",
  NumpadEnter: "Enter",
  Escape: "Escape",
  Tab: "Tab",
  Backspace: "Delete",
  Delete: "Delete",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
};

type KeyLike = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

/**
 * The key of an event, by its position on the keyboard (so ⌥S is "S", not "ß", and it works with any keyboard
 * layout); null for a modifier key on its own.
 */
function keyName(e: KeyLike): string | null {
  const code = e.code || "";
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^(?:Digit|Numpad)(\d)$/.exec(code);
  if (m) return m[1];
  if (/^F\d{1,2}$/.test(code)) return code;
  if (CODE_KEYS[code]) return CODE_KEYS[code];
  if (/^(Shift|Control|Alt|Meta|OS|CapsLock|Fn)/.test(code) || ["Shift", "Control", "Alt", "Meta", "CapsLock", "Dead", "Process"].includes(e.key)) return null;
  // events made in code carry no position
  if (!code && e.key) return e.key === " " ? "Space" : e.key === "Backspace" ? "Delete" : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return null;
}

/** "Mod+Shift+E" for a key press (Mod = ⌘ on a Mac, Ctrl elsewhere), or null for a lone modifier. */
export function comboOf(e: KeyLike, mac = IS_MAC): string | null {
  const key = keyName(e);
  if (!key) return null;
  const mods: string[] = [];
  if (mac ? e.metaKey : e.ctrlKey) mods.push("Mod");
  if (mac && e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  return [...mods, key].join("+");
}

const partsOf = (combo: string) => {
  const p = combo.split("+");
  return { key: p[p.length - 1] || "+", mods: p.slice(0, -1) };
};
const isFunctionKey = (key: string) => /^F\d{1,2}$/.test(key);

/** The same shortcut as the Mac menu bar writes it ("CmdOrCtrl+Shift+E"), or null when it is not one a menu should own. */
export function toAccelerator(combo: string | null): string | null {
  if (!combo) return null;
  const { key, mods } = partsOf(combo);
  // without ⌘ a menu shortcut would swallow plain typing: those stay with the page
  if (!mods.includes("Mod") && !isFunctionKey(key)) return null;
  const names: Record<string, string> = { ArrowLeft: "Left", ArrowRight: "Right", ArrowUp: "Up", ArrowDown: "Down", Delete: "Backspace" };
  const k = names[key] ?? key;
  if (!/^([A-Z0-9]|F\d{1,2}|[-=,./;'[\]\\`]|Space|Enter|Tab|Home|End|PageUp|PageDown|Left|Right|Up|Down|Backspace)$/.test(k)) return null;
  const mod: Record<string, string> = { Mod: "CmdOrCtrl", Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift" };
  return [...mods.map((m) => mod[m]), k].join("+");
}

/** Shortcuts the browser, macOS or Windows keeps for itself. */
const BROWSER_RESERVED = new Set(["Mod+N", "Mod+T", "Mod+W", "Mod+R", "Mod+L", "Mod+Q", "Mod+Shift+N", "Mod+Shift+T", "Mod+Shift+W", "Mod+Alt+I", "Mod+Shift+R", "Mod+Tab"]);
const SYSTEM_RESERVED = new Set(["Mod+Q", "Mod+H", "Mod+M", "Mod+W", "Mod+Tab", "Mod+Space", "Mod+Alt+H"]);
const WINDOWS_RESERVED = new Set(["Alt+F4", "Alt+Space", "Alt+Tab", "Alt+Escape", "Mod+Escape", "Mod+Alt+Delete", "F10"]);
/**
 * Redo, however it is typed: ⇧⌘Z on a Mac; elsewhere Ctrl+Y (the Windows habit) and Ctrl+Shift+Z both work, whichever
 * of the two the menu shows.
 */
export const REDO_COMBOS = IS_MAC ? ["Mod+Shift+Z"] : ["Mod+Y", "Mod+Shift+Z"];
const EDITING_KEYS = new Set(["Enter", "Escape", "Tab", "Delete", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

// ---------------------------------------------------------------- the user's choices

const STORAGE_KEY = "plotfolio.shortcuts.v1";
type Overrides = Record<string, string | null>;

function load(): Overrides {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    if (!v || typeof v !== "object") return {};
    const out: Overrides = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (x === null || typeof x === "string") out[k] = x;
    return out;
  } catch {
    return {};
  }
}

interface ShortcutState {
  /** command id → the user's shortcut (null = none); commands that are not listed use their default */
  overrides: Overrides;
  set: (id: string, combo: string | null) => void;
  reset: (id: string) => void;
  resetAll: () => void;
  /** take the choices saved by another window */
  reload: () => void;
}

export const useShortcuts = create<ShortcutState>((set, get) => {
  const commit = (overrides: Overrides) => {
    set({ overrides });
    try {
      if (Object.keys(overrides).length) localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* private mode: the choice lasts until the window closes */
    }
    void syncNativeMenu();
  };
  return {
    overrides: load(),
    set: (id, combo) => {
      const c = commandById(id);
      if (!c || c.fixed) return;
      const next = { ...get().overrides };
      if (combo === c.keys) delete next[id];
      else next[id] = combo;
      commit(next);
    },
    reset: (id) => {
      const next = { ...get().overrides };
      delete next[id];
      commit(next);
    },
    resetAll: () => commit({}),
    reload: () => set({ overrides: load() }),
  };
});

/** The shortcut in use for a command ("Mod+S"), or null. */
export function bindingOf(id: string, overrides: Overrides = useShortcuts.getState().overrides): string | null {
  const c = commandById(id);
  if (!c) return null;
  return !c.fixed && id in overrides ? overrides[id] : c.keys;
}

/** The shortcut in use as shown to the user ("⇧⌘E"), or "" when the command has none. */
export function keyHint(id: string, overrides?: Overrides): string {
  const b = bindingOf(id, overrides);
  return b ? formatKeys(b) : "";
}
/** " (⇧⌘E)" for the end of a tooltip, or "". */
export function keyHintSuffix(id: string, overrides?: Overrides): string {
  const h = keyHint(id, overrides);
  return h ? ` (${h})` : "";
}

const overlap = (a: Command, b: Command) => !a.when || !b.when || a.when === b.when;

/** Another command that already uses this shortcut where `id` would also be active. */
export function conflictOf(id: string, combo: string, overrides?: Overrides): Command | null {
  const me = commandById(id);
  if (!me) return null;
  return commands().find((c) => c.id !== id && overlap(c, me) && bindingOf(c.id, overrides) === combo) ?? null;
}

/** Why a shortcut cannot be given to a command (a sentence for the user), or null when it can. */
export function refusal(id: string, combo: string, s: Shell = shell()): string | null {
  const c = commandById(id);
  if (!c) return "Unknown command.";
  if (c.fixed) return "This shortcut is the same in every app and cannot be changed.";
  const { key, mods } = partsOf(combo);
  const shown = formatKeys(combo);
  const fixed = commands().find((x) => x.fixed && x.keys === combo);
  if (fixed) return `${shown} always means ${fixed.label}.`;
  if (REDO_COMBOS.includes(combo)) return `${shown} always means Redo.`;
  if (EDITING_KEYS.has(key) && !mods.includes("Mod")) return `${shown} is used for editing and moving the selection.`;
  if (combo === "L") return "L is held down to pick a layer on a graph.";
  if (s === "browser" && BROWSER_RESERVED.has(combo)) return `The browser keeps ${shown} for itself.`;
  if (s === "mac" && SYSTEM_RESERVED.has(combo)) return `macOS keeps ${shown} for itself.`;
  if (s === "windows") {
    if (WINDOWS_RESERVED.has(combo)) return `Windows keeps ${shown} for itself.`;
    const menu = WINDOWS_MENUS.find((m) => combo === `Alt+${accessKey(m)}`);
    if (menu) return `${shown} opens the ${menu.title} menu.`;
  }
  if (!mods.includes("Mod") && !isFunctionKey(key) && c.when !== "graph") return `Add ${IS_MAC ? "⌘" : "Ctrl"}, or use a function key: plain keys are needed for typing in sheets.`;
  return null;
}

/**
 * The command a key press stands for in the given context. ⌘+ (⌘ with Shift and =) also counts as ⌘= when nothing
 * else uses it, so "zoom in" works whichever way the plus is typed.
 */
export function commandForCombo(combo: string, active: MenuContext | null, overrides?: Overrides): Command | null {
  const find = (k: string) => commands().find((c) => !c.fixed && (!c.when || c.when === active) && bindingOf(c.id, overrides) === k) ?? null;
  return find(combo) ?? (combo.endsWith("Shift+=") ? find(combo.replace("Shift+=", "=")) : null);
}

/** True when the Mac menu bar owns the command's shortcut (the page must then not act on the same key press). */
export function nativeHandles(id: string, nativeMenu = hasNativeMenu()): boolean {
  const c = commandById(id);
  return nativeMenu && !!c && c.native && !c.fixed && toAccelerator(bindingOf(id)) !== null;
}

/** Give the Mac menu bar the shortcuts in use (the Mac app only). */
export async function syncNativeMenu(): Promise<void> {
  if (!hasNativeMenu()) return;
  const accels: Record<string, string | null> = {};
  for (const c of commands()) if (c.native && !c.fixed) accels[c.id] = toAccelerator(bindingOf(c.id));
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_menu_accelerators", { accels });
  } catch {
    /* an older shell without the command: the menu keeps its built-in shortcuts */
  }
}

/** Other windows of the app share the saved choices: follow them. */
export function installShortcutSync(): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) useShortcuts.getState().reload();
  };
  window.addEventListener("storage", onStorage);
  void syncNativeMenu();
  return () => window.removeEventListener("storage", onStorage);
}
