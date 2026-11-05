import { memo, useState } from "react";
import { sameTab, useStore, useStoreEq } from "../model/store";
import type { TabRef } from "../model/types";
import { Icon } from "../ui/Icon";
import { useContextMenu } from "../ui/ContextMenu";
import { popOutTab } from "./popout";

interface ItemRef {
  id: string;
  name: string;
  folderId: string | null;
}
const sameItems = (a: ItemRef[], b: ItemRef[]) => a.length === b.length && a.every((x, i) => x.id === b[i].id && x.name === b[i].name && x.folderId === b[i].folderId);

export const TabBar = memo(function TabBar() {
  const openTabs = useStore((s) => s.ui.openTabs);
  const activeTab = useStore((s) => s.ui.activeTab);
  const sheets = useStoreEq((s) => s.project.sheets.map((x): ItemRef => ({ id: x.id, name: x.name, folderId: x.folderId ?? null })), sameItems);
  const graphs = useStoreEq((s) => s.project.graphs.map((x): ItemRef => ({ id: x.id, name: x.name, folderId: x.folderId ?? null })), sameItems);
  const [renaming, setRenaming] = useState<TabRef | null>(null);
  const [draft, setDraft] = useState("");
  const st = useStore;
  const [menu, openMenu] = useContextMenu();

  const nameOf = (t: TabRef) =>
    t.kind === "sheet" ? sheets.find((s) => s.id === t.id)?.name : graphs.find((g) => g.id === t.id)?.name;
  const folderOf = (t: TabRef) => (t.kind === "sheet" ? sheets.find((s) => s.id === t.id)?.folderId : graphs.find((g) => g.id === t.id)?.folderId) ?? null;
  // Show only open items of the same kind and folder as the active one; the sidebar has everything.
  const visibleTabs = activeTab ? openTabs.filter((t) => t.kind === activeTab.kind && folderOf(t) === folderOf(activeTab)) : openTabs;

  const finishRename = (t: TabRef, commit: boolean) => {
    setRenaming(null);
    const v = draft.trim();
    if (!commit || !v) return;
    if (t.kind === "sheet") st.getState().renameSheet(t.id, v);
    else st.getState().renameGraph(t.id, v);
  };

  return (
    <div className="tabbar">
      {visibleTabs.map((t) => {
        const name = nameOf(t);
        if (name === undefined) return null;
        const active = sameTab(activeTab, t);
        const isRenaming = renaming && sameTab(renaming, t);
        return (
          <div
            key={t.kind + t.id}
            className={"tab" + (active ? " active" : "")}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                st.getState().closeTab(t);
              } else if (!isRenaming) st.getState().setActiveTab(t);
            }}
            onDoubleClick={() => {
              setDraft(name);
              setRenaming(t);
            }}
            onContextMenu={(e) =>
              openMenu(e, [
                { label: "Open in new window", shortcut: "⇧⌘O", onSelect: () => void popOutTab(t) },
                { label: "Rename", onSelect: () => { setDraft(name); setRenaming(t); } },
                { type: "sep" },
                { label: "Close", shortcut: "⌘W", onSelect: () => st.getState().closeTab(t) },
                { label: "Close others", onSelect: () => st.getState().ui.openTabs.filter((o) => !sameTab(o, t)).forEach((o) => st.getState().closeTab(o)) },
              ])
            }
            title={name}
          >
            <Icon name={t.kind === "sheet" ? "table" : "chart"} size={13} style={{ flex: "none", opacity: 0.8 }} />
            {isRenaming ? (
              <input
                className="input"
                autoFocus
                value={draft}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => finishRename(t, true)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") finishRename(t, true);
                  if (e.key === "Escape") finishRename(t, false);
                }}
                onMouseDown={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="name">{name}</span>
            )}
            <span
              className="close"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                st.getState().closeTab(t);
              }}
              title="Close tab"
            >
              <Icon name="close" size={12} />
            </span>
          </div>
        );
      })}
      {menu}
    </div>
  );
});
