import { memo, useEffect, useState } from "react";
import { useContextMenu } from "../ui/ContextMenu";
import { listSamples, loadSample } from "./openFile";
import { MenuBar } from "./MenuBar";
import { guardedOpen } from "./menu";
import { useStore, undo, redo } from "../model/store";
import { Icon } from "../ui/Icon";
import { isTauri } from "../io/platform";
import { popOutActiveTab } from "./popout";

export const Toolbar = memo(function Toolbar() {
  const activeTab = useStore((s) => s.ui.activeTab);
  const projectName = useStore((s) => s.project.name);
  const dirty = useStore((s) => s.dirty);
  const sidebarCollapsed = useStore((s) => s.ui.sidebarCollapsed);
  const inspectorCollapsed = useStore((s) => s.ui.inspectorCollapsed);
  const st = useStore;


  return (
    <div className="titlebar" data-tauri-drag-region style={isTauri() ? undefined : { paddingLeft: 10 }}>
      <div className="toolbar-group">
        <button className={"icon-btn" + (sidebarCollapsed ? "" : " on")} title="Toggle sidebar (⌘⌥S)" onClick={() => st.getState().toggleSidebar()}>
          <Icon name="sidebar" />
        </button>
      </div>
      {/* In the browser there is no native menu bar: PlotFolio draws its own here. The Mac app uses the system menu bar. */}
      {!isTauri() && (
        <>
          <div className="toolbar-sep" />
          <MenuBar />
        </>
      )}
      <div className="toolbar-sep" />
      <div className="toolbar-group undo-group">
        <button className="icon-btn" title="Undo (⌘Z)" onClick={() => undo()}>
          <Icon name="undo" />
        </button>
        <button className="icon-btn" title="Redo (⇧⌘Z)" onClick={() => redo()}>
          <Icon name="redo" />
        </button>
      </div>
      {!isTauri() && (
        <>
          <div className="toolbar-sep" />
          <SamplesButton />
        </>
      )}
      <div className="spacer" data-tauri-drag-region />
      <div className="title" data-tauri-drag-region>
        {projectName}
        {dirty && <span className="dirty"> — Edited</span>}
      </div>
      <div className="spacer" data-tauri-drag-region />
      <div className="toolbar-group">
        {isTauri() && (
          <button className="icon-btn" title="Open this sheet or graph in a new window (⇧⌘O)" disabled={!activeTab} onClick={() => void popOutActiveTab()}>
            <Icon name="popout" />
          </button>
        )}
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
  return (
    <>
      <button
        className="btn"
        title="Open a sample project to play with, or a .plotproj file from your computer"
        onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          openMenu({ clientX: r.left, clientY: r.bottom + 2 }, [
            ...samples.map((s) => ({ label: s.name, onSelect: () => void loadSample(s.file, s.name) })),
            ...(samples.length ? [{ type: "sep" } as const] : []),
            { label: "Open a .plotproj file…", onSelect: () => void guardedOpen() },
          ]);
        }}
      >
        <Icon name="folder" size={14} /> <span className="lbl">Samples</span>
      </button>
      {menuNode}
    </>
  );
}
