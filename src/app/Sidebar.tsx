import { memo, useEffect, useRef, useState } from "react";
import { useStore, useStoreEq, sameTab } from "../model/store";
import type { Folder, TabRef } from "../model/types";
import { Icon } from "../ui/Icon";
import { useContextMenu, type MenuItem } from "../ui/ContextMenu";
import { exportSheetCsv } from "../export/csv";
import { confirmDialog } from "../ui/confirm";
import { popOutTab } from "./popout";
import { useDialogs } from "./dialogs";

function RenameInput({ value, onDone }: { value: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(value);
  return (
    <input
      className="input"
      autoFocus
      value={v}
      onChange={(e) => setV(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => onDone(v.trim() || null)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") onDone(v.trim() || null);
        if (e.key === "Escape") onDone(null);
      }}
      onMouseDown={(e) => e.stopPropagation()}
    />
  );
}

type DragPayload = { kind: "sheet" | "graph" | "folder"; id: string };

interface ItemRef {
  id: string;
  name: string;
  folderId: string | null;
}
const sameItems = (a: ItemRef[], b: ItemRef[]) => a.length === b.length && a.every((x, i) => x.id === b[i].id && x.name === b[i].name && x.folderId === b[i].folderId);
const NO_FOLDERS: Folder[] = [];

export const Sidebar = memo(function Sidebar() {
  // the tree needs only ids, names and folders: compare by value so content edits do not re-render it
  const sheets = useStoreEq((s) => s.project.sheets.map((x): ItemRef => ({ id: x.id, name: x.name, folderId: x.folderId ?? null })), sameItems);
  const graphs = useStoreEq((s) => s.project.graphs.map((x): ItemRef => ({ id: x.id, name: x.name, folderId: x.folderId ?? null })), sameItems);
  const folders = useStore((s) => s.project.folders ?? NO_FOLDERS);
  const activeTab = useStore((s) => s.ui.activeTab);
  const currentFolderId = useStore((s) => s.ui.currentFolderId);
  const openTab = useStore((s) => s.openTab);
  const [renaming, setRenaming] = useState<{ kind: "sheet" | "graph" | "folder"; id: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null | undefined>(undefined);
  const [menu, openMenu] = useContextMenu();
  const st = useStore;

  const folderMenuItems = (parentId: string | null): MenuItem[] => {
    const subs = folders.filter((f) => f.parentId === parentId);
    return subs.map((f) => ({ type: "submenu", label: f.name, items: [{ label: `Move here`, onSelect: () => {} }, ...folderMenuItems(f.id)] }));
  };
  const moveMenu = (tab: TabRef): MenuItem => {
    const build = (parentId: string | null): MenuItem[] => {
      const subs = folders.filter((f) => f.parentId === parentId);
      const items: MenuItem[] = subs.map((f) =>
        folders.some((x) => x.parentId === f.id)
          ? { type: "submenu", label: f.name, items: [{ label: `Move into "${f.name}"`, onSelect: () => st.getState().moveToFolder(tab, f.id) }, { type: "sep" }, ...build(f.id)] }
          : { label: f.name, onSelect: () => st.getState().moveToFolder(tab, f.id) },
      );
      return items;
    };
    return { type: "submenu", label: "Move to folder", items: [{ label: "(Project root)", onSelect: () => st.getState().moveToFolder(tab, null) }, { type: "sep" }, ...build(null)] };
  };
  void folderMenuItems;

  const itemMenu = (tab: TabRef): MenuItem[] => {
    const s = st.getState();
    if (tab.kind === "sheet") {
      const sheet = s.project.sheets.find((x) => x.id === tab.id)!;
      return [
        { label: "Open", onSelect: () => openTab(tab) },
        { label: "Open in new window", shortcut: "⇧⌘O", onSelect: () => void popOutTab(tab) },
        { label: "Rename", onSelect: () => setRenaming(tab) },
        { label: "Duplicate", onSelect: () => s.duplicateSheet(tab.id) },
        moveMenu(tab),
        { type: "sep" },
        { label: "Export as CSV…", onSelect: () => void exportSheetCsv(sheet) },
        { type: "sep" },
        { label: "Delete", onSelect: () => void confirmDialog(`Delete sheet "${sheet.name}"?`).then((ok) => ok && useStore.getState().deleteSheet(tab.id)) },
      ];
    }
    const g = s.project.graphs.find((x) => x.id === tab.id)!;
    return [
      { label: "Open", onSelect: () => openTab(tab) },
      { label: "Open in new window", shortcut: "⇧⌘O", onSelect: () => void popOutTab(tab) },
      { label: "Rename", onSelect: () => setRenaming(tab) },
      { label: "Duplicate", onSelect: () => s.duplicateGraph(tab.id) },
      moveMenu(tab),
      { type: "sep" },
      { label: "Delete", onSelect: () => void confirmDialog(`Delete graph "${g.name}"?`).then((ok) => ok && useStore.getState().deleteGraph(tab.id)) },
    ];
  };

  const folderMenu = (f: Folder): MenuItem[] => [
    { label: "New sheet here", onSelect: () => { st.getState().setCurrentFolder(f.id); st.getState().addSheet(); } },
    { label: "New graph here", onSelect: () => { st.getState().setCurrentFolder(f.id); st.getState().addGraph(); } },
    { label: "New sub-folder", onSelect: () => setRenaming({ kind: "folder", id: st.getState().addFolder("New folder", f.id) }) },
    { type: "sep" },
    { label: "Collapse all", onSelect: () => st.getState().setAllFoldersCollapsed(true) },
    { label: "Expand all", onSelect: () => st.getState().setAllFoldersCollapsed(false) },
    { label: "Collapse sub-folders", disabled: !folders.some((x) => x.parentId === f.id), onSelect: () => st.getState().setAllFoldersCollapsed(true, f.id) },
    { type: "sep" },
    { label: "Rename", onSelect: () => setRenaming({ kind: "folder", id: f.id }) },
    { label: "Move to project root", disabled: f.parentId === null, onSelect: () => st.getState().moveFolder(f.id, null) },
    { type: "sep" },
    { label: "Delete folder (keeps its contents)", onSelect: () => st.getState().deleteFolder(f.id) },
  ];

  // ---- pointer-based drag (HTML5 drag-and-drop is intercepted by the native webview)
  const [drag, setDrag] = useState<{ payload: DragPayload; label: string; icon: string; x: number; y: number; active: boolean; startX: number; startY: number } | null>(null);
  const suppressClick = useRef(false);

  const dropTargetAt = (x: number, y: number): string | null | undefined => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const folderEl = el?.closest<HTMLElement>("[data-folder-id]");
    if (folderEl) return folderEl.dataset.folderId!;
    if (el?.closest(".sidebar")) return null; // root
    return undefined;
  };

  // release outside the sidebar cancels the drag
  useEffect(() => {
    if (!drag) return;
    const up = (e: PointerEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.(".sidebar")) return; // handled by the sidebar itself
      setDrag(null);
      setDropTarget(undefined);
    };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, [drag]);

  const startDrag = (e: React.PointerEvent, payload: DragPayload, label: string, icon: string) => {
    if (e.button !== 0) return;
    setDrag({ payload, label, icon, x: e.clientX, y: e.clientY, active: false, startX: e.clientX, startY: e.clientY });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const active = drag.active || Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 5;
    if (!active) return;
    setDrag({ ...drag, x: e.clientX, y: e.clientY, active: true });
    setDropTarget(dropTargetAt(e.clientX, e.clientY));
  };
  const endDrag = (e: React.PointerEvent) => {
    if (!drag) return;
    if (drag.active) {
      const target = dropTargetAt(e.clientX, e.clientY);
      const p = drag.payload;
      if (target !== undefined) {
        if (p.kind === "folder") {
          if (target !== p.id) st.getState().moveFolder(p.id, target);
        } else st.getState().moveToFolder({ kind: p.kind, id: p.id }, target);
      }
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
    }
    setDrag(null);
    setDropTarget(undefined);
  };

  const columnDropGraph = useDialogs((s) => s.columnDrag?.overGraphId ?? null);
  const renderItem = (tab: TabRef, name: string, icon: string, depth: number) => {
    const active = sameTab(activeTab, tab);
    const isRenaming = renaming && renaming.kind === tab.kind && renaming.id === tab.id;
    return (
      <div
        key={tab.kind + tab.id}
        data-graph-id={tab.kind === "graph" ? tab.id : undefined}
        className={"item" + (active ? " active" : "") + (tab.kind === "graph" && columnDropGraph === tab.id ? " drop" : "")}
        style={{ paddingLeft: 8 + depth * 14 }}
        onPointerDown={(e) => startDrag(e, { kind: tab.kind, id: tab.id }, name, icon)}
        onClick={() => !suppressClick.current && openTab(tab)}
        onDoubleClick={() => setRenaming(tab)}
        onContextMenu={(e) => openMenu(e, itemMenu(tab))}
        title={name}
      >
        <Icon name={icon} size={15} style={{ color: active ? "var(--accent)" : "var(--text-2)", flex: "none" }} />
        {isRenaming ? (
          <RenameInput
            value={name}
            onDone={(v) => {
              setRenaming(null);
              if (v && v !== name) {
                if (tab.kind === "sheet") st.getState().renameSheet(tab.id, v);
                else st.getState().renameGraph(tab.id, v);
              }
            }}
          />
        ) : (
          <span className="name">{name}</span>
        )}
      </div>
    );
  };

  const renderFolder = (parentId: string | null, depth: number): React.ReactNode => {
    const subs = folders.filter((f) => f.parentId === parentId);
    const sh = sheets.filter((s) => (s.folderId ?? null) === parentId);
    const gr = graphs.filter((g) => (g.folderId ?? null) === parentId);
    return (
      <>
        {subs.map((f) => {
          const isRenaming = renaming?.kind === "folder" && renaming.id === f.id;
          const isCurrent = currentFolderId === f.id;
          return (
            <div key={f.id}>
              <div
                className={"item folder" + (dropTarget === f.id ? " drop" : "") + (isCurrent ? " current" : "")}
                style={{ paddingLeft: 8 + depth * 14 }}
                data-folder-id={f.id}
                onPointerDown={(e) => startDrag(e, { kind: "folder", id: f.id }, f.name, "folder")}
                onClick={() => {
                  if (suppressClick.current) return;
                  st.getState().setCurrentFolder(f.id);
                  st.getState().toggleFolder(f.id);
                }}
                onDoubleClick={() => setRenaming({ kind: "folder", id: f.id })}
                onContextMenu={(e) => openMenu(e, folderMenu(f))}
                title={isCurrent ? "New sheets and graphs go here" : f.name}
              >
                <Icon name="chevron" size={11} style={{ transform: f.collapsed ? "none" : "rotate(90deg)", color: "var(--text-3)", flex: "none", transition: "transform .12s" }} />
                <Icon name="folder" size={15} style={{ color: "var(--text-2)", flex: "none" }} />
                {isRenaming ? (
                  <RenameInput
                    value={f.name}
                    onDone={(v) => {
                      setRenaming(null);
                      if (v && v !== f.name) st.getState().renameFolder(f.id, v);
                    }}
                  />
                ) : (
                  <span className="name">{f.name}</span>
                )}
              </div>
              {!f.collapsed && renderFolder(f.id, depth + 1)}
            </div>
          );
        })}
        {sh.map((s) => renderItem({ kind: "sheet", id: s.id }, s.name, "table", depth))}
        {gr.map((g) => renderItem({ kind: "graph", id: g.id }, g.name, "chart", depth))}
      </>
    );
  };

  const rootEmpty = sheets.length === 0 && graphs.length === 0 && folders.length === 0;

  return (
    <div
      className={"sidebar" + (dropTarget === null && drag?.active ? " drop-root" : "") + (drag?.active ? " dragging" : "")}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={() => {
        setDrag(null);
        setDropTarget(undefined);
      }}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest(".item")) return;
        openMenu(e, [
          { label: "New sheet", onSelect: () => { st.getState().setCurrentFolder(null); st.getState().addSheet(); } },
          { label: "New graph", onSelect: () => { st.getState().setCurrentFolder(null); st.getState().addGraph(); } },
          { label: "New folder", onSelect: () => setRenaming({ kind: "folder", id: st.getState().addFolder("New folder", null) }) },
          { type: "sep" },
          { label: "Collapse all", disabled: folders.length === 0, onSelect: () => st.getState().setAllFoldersCollapsed(true) },
          { label: "Expand all", disabled: folders.length === 0, onSelect: () => st.getState().setAllFoldersCollapsed(false) },
        ]);
      }}
    >
      <div className="section">
        <span onClick={() => st.getState().setCurrentFolder(null)} title="Project root — drop items on empty sidebar space to move them here" style={{ cursor: "default" }}>
          Project
        </span>
        <span style={{ display: "flex", gap: 2 }}>
          <button className="icon-btn tiny" title="New folder" onClick={() => setRenaming({ kind: "folder", id: st.getState().addFolder("New folder", currentFolderId) })}>
            <Icon name="folderPlus" size={13} />
          </button>
          <button className="icon-btn tiny" title="New sheet" onClick={() => st.getState().addSheet()}>
            <Icon name="table" size={13} />
          </button>
          <button className="icon-btn tiny" title="New graph" onClick={() => st.getState().addGraph()}>
            <Icon name="chart" size={13} />
          </button>
        </span>
      </div>
      {renderFolder(null, 0)}
      {rootEmpty && <div className="empty">Empty project</div>}
      {drag?.active && (
        <div className="drag-ghost" style={{ left: drag.x, top: drag.y }}>
          <Icon name={drag.icon} size={13} /> {drag.label}
        </div>
      )}
      {menu}
    </div>
  );
});
