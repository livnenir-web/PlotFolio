// The menu bar of the browser build. In the Mac app the same commands live in the native menu bar
// (src-tauri/src/menu.rs); both send command ids to handleMenu() in src/app/menu.ts. Keep the two in sync:
// a command added to one menu should be added to the other.

/** "graph" / "sheet": the item is enabled only while a graph / sheet tab is active. */
export type MenuContext = "graph" | "sheet";

export type MenuEntry =
  | {
      id: string;
      label: string;
      /** shortcut as "Mod+Shift+S" (Mod = ⌘ on a Mac, Ctrl elsewhere); left out when the browser keeps that key for itself */
      keys?: string;
      when?: MenuContext;
    }
  | { sep: true }
  | { label: string; submenu: MenuEntry[] | "samples" };

export interface MenuDef {
  title: string;
  items: MenuEntry[];
}

// Keys that browsers reserve (new window/tab, close tab, reload, address bar, developer tools) have no shortcut here.
export const WEB_MENUS: MenuDef[] = [
  {
    title: "PlotFolio",
    items: [
      { id: "about", label: "About PlotFolio" },
      { id: "aiNotes", label: "Notes for AI Assistants…" },
      { sep: true },
      { id: "settings", label: "Settings…" },
    ],
  },
  {
    title: "File",
    items: [
      { id: "new", label: "New Project" },
      { id: "open", label: "Open…", keys: "Mod+O" },
      { label: "Open Sample", submenu: "samples" },
      { sep: true },
      { id: "save", label: "Save", keys: "Mod+S" },
      { id: "saveAs", label: "Save As…", keys: "Mod+Shift+S" },
      { sep: true },
      {
        label: "Import",
        submenu: [
          { id: "import", label: "Data (CSV, TSV, Excel)…", keys: "Mod+I" },
          { id: "importImage", label: "Image onto Graph…", when: "graph" },
        ],
      },
      { id: "exportGraph", label: "Export Graph…", keys: "Mod+Shift+E", when: "graph" },
      { id: "exportCsv", label: "Export Sheet as CSV…", when: "sheet" },
    ],
  },
  {
    title: "Edit",
    items: [
      { id: "undo", label: "Undo", keys: "Mod+Z" },
      { id: "redo", label: "Redo", keys: "Mod+Shift+Z" },
      { sep: true },
      { id: "cut", label: "Cut", keys: "Mod+X" },
      { id: "copy", label: "Copy", keys: "Mod+C" },
      { id: "paste", label: "Paste", keys: "Mod+V" },
      { id: "selectAll", label: "Select All", keys: "Mod+A" },
      { sep: true },
      { id: "delete", label: "Delete", keys: "Delete" },
    ],
  },
  {
    title: "Data",
    items: [
      { id: "newSheet", label: "New Sheet" },
      { id: "plot", label: "Plot Columns…", keys: "Mod+P", when: "sheet" },
      { id: "stats", label: "Column Statistics", when: "sheet" },
      { sep: true },
      { id: "addColumn", label: "Add Column", when: "sheet" },
      { id: "sortAsc", label: "Sort Ascending", when: "sheet" },
      { id: "sortDesc", label: "Sort Descending", when: "sheet" },
    ],
  },
  {
    title: "Analysis",
    items: [
      { id: "fit", label: "Fit Curve…", keys: "Mod+F", when: "graph" },
      { sep: true },
      { id: "an:smooth", label: "Smooth…", when: "sheet" },
      { id: "an:derivative", label: "Differentiate", when: "sheet" },
      { id: "an:integrate", label: "Integrate", when: "sheet" },
      { id: "an:normalize", label: "Normalize…", when: "sheet" },
      { id: "an:fft", label: "FFT…", when: "sheet" },
      { sep: true },
      { id: "an:average", label: "Average Curves…", when: "sheet" },
      { id: "an:interpolate", label: "Interpolate onto X…", when: "sheet" },
      { sep: true },
      { id: "an:fill", label: "Fill Column With…", when: "sheet" },
      { id: "stats", label: "Column Statistics", when: "sheet" },
    ],
  },
  {
    title: "Graph",
    items: [
      { id: "newGraph", label: "New Graph" },
      { id: "addLayer", label: "Add Layer", when: "graph" },
      { id: "addText", label: "Add Text", when: "graph" },
      { id: "insertFunction", label: "Insert Function…", when: "graph" },
      { sep: true },
      { id: "draw:line", label: "Draw Line", when: "graph" },
      { id: "draw:arrow", label: "Draw Arrow", when: "graph" },
      { id: "draw:rect", label: "Draw Rectangle", when: "graph" },
      { id: "draw:ellipse", label: "Draw Ellipse", when: "graph" },
      { sep: true },
      { id: "rescale", label: "Rescale Axes to Data", when: "graph" },
      { sep: true },
      { id: "copySvg", label: "Copy as SVG", when: "graph" },
      { id: "copyPng", label: "Copy as PNG", when: "graph" },
    ],
  },
  {
    title: "View",
    items: [
      { id: "toggleSidebar", label: "Toggle Sidebar", keys: "Mod+Alt+S" },
      { id: "toggleInspector", label: "Toggle Inspector" },
      { sep: true },
      { id: "zoomIn", label: "Zoom In", keys: "Mod+=", when: "graph" },
      { id: "zoomOut", label: "Zoom Out", keys: "Mod+-", when: "graph" },
      { id: "zoomFit", label: "Zoom to Fit", keys: "Mod+0", when: "graph" },
      { sep: true },
      { id: "fullscreen", label: "Toggle Full Screen" },
    ],
  },
];

export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** "Mod+Shift+S" → "⇧⌘S" on a Mac, "Ctrl+Shift+S" elsewhere. */
export function formatKeys(keys: string, mac = IS_MAC): string {
  const parts = keys.split("+").filter(Boolean);
  // "Mod+=" splits into ["Mod", "="]; "Mod++" would lose the plus, so zoom in is written "Mod+="
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  const keyLabel = key === "=" ? "+" : key === "-" ? "−" : key === "Delete" ? (mac ? "⌫" : "Delete") : key.length === 1 ? key.toUpperCase() : key;
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
