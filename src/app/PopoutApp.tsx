import { useEffect, useRef } from "react";
import { Group, Panel, Separator, type PanelImperativeHandle } from "react-resizable-panels";
import { useStore } from "../model/store";
import type { TabRef } from "../model/types";
import { Inspector } from "./Inspector";
import { SheetView } from "../sheet/SheetView";
import { GraphView } from "../graph/GraphView";
import { ExportDialog } from "../export/ExportDialog";
import { useDialogs } from "./dialogs";
import { installPopoutSync } from "./popout";
import { handleMenu } from "./menu";
import { Icon } from "../ui/Icon";
import { TabBar } from "./TabBar";
import { isTauri, setWindowTitle } from "../io/platform";
import { installColumnDropHandler } from "../io/columnDrop";

const POPOUT_MENU_IDS = new Set(["undo", "redo", "delete", "exportGraph", "addLayer", "addText", "fit", "copySvg", "copyPng", "toggleInspector", "zoomIn", "zoomOut", "zoomFit"]);

/** A second native window showing one graph or sheet, mirrored from the main window. */
export function PopoutApp({ tab }: { tab: TabRef }) {
  const inspectorCollapsed = useStore((s) => s.ui.inspectorCollapsed);
  const exportDialog = useDialogs((s) => s.exportDialog);
  const toast = useDialogs((s) => s.toast);
  const inspectorRef = useRef<PanelImperativeHandle>(null);

  const activeTab = useStore((s) => s.ui.activeTab);
  useEffect(() => {
    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      return installPopoutSync(getCurrentWindow().label);
    })().then(() => {
      // once the project has arrived, open the sibling items (same kind, same folder) as tabs too
      setTimeout(() => {
        const p = useStore.getState().project;
        const folderOf = (t: TabRef) => (t.kind === "sheet" ? p.sheets.find((s) => s.id === t.id)?.folderId : p.graphs.find((g) => g.id === t.id)?.folderId) ?? null;
        const folder = folderOf(tab);
        const siblings: TabRef[] = tab.kind === "sheet" ? p.sheets.filter((s) => (s.folderId ?? null) === folder).map((s) => ({ kind: "sheet" as const, id: s.id })) : p.graphs.filter((g) => (g.folderId ?? null) === folder).map((g) => ({ kind: "graph" as const, id: g.id }));
        useStore.setState((s) => ({ ui: { ...s.ui, openTabs: siblings.length ? siblings : [tab], activeTab: tab } }));
      }, 300);
    });
    useStore.getState().openTab(tab);
    let unDrop: (() => void) | undefined;
    if (isTauri()) void installColumnDropHandler().then((u) => (unDrop = u));
    let un: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      un = await listen<string>("menu", async (e) => {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        if (!(await getCurrentWindow().isFocused())) return;
        if (POPOUT_MENU_IDS.has(e.payload)) handleMenu(e.payload);
      });
    });
    return () => {
      un?.();
      unDrop?.();
    };
  }, [tab]);

  useEffect(() => {
    const p = inspectorRef.current;
    if (!p) return;
    if (inspectorCollapsed && !p.isCollapsed()) p.collapse();
    if (!inspectorCollapsed && p.isCollapsed()) p.expand();
  }, [inspectorCollapsed]);

  const current = activeTab ?? tab;
  const sheet = useStore((s) => (current.kind === "sheet" ? s.project.sheets.find((x) => x.id === current.id) : undefined));
  const graph = useStore((s) => (current.kind === "graph" ? s.project.graphs.find((g) => g.id === current.id) : undefined));
  const name = sheet?.name ?? graph?.name;
  useEffect(() => {
    if (name) void setWindowTitle(name);
  }, [name]);

  return (
    <div className="app">
      <div className="titlebar" data-tauri-drag-region>
        <span className="title" data-tauri-drag-region>
          {name ?? "Closed"}
        </span>
        <div className="spacer" data-tauri-drag-region />
        <button className={"icon-btn" + (inspectorCollapsed ? "" : " on")} title="Toggle inspector" onClick={() => useStore.getState().toggleInspector()}>
          <Icon name="inspector" />
        </button>
      </div>
      <div className="body">
        <Group orientation="horizontal" style={{ height: "100%" }}>
          <Panel minSize={300}>
            <div className="main">
              <TabBar />
              <div className="content">
                {sheet && <SheetView key={sheet.id} sheet={sheet} />}
                {graph && <GraphView key={graph.id} graph={graph} />}
                {!sheet && !graph && <div style={{ padding: 20, color: "var(--text-3)" }}>This item no longer exists in the project.</div>}
              </div>
            </div>
          </Panel>
          <Separator className="separator" />
          <Panel panelRef={inspectorRef} defaultSize={260} minSize={200} maxSize={480} collapsible collapsedSize={0}>
            <Inspector />
          </Panel>
        </Group>
      </div>
      {exportDialog && <ExportDialog graphId={exportDialog.graphId} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
