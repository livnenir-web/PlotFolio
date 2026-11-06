import { useEffect, useRef, useState } from "react";
import { Group, Panel, Separator, type PanelImperativeHandle } from "react-resizable-panels";
import { useStore, undo, redo } from "../model/store";
import { Toolbar } from "./Toolbar";
import { Sidebar } from "./Sidebar";
import { TabBar } from "./TabBar";
import { Inspector } from "./Inspector";
import { SheetView } from "../sheet/SheetView";
import { GraphView } from "../graph/GraphView";
import { ImportDialog } from "../sheet/ImportDialog";
import { PlotDialog } from "../sheet/PlotDialog";
import { ExportDialog } from "../export/ExportDialog";
import { useDialogs } from "./dialogs";
import { importFileObject, importPath, importViaDialog } from "../io/importFiles";
import { isTauri } from "../io/platform";
import { clearAutosave, installViewMemory, loadAutosave, loadAutosaveView, otherAutosaves, saveProject, startAutosave, updateTitle } from "../io/project";
import { installRefitWatcher } from "../fit/runFit";
import { confirmDialog } from "../ui/confirm";
import { SettingsDialog } from "./SettingsDialog";
import { AboutDialog } from "./AboutDialog";
import { handleMenu, installMenuListener } from "./menu";
import { installOpenFileListener, openPendingFile, openStartupProject } from "./openFile";
import { currentLabel, installClipboardSync, installQuitListener, installWindowFileSync, openProjectWindow } from "./windows";
import { fileToDataUrl, insertImageIntoGraph, isImagePath } from "../io/images";
import { syncRecentMenu } from "../io/recent";
import { installColumnDropHandler, isColumnDragFile } from "../io/columnDrop";
import { installMainSync } from "./popout";
import { AnalysisDialog } from "../analysis/AnalysisDialog";
import { ClosePrompt } from "./ClosePrompt";
import { FunctionDialog } from "../graph/FunctionDialog";
import { installCloseGuard } from "./closeGuard";

export default function App() {
  const activeTab = useStore((s) => s.ui.activeTab);
  // only the active item is selected, so edits elsewhere (or per-frame layer edits) do not re-render the shell
  const activeSheet = useStore((s) => (s.ui.activeTab?.kind === "sheet" ? s.project.sheets.find((x) => x.id === s.ui.activeTab!.id) : undefined));
  const activeGraph = useStore((s) => (s.ui.activeTab?.kind === "graph" ? s.project.graphs.find((g) => g.id === s.ui.activeTab!.id) : undefined));
  const sidebarCollapsed = useStore((s) => s.ui.sidebarCollapsed);
  const inspectorCollapsed = useStore((s) => s.ui.inspectorCollapsed);
  const importSource = useDialogs((s) => s.importSource);
  const plotDialog = useDialogs((s) => s.plotDialog);
  const exportDialog = useDialogs((s) => s.exportDialog);
  const toast = useDialogs((s) => s.toast);
  const settingsOpen = useDialogs((s) => s.settingsOpen);
  const aboutOpen = useDialogs((s) => s.aboutOpen);
  const analysis = useDialogs((s) => s.analysis);
  const functionDialog = useDialogs((s) => s.functionDialog);
  const projectName = useStore((s) => s.project.name);
  const dirty = useStore((s) => s.dirty);
  const sidebarRef = useRef<PanelImperativeHandle>(null);
  const inspectorRef = useRef<PanelImperativeHandle>(null);
  const [dragOver, setDragOver] = useState(false);

  // initial tab + autosave recovery
  useEffect(() => {
    installRefitWatcher();
    const st = useStore.getState();
    if (!st.ui.activeTab && st.project.sheets[0]) st.openTab({ kind: "sheet", id: st.project.sheets[0].id });
    void (async () => {
      void installWindowFileSync();
      installViewMemory();
      // a window opened for a file or an autosave: load it and skip recovery
      if (await openStartupProject()) {
        startAutosave();
        void updateTitle();
        return;
      }
      // launched by double-clicking a project file: open it instead of offering recovery
      if (await openPendingFile()) {
        startAutosave();
        void updateTitle();
        return;
      }
      const label = await currentLabel();
      if (label === "main") {
        const auto = await loadAutosave();
        const autoView = await loadAutosaveView();
        const hasContent = (p: typeof auto) => !!p && (p.graphs.length > 0 || p.sheets.some((s) => s.columns.some((c) => c.values.length > 0)));
        const others = await otherAutosaves();
        const n = (hasContent(auto) ? 1 : 0) + others.length;
        if (n > 0) {
          if (await confirmDialog(n === 1 ? "Recover the unsaved project from the last session?" : `Recover the ${n} unsaved projects from the last session?`)) {
            if (hasContent(auto)) {
              useStore.getState().loadProject(auto!, null, autoView);
              useStore.setState({ savedRef: null, dirty: true });
            }
            for (const file of others) void openProjectWindow({ recover: file });
          } else {
            await clearAutosave(); // declined: do not ask again
            const { remove } = await import("@tauri-apps/plugin-fs");
            for (const file of others) await remove(file).catch(() => {});
          }
        }
      }
      startAutosave();
      void updateTitle();
    })();
  }, []);

  useEffect(() => {
    void updateTitle();
  }, [projectName, dirty]);

  useEffect(() => {
    let un: (() => void) | undefined;
    void installMenuListener().then((u) => (un = u));
    void installMainSync();
    void installCloseGuard();
    void syncRecentMenu();
    let unDrop: (() => void) | undefined;
    if (isTauri()) void installColumnDropHandler().then((u) => (unDrop = u));
    let unOpen: (() => void) | undefined;
    void installOpenFileListener().then((u) => (unOpen = u));
    let unQuit: (() => void) | undefined;
    void installQuitListener().then((u) => (unQuit = u));
    let unClip: (() => void) | undefined;
    void installClipboardSync().then((u) => (unClip = u));
    return () => {
      un?.();
      unDrop?.();
      unOpen?.();
      unQuit?.();
      unClip?.();
    };
  }, []);

  // collapse/expand side panels
  useEffect(() => {
    const p = sidebarRef.current;
    if (!p) return;
    if (sidebarCollapsed && !p.isCollapsed()) p.collapse();
    if (!sidebarCollapsed && p.isCollapsed()) p.expand();
  }, [sidebarCollapsed]);
  useEffect(() => {
    const p = inspectorRef.current;
    if (!p) return;
    if (inspectorCollapsed && !p.isCollapsed()) p.collapse();
    if (!inspectorCollapsed && p.isCollapsed()) p.expand();
  }, [inspectorCollapsed]);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const target = e.target as HTMLElement;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      const k = e.key.toLowerCase();
      const st = useStore.getState();
      if (k === "z" && !typing) {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (k === "s") {
        e.preventDefault();
        void saveProject(e.shiftKey);
      } else if (k === "o" && !e.shiftKey) {
        e.preventDefault();
        handleMenu("open");
      } else if (k === "i" && !e.altKey && !e.shiftKey && !typing) {
        e.preventDefault();
        void importViaDialog();
      } else if (k === "i" && e.altKey) {
        e.preventDefault();
        st.toggleInspector();
      } else if (k === "s" && e.altKey) {
        e.preventDefault();
        st.toggleSidebar();
      } else if (k === "w" && !typing) {
        e.preventDefault();
        if (st.ui.activeTab) st.closeTab(st.ui.activeTab);
      } else if (k === "p" && !typing && st.ui.activeTab?.kind === "sheet") {
        e.preventDefault();
        useDialogs.getState().setPlotDialog({ sheetId: st.ui.activeTab.id });
      } else if (k === "f" && !typing && !e.shiftKey && !e.altKey && !isTauri() && st.ui.activeTab?.kind === "graph") {
        e.preventDefault();
        handleMenu("fit");
      } else if (k === "e" && e.shiftKey && st.ui.activeTab?.kind === "graph") {
        e.preventDefault();
        useDialogs.getState().setExportDialog({ graphId: st.ui.activeTab.id });
      } else if (k === "n" && !typing) {
        e.preventDefault();
        if (e.shiftKey) st.addGraph();
        else if (!st.dirty) st.resetProject();
        else void confirmDialog("Discard unsaved changes and start a new project?").then((ok) => ok && useStore.getState().resetProject());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // file drop (Tauri paths + browser File objects)
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      void import("@tauri-apps/api/webview").then(async ({ getCurrentWebview }) => {
        unlisten = await getCurrentWebview().onDragDropEvent((ev) => {
          if (ev.payload.type === "enter" || ev.payload.type === "over") setDragOver(true);
          else if (ev.payload.type === "leave") setDragOver(false);
          else if (ev.payload.type === "drop") {
            setDragOver(false);
            const onGraph = useStore.getState().ui.activeTab?.kind === "graph";
            // column drags and pictures dropped on a graph are handled by the graph drop handler
            for (const p of ev.payload.paths) if (!isColumnDragFile(p) && !(onGraph && isImagePath(p))) void importPath(p);
          }
        });
      });
    }
    const over = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(true);
    };
    const leave = () => setDragOver(false);
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (isTauri()) return;
      for (const f of Array.from(e.dataTransfer?.files ?? [])) {
        const tab = useStore.getState().ui.activeTab;
        if (f.type.startsWith("image/") && tab?.kind === "graph") void fileToDataUrl(f).then((url) => insertImageIntoGraph(tab.id, url, { name: f.name }));
        else void importFileObject(f);
      }
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      unlisten?.();
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  // warn before closing with unsaved changes (browser)
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (useStore.getState().dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);


  return (
    <div className="app">
      <Toolbar />
      <div className="body">
        <Group orientation="horizontal" style={{ height: "100%" }}>
          <Panel
            panelRef={sidebarRef}
            defaultSize={200}
            minSize={140}
            maxSize={400}
            collapsible
            collapsedSize={0}
            onResize={(size) => {
              const collapsed = size.inPixels === 0;
              if (collapsed !== useStore.getState().ui.sidebarCollapsed) useStore.setState((s) => ({ ui: { ...s.ui, sidebarCollapsed: collapsed } }));
            }}
          >
            <Sidebar />
          </Panel>
          <Separator className="separator" />
          <Panel minSize={300}>
            <div className="main">
              <TabBar />
              <div className="content">
                {activeSheet && <SheetView key={activeSheet.id} sheet={activeSheet} />}
                {activeGraph && <GraphView key={activeGraph.id} graph={activeGraph} />}
                {!activeSheet && !activeGraph && <EmptyState />}
              </div>
            </div>
          </Panel>
          <Separator className="separator" />
          <Panel
            panelRef={inspectorRef}
            defaultSize={260}
            minSize={200}
            maxSize={480}
            collapsible
            collapsedSize={0}
            onResize={(size) => {
              const collapsed = size.inPixels === 0;
              if (collapsed !== useStore.getState().ui.inspectorCollapsed) useStore.setState((s) => ({ ui: { ...s.ui, inspectorCollapsed: collapsed } }));
            }}
          >
            <Inspector />
          </Panel>
        </Group>
      </div>
      {dragOver && <div className="dropzone">Drop CSV, TSV, Excel or .plotproj files to import{activeTab?.kind === "graph" ? ", or an image to place it on the graph" : ""}</div>}
      {importSource && <ImportDialog key={importSource.name} source={importSource} />}
      {plotDialog && <PlotDialog key={plotDialog.sheetId} sheetId={plotDialog.sheetId} />}
      {exportDialog && <ExportDialog graphId={exportDialog.graphId} />}
      {settingsOpen && <SettingsDialog />}
      {aboutOpen && <AboutDialog key={aboutOpen} page={aboutOpen} />}
      <ClosePrompt />
      {functionDialog && <FunctionDialog graphId={functionDialog.graphId} layerId={functionDialog.layerId} />}
      {analysis && <AnalysisDialog key={analysis.op + analysis.sheetId} op={analysis.op} sheetId={analysis.sheetId} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-3)", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 15 }}>Open a sheet or graph from the sidebar</div>
      <div style={{ fontSize: 12 }}>Drop a CSV or Excel file anywhere to import it · ⌘I to import · ⌘O to open a project</div>
    </div>
  );
}
