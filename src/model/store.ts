import { useRef } from "react";
import { create } from "zustand";
import { temporal } from "zundo";
import { immer } from "zustand/middleware/immer";
import type { Axis, CellValue, Column, Designation, Graph, Layer, Plot, Project, Selection, Sheet, TabRef, TextItem, ProjectView } from "./types";
import {
  columnLetter,
  defaultColorScale,
  make3D,
  newColumn,
  newShape,
  newGraph,
  newLayer,
  newPlot,
  newProject,
  newSheet,
  uid,
  uniqueName,
} from "./defaults";
import type { PlotSource, PlotType, Shape, ShapeKind } from "./types";
import { defaultMatrixSource } from "../graph/matrix";
import { recalculateSheet, sheetRowCount } from "../formula/engine";
import { stepPlot, tidyGroups } from "./plotGroups";
import { dropOrphanBrackets } from "./brackets";
import { renewPlotIds } from "./figure";
import { excludeRows, includeRows, type ExcludeResult } from "./exclude";
import { CANVAS_MARGIN_MM, layoutGraph } from "../graph/layout";

export interface CellEdit {
  col: number;
  row: number;
  value: CellValue;
}

export interface UIState {
  openTabs: TabRef[];
  activeTab: TabRef | null;
  selection: Selection;
  sidebarCollapsed: boolean;
  inspectorCollapsed: boolean;
  zoom: Record<string, number>;
  /** Internal clipboard for layers. */
  /** copied layers (several at once keep their relative positions) */
  layerClipboard: Layer[] | null;
  /** copied shapes / texts (stored values, including their coordinate mode) */
  objectClipboard: ({ kind: "shape"; shape: Shape } | { kind: "text"; text: import("./types").TextItem })[] | null;
  currentFolderId: string | null;
  /** objects selected in addition to `selection` (shift-click, lasso, groups) */
  multi: Selection[];
}

export interface AppState {
  project: Project;
  filePath: string | null;
  /** True when the project differs from the last saved/loaded state (kept in sync automatically). */
  dirty: boolean;
  /** The project object as last saved or loaded; dirty = project !== savedRef. */
  savedRef: Project | null;
  /** Incremented on every load/reset so watchers can ignore wholesale replacements. */
  loadSeq: number;
  ui: UIState;

  // project / file
  resetProject: (p?: Project) => void;
  loadProject: (p: Project, path: string | null, view?: ProjectView | null) => void;
  /** The current view (tabs, zoom, folder) for saving alongside the project. */
  captureView: () => ProjectView;
  markSaved: (path: string) => void;
  setProjectName: (name: string) => void;

  // ui
  openTab: (tab: TabRef) => void;
  closeTab: (tab: TabRef) => void;
  setActiveTab: (tab: TabRef | null) => void;
  /** Put an open tab just before or after another one (dragging in the tab bar). */
  moveTab: (tab: TabRef, target: TabRef, after: boolean) => void;
  setSelection: (sel: Selection) => void;
  /** Select several objects at once: `primary` is shown in the inspector, edits reach the others as well. */
  selectMany: (primary: Selection, others: Selection[]) => void;
  toggleSidebar: () => void;
  toggleInspector: () => void;
  setInspectorCollapsed: (v: boolean) => void;
  setZoom: (graphId: string, zoom: number) => void;
  setLayerClipboard: (layers: Layer[] | null) => void;
  deleteLayers: (graphId: string, layerIds: string[]) => void;
  /** One undo step that appends fully formed layers, shapes and texts (ids already assigned by the caller). */
  addGraphItems: (graphId: string, layers: Layer[], shapes: { layerId: string; shape: Shape }[], texts: { layerId: string; text: TextItem }[]) => void;
  setObjectClipboard: (items: UIState["objectClipboard"]) => void;

  // folders
  addFolder: (name?: string, parentId?: string | null) => string;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;
  toggleFolder: (id: string) => void;
  /** collapse (or expand) every folder of the project, or only the sub-tree under `parentId` */
  setAllFoldersCollapsed: (collapsed: boolean, parentId?: string | null) => void;
  moveToFolder: (item: TabRef, folderId: string | null) => void;
  moveFolder: (id: string, parentId: string | null) => void;
  /** Put a sheet or graph just before or after another of its kind in the project list, in that one's folder. */
  placeItem: (item: TabRef, refId: string, after: boolean) => void;
  /** Put a folder just before or after another folder, inside that one's parent. */
  placeFolder: (id: string, refId: string, after: boolean) => void;
  /** folder that new sheets/graphs are created in */
  setCurrentFolder: (id: string | null) => void;
  setMulti: (items: Selection[]) => void;
  /** Make these member keys one group (they leave any previous group). */
  groupObjects: (graphId: string, members: string[]) => string;
  ungroupObjects: (graphId: string, groupId: string) => void;

  // sheets
  addSheet: (name?: string) => string;
  addSheetObject: (sheet: Sheet) => void;
  renameSheet: (id: string, name: string) => void;
  deleteSheet: (id: string) => void;
  duplicateSheet: (id: string) => void;
  setCell: (sheetId: string, col: number, row: number, value: CellValue) => void;
  setCells: (sheetId: string, edits: CellEdit[]) => void;
  addColumn: (sheetId: string, at?: number, designation?: Designation) => void;
  ensureColumns: (sheetId: string, count: number) => void;
  appendColumns: (sheetId: string, columns: Column[]) => void;
  deleteColumns: (sheetId: string, indices: number[]) => void;
  duplicateColumn: (sheetId: string, index: number) => void;
  moveColumn: (sheetId: string, from: number, to: number) => void;
  setColumnWidth: (sheetId: string, index: number, widthPx: number) => void;
  updateColumn: (sheetId: string, colId: string, patch: Partial<Column>) => void;
  clearColumns: (sheetId: string, indices: number[]) => void;
  deleteRows: (sheetId: string, rows: number[]) => void;
  insertRows: (sheetId: string, at: number, count: number) => void;
  sortByColumn: (sheetId: string, index: number, descending: boolean) => void;
  recalc: (sheetId: string) => void;

  // graphs
  addGraph: (name?: string) => string;
  addGraphObject: (graph: Graph) => void;
  renameGraph: (id: string, name: string) => void;
  deleteGraph: (id: string) => void;
  duplicateGraph: (id: string) => void;
  /**
   * A new figure holding copies of these layers of a graph (with their texts, shapes, legends and curve groups),
   * moved to the top-left corner of a canvas that fits them. With `plotIds`, only those plots are copied.
   * Returns the id of the new graph.
   */
  copyToNewGraph: (graphId: string, layerIds: string[], plotIds?: string[]) => string;
  updateGraph: (graphId: string, fn: (g: Graph) => void) => void;
  updateLayer: (graphId: string, layerId: string, fn: (l: Layer) => void) => void;
  updateAxis: (graphId: string, layerId: string, axis: "x" | "y" | "y2" | "z", fn: (a: Axis) => void) => void;
  updatePlot: (graphId: string, layerId: string, plotId: string, fn: (p: Plot) => void) => void;
  addLayer: (graphId: string, layer?: Layer) => string;
  /** Change the drawing order of the layers: the layer at `from` ends at index `to` (later = on top). */
  moveLayer: (graphId: string, from: number, to: number) => void;
  deleteLayer: (graphId: string, layerId: string) => void;
  deletePlot: (graphId: string, layerId: string, plotId: string) => void;
  /** y = f(x) curve following the axis range. Returns the plot id. */
  addFunctionPlot: (graphId: string, layerId: string | "new", expression: string, name?: string) => string;
  /**
   * Exclude the points of a plot on these sheet rows: their values move to an "(excluded)" column of the same sheet,
   * drawn as a plot of its own. `includePoints` moves them back. One undo step each. See src/model/exclude.ts.
   */
  excludePoints: (graphId: string, layerId: string, plotId: string, rows: number[]) => ExcludeResult;
  includePoints: (graphId: string, layerId: string, plotId: string, rows: number[] | "all") => ExcludeResult;
  addShape: (graphId: string, layerId: string, kind: ShapeKind, x1: number, y1: number, x2: number, y2: number, extra?: Partial<Shape>) => string;
  updateShape: (graphId: string, layerId: string, shapeId: string, fn: (s: Shape) => void) => void;
  deleteShape: (graphId: string, layerId: string, shapeId: string) => void;
  /** Change drawing order. delta: ±1 one step, "front" / "back" to the end. */
  movePlot: (graphId: string, layerId: string, plotId: string, delta: 1 | -1 | "front" | "back") => void;
  moveShape: (graphId: string, layerId: string, shapeId: string, delta: 1 | -1 | "front" | "back") => void;
  /** Add any plot type to a layer; converts the layer to 3D for surface/scatter3d. Returns the plot id. */
  /** `apply` adjusts the new plot before it is added (e.g. a box plot drawn as a violin) */
  addPlot: (graphId: string, layerId: string | "new", type: PlotType, source: PlotSource, name?: string, apply?: (p: Plot) => void) => string;
  plotColumns: (
    sheetId: string,
    yColIds: string[],
    xColId: string | null,
    target: { graphId: string; layerId: string } | null,
    type?: Plot["type"],
    apply?: (p: Plot) => void,
  ) => string;
}

function sheetOf(p: Project, id: string): Sheet {
  const s = p.sheets.find((x) => x.id === id);
  if (!s) throw new Error("Sheet not found");
  return s;
}
function graphOf(p: Project, id: string): Graph {
  const g = p.graphs.find((x) => x.id === id);
  if (!g) throw new Error("Graph not found");
  return g;
}
function layerOf(g: Graph, id: string): Layer {
  const l = g.layers.find((x) => x.id === id);
  if (!l) throw new Error("Layer not found");
  return l;
}

export function sameTab(a: TabRef | null, b: TabRef | null): boolean {
  return !!a && !!b && a.kind === b.kind && a.id === b.id;
}

function ensureRows(col: Column, rows: number) {
  while (col.values.length < rows) col.values.push(null);
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}
/** Curve groups follow every edit of a graph (membership, order, colors); figures without groups pay nothing. */
function tidy(g: Graph): void {
  if (g.plotGroups?.length) tidyGroups(g);
  dropOrphanBrackets(g);
}

export function columnDisplayName(col: Column, index: number): string {
  return col.longName.trim() || columnLetter(index);
}

export const useStore = create<AppState>()(
  temporal(
    immer((set, get) => {
      const mutate = (fn: (p: Project, s: AppState) => void) =>
        set((s) => {
          fn(s.project, s);
          s.dirty = true;
        });
      const mutateSheet = (sheetId: string, fn: (sheet: Sheet) => void | Set<number>) =>
        mutate((p) => {
          const sh = sheetOf(p, sheetId);
          // fn may return the indices of the columns it changed; formulas are then recalculated only where needed
          const changed = fn(sh);
          recalculateSheet(sh, changed ?? undefined);
        });

      return {
        project: newProject(),
        filePath: null,
        dirty: false,
        savedRef: null,
        loadSeq: 0,
        ui: {
          openTabs: [],
          activeTab: null,
          selection: { kind: "none" },
          sidebarCollapsed: false,
          inspectorCollapsed: false,
          zoom: {},
          layerClipboard: null,
          objectClipboard: null,
          currentFolderId: null,
          multi: [],
        },

        resetProject: (p) =>
          set((s) => {
            const proj = p ?? newProject();
            s.project = proj;
            s.filePath = null;
            s.dirty = false;
            s.savedRef = proj;
            s.loadSeq++;
            const first = proj.sheets[0];
            s.ui.openTabs = first ? [{ kind: "sheet", id: first.id }] : [];
            s.ui.activeTab = first ? { kind: "sheet", id: first.id } : null;
            s.ui.selection = { kind: "none" };
          }),
        captureView: () => {
          const u = get().ui;
          return { openTabs: u.openTabs, activeTab: u.activeTab, zoom: u.zoom, currentFolderId: u.currentFolderId };
        },
        loadProject: (p, path, view) =>
          set((s) => {
            s.project = p;
            s.filePath = path;
            s.dirty = false;
            s.savedRef = p;
            s.loadSeq++;
            const exists = (t: TabRef) => (t.kind === "sheet" ? p.sheets : p.graphs).some((x) => x.id === t.id);
            const first: TabRef | null = p.graphs[0]
              ? { kind: "graph", id: p.graphs[0].id }
              : p.sheets[0]
                ? { kind: "sheet", id: p.sheets[0].id }
                : null;
            // restore the saved view where its items still exist
            const tabs = (view?.openTabs ?? []).filter(exists);
            s.ui.openTabs = tabs.length ? tabs : first ? [first] : [];
            s.ui.activeTab = view?.activeTab && exists(view.activeTab) ? view.activeTab : (s.ui.openTabs[0] ?? null);
            s.ui.zoom = view?.zoom ? Object.fromEntries(Object.entries(view.zoom).filter(([id]) => p.graphs.some((g) => g.id === id))) : {};
            s.ui.currentFolderId = view?.currentFolderId && p.folders.some((f) => f.id === view.currentFolderId) ? view.currentFolderId : null;
            s.ui.selection = { kind: "none" };
          }),
        markSaved: (path) => {
          set((s) => {
            s.filePath = path;
            s.dirty = false;
          });
          useStore.setState((s) => ({ savedRef: s.project }));
        },
        setProjectName: (name) => mutate((p) => void (p.name = name)),

        openTab: (tab) => {
          endEdit();
          set((s) => {
            if (!s.ui.openTabs.some((t) => sameTab(t, tab))) s.ui.openTabs.push(tab);
            s.ui.activeTab = tab;
            if (tab.kind === "graph") s.ui.selection = { kind: "canvas", graphId: tab.id };
            else s.ui.selection = { kind: "none" };
          });
        },
        closeTab: (tab) => {
          endEdit();
          set((s) => {
            const idx = s.ui.openTabs.findIndex((t) => sameTab(t, tab));
            if (idx < 0) return;
            s.ui.openTabs.splice(idx, 1);
            if (sameTab(s.ui.activeTab, tab)) {
              const next = s.ui.openTabs[Math.min(idx, s.ui.openTabs.length - 1)] ?? null;
              s.ui.activeTab = next;
              s.ui.selection = next?.kind === "graph" ? { kind: "canvas", graphId: next.id } : { kind: "none" };
            }
          });
        },
        moveTab: (tab, target, after) =>
          set((s) => {
            const tabs = s.ui.openTabs;
            const i = tabs.findIndex((t) => sameTab(t, tab));
            if (i < 0 || sameTab(tab, target)) return;
            const [t] = tabs.splice(i, 1);
            const j = tabs.findIndex((x) => sameTab(x, target));
            tabs.splice(j < 0 ? i : j + (after ? 1 : 0), 0, t);
          }),
        setActiveTab: (tab) => {
          endEdit();
          set((s) => {
            s.ui.activeTab = tab;
            s.ui.selection = tab?.kind === "graph" ? { kind: "canvas", graphId: tab.id } : { kind: "none" };
          });
        },
        // a field that is still being edited is finished first, so its value goes to the object it belongs to
        setSelection: (sel) => {
          endEdit();
          set((s) => void (s.ui.selection = sel));
        },
        selectMany: (primary, others) => {
          endEdit();
          set((s) => {
            s.ui.selection = primary;
            s.ui.multi = others;
          });
        },
        setMulti: (items) => set((s) => void (s.ui.multi = items)),
        groupObjects: (graphId, members) => {
          const id = uid();
          mutate((p) => {
            const g = graphOf(p, graphId);
            const set = new Set(members);
            g.groups = (g.groups ?? []).map((gr) => ({ ...gr, members: gr.members.filter((m) => !set.has(m)) })).filter((gr) => gr.members.length > 1);
            g.groups.push({ id, members });
          });
          return id;
        },
        ungroupObjects: (graphId, groupId) =>
          mutate((p) => {
            const g = graphOf(p, graphId);
            g.groups = (g.groups ?? []).filter((gr) => gr.id !== groupId);
          }),
        toggleSidebar: () => set((s) => void (s.ui.sidebarCollapsed = !s.ui.sidebarCollapsed)),
        toggleInspector: () => set((s) => void (s.ui.inspectorCollapsed = !s.ui.inspectorCollapsed)),
        setInspectorCollapsed: (v) => set((s) => void (s.ui.inspectorCollapsed = v)),
        setZoom: (graphId, zoom) => set((s) => void (s.ui.zoom[graphId] = zoom)),
        setLayerClipboard: (layers) => set((s) => void (s.ui.layerClipboard = layers?.length ? clone(layers) : null)),
        setObjectClipboard: (items) => set((s) => void (s.ui.objectClipboard = items ? clone(items) : null)),

        addFolder: (name, parentId = null) => {
          const id = uid();
          mutate((p) => {
            p.folders = p.folders ?? [];
            p.folders.push({ id, name: uniqueName(name ?? "Folder 1", p.folders.filter((f) => f.parentId === parentId).map((f) => f.name)), parentId });
          });
          set((s) => void (s.ui.currentFolderId = id));
          return id;
        },
        renameFolder: (id, name) => mutate((p) => void (p.folders.find((f) => f.id === id) && (p.folders.find((f) => f.id === id)!.name = name))),
        deleteFolder: (id) =>
          mutate((p, s) => {
            // move contents (and sub-folders) to the parent
            const f = p.folders.find((x) => x.id === id);
            const parent = f?.parentId ?? null;
            for (const sh of p.sheets) if (sh.folderId === id) sh.folderId = parent;
            for (const g of p.graphs) if (g.folderId === id) g.folderId = parent;
            for (const sub of p.folders) if (sub.parentId === id) sub.parentId = parent;
            p.folders = p.folders.filter((x) => x.id !== id);
            if (s.ui.currentFolderId === id) s.ui.currentFolderId = parent;
          }),
        toggleFolder: (id) =>
          set((s) => {
            const f = s.project.folders.find((x) => x.id === id);
            if (f) f.collapsed = !f.collapsed;
          }),
        setAllFoldersCollapsed: (collapsed, parentId) =>
          set((s) => {
            const under = new Set<string>();
            if (parentId != null) {
              under.add(parentId);
              let grew = true;
              while (grew) {
                grew = false;
                for (const f of s.project.folders) if (f.parentId && under.has(f.parentId) && !under.has(f.id)) (under.add(f.id), (grew = true));
              }
            }
            for (const f of s.project.folders) if (parentId == null || under.has(f.id)) f.collapsed = collapsed;
          }),
        moveToFolder: (item, folderId) =>
          mutate((p) => {
            if (item.kind === "sheet") {
              const sh = p.sheets.find((x) => x.id === item.id);
              if (sh) sh.folderId = folderId;
            } else {
              const g = p.graphs.find((x) => x.id === item.id);
              if (g) g.folderId = folderId;
            }
          }),
        placeItem: (item, refId, after) =>
          mutate((p) => {
            if (item.id === refId) return;
            const list: { id: string; folderId?: string | null }[] = item.kind === "sheet" ? p.sheets : p.graphs;
            const i = list.findIndex((x) => x.id === item.id);
            const ref = list.find((x) => x.id === refId);
            if (i < 0 || !ref) return;
            const [x] = list.splice(i, 1);
            x.folderId = ref.folderId ?? null;
            list.splice(list.indexOf(ref) + (after ? 1 : 0), 0, x);
          }),
        placeFolder: (id, refId, after) =>
          mutate((p) => {
            const folders = p.folders ?? [];
            const ref = folders.find((f) => f.id === refId);
            const i = folders.findIndex((f) => f.id === id);
            if (i < 0 || !ref || id === refId) return;
            // not next to a folder that is inside the moved one
            for (let cur: string | null = ref.parentId; cur; cur = folders.find((f) => f.id === cur)?.parentId ?? null) if (cur === id) return;
            const [f] = folders.splice(i, 1);
            f.parentId = ref.parentId;
            folders.splice(folders.indexOf(ref) + (after ? 1 : 0), 0, f);
          }),
        moveFolder: (id, parentId) =>
          mutate((p) => {
            if (id === parentId) return;
            // refuse moving a folder into its own descendant
            let cur = parentId;
            while (cur) {
              if (cur === id) return;
              cur = p.folders.find((f) => f.id === cur)?.parentId ?? null;
            }
            const f = p.folders.find((x) => x.id === id);
            if (f) f.parentId = parentId;
          }),
        setCurrentFolder: (id) => set((s) => void (s.ui.currentFolderId = id)),

        addSheet: (name) => {
          const sheet = newSheet(uniqueName(name ?? "Sheet 1", get().project.sheets.map((s) => s.name)));
          sheet.folderId = get().ui.currentFolderId;
          mutate((p) => void p.sheets.push(sheet));
          get().openTab({ kind: "sheet", id: sheet.id });
          return sheet.id;
        },
        addSheetObject: (sheet) => {
          mutate((p, s) => {
            sheet.name = uniqueName(sheet.name, p.sheets.map((x) => x.name));
            if (sheet.folderId === undefined) sheet.folderId = s.ui.currentFolderId;
            recalculateSheet(sheet);
            p.sheets.push(sheet);
          });
          get().openTab({ kind: "sheet", id: sheet.id });
        },
        renameSheet: (id, name) => mutate((p) => void (sheetOf(p, id).name = name)),
        deleteSheet: (id) => {
          get().closeTab({ kind: "sheet", id });
          mutate((p) => {
            p.sheets = p.sheets.filter((s) => s.id !== id);
          });
        },
        duplicateSheet: (id) => {
          const src = get().project.sheets.find((s) => s.id === id);
          if (!src) return;
          const copy = clone(src);
          copy.id = uid();
          // columns of excluded points keep pointing at their column, in the copy
          const newId = new Map(copy.columns.map((c) => [c.id, uid()]));
          copy.columns.forEach((c) => {
            c.id = newId.get(c.id)!;
            if (c.excludedFrom) c.excludedFrom = newId.get(c.excludedFrom) ?? undefined;
          });
          copy.name = uniqueName(src.name + " copy", get().project.sheets.map((s) => s.name));
          mutate((p) => void p.sheets.push(copy));
          get().openTab({ kind: "sheet", id: copy.id });
        },

        setCell: (sheetId, col, row, value) => get().setCells(sheetId, [{ col, row, value }]),
        setCells: (sheetId, edits) =>
          mutateSheet(sheetId, (sh) => {
            for (const e of edits) {
              while (sh.columns.length <= e.col) sh.columns.push(newColumn("Y"));
              const c = sh.columns[e.col];
              if (c.formula) {
                c.formula = undefined;
                c.formulaError = undefined;
              }
              ensureRows(c, e.row + 1);
              c.values[e.row] = e.value;
            }
            // trim trailing nulls
            for (const c of sh.columns) {
              let n = c.values.length;
              while (n > 0 && c.values[n - 1] === null) n--;
              if (n !== c.values.length) c.values.length = n;
            }
            return new Set(edits.map((e) => e.col));
          }),
        addColumn: (sheetId, at, designation = "Y") =>
          mutateSheet(sheetId, (sh) => {
            const c = newColumn(designation);
            if (at === undefined || at >= sh.columns.length) sh.columns.push(c);
            else sh.columns.splice(at, 0, c);
          }),
        appendColumns: (sheetId, columns) =>
          mutateSheet(sheetId, (sh) => {
            for (const c of columns) sh.columns.push({ ...c, id: c.id || uid() });
          }),
        ensureColumns: (sheetId, count) =>
          mutateSheet(sheetId, (sh) => {
            while (sh.columns.length < count) sh.columns.push(newColumn("Y"));
          }),
        deleteColumns: (sheetId, indices) =>
          mutateSheet(sheetId, (sh) => {
            const del = new Set(indices);
            sh.columns = sh.columns.filter((_, i) => !del.has(i));
            if (sh.columns.length === 0) sh.columns.push(newColumn("X"));
          }),
        duplicateColumn: (sheetId, index) =>
          mutateSheet(sheetId, (sh) => {
            const src = sh.columns[index];
            if (!src) return;
            const copy = clone(src);
            copy.id = uid();
            if (copy.longName) copy.longName += " copy";
            sh.columns.splice(index + 1, 0, copy);
          }),
        moveColumn: (sheetId, from, to) =>
          mutateSheet(sheetId, (sh) => {
            const [c] = sh.columns.splice(from, 1);
            sh.columns.splice(to, 0, c);
          }),
        setColumnWidth: (sheetId, index, widthPx) =>
          set((s) => {
            const c = sheetOf(s.project, sheetId).columns[index];
            if (c) c.widthPx = widthPx;
          }),
        updateColumn: (sheetId, colId, patch) =>
          mutateSheet(sheetId, (sh) => {
            const idx = sh.columns.findIndex((x) => x.id === colId);
            const c = sh.columns[idx];
            if (!c) return;
            Object.assign(c, patch);
            if (patch.formula !== undefined && !patch.formula.trim()) {
              c.formula = undefined;
              c.formulaError = undefined;
            }
            // a formula or values edit affects this column and its dependents only; a name change can alter
            // what other formulas resolve to, so everything is recalculated then
            return Object.keys(patch).every((k) => k === "formula" || k === "values" || k === "formulaError") ? new Set([idx]) : undefined;
          }),
        clearColumns: (sheetId, indices) =>
          mutateSheet(sheetId, (sh) => {
            for (const i of indices) {
              const c = sh.columns[i];
              if (!c) continue;
              c.values = [];
              c.formula = undefined;
              c.formulaError = undefined;
            }
          }),
        deleteRows: (sheetId, rows) =>
          mutateSheet(sheetId, (sh) => {
            const del = new Set(rows);
            for (const c of sh.columns) c.values = c.values.filter((_, i) => !del.has(i));
          }),
        insertRows: (sheetId, at, count) =>
          mutateSheet(sheetId, (sh) => {
            for (const c of sh.columns) {
              if (c.values.length < at) continue;
              c.values.splice(at, 0, ...new Array(count).fill(null));
            }
          }),
        sortByColumn: (sheetId, index, descending) =>
          mutateSheet(sheetId, (sh) => {
            const key = sh.columns[index];
            if (!key) return;
            const n = sheetRowCount(sh);
            const order = [...Array(n).keys()].sort((a, b) => {
              const va = key.values[a] ?? null;
              const vb = key.values[b] ?? null;
              if (va === null && vb === null) return 0;
              if (va === null) return 1;
              if (vb === null) return -1;
              const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
              return descending ? -cmp : cmp;
            });
            for (const c of sh.columns) {
              if (c.formula) continue;
              ensureRows(c, n);
              c.values = order.map((i) => c.values[i]);
            }
          }),
        recalc: (sheetId) => mutateSheet(sheetId, () => {}),

        addGraph: (name) => {
          const g = newGraph(get().project.defaults, uniqueName(name ?? "Graph 1", get().project.graphs.map((x) => x.name)));
          g.folderId = get().ui.currentFolderId;
          mutate((p) => void p.graphs.push(g));
          get().openTab({ kind: "graph", id: g.id });
          return g.id;
        },
        addGraphObject: (graph) => {
          mutate((p) => {
            graph.name = uniqueName(graph.name, p.graphs.map((x) => x.name));
            p.graphs.push(graph);
          });
          get().openTab({ kind: "graph", id: graph.id });
        },
        renameGraph: (id, name) => mutate((p) => void (graphOf(p, id).name = name)),
        deleteGraph: (id) => {
          get().closeTab({ kind: "graph", id });
          mutate((p) => void (p.graphs = p.graphs.filter((g) => g.id !== id)));
        },
        duplicateGraph: (id) => {
          const src = get().project.graphs.find((g) => g.id === id);
          if (!src) return;
          const copy = clone(src);
          copy.id = uid();
          copy.layers.forEach((l) => {
            l.id = uid();
            renewPlotIds(l, uid);
          });
          copy.name = uniqueName(src.name + " copy", get().project.graphs.map((g) => g.name));
          mutate((p) => void p.graphs.push(copy));
          get().openTab({ kind: "graph", id: copy.id });
        },
        copyToNewGraph: (graphId, layerIds, plotIds) => {
          const state = get();
          const src = state.project.graphs.find((g) => g.id === graphId);
          if (!src) throw new Error("Graph not found");
          const picked = new Set(layerIds);
          const only = plotIds ? new Set(plotIds) : null;
          const layers: Layer[] = clone(src.layers.filter((l) => picked.has(l.id)));
          for (const l of layers) {
            if (only) l.plots = l.plots.filter((pl) => only.has(pl.id));
            l.id = uid();
            renewPlotIds(l, uid);
            l.shapes?.forEach((sh) => (sh.id = uid()));
            l.texts.forEach((t) => (t.id = uid()));
          }
          const usedGroups = new Set(layers.flatMap((l) => l.plots.map((pl) => pl.groupId)));
          const groups = clone((src.plotGroups ?? []).filter((g) => usedGroups.has(g.id)));
          for (const g of groups) {
            delete g.shownIds;
            // single curves taken out of a group keep the colors they have (a gradient over fewer curves would change them)
            if (only) delete g.colors;
          }
          const name = layers.length === 1 && src.layers.length > 1 ? `${src.name} – ${layers[0].name}` : `${src.name} copy`;
          const graph: Graph = {
            id: uid(),
            name: uniqueName(name, state.project.graphs.map((g) => g.name)),
            canvas: { ...src.canvas, autoHeight: true },
            layers,
            folderId: src.folderId,
            ...(groups.length ? { plotGroups: groups } : {}),
          };
          // move the content to the top-left corner and fit the canvas around it
          const box = layoutGraph(state.project, graph).content;
          if (Number.isFinite(box.x0) && Number.isFinite(box.y0) && box.x1 > box.x0) {
            // whole half millimeters, so the frames keep round positions
            const dx = Math.ceil((CANVAS_MARGIN_MM - box.x0) * 2) / 2;
            const dy = Math.ceil((CANVAS_MARGIN_MM - box.y0) * 2) / 2;
            for (const l of layers) {
              l.frame.xMm += dx;
              l.frame.yMm += dy;
              for (const t of l.texts)
                if (t.coord !== "data") {
                  t.xMm += dx;
                  t.yMm += dy;
                }
              for (const sh of l.shapes ?? [])
                if (sh.coord !== "data") {
                  sh.x1 += dx;
                  sh.x2 += dx;
                  sh.y1 += dy;
                  sh.y2 += dy;
                  sh.points?.forEach((pt) => {
                    pt.x += dx;
                    pt.y += dy;
                  });
                }
            }
            graph.canvas.widthMm = Math.max(20, Math.ceil((box.x1 + dx + CANVAS_MARGIN_MM) * 2) / 2);
          }
          tidyGroups(graph);
          mutate((p) => void p.graphs.push(graph));
          get().openTab({ kind: "graph", id: graph.id });
          return graph.id;
        },
        updateGraph: (graphId, fn) =>
          mutate((p) => {
            const g = graphOf(p, graphId);
            fn(g);
            tidy(g);
          }),
        updateLayer: (graphId, layerId, fn) =>
          mutate((p) => {
            const g = graphOf(p, graphId);
            fn(layerOf(g, layerId));
            tidy(g);
          }),
        updateAxis: (graphId, layerId, axis, fn) =>
          mutate((p) => {
            const l = layerOf(graphOf(p, graphId), layerId);
            const a = l.axes[axis];
            if (a) fn(a);
          }),
        updatePlot: (graphId, layerId, plotId, fn) =>
          mutate((p) => {
            const g = graphOf(p, graphId);
            const pl = layerOf(g, layerId).plots.find((x) => x.id === plotId);
            if (pl) fn(pl);
            tidy(g);
          }),
        moveLayer: (graphId, from, to) =>
          mutate((p) => {
            const g = graphOf(p, graphId);
            if (from < 0 || from >= g.layers.length) return;
            const [l] = g.layers.splice(from, 1);
            g.layers.splice(Math.max(0, Math.min(g.layers.length, to)), 0, l);
          }),
        addLayer: (graphId, layer) => {
          const d = get().project.defaults;
          const g = get().project.graphs.find((x) => x.id === graphId)!;
          let l: Layer;
          if (layer) {
            l = clone(layer);
            l.id = uid();
            renewPlotIds(l, uid);
            l.frame = { ...l.frame, xMm: l.frame.xMm + 5, yMm: l.frame.yMm + 5 };
          } else {
            // stack below the lowest existing layer (room for tick labels and the x title)
            const bottom = g.layers.reduce((m, x) => Math.max(m, x.frame.yMm + x.frame.hMm), 0);
            l = newLayer(d, `Layer ${g.layers.length + 1}`, {
              ...d.frame,
              yMm: g.layers.length ? bottom + 18 : d.frame.yMm,
            });
          }
          l.name = uniqueName(l.name, g.layers.map((x) => x.name));
          mutate((p) => {
            const gr = graphOf(p, graphId);
            gr.layers.push(l);
            // a copied layer keeps its curves in their groups; one from another figure leaves groups this figure lacks
            tidyGroups(gr);
          });
          return l.id;
        },
        deleteLayer: (graphId, layerId) =>
          mutate((p) => {
            const g = graphOf(p, graphId);
            g.layers = g.layers.filter((l) => l.id !== layerId);
            tidy(g);
          }),
        addGraphItems: (graphId, layers, shapes, texts) =>
          mutate((p) => {
            const g = graphOf(p, graphId);
            g.layers.push(...layers);
            for (const { layerId, shape } of shapes) (layerOf(g, layerId).shapes ??= []).push(shape);
            for (const { layerId, text } of texts) layerOf(g, layerId).texts.push(text);
            if (layers.length) tidyGroups(g);
          }),
        deleteLayers: (graphId, layerIds) =>
          mutate((p) => {
            const g = graphOf(p, graphId);
            const ids = new Set(layerIds);
            g.layers = g.layers.filter((l) => !ids.has(l.id));
            tidy(g);
          }),
        deletePlot: (graphId, layerId, plotId) =>
          mutate((p) => {
            const g = graphOf(p, graphId);
            const l = layerOf(g, layerId);
            l.plots = l.plots.filter((x) => x.id !== plotId);
            tidy(g);
          }),
        excludePoints: (graphId, layerId, plotId, rows) => {
          let res: ExcludeResult = { moved: 0 };
          mutate((p) => {
            res = excludeRows(p, graphId, layerId, plotId, rows);
            if (!res.moved) return;
            const plot = layerOf(graphOf(p, graphId), layerId).plots.find((x) => x.id === plotId);
            // formulas that read the column follow
            if (plot) recalculateSheet(sheetOf(p, plot.source.sheetId));
            tidy(graphOf(p, graphId));
          });
          return res;
        },
        includePoints: (graphId, layerId, plotId, rows) => {
          let res: ExcludeResult = { moved: 0 };
          const sheetId = get().project.graphs.find((g) => g.id === graphId)?.layers.find((l) => l.id === layerId)?.plots.find((x) => x.id === plotId)?.source.sheetId;
          mutate((p) => {
            res = includeRows(p, graphId, layerId, plotId, rows);
            if (!res.moved) return;
            if (sheetId) recalculateSheet(sheetOf(p, sheetId));
            for (const g of p.graphs) tidy(g);
          });
          // the plot of the excluded points is gone with its last point: select the plot they went back to
          const to = (res as ExcludeResult).select;
          if (to) get().setSelection(to.plotId ? { kind: "plot", graphId, layerId: to.layerId, plotId: to.plotId } : { kind: "layer", graphId, layerId: to.layerId });
          return res;
        },
        addFunctionPlot: (graphId, layerIdIn, expression, name) => {
          const state = get();
          const layerId = layerIdIn === "new" ? state.addLayer(graphId) : layerIdIn;
          let plotId = "";
          mutate((p) => {
            const g = graphOf(p, graphId);
            const l = layerOf(g, layerId);
            const sheetId = p.sheets[0]?.id ?? "";
            const plot = newPlot(p.defaults, l, { sheetId, xColId: null, yColId: "" }, name ?? expression, "function");
            plot.func = { expression, from: null, to: null, points: 400 };
            plotId = plot.id;
            l.plots.push(plot);
            l.nextColorIndex++;
            if (l.plots.length === 1) {
              l.axes.x.title = "x";
              l.axes.y.title = "y";
              l.axes.x.auto = false;
              l.axes.x.from = -10;
              l.axes.x.to = 10;
            }
          });
          get().openTab({ kind: "graph", id: graphId });
          get().setSelection({ kind: "plot", graphId, layerId, plotId });
          return plotId;
        },
        addShape: (graphId, layerId, kind, x1, y1, x2, y2, extra) => {
          const sh = { ...newShape(kind, x1, y1, x2, y2), ...(kind === "bracket" ? { labelStyle: { ...get().project.defaults.tickLabel } } : {}), ...(extra ?? {}) };
          mutate((p) => {
            const l = layerOf(graphOf(p, graphId), layerId);
            (l.shapes ??= []).push(sh);
          });
          return sh.id;
        },
        updateShape: (graphId, layerId, shapeId, fn) =>
          mutate((p) => {
            const sh = layerOf(graphOf(p, graphId), layerId).shapes?.find((x) => x.id === shapeId);
            if (sh) fn(sh);
          }),
        movePlot: (graphId, layerId, plotId, delta) =>
          mutate((p) => {
            const g = graphOf(p, graphId);
            const l = layerOf(g, layerId);
            // with curve groups, one step moves a curve within its group and other plots past a whole group
            if (g.plotGroups?.length && (delta === 1 || delta === -1)) stepPlot(g, l, plotId, delta);
            else reorder(l.plots, l.plots.findIndex((x) => x.id === plotId), delta);
            tidy(g);
          }),
        moveShape: (graphId, layerId, shapeId, delta) =>
          mutate((p) => {
            const l = layerOf(graphOf(p, graphId), layerId);
            if (l.shapes) reorder(l.shapes, l.shapes.findIndex((x) => x.id === shapeId), delta);
          }),
        deleteShape: (graphId, layerId, shapeId) =>
          mutate((p) => {
            const l = layerOf(graphOf(p, graphId), layerId);
            l.shapes = (l.shapes ?? []).filter((x) => x.id !== shapeId);
          }),
        addPlot: (graphId, layerIdIn, type, source, name, apply) => {
          const state = get();
          const d = state.project.defaults;
          const layerId = layerIdIn === "new" ? state.addLayer(graphId) : layerIdIn;
          const sheet = state.project.sheets.find((s) => s.id === source.sheetId);
          let plotId = "";
          mutate((p) => {
            const g = graphOf(p, graphId);
            const l = layerOf(g, layerId);
            const src: PlotSource = { ...source };
            const isMatrix = type === "heatmap" || type === "contour" || type === "surface3d";
            if (isMatrix && sheet && !src.matrix) src.matrix = defaultMatrixSource(sheet);
            const yIdx = sheet ? sheet.columns.findIndex((c) => c.id === src.yColId) : -1;
            const zIdx = sheet ? sheet.columns.findIndex((c) => c.id === src.zColId) : -1;
            const label = name ?? (isMatrix ? (src.matrix?.mode === "xyz" && zIdx >= 0 ? columnDisplayName(sheet!.columns[zIdx], zIdx) : sheet?.name ?? "Matrix") : yIdx >= 0 ? columnDisplayName(sheet!.columns[yIdx], yIdx) : "Plot");
            const plot = newPlot(d, l, src, label, type);
            apply?.(plot);
            plotId = plot.id;
            if (type === "surface3d" || type === "scatter3d") {
              make3D(d, l);
              if (l.plots.length === 0) {
                l.frame.hMm = Math.max(l.frame.hMm, l.frame.wMm);
                if (sheet) {
                  const xc = sheet.columns.find((c) => c.id === src.xColId);
                  const yc = sheet.columns.find((c) => c.id === src.yColId);
                  if (xc) l.axes.x.title = axisTitleFor(xc, sheet.columns.indexOf(xc));
                  if (yc && type === "scatter3d") l.axes.y.title = axisTitleFor(yc, sheet.columns.indexOf(yc));
                  if (type === "surface3d") {
                    l.axes.x.title = "X";
                    l.axes.y.title = "Y";
                  }
                  l.axes.z!.title = type === "scatter3d" && zIdx >= 0 ? axisTitleFor(sheet.columns[zIdx], zIdx) : "Z";
                }
              }
            } else if (isMatrix && l.plots.length === 0) {
              l.axes.x.title = "X";
              l.axes.y.title = "Y";
            } else if (type === "bar" && l.plots.length === 0 && sheet) {
              const xc = sheet.columns.find((c) => c.id === src.xColId);
              l.axes.x.title = xc ? axisTitleFor(xc, sheet.columns.indexOf(xc)) : "";
              l.axes.y.title = yIdx >= 0 ? axisTitleFor(sheet.columns[yIdx], yIdx) : "";
            } else if (type === "box" && l.plots.length === 0) {
              l.axes.x.title = "";
              l.axes.y.title = "Value";
            }
            if (plot.colormap && !l.colorScale) l.colorScale = defaultColorScale(d, l.frame);
            l.plots.push(plot);
            l.nextColorIndex++;
          });
          get().openTab({ kind: "graph", id: graphId });
          get().setSelection({ kind: "plot", graphId, layerId, plotId });
          return plotId;
        },
        plotColumns: (sheetId, yColIds, xColId, target, type = "scatter", apply) => {
          const state = get();
          const d = state.project.defaults;
          const sheet = state.project.sheets.find((s) => s.id === sheetId);
          if (!sheet) throw new Error("Sheet not found");
          let graphId = target?.graphId;
          let layerId = target?.layerId;
          if (!graphId) {
            graphId = state.addGraph();
            layerId = get().project.graphs.find((g) => g.id === graphId)!.layers[0].id;
          } else if (!layerId || layerId === "new") {
            layerId = get().addLayer(graphId);
          }
          if (type === "heatmap" || type === "contour" || type === "surface3d" || type === "scatter3d" || type === "bar" || type === "box") {
            for (const yId of yColIds) get().addPlot(graphId, layerId!, type, { sheetId, xColId, yColId: yId }, undefined, apply);
            return graphId;
          }
          mutate((p) => {
            const g = graphOf(p, graphId!);
            const l = layerId ? layerOf(g, layerId) : g.layers[0];
            const xCol = xColId ? sheet.columns.find((c) => c.id === xColId) : undefined;
            const xIdx = xCol ? sheet.columns.indexOf(xCol) : -1;
            for (const yId of yColIds) {
              const yIdx = sheet.columns.findIndex((c) => c.id === yId);
              if (yIdx < 0) continue;
              const yCol = sheet.columns[yIdx];
              // yErr: the next column if designated yErr
              const next = sheet.columns[yIdx + 1];
              const yErrColId = next && next.designation === "yErr" ? next.id : null;
              const plot = newPlot(d, l, { sheetId, xColId: xColId, yColId: yId, yErrColId }, columnDisplayName(yCol, yIdx), type);
              apply?.(plot);
              l.plots.push(plot);
              l.nextColorIndex++;
              if (l.plots.length === 1) {
                if (type === "histogram") {
                  // several columns share the axis: name it after what they hold, not after the first of them
                  l.axes.x.title = yColIds.length > 1 ? (yCol.units ? `Value (${yCol.units})` : "Value") : axisTitleFor(yCol, yIdx);
                  l.axes.y.title = plot.histogram?.display === "cdf" ? "Cumulative fraction" : "Count";
                  // cumulative curves end in the top-right corner: the legend goes to the bottom right, which they leave free
                  if (plot.histogram?.display === "cdf") Object.assign(l.legend, { xMm: Math.round(l.frame.wMm * 0.5), yMm: Math.round((l.frame.hMm - 2.5 - 3.4 * yColIds.length) * 2) / 2 });
                } else {
                  if (xCol) l.axes.x.title = axisTitleFor(xCol, xIdx);
                  l.axes.y.title = axisTitleFor(yCol, yIdx);
                }
              }
            }
          });
          get().openTab({ kind: "graph", id: graphId });
          get().setSelection({ kind: "layer", graphId, layerId: layerId! });
          return graphId;
        },
      };
    }),
    {
      partialize: (s) => ({ project: s.project }) as unknown as AppState,
      limit: 200,
      equality: (a, b) => a.project === b.project,
    },
  ),
);

/** Move arr[i] by one step or to either end (later items draw on top). */
function reorder<T>(arr: T[], i: number, delta: 1 | -1 | "front" | "back"): void {
  if (i < 0) return;
  const [item] = arr.splice(i, 1);
  const j = delta === "front" ? arr.length : delta === "back" ? 0 : Math.max(0, Math.min(arr.length, i + delta));
  arr.splice(j, 0, item);
}

export function axisTitleFor(col: Column, idx: number): string {
  const name = columnDisplayName(col, idx);
  return col.units.trim() ? `${name} (${col.units.trim()})` : name;
}

// Keep `dirty` consistent with the saved reference (so undoing back to the saved state clears it).
useStore.subscribe((s) => {
  const d = s.savedRef === null ? true : s.project !== s.savedRef;
  if (d !== s.dirty) useStore.setState({ dirty: d });
});
// A brand-new project starts clean.
useStore.setState((s) => ({ savedRef: s.project, dirty: false }));

/**
 * Select a derived value and keep the previous result while `eq` says it is unchanged, so components
 * that only need ids/names do not re-render on unrelated edits (zustand compares results by identity).
 */
export function useStoreEq<T>(selector: (s: AppState) => T, eq: (a: T, b: T) => boolean): T {
  const ref = useRef<{ v: T } | null>(null);
  return useStore((s) => {
    const next = selector(s);
    if (ref.current && eq(ref.current.v, next)) return ref.current.v;
    ref.current = { v: next };
    return next;
  });
}

export const undo = () => {
  endEdit();
  useStore.temporal.getState().undo();
};
export const redo = () => {
  endEdit();
  useStore.temporal.getState().redo();
};
/** For a drag: its steps are applied with history paused and recorded as one at the end. */
export const pauseHistory = () => {
  endEdit();
  useStore.temporal.getState().pause();
};
export const resumeHistory = () => useStore.temporal.getState().resume();

// A field of the inspector that is being edited: every keystroke is applied with history paused, and the edit
// becomes one undo step when it ends. Only one can be open, and whatever moves on (another selection or tab, a
// drag, undo) ends it first: the value then lands on the object it was typed for, and history is never left paused.
let openEdit: { end: () => boolean | void; start: Project } | null = null;

/**
 * Start a field edit. `end` is called once when the edit finishes, with history still paused: it applies what is
 * left to apply and returns false to throw the edit away (Escape, text that is no number).
 */
export function beginEdit(end: () => boolean | void): void {
  endEdit();
  openEdit = { end, start: useStore.getState().project };
  useStore.temporal.getState().pause();
}
/** Several store calls recorded as one undo step (a command that adds columns and then plots them, say). */
export function oneUndoStep<T>(fn: () => T): T {
  endEdit();
  const history = useStore.temporal.getState();
  const start = useStore.getState().project;
  history.pause();
  try {
    return fn();
  } finally {
    const final = useStore.getState().project;
    if (final === start) history.resume();
    else {
      // history sees the project as it was before the command, then as it is now
      useStore.setState({ project: start });
      history.resume();
      useStore.setState({ project: final });
    }
  }
}

/** Finish the open field edit, if any. Pass the edit's own `end` to finish it only if it is still the open one. */
export function endEdit(own?: () => boolean | void): void {
  const e = openEdit;
  if (!e || (own && own !== e.end)) return;
  openEdit = null;
  const keep = e.end() !== false;
  const history = useStore.temporal.getState();
  const final = useStore.getState().project;
  if (final === e.start) return history.resume();
  // one undo step: history sees the project as it was before the edit, then as it is now
  useStore.setState({ project: e.start });
  history.resume();
  if (keep) useStore.setState({ project: final });
}
