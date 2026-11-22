import { memo, useEffect, useState } from "react";
import { useContextMenu } from "../ui/ContextMenu";
import { listSamples, loadSample } from "./openFile";
import { MenuBar } from "./MenuBar";
import { guardedOpen } from "./menu";
import { useStore, undo, redo } from "../model/store";
import { Icon } from "../ui/Icon";
import { hasNativeMenu, isTauri, shell } from "../io/platform";
import { popOutActiveTab } from "./popout";
import { keyHintSuffix, useShortcuts } from "./shortcuts";

export const Toolbar = memo(function Toolbar() {
  const activeTab = useStore((s) => s.ui.activeTab);
  const projectName = useStore((s) => s.project.name);
  const dirty = useStore((s) => s.dirty);
  const sidebarCollapsed = useStore((s) => s.ui.sidebarCollapsed);
  const inspectorCollapsed = useStore((s) => s.ui.inspectorCollapsed);
  const overrides = useShortcuts((s) => s.overrides);
  const st = useStore;
  // the Mac app: this row is also the window's title bar (it is dragged to move the window and shows the project
  // name between the traffic lights and the buttons). The Windows app has the Windows title bar above this row.
  const mac = shell() === "mac";
  const drag = mac ? { "data-tauri-drag-region": true } : {};

  return (
    <div className="titlebar" {...drag}>
      <div className="toolbar-group">
        <button className={"icon-btn" + (sidebarCollapsed ? "" : " on")} title={`Toggle sidebar${keyHintSuffix("toggleSidebar", overrides)}`} onClick={() => st.getState().toggleSidebar()}>
          <Icon name="sidebar" />
        </button>
      </div>
      {/* The Mac app uses the system menu bar. In the Windows app and in the browser PlotFolio draws its own here. */}
      {!hasNativeMenu() && (
        <>
          <div className="toolbar-sep" />
          <MenuBar />
        </>
      )}
      <div className="toolbar-sep" />
      <div className="toolbar-group undo-group">
        <button className="icon-btn" title={`Undo${keyHintSuffix("undo")}`} onClick={() => undo()}>
          <Icon name="undo" />
        </button>
        <button className="icon-btn" title={`Redo${keyHintSuffix("redo")}`} onClick={() => redo()}>
          <Icon name="redo" />
        </button>
      </div>
      {!isTauri() && (
        <>
          <div className="toolbar-sep" />
          <SamplesButton />
        </>
      )}
      <div className="spacer" {...drag} />
      {/* the Windows title bar already shows the name of the project */}
      {shell() !== "windows" && (
        <div className="title" {...drag}>
          {projectName}
          {dirty && <span className="dirty"> — Edited</span>}
        </div>
      )}
      <div className="spacer" {...drag} />
      <div className="toolbar-group">
        {isTauri() && (
          <button className="icon-btn" title={`Open this sheet or graph in a new window${keyHintSuffix("popOut", overrides)}`} disabled={!activeTab} onClick={() => void popOutActiveTab()}>
            <Icon name="popout" />
          </button>
        )}
        <button className={"icon-btn" + (inspectorCollapsed ? "" : " on")} title={`Toggle inspector${keyHintSuffix("toggleInspector", overrides)}`} onClick={() => st.getState().toggleInspector()}>
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
