// The menus PlotFolio draws itself: in the browser build, and in the Windows app (under the Windows title bar).
// In the Mac app the same commands live in the native menu bar (src-tauri/src/menu.rs). All of them send command
// ids to handleMenu() in src/app/menu.ts. Keep them in sync: a command added to the Mac menu should be added here,
// and the other way round. Data, Analysis and Graph are written once and used by both layouts below.
import { MAC_KEYS, shell, type Shell } from "../io/platform";

/** "graph" / "sheet": the item is enabled only while a graph / sheet tab is active. */
export type MenuContext = "graph" | "sheet";

export type MenuEntry =
  | {
      id: string;
      label: string;
      /**
       * default shortcut as "Mod+Shift+S" (Mod = ⌘ on a Mac, Ctrl elsewhere); left out when the browser keeps that key
       * for itself (the desktop apps add theirs, see DESKTOP_DEFAULTS in shortcuts.ts). The shortcut in use may
       * differ: users can change it (see shortcuts.ts).
       */
      keys?: string;
      when?: MenuContext;
      /** a key the system handles itself, shown where a shortcut would be ("Alt+F4"); not a shortcut of PlotFolio */
      hint?: string;
    }
  | { sep: true }
  | { label: string; submenu: MenuEntry[] | "samples" | "recent" };

export interface MenuDef {
  title: string;
  items: MenuEntry[];
  /** the menu named after the app (Mac habit; the browser build has one): its title is drawn bold */
  app?: boolean;
}

const SEP: MenuEntry = { sep: true };

const IMPORT: MenuEntry = {
  label: "Import",
  submenu: [
    { id: "import", label: "Data (CSV, TSV, Excel)…", keys: "Mod+I" },
    { id: "importImage", label: "Image onto Graph…", when: "graph" },
  ],
};
const EXPORTS: MenuEntry[] = [
  { id: "exportGraph", label: "Export Graph…", keys: "Mod+Shift+E", when: "graph" },
  { id: "exportAnimation", label: "Export Animation…", when: "graph" },
  { id: "exportCsv", label: "Export Sheet as CSV…", when: "sheet" },
];
const SAVES: MenuEntry[] = [
  { id: "save", label: "Save", keys: "Mod+S" },
  { id: "saveAs", label: "Save As…", keys: "Mod+Shift+S" },
];
const CLIPBOARD: MenuEntry[] = [
  { id: "cut", label: "Cut", keys: "Mod+X" },
  { id: "copy", label: "Copy", keys: "Mod+C" },
  { id: "paste", label: "Paste", keys: "Mod+V" },
  { id: "selectAll", label: "Select All", keys: "Mod+A" },
  SEP,
  { id: "delete", label: "Delete", keys: "Delete" },
];
const ZOOM: MenuEntry[] = [
  { id: "zoomIn", label: "Zoom In", keys: "Mod+=", when: "graph" },
  { id: "zoomOut", label: "Zoom Out", keys: "Mod+-", when: "graph" },
  { id: "zoomFit", label: "Zoom to Fit", keys: "Mod+0", when: "graph" },
];

const DATA: MenuDef = {
  title: "Data",
  items: [
    { id: "newSheet", label: "New Sheet" },
    { id: "plot", label: "Plot Columns…", keys: "Mod+P", when: "sheet" },
    { id: "stats", label: "Statistics" },
    SEP,
    { id: "addColumn", label: "Add Column", when: "sheet" },
    { id: "sortAsc", label: "Sort Ascending", when: "sheet" },
    { id: "sortDesc", label: "Sort Descending", when: "sheet" },
  ],
};
const ANALYSIS: MenuDef = {
  title: "Analysis",
  items: [
    { id: "fit", label: "Fit Curve…", keys: "Mod+F", when: "graph" },
    { id: "compare", label: "Compare Groups…" },
    SEP,
    { id: "an:smooth", label: "Smooth…" },
    { id: "an:derivative", label: "Differentiate" },
    { id: "an:integrate", label: "Integrate" },
    { id: "an:normalize", label: "Normalize…" },
    { id: "an:math", label: "Curve Math…", when: "graph" },
    { id: "an:fft", label: "FFT…" },
    { id: "an:cdf", label: "Cumulative Distribution (CDF)…" },
    SEP,
    { id: "an:average", label: "Average Curves…" },
    { id: "an:interpolate", label: "Interpolate onto X…" },
    SEP,
    { id: "an:fill", label: "Fill Column With…", when: "sheet" },
    { id: "stats", label: "Statistics" },
  ],
};
const GRAPH: MenuDef = {
  title: "Graph",
  items: [
    { id: "newGraph", label: "New Graph" },
    { id: "addLayer", label: "Add Layer", when: "graph" },
    { id: "addText", label: "Add Text", when: "graph" },
    { id: "insertFunction", label: "Insert Function…", when: "graph" },
    SEP,
    { id: "draw:line", label: "Draw Line", when: "graph" },
    { id: "draw:arrow", label: "Draw Arrow", when: "graph" },
    { id: "draw:rect", label: "Draw Rectangle", when: "graph" },
    { id: "draw:ellipse", label: "Draw Ellipse", when: "graph" },
    { id: "draw:bracket", label: "Draw Significance Bracket", when: "graph" },
    SEP,
    { id: "rescale", label: "Rescale Axes to Data", when: "graph" },
    SEP,
    { id: "animate", label: "Animate Figure", when: "graph" },
    { id: "playAnimation", label: "Play or Pause Animation", keys: "Space", when: "graph" },
    SEP,
    { id: "copySvg", label: "Copy as SVG", when: "graph" },
    { id: "copyPng", label: "Copy as PNG", when: "graph" },
  ],
};

// Keys that browsers reserve (new window/tab, close tab, reload, address bar, developer tools) have no shortcut here.
/** The browser build: laid out like the Mac menu bar, with a menu named after the app. */
export const WEB_MENUS: MenuDef[] = [
  {
    title: "PlotFolio",
    app: true,
    items: [
      { id: "about", label: "About PlotFolio" },
      { id: "aiNotes", label: "Notes for AI Assistants…" },
      { id: "shortcuts", label: "Shortcuts and Gestures…", keys: "Shift+/" },
      SEP,
      { id: "settings", label: "Settings…" },
      { id: "appearance", label: "Appearance…" },
    ],
  },
  {
    title: "File",
    items: [{ id: "new", label: "New Project" }, { id: "open", label: "Open…", keys: "Mod+O" }, { label: "Open Sample", submenu: "samples" }, SEP, ...SAVES, SEP, IMPORT, ...EXPORTS],
  },
  {
    title: "Edit",
    items: [{ id: "undo", label: "Undo", keys: "Mod+Z" }, { id: "redo", label: "Redo", keys: "Mod+Shift+Z" }, SEP, ...CLIPBOARD],
  },
  DATA,
  ANALYSIS,
  GRAPH,
  {
    title: "View",
    items: [{ id: "toggleSidebar", label: "Toggle Sidebar", keys: "Mod+Alt+S" }, { id: "toggleInspector", label: "Toggle Inspector" }, SEP, ...ZOOM, SEP, { id: "fullscreen", label: "Toggle Full Screen" }],
  },
];

/**
 * The Windows app: laid out the way Windows programs are. No menu named after the app: Settings and Exit sit in
 * File, About in Help; Redo is Ctrl+Y, full screen is F11, help is F1. Each menu opens with Alt and its first
 * letter (see accessKey), so the titles must start with different letters.
 */
export const WINDOWS_MENUS: MenuDef[] = [
  {
    title: "File",
    items: [
      { id: "new", label: "New Project" },
      { id: "open", label: "Open…", keys: "Mod+O" },
      { label: "Open Recent", submenu: "recent" },
      { label: "Open Sample", submenu: "samples" },
      SEP,
      ...SAVES,
      SEP,
      IMPORT,
      ...EXPORTS,
      SEP,
      { id: "settings", label: "Settings…" },
      SEP,
      { id: "closeWindow", label: "Close Window", hint: "Alt+F4" },
      { id: "quit", label: "Exit" },
    ],
  },
  {
    title: "Edit",
    items: [{ id: "undo", label: "Undo", keys: "Mod+Z" }, { id: "redo", label: "Redo", keys: "Mod+Y" }, SEP, ...CLIPBOARD],
  },
  DATA,
  ANALYSIS,
  GRAPH,
  {
    title: "View",
    items: [
      { id: "toggleSidebar", label: "Toggle Sidebar", keys: "Mod+Alt+S" },
      { id: "toggleInspector", label: "Toggle Inspector" },
      SEP,
      ...ZOOM,
      SEP,
      { id: "appearance", label: "Appearance…" },
      SEP,
      { id: "popOut", label: "Open in New Window", keys: "Mod+Shift+O" },
      { id: "fullscreen", label: "Full Screen", keys: "F11" },
    ],
  },
  {
    title: "Help",
    items: [{ id: "shortcuts", label: "Shortcuts and Gestures…", keys: "F1" }, { id: "aiNotes", label: "Notes for AI Assistants…" }, SEP, { id: "about", label: "About PlotFolio" }],
  },
];

/** The menus PlotFolio draws in this build. The Mac app draws none (its menu bar is native) but lists its commands from the browser layout. */
export function menusFor(s: Shell = shell()): MenuDef[] {
  return s === "windows" ? WINDOWS_MENUS : WEB_MENUS;
}

/** The letter that opens a menu together with Alt in the Windows app: the first of its title. */
export function accessKey(menu: MenuDef): string {
  return menu.title[0].toUpperCase();
}

/** True where keys are named the Mac way: ⌘ is the main modifier, and shortcuts are shown as symbols. */
export const IS_MAC = MAC_KEYS;
/** The names of the main modifier and of Alt in this build, for sentences ("⌘-click", "hold Alt"). */
export const MOD_KEY = IS_MAC ? "⌘" : "Ctrl";
export const ALT_KEY = IS_MAC ? "⌥" : "Alt";

/** "Mod+Shift+S" → "⇧⌘S" on a Mac, "Ctrl+Shift+S" elsewhere. */
export function formatKeys(keys: string, mac = IS_MAC): string {
  const parts = keys.split("+").filter(Boolean);
  // "Mod+=" splits into ["Mod", "="]; "Mod++" would lose the plus, so zoom in is written "Mod+="
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  // Shift + / is the question mark
  if (key === "/" && mods.length === 1 && mods[0] === "Shift") return "?";
  const named: Record<string, string> = { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Enter: "↩", Escape: "Esc", PageUp: "Page Up", PageDown: "Page Down" };
  const keyLabel = key === "=" ? "+" : key === "-" ? "−" : key === "Delete" ? (mac ? "⌫" : "Del") : key.length === 1 ? key.toUpperCase() : (named[key] ?? key);
  if (mac) {
    const sym: Record<string, string> = { Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Mod: "⌘" };
    // macOS order: ⌃ ⌥ ⇧ ⌘
    const order = ["Ctrl", "Alt", "Shift", "Mod"];
    return order.filter((m) => mods.includes(m)).map((m) => sym[m]).join("") + keyLabel;
  }
  const names: Record<string, string> = { Mod: "Ctrl", Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift" };
  const order = ["Mod", "Ctrl", "Alt", "Shift"];
  const seen = new Set<string>();
  const words = order.filter((m) => mods.includes(m)).map((m) => names[m]).filter((w) => !seen.has(w) && seen.add(w));
  return [...words, keyLabel].join("+");
}
