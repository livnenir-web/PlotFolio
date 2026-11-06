import { useStore, undo, redo } from "../model/store";
import { useDialogs } from "./dialogs";
import { isTauri } from "../io/platform";
import { importViaDialog } from "../io/importFiles";
import { openProject, saveProject } from "../io/project";
import { exportSheetCsv } from "../export/csv";
import { exportGraphAs } from "../export/exportGraph";
import { sheetPasteRef, sheetSelectionRef } from "../sheet/SheetView";
import { columnStatistics } from "../sheet/stats";
import { popOutActiveTab } from "./popout";
import { confirmDialog } from "../ui/confirm";
import { requestQuit } from "./closeGuard";
import { focusWindow, isBlankProject, openProjectWindow, windowForFile } from "./windows";
import { clearRecent } from "../io/recent";
import { insertImageIntoGraph, pickImageFile } from "../io/images";

/** File > Import > Image…: pick a picture and place it on the given graph (on the selected layer when there is one). */
export async function importImageOntoGraph(graphId: string): Promise<void> {
  const img = await pickImageFile();
  if (!img) return;
  const sel = useStore.getState().ui.selection;
  await insertImageIntoGraph(graphId, img.dataUrl, { layerId: "layerId" in sel && sel.graphId === graphId ? sel.layerId : undefined, name: img.name });
}

/**
 * Open a project (optionally a given path). A blank window takes the project itself; otherwise the file
 * opens in a new window, or the window that already shows it is brought to the front.
 */
export async function guardedOpen(path?: string): Promise<void> {
  try {
    if (!isTauri()) {
      if (useStore.getState().dirty && !(await confirmDialog("Discard unsaved changes and open another project?"))) return;
      await openProject(path);
      return;
    }
    let target = path;
    if (!target) {
      const { pickOpenFile } = await import("../io/platform");
      const { PROJECT_FILTER } = await import("../io/project");
      const res = await pickOpenFile(PROJECT_FILTER);
      if (!res?.[0]) return;
      target = res[0];
    }
    const existing = await windowForFile(target);
    if (existing) {
      await focusWindow(existing);
      return;
    }
    if (isBlankProject()) await openProject(target);
    else await openProjectWindow({ open: target });
  } catch (e) {
    useDialogs.getState().showToast(`Could not open: ${(e as Error).message}`);
  }
}

function typingTarget(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

/** Handle a native menu command (ids are defined in src-tauri/src/menu.rs). */
export function handleMenu(id: string): void {
  const st = useStore.getState();
  const d = useDialogs.getState();
  const tab = st.ui.activeTab;
  const graphId = tab?.kind === "graph" ? tab.id : null;
  const sheetId = tab?.kind === "sheet" ? tab.id : null;
  const graph = graphId ? st.project.graphs.find((g) => g.id === graphId) : undefined;
  const selLayerId = "layerId" in st.ui.selection ? st.ui.selection.layerId : graph?.layers[0]?.id;

  if (id.startsWith("recent:")) {
    const p = id.slice(7);
    if (p === "clear") clearRecent();
    else if (p !== "none") void guardedOpen(p);
    return;
  }
  switch (id) {
    case "new":
      // a new project gets its own window, unless this one is still blank
      if (!isTauri()) {
        if (!st.dirty) st.resetProject();
        else void confirmDialog("Discard unsaved changes and start a new project?").then((ok) => ok && useStore.getState().resetProject());
      } else if (!isBlankProject()) void openProjectWindow();
      break;
    case "open":
      void guardedOpen();
      break;
    case "quit":
      void requestQuit();
      break;
    case "save":
      void saveProject(false);
      break;
    case "saveAs":
      void saveProject(true);
      break;
    case "import":
      void importViaDialog();
      break;
    case "importImage":
      if (graphId) void importImageOntoGraph(graphId);
      else d.showToast("Open a graph first: pictures are placed on the active graph.");
      break;
    case "about":
      d.setAboutOpen("about");
      break;
    case "aiNotes":
      d.setAboutOpen("notes");
      break;
    case "exportGraph":
      if (graphId) d.setExportDialog({ graphId });
      break;
    case "exportCsv": {
      const sheet = sheetId ? st.project.sheets.find((s) => s.id === sheetId) : undefined;
      if (sheet) void exportSheetCsv(sheet);
      break;
    }
    case "undo":
      if (typingTarget()) document.execCommand("undo");
      else undo();
      break;
    case "redo":
      if (typingTarget()) document.execCommand("redo");
      else redo();
      break;
    case "delete":
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
      break;
    case "settings":
      d.setSettingsOpen(true);
      break;
    case "newSheet":
      st.addSheet();
      break;
    case "plot":
      if (sheetId) d.setPlotDialog({ sheetId });
      break;
    case "an:smooth":
    case "an:derivative":
    case "an:integrate":
    case "an:normalize":
    case "an:fft":
    case "an:average":
    case "an:interpolate":
    case "an:fill":
      if (sheetId) d.setAnalysis({ op: id.slice(3) as import("../analysis/AnalysisDialog").AnalysisOp, sheetId });
      break;
    case "rescale":
      if (graphId)
        st.updateGraph(graphId, (g) => {
          for (const l of g.layers) for (const a of [l.axes.x, l.axes.y, l.axes.y2, l.axes.z]) if (a) a.auto = true;
        });
      break;
    case "stats":
      if (sheetId) columnStatistics(sheetId, sheetSelectionRef.sheetId === sheetId ? sheetSelectionRef.cols : []);
      break;
    case "addColumn":
      if (sheetId) st.addColumn(sheetId);
      break;
    case "sortAsc":
    case "sortDesc":
      if (sheetId && sheetSelectionRef.cols[0] !== undefined) st.sortByColumn(sheetId, sheetSelectionRef.cols[0], id === "sortDesc");
      break;
    case "newGraph":
      st.addGraph();
      break;
    case "addLayer":
      if (graphId) st.setSelection({ kind: "layer", graphId, layerId: st.addLayer(graphId) });
      break;
    case "addText":
      window.dispatchEvent(new CustomEvent("plotkit:addText"));
      break;
    case "insertFunction":
      if (graphId) d.setFunctionDialog({ graphId, layerId: selLayerId ?? "new" });
      break;
    case "draw:line":
    case "draw:arrow":
    case "draw:rect":
    case "draw:ellipse":
      window.dispatchEvent(new CustomEvent("plotkit:draw", { detail: id.slice(5) }));
      break;
    case "fit":
      if (graphId && selLayerId) d.setFitDialog({ graphId, layerId: selLayerId, plotId: st.ui.selection.kind === "plot" ? st.ui.selection.plotId : null });
      break;
    case "copySvg":
      if (graphId) void exportGraphAs(graphId, "clipboard-svg");
      break;
    case "copyPng":
      if (graphId) void exportGraphAs(graphId, "clipboard-png");
      break;
    case "popOut":
      void popOutActiveTab();
      break;
    case "cut":
    case "copy":
    case "paste":
    case "selectAll":
      editCommand(id);
      break;
    case "fullscreen":
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.();
      break;
    case "toggleSidebar":
      st.toggleSidebar();
      break;
    case "toggleInspector":
      st.toggleInspector();
      break;
    case "zoomIn":
    case "zoomOut":
    case "zoomFit":
      window.dispatchEvent(new CustomEvent("plotkit:zoom", { detail: id }));
      break;
  }
}

/** Menu commands reach every window; only the focused project window acts on them. */
export async function installMenuListener(): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return listen<string>("menu", async (e) => {
    if (!(await getCurrentWindow().isFocused())) return;
    handleMenu(e.payload);
  });
}

/**
 * Edit menu in the browser build (the Mac app uses the native Cut/Copy/Paste items). Text fields get the browser's
 * own editing commands; a graph gets the same keys its shortcuts use; the sheet grid gets real clipboard events.
 */
function editCommand(cmd: "cut" | "copy" | "paste" | "selectAll"): void {
  const el = document.activeElement as HTMLElement | null;
  const toast = (m: string) => useDialogs.getState().showToast(m);
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const key = (k: string, target: EventTarget = window) =>
    target.dispatchEvent(new KeyboardEvent("keydown", { key: k, metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true }));
  const readClipboard = async (): Promise<string | null> => {
    try {
      return await navigator.clipboard.readText();
    } catch {
      toast(`The browser blocked reading the clipboard; press ${mac ? "⌘V" : "Ctrl+V"} instead`);
      return null;
    }
  };
  if (el && typingTarget()) {
    if (cmd === "paste") void readClipboard().then((t) => t !== null && document.execCommand("insertText", false, t));
    else document.execCommand(cmd);
    return;
  }
  const tab = useStore.getState().ui.activeTab;
  if (tab?.kind === "graph") {
    if (cmd === "selectAll") key("a");
    else if (cmd === "paste") key("v");
    else {
      key("c");
      if (cmd === "cut") window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    }
    return;
  }
  if (tab?.kind === "sheet") {
    if (cmd === "selectAll") {
      key("a", el ?? window);
      return;
    }
    if (cmd === "paste") {
      // the grid ignores synthetic paste events, so the text goes through the sheet's own paste logic
      void readClipboard().then((t) => {
        if (t !== null && !sheetPasteRef.paste?.(t)) toast("Click a cell first, then paste");
      });
      return;
    }
    // copy / cut: a real clipboard event, which the grid answers with the selected cells
    if (!document.execCommand(cmd)) toast(`Press ${mac ? (cmd === "cut" ? "⌘X" : "⌘C") : cmd === "cut" ? "Ctrl+X" : "Ctrl+C"} to ${cmd}`);
  }
}
