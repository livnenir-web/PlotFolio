import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CompactSelection, DataEditor, GridCellKind, type DataEditorRef, type EditableGridCell, type GridCell, type GridColumn, type GridSelection, type Item, type Rectangle, type Theme, type CustomCell, type CustomRenderer } from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import { useStore, type CellEdit } from "../model/store";
import type { CellValue, Column, Designation, Sheet } from "../model/types";
import { columnLetter } from "../model/defaults";
import { sheetRowCount } from "../formula/engine";
import { toCell } from "../io/importText";
import { useGridTheme } from "./gridTheme";
import { useContextMenu, type MenuItem } from "../ui/ContextMenu";
import { Icon } from "../ui/Icon";
import { useDialogs } from "../app/dialogs";
import { exportSheetCsv } from "../export/csv";
import { columnStatistics } from "./stats";
import type { AnalysisOp } from "../analysis/AnalysisDialog";
import { addColumnsToGraph } from "../graph/addData";
import { startNativeColumnDrag } from "../io/columnDrag";
import { isTauri } from "../io/platform";
import { createPortal } from "react-dom";

const HDR = 5; // Name, Units, Comments, F(x), sparkline
const HDR_LABELS = ["Name", "Units", "Comments", "F(x)", ""];
const ROW_SPARK = 4;

/** Tiny line chart of a column's numeric values, drawn in the last header row. */
const sparklineRenderer: CustomRenderer<SparkCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is SparkCell => (c.data as { kind?: string })?.kind === "sparkline",
  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const vals = cell.data.values;
    if (vals.length < 2) return;
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of vals) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (!(hi > lo)) hi = lo + 1;
    const pad = 3;
    const w = rect.width - pad * 2;
    const h = rect.height - pad * 2;
    ctx.save();
    ctx.beginPath();
    ctx.strokeStyle = theme.accentColor;
    ctx.lineWidth = 1;
    vals.forEach((v, i) => {
      const x = rect.x + pad + (i / (vals.length - 1)) * w;
      const y = rect.y + pad + h - ((v - lo) / (hi - lo)) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();
  },
};
type SparkCell = CustomCell<{ kind: "sparkline"; values: number[] }>;
const sparkRenderers = [sparklineRenderer];
/** Up to 120 evenly spaced numeric samples of a column, for the sparkline. */
function sparkValues(values: CellValue[]): number[] {
  const nums: number[] = [];
  for (const v of values) if (typeof v === "number" && Number.isFinite(v)) nums.push(v);
  if (nums.length <= 120) return nums;
  const out: number[] = [];
  for (let i = 0; i < 120; i++) out.push(nums[Math.floor((i / 119) * (nums.length - 1))]);
  return out;
}
const EXTRA_ROWS = 40;
const EXTRA_COLS = 2;

export const DESIGNATION_LABEL: Record<Designation, string> = {
  X: "X",
  Y: "Y",
  yErr: "yEr±",
  xErr: "xEr±",
  label: "L",
  none: "",
};

/** Columns currently selected in the active sheet (sheet column indices). Read by the toolbar. */
/** Columns a sheet should select as soon as it is shown (set by goToDataSheet when the sheet is not on screen yet). */
let pendingColumnFocus: { sheetId: string; colIds: string[] } | null = null;

/**
 * Show the sheet behind a plot with its columns selected: opens (or switches to) the sheet's tab, then selects the
 * columns and scrolls them into view.
 */
export function goToDataSheet(sheetId: string, colIds: string[]): void {
  const st = useStore.getState();
  if (!st.project.sheets.some((s) => s.id === sheetId)) return;
  const active = st.ui.activeTab;
  if (active?.kind === "sheet" && active.id === sheetId) {
    window.dispatchEvent(new CustomEvent("plotkit:focusColumns", { detail: { sheetId, colIds } }));
    return;
  }
  pendingColumnFocus = { sheetId, colIds };
  st.openTab({ kind: "sheet", id: sheetId });
}

export const sheetSelectionRef: { sheetId: string | null; cols: number[]; cell: [number, number] | null } = {
  sheetId: null,
  cols: [],
  cell: null,
};

export function formatCell(v: CellValue | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    if (Number.isInteger(v)) return String(v);
    const a = Math.abs(v);
    if (a !== 0 && (a < 1e-4 || a >= 1e9)) return v.toExponential(5).replace(/\.?0+e/, "e");
    return String(Number(v.toPrecision(10)));
  }
  return v;
}

function headerTitle(col: Column, idx: number): string {
  const d = DESIGNATION_LABEL[col.designation];
  return d ? `${columnLetter(idx)} (${d})` : columnLetter(idx);
}

export function SheetView({ sheet }: { sheet: Sheet }) {
  const theme = useGridTheme();
  const st = useStore;
  const setSelection = useStore((s) => s.setSelection);
  const ref = useRef<DataEditorRef>(null);
  const [gridSel, setGridSel] = useState<GridSelection>({ columns: CompactSelection.empty(), rows: CompactSelection.empty() });
  const [menu, openMenu] = useContextMenu();
  const [curCol, setCurCol] = useState<number>(0);
  const [headerHover, setHeaderHover] = useState<{ col: number; x: number; y: number } | null>(null);
  const hideTimer = useRef<number | null>(null);
  const cancelHide = () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };
  const pressing = useRef(false); // the handle is being dragged: keep it mounted
  const scheduleHide = () => {
    cancelHide();
    if (pressing.current) return;
    hideTimer.current = window.setTimeout(() => setHeaderHover(null), 350);
  };
  const onItemHovered = useCallback(
    (args: { kind: string; location: Item }) => {
      const [col, row] = args.location;
      if (args.kind === "header" && col >= 1 && row === -1 && sheet.columns[col - 1]) {
        const b = ref.current?.getBounds(col, -1);
        if (b) {
          cancelHide();
          setHeaderHover({ col: col - 1, x: b.x + b.width - 22, y: b.y + Math.max(0, (b.height - 18) / 2) });
          return;
        }
      }
      scheduleHide();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sheet.columns],
  );

  const rowCount = sheetRowCount(sheet);
  const totalRows = HDR + Math.max(rowCount + EXTRA_ROWS, 60);
  const nCols = sheet.columns.length + EXTRA_COLS;

  const columns = useMemo<GridColumn[]>(() => {
    const cols: GridColumn[] = [{ title: "", id: "__rows", width: 66, themeOverride: { bgCell: theme.bgHeader, textDark: theme.textMedium } }];
    for (let i = 0; i < nCols; i++) {
      const c = sheet.columns[i];
      cols.push({
        title: c ? headerTitle(c, i) : columnLetter(i),
        id: c?.id ?? `__virtual${i}`,
        width: c?.widthPx ?? 96,
        hasMenu: !!c,
        themeOverride: c ? undefined : { textHeader: theme.textLight },
      });
    }
    return cols;
  }, [sheet.columns, nCols, theme]);

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      if (col === 0) {
        const label = row < HDR ? HDR_LABELS[row] : String(row - HDR + 1);
        return {
          kind: GridCellKind.Text,
          data: label,
          displayData: label,
          allowOverlay: false,
          readonly: true,
          contentAlign: row < HDR ? "left" : "right",
          themeOverride: row < HDR ? { textDark: theme.textMedium, bgCell: theme.bgHeader } : undefined,
        };
      }
      const c = sheet.columns[col - 1];
      if (row === ROW_SPARK) {
        const cell: SparkCell = { kind: GridCellKind.Custom, data: { kind: "sparkline", values: c ? sparkValues(c.values) : [] }, copyData: "", allowOverlay: false, readonly: true, themeOverride: { bgCell: theme.bgCellMedium } };
        return cell;
      }
      if (row < HDR) {
        let text = "";
        if (c) text = row === 0 ? c.longName : row === 1 ? c.units : row === 2 ? (c.comment ?? "") : (c.formula ?? "");
        const isFormula = row === 3;
        return {
          kind: GridCellKind.Text,
          data: text,
          displayData: text,
          allowOverlay: true,
          themeOverride: {
            bgCell: theme.bgCellMedium,
            textDark: isFormula ? (c?.formulaError ? "#ff3b30" : theme.accentColor) : theme.textDark,
            baseFontStyle: isFormula ? "11.5px" : theme.baseFontStyle,
            fontFamily: isFormula ? "SF Mono, Menlo, monospace" : theme.fontFamily,
          },
        };
      }
      const v = c?.values[row - HDR];
      const text = formatCell(v);
      const isNum = typeof v === "number" || v === null || v === undefined;
      return {
        kind: GridCellKind.Text,
        data: text,
        displayData: text,
        allowOverlay: true,
        contentAlign: isNum ? "right" : "left",
        themeOverride: c?.formula ? { textDark: theme.textMedium } : undefined,
      };
    },
    [sheet.columns, theme],
  );

  const onCellEdited = useCallback(
    ([col, row]: Item, nv: EditableGridCell) => {
      if (col === 0 || nv.kind !== GridCellKind.Text) return;
      const idx = col - 1;
      const text = nv.data ?? "";
      if (row < HDR) {
        if (row === ROW_SPARK) return;
        st.getState().ensureColumns(sheet.id, idx + 1);
        const c = st.getState().project.sheets.find((s) => s.id === sheet.id)!.columns[idx];
        const patch = row === 0 ? { longName: text } : row === 1 ? { units: text } : row === 2 ? { comment: text } : { formula: text };
        st.getState().updateColumn(sheet.id, c.id, patch);
        return;
      }
      st.getState().setCell(sheet.id, idx, row - HDR, toCell(text, false));
    },
    [sheet.id, st],
  );

  const onPaste = useCallback(
    ([col, row]: Item, values: readonly (readonly string[])[]) => {
      if (col === 0) return false;
      const idx = col - 1;
      const edits: CellEdit[] = [];
      const state = st.getState();
      let needCols = idx + values.reduce((m, r) => Math.max(m, r.length), 0);
      needCols = Math.max(needCols, 0);
      if (needCols > sheet.columns.length) state.ensureColumns(sheet.id, needCols);
      values.forEach((r, ri) => {
        const gridRow = row + ri;
        r.forEach((v, ci) => {
          const cIdx = idx + ci;
          if (gridRow < HDR) {
            const c = st.getState().project.sheets.find((s) => s.id === sheet.id)!.columns[cIdx];
            if (!c) return;
            const patch = gridRow === 0 ? { longName: v } : gridRow === 1 ? { units: v } : { formula: v };
            st.getState().updateColumn(sheet.id, c.id, patch);
          } else {
            edits.push({ col: cIdx, row: gridRow - HDR, value: toCell(v, false) });
          }
        });
      });
      if (edits.length) st.getState().setCells(sheet.id, edits);
      return false;
    },
    [sheet.id, sheet.columns.length, st],
  );

  const onDelete = useCallback(
    (sel: GridSelection) => {
      const edits: CellEdit[] = [];
      const state = st.getState();
      const cols = sel.columns.toArray().map((c) => c - 1).filter((c) => c >= 0 && c < sheet.columns.length);
      if (cols.length) state.clearColumns(sheet.id, cols);
      const rows = sel.rows.toArray().map((r) => r - HDR).filter((r) => r >= 0);
      if (rows.length) state.deleteRows(sheet.id, rows);
      if (sel.current) {
        const rects = [sel.current.range, ...sel.current.rangeStack];
        for (const r of rects) {
          for (let x = r.x; x < r.x + r.width; x++) {
            for (let y = r.y; y < r.y + r.height; y++) {
              if (x === 0) continue;
              const cIdx = x - 1;
              if (cIdx >= sheet.columns.length) continue;
              if (y < HDR) {
                const c = sheet.columns[cIdx];
                const patch = y === 0 ? { longName: "" } : y === 1 ? { units: "" } : { formula: "" };
                state.updateColumn(sheet.id, c.id, patch);
              } else if (y - HDR < rowCount) edits.push({ col: cIdx, row: y - HDR, value: null });
            }
          }
        }
      }
      if (edits.length) state.setCells(sheet.id, edits);
      return false;
    },
    [sheet, rowCount, st],
  );

  const onGridSelectionChange = useCallback(
    (sel: GridSelection) => {
      setGridSel(sel);
      const cols = sel.columns.toArray().map((c) => c - 1).filter((c) => c >= 0);
      let cell: [number, number] | null = null;
      if (sel.current) {
        const [c, r] = sel.current.cell;
        cell = [c - 1, r - HDR];
        if (c >= 1) setCurCol(c - 1);
      } else if (cols.length) setCurCol(cols[0]);
      sheetSelectionRef.sheetId = sheet.id;
      sheetSelectionRef.cols = cols.length ? cols : cell && cell[0] >= 0 ? [cell[0]] : [];
      sheetSelectionRef.cell = cell;
      const focusCol = cols[0] ?? cell?.[0];
      if (focusCol !== undefined && focusCol >= 0 && sheet.columns[focusCol]) setSelection({ kind: "column", sheetId: sheet.id, colId: sheet.columns[focusCol].id });
    },
    [sheet.id, sheet.columns, setSelection],
  );

  useEffect(() => {
    sheetSelectionRef.sheetId = sheet.id;
    sheetSelectionRef.cols = [];
    sheetSelectionRef.cell = null;
    setGridSel({ columns: CompactSelection.empty(), rows: CompactSelection.empty() });
    setCurCol(0);
  }, [sheet.id]);

  // "Go to data sheet" from a graph: select the plot's columns and scroll them into view
  useEffect(() => {
    const focus = (ids: string[]) => {
      const idx = ids.map((id) => sheet.columns.findIndex((c) => c.id === id)).filter((i) => i >= 0);
      if (!idx.length) return;
      let columns = CompactSelection.empty();
      for (const i of idx) columns = columns.add(i + 1);
      setGridSel({ columns, rows: CompactSelection.empty() });
      setCurCol(idx[0]);
      sheetSelectionRef.sheetId = sheet.id;
      sheetSelectionRef.cols = idx;
      sheetSelectionRef.cell = null;
      setSelection({ kind: "column", sheetId: sheet.id, colId: sheet.columns[idx[0]].id });
      ref.current?.scrollTo(idx[0] + 1, 0, "horizontal", 0, 0, { hAlign: "start" });
    };
    const onEvent = (e: Event) => {
      const d = (e as CustomEvent<{ sheetId: string; colIds: string[] }>).detail;
      if (d?.sheetId === sheet.id) focus(d.colIds);
    };
    window.addEventListener("plotkit:focusColumns", onEvent);
    let timer: number | undefined;
    if (pendingColumnFocus && pendingColumnFocus.sheetId === sheet.id) {
      // the grid reports an empty selection right after mounting; select the columns once it has settled
      // (the pending request is consumed only when the timer fires, so a re-run of this effect keeps it)
      timer = window.setTimeout(() => {
        const p = pendingColumnFocus;
        if (!p || p.sheetId !== sheet.id) return;
        pendingColumnFocus = null;
        focus(p.colIds);
      }, 40);
    }
    return () => {
      window.removeEventListener("plotkit:focusColumns", onEvent);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [sheet.id, sheet.columns, setSelection]);

  const columnMenu = useCallback(
    (idx: number): MenuItem[] => {
      const state = st.getState();
      const c = sheet.columns[idx];
      if (!c) return [{ label: "Add column", onSelect: () => state.ensureColumns(sheet.id, idx + 1) }];
      const selCols = gridSel.columns.toArray().map((x) => x - 1).filter((x) => x >= 0 && x < sheet.columns.length);
      const targets = selCols.includes(idx) ? selCols : [idx];
      const setDes = (d: Designation) => targets.forEach((i) => state.updateColumn(sheet.id, sheet.columns[i].id, { designation: d }));
      const desItem = (d: Designation, label: string): MenuItem => ({ label, checked: c.designation === d, onSelect: () => setDes(d) });
      return [
        { type: "label", label: `Column ${columnLetter(idx)}${c.longName ? " · " + c.longName : ""}` },
        {
          type: "submenu",
          label: "Set as",
          items: [desItem("X", "X"), desItem("Y", "Y"), desItem("yErr", "Y error"), desItem("xErr", "X error"), desItem("label", "Label"), desItem("none", "None")],
        },
        { label: "Set column values (formula)…", onSelect: () => focusFormula() },
        { type: "sep" },
        { label: "Plot", onSelect: () => useDialogs.getState().setPlotDialog({ sheetId: sheet.id }) },
        { type: "sep" },
        { label: "Insert column before", onSelect: () => state.addColumn(sheet.id, idx) },
        { label: "Insert column after", onSelect: () => state.addColumn(sheet.id, idx + 1) },
        { label: "Duplicate column", onSelect: () => state.duplicateColumn(sheet.id, idx) },
        { label: "Clear column", onSelect: () => state.clearColumns(sheet.id, targets) },
        { label: targets.length > 1 ? `Delete ${targets.length} columns` : "Delete column", onSelect: () => state.deleteColumns(sheet.id, targets) },
        { type: "sep" },
        { label: "Sort ascending", onSelect: () => state.sortByColumn(sheet.id, idx, false) },
        { label: "Sort descending", onSelect: () => state.sortByColumn(sheet.id, idx, true) },
        { type: "sep" },
        { label: "Export sheet as CSV…", onSelect: () => void exportSheetCsv(sheet) },
      ];
    },
    [sheet, gridSel, st],
  );

  const formulaRef = useRef<HTMLInputElement>(null!);
  const focusFormula = () => formulaRef.current?.focus();

  const onHeaderMenuClick = useCallback(
    (col: number, bounds: Rectangle) => {
      if (col === 0) return;
      setGridSel({ columns: CompactSelection.fromSingleSelection(col), rows: CompactSelection.empty() });
      setCurCol(col - 1);
      openMenu({ clientX: bounds.x, clientY: bounds.y + bounds.height }, columnMenu(col - 1));
    },
    [columnMenu, openMenu],
  );

  const onHeaderContextMenu = useCallback(
    (col: number, e: { preventDefault: () => void; bounds: Rectangle; localEventX: number; localEventY: number }) => {
      e.preventDefault();
      if (col === 0) return;
      if (!gridSel.columns.hasIndex(col)) setGridSel({ columns: CompactSelection.fromSingleSelection(col), rows: CompactSelection.empty() });
      setCurCol(col - 1);
      openMenu({ clientX: e.bounds.x + e.localEventX, clientY: e.bounds.y + e.localEventY }, columnMenu(col - 1));
    },
    [columnMenu, gridSel, openMenu],
  );

  const onCellContextMenu = useCallback(
    ([col, row]: Item, e: { preventDefault: () => void; bounds: Rectangle; localEventX: number; localEventY: number }) => {
      e.preventDefault();
      const state = st.getState();
      const dataRow = row - HDR;
      const items: MenuItem[] = [];
      if (col >= 1) items.push(...columnMenu(col - 1), { type: "sep" });
      if (dataRow >= 0) {
        const selRows = gridSel.rows.toArray().map((r) => r - HDR).filter((r) => r >= 0);
        const rows = selRows.length ? selRows : [dataRow];
        items.push(
          { label: "Insert row above", onSelect: () => state.insertRows(sheet.id, dataRow, 1) },
          { label: rows.length > 1 ? `Delete ${rows.length} rows` : "Delete row", onSelect: () => state.deleteRows(sheet.id, rows) },
        );
      }
      openMenu({ clientX: e.bounds.x + e.localEventX, clientY: e.bounds.y + e.localEventY }, items);
    },
    [columnMenu, gridSel, openMenu, sheet.id, st],
  );

  const onColumnResize = useCallback(
    (_c: GridColumn, newSize: number, colIndex: number) => {
      if (colIndex === 0) return;
      st.getState().setColumnWidth(sheet.id, colIndex - 1, newSize);
    },
    [sheet.id, st],
  );

  const onColumnMoved = useCallback(
    (from: number, to: number) => {
      if (from === 0 || to === 0) return;
      if (from - 1 >= sheet.columns.length) return;
      st.getState().moveColumn(sheet.id, from - 1, Math.min(to - 1, sheet.columns.length - 1));
    },
    [sheet.id, sheet.columns.length, st],
  );

  const getRowThemeOverride = useCallback(
    (row: number): Partial<Theme> | undefined => (row < HDR ? { bgCell: theme.bgCellMedium, borderColor: theme.borderColor } : undefined),
    [theme],
  );

  // selection statistics
  const stats = useMemo(() => {
    const cur = gridSel.current;
    const colsSel = gridSel.columns.toArray();
    const nums: number[] = [];
    const push = (v: CellValue | undefined) => typeof v === "number" && nums.push(v);
    if (colsSel.length) {
      for (const c of colsSel) sheet.columns[c - 1]?.values.forEach(push);
    } else if (cur && (cur.range.width > 1 || cur.range.height > 1)) {
      const r = cur.range;
      for (let x = r.x; x < r.x + r.width; x++) for (let y = Math.max(r.y, HDR); y < r.y + r.height; y++) push(sheet.columns[x - 1]?.values[y - HDR]);
    }
    if (nums.length < 2) return null;
    const sum = nums.reduce((a, b) => a + b, 0);
    const mean = sum / nums.length;
    return { n: nums.length, sum, mean, min: nums.reduce((a, b) => (b < a ? b : a), Infinity), max: nums.reduce((a, b) => (b > a ? b : a), -Infinity) };
  }, [gridSel, sheet.columns]);

  const current = sheet.columns[curCol];

  return (
    <div className="sheet">
      <FormulaBar sheet={sheet} colIndex={curCol} inputRef={formulaRef} />
      <div className="grid">
        <DataEditor
          ref={ref}
          width="100%"
          height="100%"
          columns={columns}
          rows={totalRows}
          getCellContent={getCellContent}
          onCellEdited={onCellEdited}
          onPaste={onPaste}
          getCellsForSelection={true}
          onDelete={onDelete}
          gridSelection={gridSel}
          onGridSelectionChange={onGridSelectionChange}
          onHeaderMenuClick={onHeaderMenuClick}
          onHeaderContextMenu={onHeaderContextMenu}
          onCellContextMenu={onCellContextMenu}
          onColumnResize={onColumnResize}
          onColumnMoved={onColumnMoved}
          onItemHovered={onItemHovered}
          customRenderers={sparkRenderers}
          getRowThemeOverride={getRowThemeOverride}
          rowMarkers="none"
          freezeColumns={1}
          rangeSelect="multi-rect"
          columnSelect="multi"
          rowSelect="multi"
          rowHeight={24}
          headerHeight={26}
          smoothScrollX
          smoothScrollY
          theme={theme}
          keybindings={{ search: true, selectAll: true }}
          fillHandle
          isDraggable={false}
        />
      </div>
      <HeaderDragHandle
        sheetId={sheet.id}
        hover={headerHover}
        onKeepAlive={cancelHide}
        onLeave={scheduleHide}
        onPressChange={(v) => {
          pressing.current = v;
          if (!v) scheduleHide();
        }}
      />
      <div className="statusbar">
        <span>
          {rowCount} rows · {sheet.columns.length} columns
        </span>
        {current && (
          <span>
            {columnLetter(curCol)}
            {current.longName ? ` · ${current.longName}` : ""} ({DESIGNATION_LABEL[current.designation] || "none"})
          </span>
        )}
        {stats && (
          <span>
            n={stats.n} · mean={formatCell(Number(stats.mean.toPrecision(6)))} · sum={formatCell(Number(stats.sum.toPrecision(6)))} · min={formatCell(stats.min)} · max={formatCell(stats.max)}
          </span>
        )}
      </div>
      {menu}
    </div>
  );
}

/** "Add to graph" menu (no rescaling of the target axes). */
function AddToGraphControls({ sheetId }: { sheetId: string }) {
  const graphs = useStore((s) => s.project.graphs);
  const [menu, openMenu] = useContextMenu();
  const selectedCols = () => (sheetSelectionRef.sheetId === sheetId ? sheetSelectionRef.cols : []);
  const addTo = (graphId: string, layerId?: string) => {
    const cols = selectedCols();
    if (!cols.length) {
      useDialogs.getState().showToast("Select one or more Y columns first");
      return;
    }
    const n = addColumnsToGraph(sheetId, cols, graphId, layerId);
    useDialogs.getState().showToast(n ? `${n} column${n > 1 ? "s" : ""} added to the graph (axes kept)` : "No Y columns in the selection");
  };
  return (
    <>
      <button
        className="btn small"
        title="Add the selected columns to a graph without changing its axes. Tip: hover a column header and drag its graph icon onto a graph."
        onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          openMenu(
            { clientX: r.left, clientY: r.bottom + 2 },
            graphs.length
              ? graphs.map((g) =>
                  g.layers.length > 1
                    ? { type: "submenu" as const, label: g.name, items: g.layers.map((l) => ({ label: l.name, onSelect: () => addTo(g.id, l.id) })) }
                    : { label: g.name, onSelect: () => addTo(g.id, g.layers[0]?.id) },
                )
              : [{ label: "No graphs yet", disabled: true, onSelect: () => {} }],
          );
        }}
      >
        <Icon name="chart" size={12} /> Add to graph
      </button>
      {menu}
    </>
  );
}

/**
 * Origin-style drag handle: hovering the right side of a column header shows a graph icon; pressing it
 * starts a drag of the hovered column (or the whole column selection when it includes that column).
 * In the Mac app the drag is native and can be dropped on a graph in any window; in the browser it
 * falls back to a pointer drag onto a graph in the sidebar.
 */
function HeaderDragHandle({
  sheetId,
  hover,
  onKeepAlive,
  onLeave,
  onPressChange,
}: {
  sheetId: string;
  hover: { col: number; x: number; y: number } | null;
  onKeepAlive: () => void;
  onLeave: () => void;
  onPressChange: (pressed: boolean) => void;
}) {
  const drag = useDialogs((s) => s.columnDrag);
  const dragRef = useRef<{ startX: number; startY: number; active: boolean; cols: number[] } | null>(null);
  if (!hover) return null;
  const colsFor = () => {
    const sel = sheetSelectionRef.sheetId === sheetId ? sheetSelectionRef.cols : [];
    return sel.includes(hover.col) && sel.length > 1 ? sel : [hover.col];
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onKeepAlive();
    onPressChange(true); // stay mounted while pressed, even when the grid reports the pointer left
    const cols = colsFor();
    const label = cols.map((i) => columnLetter(i)).join(", ");
    if (isTauri()) {
      // native drag session: can be dropped on a graph in any window
      void startNativeColumnDrag({ kind: "columns", sheetId, cols, label }).finally(() => onPressChange(false));
      return;
    }
    dragRef.current = { startX: e.clientX, startY: e.clientY, active: false, cols };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.active && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 5) return;
    d.active = true;
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const g = el?.closest<HTMLElement>("[data-graph-id]")?.dataset.graphId ?? null;
    useDialogs.getState().setColumnDrag({ sheetId, cols: d.cols, x: e.clientX, y: e.clientY, overGraphId: g });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    const cur = useDialogs.getState().columnDrag;
    useDialogs.getState().setColumnDrag(null);
    onPressChange(false);
    if (!d?.active) return;
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const g = el?.closest<HTMLElement>("[data-graph-id]")?.dataset.graphId ?? cur?.overGraphId ?? null;
    if (g) {
      const n = addColumnsToGraph(sheetId, d.cols, g);
      useDialogs.getState().showToast(n ? `${n} column${n > 1 ? "s" : ""} added to the graph (axes kept)` : "No Y columns in the dragged selection");
    }
  };
  const label = colsFor().map((i) => columnLetter(i)).join(", ");
  return createPortal(
    <>
      <div
        className="header-drag-handle"
        style={{ left: hover.x, top: hover.y }}
        title={`Drag ${label} onto a graph to add the data (axes are kept)`}
        onPointerEnter={onKeepAlive}
        onPointerLeave={onLeave}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <Icon name="chart" size={13} />
      </div>
      {drag && drag.sheetId === sheetId && (
        <div className="drag-ghost" style={{ left: drag.x, top: drag.y }}>
          <Icon name="chart" size={13} /> Add {drag.cols.map((i) => columnLetter(i)).join(", ")} to {drag.overGraphId ? "this graph" : "a graph…"}
        </div>
      )}
    </>,
    document.body,
  );
}

function AnalysisButton({ sheetId }: { sheetId: string }) {
  const [menu, openMenu] = useContextMenu();
  const open = (op: AnalysisOp) => useDialogs.getState().setAnalysis({ op, sheetId });
  return (
    <>
      <button
        className="btn small"
        title="Analysis operations on the selected columns"
        onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          openMenu({ clientX: r.left, clientY: r.bottom + 2 }, [
            { label: "Smooth…", onSelect: () => open("smooth") },
            { label: "Differentiate", onSelect: () => open("derivative") },
            { label: "Integrate", onSelect: () => open("integrate") },
            { label: "Normalize…", onSelect: () => open("normalize") },
            { label: "FFT…", onSelect: () => open("fft") },
            { type: "sep" },
            { label: "Average curves…", onSelect: () => open("average") },
            { label: "Interpolate onto X…", onSelect: () => open("interpolate") },
            { type: "sep" },
            { label: "Fill column with…", onSelect: () => open("fill") },
            { label: "Column statistics", onSelect: () => columnStatistics(sheetId, sheetSelectionRef.sheetId === sheetId ? sheetSelectionRef.cols : []) },
          ]);
        }}
      >
        <Icon name="analysis" size={13} /> Analysis
      </button>
      {menu}
    </>
  );
}

function FormulaBar({ sheet, colIndex, inputRef }: { sheet: Sheet; colIndex: number; inputRef: React.RefObject<HTMLInputElement> }) {
  const col = sheet.columns[colIndex];
  const [text, setText] = useState(col?.formula ?? "");
  useEffect(() => setText(col?.formula ?? ""), [col?.formula, colIndex, sheet.id]);
  const apply = () => {
    const state = useStore.getState();
    state.ensureColumns(sheet.id, colIndex + 1);
    const c = state.project.sheets.find((s) => s.id === sheet.id)!.columns[colIndex];
    state.updateColumn(sheet.id, c.id, { formula: text });
  };
  return (
    <div className="formulabar">
      <span className="colname" title="Column">
        {columnLetter(colIndex)} =
      </span>
      <input
        ref={inputRef}
        className="input mono"
        style={{ flex: 1, maxWidth: 520 }}
        placeholder="Formula, e.g. B*2, log10(A), (C-mean(C))/std(C), Time/60 — row index is i"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            apply();
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Escape") setText(col?.formula ?? "");
        }}
      />
      <button className="btn small" onClick={apply} disabled={text === (col?.formula ?? "")}>
        Apply
      </button>
      <AnalysisButton sheetId={sheet.id} />
      <AddToGraphControls sheetId={sheet.id} />
      {col?.formulaError && (
        <span className="error" title={col.formulaError}>
          <Icon name="warning" size={12} style={{ verticalAlign: -2 }} /> {col.formulaError}
        </span>
      )}
    </div>
  );
}
