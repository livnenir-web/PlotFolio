import { memo, useEffect, useRef, useState } from "react";
import { useStore, useStoreEq, sameTab } from "../model/store";
import type { Folder, TabRef } from "../model/types";
import { Icon } from "../ui/Icon";
import { useContextMenu, type MenuItem } from "../ui/ContextMenu";
import { exportSheetCsv } from "../export/csv";
import { confirmDialog } from "../ui/confirm";
import { popOutTab } from "./popout";
import { useDialogs } from "./dialogs";
import { keyHint } from "./shortcuts";
import { createPortal } from "react-dom";
import { layoutGraph } from "../graph/layout";
import { GraphSvg } from "../graph/render/GraphSvg";

const PEEK_DELAY_MS = 600;
const PEEK_W = 240;
const PEEK_H = 220;

/** A small picture of a figure next to the sidebar, while the pointer rests on its name. */
function GraphPeek({ graphId, top, left }: { graphId: string; top: number; left: number }) {
  const project = useStore((s) => s.project);
  const graph = project.graphs.find((g) => g.id === graphId);
  if (!graph) return null;
  const layout = layoutGraph(project, graph);
  const k = Math.min(PEEK_W / layout.widthMm, PEEK_H / layout.heightMm);
  const w = layout.widthMm * k;
  const h = layout.heightMm * k;
  return createPortal(
    <div className="graph-peek" style={{ left, top: Math.max(8, Math.min(top - 12, window.innerHeight - h - 44)) }}>
      <div className="paper" style={{ width: w, height: h, background: graph.canvas.background }}>
        <GraphSvg layout={layout} background widthCss="100%" heightCss="100%" />
      </div>
      <div className="cap">
        {graph.name} · {graph.layers.length > 1 ? `${graph.layers.length} panels` : `${graph.layers[0]?.plots.length ?? 0} plot${graph.layers[0]?.plots.length === 1 ? "" : "s"}`}
      </div>
    </div>,
    document.body,
  );
}

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
/** What releasing a dragged row would do: put it into a folder (null = the project root), or next to a row of its kind. */
type Drop = { type: "into"; folderId: string | null } | { type: "place"; refId: string; after: boolean; left: number; width: number; y: number };

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
  // where a dragged row would land between its neighbors
  const [line, setLine] = useState<{ left: number; width: number; y: number } | null>(null);
  const [menu, openMenu] = useContextMenu();
  const st = useStore;
  // filter by name (the search button in the header); null = not filtering
  const [filter, setFilter] = useState<string | null>(null);
  const query = (filter ?? "").trim().toLowerCase();
  const matches = (name: string) => !query || name.toLowerCase().includes(query);
  // figure preview while the pointer rests on a figure's name
  const [peek, setPeek] = useState<{ id: string; top: number; left: number } | null>(null);
  const peekTimer = useRef(0);
  const stopPeek = () => {
    window.clearTimeout(peekTimer.current);
    setPeek(null);
  };
  useEffect(() => () => window.clearTimeout(peekTimer.current), []);

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
        { label: "Open in new window", shortcut: keyHint("popOut"), onSelect: () => void popOutTab(tab) },
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
      { label: "Open in new window", shortcut: keyHint("popOut"), onSelect: () => void popOutTab(tab) },
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

  const dropAt = (x: number, y: number, p: DragPayload): Drop | undefined => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!el?.closest(".sidebar")) return undefined;
    const row = el.closest<HTMLElement>("[data-folder-id], [data-item-id]");
    if (!row) return { type: "into", folderId: null }; // empty space: the root
    const r = row.getBoundingClientRect();
    const place = (after: boolean): Drop => ({ type: "place", refId: (row.dataset.folderId ?? row.dataset.itemId)!, after, left: r.left, width: r.width, y: after ? r.bottom : r.top });
    if (row.dataset.folderId) {
      if (p.kind !== "folder") return { type: "into", folderId: row.dataset.folderId };
      if (row.dataset.folderId === p.id) return undefined;
      // a folder over a folder: near an edge it goes next to that one, in the middle it goes inside
      const t = (y - r.top) / r.height;
      return t < 0.25 ? place(false) : t > 0.75 ? place(true) : { type: "into", folderId: row.dataset.folderId };
    }
    // over a sheet or figure: one of the same kind goes next to it, anything else joins its folder
    if (row.dataset.itemKind === p.kind) return row.dataset.itemId === p.id ? undefined : place(y > r.top + r.height / 2);
    return { type: "into", folderId: row.dataset.parent || null };
  };
  const showDrop = (d: Drop | undefined) => {
    setDropTarget(d?.type === "into" ? d.folderId : undefined);
    setLine(d?.type === "place" ? { left: d.left, width: d.width, y: d.y } : null);
  };

  // release outside the sidebar cancels the drag
  useEffect(() => {
    if (!drag) return;
    const up = (e: PointerEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.(".sidebar")) return; // handled by the sidebar itself
      setDrag(null);
      showDrop(undefined);
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
    showDrop(dropAt(e.clientX, e.clientY, drag.payload));
  };
  const endDrag = (e: React.PointerEvent) => {
    if (!drag) return;
    if (drag.active) {
      const p = drag.payload;
      const d = dropAt(e.clientX, e.clientY, p);
      if (d?.type === "into") {
        if (p.kind === "folder") {
          if (d.folderId !== p.id) st.getState().moveFolder(p.id, d.folderId);
        } else st.getState().moveToFolder({ kind: p.kind, id: p.id }, d.folderId);
      } else if (d?.type === "place") {
        if (p.kind === "folder") st.getState().placeFolder(p.id, d.refId, d.after);
        else st.getState().placeItem({ kind: p.kind, id: p.id }, d.refId, d.after);
      }
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
    }
    setDrag(null);
    showDrop(undefined);
  };

  const columnDropGraph = useDialogs((s) => s.columnDrag?.overGraphId ?? null);
  // with folders in the project, sheets and figures are indented by the width of the folding arrow, so all icons line up
  const hasFolders = folders.length > 0;
  /** While filtering: does this folder (or a folder inside it) hold a sheet or figure that matches? */
  const folderHasMatch = (id: string): boolean =>
    sheets.some((x) => x.folderId === id && matches(x.name)) || graphs.some((x) => x.folderId === id && matches(x.name)) || folders.some((f) => f.parentId === id && folderHasMatch(f.id));
  const renderItem = (tab: TabRef, name: string, icon: string, depth: number, parentId: string | null) => {
    const active = sameTab(activeTab, tab);
    const isRenaming = renaming && renaming.kind === tab.kind && renaming.id === tab.id;
    return (
      <div
        key={tab.kind + tab.id}
        data-graph-id={tab.kind === "graph" ? tab.id : undefined}
        data-item-kind={tab.kind}
        data-item-id={tab.id}
        data-parent={parentId ?? ""}
        className={"item" + (active ? " active" : "") + (tab.kind === "graph" && columnDropGraph === tab.id ? " drop" : "")}
        style={{ paddingLeft: 8 + depth * 14 + (hasFolders ? 18 : 0) }}
        onPointerDown={(e) => {
          stopPeek();
          startDrag(e, { kind: tab.kind, id: tab.id }, name, icon);
        }}
        onClick={() => !suppressClick.current && openTab(tab)}
        onDoubleClick={() => setRenaming(tab)}
        onContextMenu={(e) => {
          stopPeek();
          openMenu(e, itemMenu(tab));
        }}
        onMouseEnter={
          tab.kind === "graph" && !active
            ? (e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const side = e.currentTarget.closest(".sidebar")?.getBoundingClientRect();
                window.clearTimeout(peekTimer.current);
                peekTimer.current = window.setTimeout(() => setPeek({ id: tab.id, top: r.top, left: (side?.right ?? r.right) + 6 }), PEEK_DELAY_MS);
              }
            : undefined
        }
        onMouseLeave={tab.kind === "graph" ? stopPeek : undefined}
        title={tab.kind === "graph" && !active ? undefined : name}
      >
        <Icon name={icon} size={15} style={{ color: "var(--text-2)", flex: "none" }} />
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
    const subs = folders.filter((f) => f.parentId === parentId && (!query || folderHasMatch(f.id)));
    const sh = sheets.filter((s) => (s.folderId ?? null) === parentId && matches(s.name));
    const gr = graphs.filter((g) => (g.folderId ?? null) === parentId && matches(g.name));
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
                <Icon name="chevron" size={11} style={{ transform: f.collapsed && !query ? "none" : "rotate(90deg)", color: "var(--text-3)", flex: "none", transition: "transform .12s" }} />
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
              {(!f.collapsed || !!query) && renderFolder(f.id, depth + 1)}
            </div>
          );
        })}
        {sh.map((s) => renderItem({ kind: "sheet", id: s.id }, s.name, "table", depth, parentId))}
        {gr.map((g) => renderItem({ kind: "graph", id: g.id }, g.name, "chart", depth, parentId))}
      </>
    );
  };

  const rootEmpty = sheets.length === 0 && graphs.length === 0 && folders.length === 0;
  const noMatch = !!query && !sheets.some((x) => matches(x.name)) && !graphs.some((x) => matches(x.name));
  const newMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openMenu({ clientX: r.left, clientY: r.bottom + 2 }, [
      { label: "New sheet", onSelect: () => st.getState().addSheet() },
      { label: "New graph", onSelect: () => st.getState().addGraph() },
      { label: "New folder", onSelect: () => setRenaming({ kind: "folder", id: st.getState().addFolder("New folder", currentFolderId) }) },
    ]);
  };

  return (
    <div
      className={"sidebar" + (dropTarget === null && drag?.active ? " drop-root" : "") + (drag?.active ? " dragging" : "")}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={() => {
        setDrag(null);
        showDrop(undefined);
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
        <span onClick={() => st.getState().setCurrentFolder(null)} title="Project root — drop items on empty sidebar space to move them here. Drag a sheet, figure or folder between others of its kind to change the order." style={{ cursor: "default" }}>
          Project
        </span>
        <span style={{ display: "flex", gap: 2 }}>
          <button className={"icon-btn tiny" + (filter !== null ? " on" : "")} title="Find a sheet or figure by name" onClick={() => setFilter(filter === null ? "" : null)}>
            <Icon name="search" size={13} />
          </button>
          <button className="icon-btn tiny" title="New sheet, graph or folder (in the folder you clicked last)" onClick={newMenu}>
            <Icon name="plus" size={14} />
          </button>
        </span>
      </div>
      {filter !== null && (
        <div className="sidebar-filter">
          <input
            className="input"
            autoFocus
            placeholder="Find by name"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") setFilter(null);
            }}
          />
        </div>
      )}
      {renderFolder(null, 0)}
      {rootEmpty && <div className="empty">Empty project</div>}
      {noMatch && <div className="empty">Nothing with that name</div>}
      {peek && !drag?.active && <GraphPeek graphId={peek.id} top={peek.top} left={peek.left} />}
      {drag?.active && line && <div className="reorder-line" style={{ left: line.left, top: line.y - 1, width: line.width, height: 2 }} />}
      {drag?.active && (
        <div className="drag-ghost" style={{ left: drag.x, top: drag.y }}>
          <Icon name={drag.icon} size={13} /> {drag.label}
        </div>
      )}
      {menu}
    </div>
  );
});
