import { memo, useEffect, useState } from "react";
import { useContextMenu } from "../ui/ContextMenu";
import { listSamples, openProjectFromUrl } from "./openFile";
import { confirmDialog } from "../ui/confirm";
import { guardedOpen } from "./menu";
import { useStore, undo, redo } from "../model/store";
import { Icon } from "../ui/Icon";
import { useDialogs } from "./dialogs";
import { importViaDialog } from "../io/importFiles";
import { isTauri } from "../io/platform";
import { popOutActiveTab } from "./popout";

export const Toolbar = memo(function Toolbar() {
  const activeTab = useStore((s) => s.ui.activeTab);
  const projectName = useStore((s) => s.project.name);
  const dirty = useStore((s) => s.dirty);
  const sidebarCollapsed = useStore((s) => s.ui.sidebarCollapsed);
  const inspectorCollapsed = useStore((s) => s.ui.inspectorCollapsed);
  const st = useStore;
  const dialogs = useDialogs;

  const isSheet = activeTab?.kind === "sheet";
  const isGraph = activeTab?.kind === "graph";

  return (
    <div className="titlebar" data-tauri-drag-region style={isTauri() ? undefined : { paddingLeft: 10 }}>
      <div className="toolbar-group">
        <button className={"icon-btn" + (sidebarCollapsed ? "" : " on")} title="Toggle sidebar (⌘⌥S)" onClick={() => st.getState().toggleSidebar()}>
          <Icon name="sidebar" />
        </button>
      </div>
      <div className="toolbar-sep" />
      <div className="toolbar-group">
        <button className="icon-btn" title="Undo (⌘Z)" onClick={() => undo()}>
          <Icon name="undo" />
        </button>
        <button className="icon-btn" title="Redo (⇧⌘Z)" onClick={() => redo()}>
          <Icon name="redo" />
        </button>
      </div>
      {/* In the Mac app these commands live in the menu bar (File, Data, Analysis); the buttons only show in the browser preview. */}
      {!isTauri() && (
        <>
          <div className="toolbar-sep" />
          <div className="toolbar-group">
            <button className="btn" title="Import CSV, TSV or Excel (⌘I)" onClick={() => void importViaDialog()}>
              <Icon name="import" size={14} /> Import
            </button>
            <button className="btn" title="New sheet" onClick={() => st.getState().addSheet()}>
              <Icon name="table" size={14} /> Sheet
            </button>
            <button
              className="btn"
              title="Plot selected columns (⌘P)"
              disabled={!isSheet}
              onClick={() => isSheet && dialogs.getState().setPlotDialog({ sheetId: activeTab.id })}
            >
              <Icon name="chart" size={14} /> Plot
            </button>
            <button
              className="btn"
              title="Fit a curve"
              disabled={!isGraph}
              onClick={() => {
                if (!isGraph) return;
                const g = st.getState().project.graphs.find((x) => x.id === activeTab.id);
                const sel = st.getState().ui.selection;
                const layerId = "layerId" in sel ? sel.layerId : g?.layers[0]?.id;
                const plotId = sel.kind === "plot" ? sel.plotId : null;
                if (g && layerId) dialogs.getState().setFitDialog({ graphId: g.id, layerId, plotId });
              }}
            >
              <Icon name="fit" size={14} /> Fit
            </button>
            <button className="btn" title="Export graph (⇧⌘E)" disabled={!isGraph} onClick={() => isGraph && dialogs.getState().setExportDialog({ graphId: activeTab.id })}>
              <Icon name="export" size={14} /> Export
            </button>
            <SamplesButton />
          </div>
        </>
      )}
      <div className="spacer" data-tauri-drag-region />
      <div className="title" data-tauri-drag-region>
        {projectName}
        {dirty && <span className="dirty"> — Edited</span>}
      </div>
      <div className="spacer" data-tauri-drag-region />
      <div className="toolbar-group">
        <button className="icon-btn" title="Open this sheet or graph in a new window (⇧⌘O)" disabled={!activeTab} onClick={() => void popOutActiveTab()}>
          <Icon name="popout" />
        </button>
        <button className={"icon-btn" + (inspectorCollapsed ? "" : " on")} title="Toggle inspector (⌘⌥I)" onClick={() => st.getState().toggleInspector()}>
          <Icon name="inspector" />
        </button>
      </div>
    </div>
  );
});

/** Browser build only: open one of the bundled sample projects, or a project file from disk. */
function SamplesButton() {
  const [samples, setSamples] = useState<{ file: string; name: string }[]>([]);
  const [menuNode, openMenu] = useContextMenu();
  useEffect(() => {
    void listSamples().then(setSamples);
  }, []);
  const load = async (file: string, name: string) => {
    if (useStore.getState().dirty && !(await confirmDialog("Discard your changes and open the sample?"))) return;
    try {
      await openProjectFromUrl(`samples/${file}`, name);
    } catch (e) {
      useDialogs.getState().showToast(`Could not load the sample: ${(e as Error).message}`);
    }
  };
  return (
    <>
      <button
        className="btn"
        title="Open a sample project to play with, or a .plotproj file from your computer"
        onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          openMenu({ clientX: r.left, clientY: r.bottom + 2 }, [
            ...samples.map((s) => ({ label: s.name, onSelect: () => void load(s.file, s.name) })),
            ...(samples.length ? [{ type: "sep" } as const] : []),
            { label: "Open a .plotproj file…", onSelect: () => void guardedOpen() },
          ]);
        }}
      >
        <Icon name="folder" size={14} /> Samples
      </button>
      {menuNode}
    </>
  );
}
