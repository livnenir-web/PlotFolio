import { memo } from "react";
import { useStore } from "../model/store";
import { columnLetter } from "../model/defaults";
import type { Column, Designation } from "../model/types";
import { Group, InspectorPanel, Row, SelectField, TextField } from "../ui/Fields";
import { Icon } from "../ui/Icon";
import { reorderRow } from "../ui/reorder";
import { GraphInspector } from "../graph/inspector/GraphInspector";
import { useDialogs } from "./dialogs";

export const Inspector = memo(function Inspector() {
  const activeTab = useStore((s) => s.ui.activeTab);
  const selection = useStore((s) => s.ui.selection);

  if (activeTab?.kind === "graph") return <GraphInspector graphId={activeTab.id} />;
  if (activeTab?.kind === "sheet") {
    if (selection.kind === "column" && selection.sheetId === activeTab.id) return <ColumnInspector key={selection.colId} sheetId={selection.sheetId} colId={selection.colId} />;
    return <SheetInspector key={activeTab.id} sheetId={activeTab.id} />;
  }
  return (
    <div className="inspector">
      <div className="empty">Select a sheet or graph</div>
    </div>
  );
});

const DESIGNATION_SHORT: Record<Designation, string> = { X: "X", Y: "Y", yErr: "Y error", xErr: "X error", label: "Label", none: "–" };

/** Nothing selected in a sheet: its name, its columns (click one to edit it) and the graphs that plot it. */
function SheetInspector({ sheetId }: { sheetId: string }) {
  const sheet = useStore((s) => s.project.sheets.find((x) => x.id === sheetId));
  const graphs = useStore((s) => s.project.graphs);
  if (!sheet) return null;
  const st = useStore.getState;
  const rows = sheet.columns.reduce((m, c) => Math.max(m, c.values.length), 0);
  const used = graphs.filter((g) => g.layers.some((l) => l.plots.some((p) => p.source?.sheetId === sheetId)));
  return (
    // two short lists: shown together, not as an accordion
    <div className="inspector">
      <div className="head">
        <Icon name="table" size={14} /> {sheet.name}
      </div>
      <Group>
        <Row label="Name">
          <TextField value={sheet.name} onCommit={(v) => v.trim() && st().renameSheet(sheetId, v.trim())} />
        </Row>
        <div className="note">
          {rows} rows · {sheet.columns.length} columns
        </div>
      </Group>
      <Group title="Columns" info="Click a column here or its header in the sheet to edit it; drag one, here or by its header, to move it. Right-click a header to set what it is plotted as, or to insert, delete and sort.">
        {sheet.columns.map((c, i) => (
          <div key={c.id} className="list-item" {...reorderRow(`columns:${sheetId}`, c.id, (from, to) => st().moveColumn(sheetId, from, to))} title="Show this column's name, units, formula and statistics" onClick={() => st().setSelection({ kind: "column", sheetId, colId: c.id })}>
            <span className="mono" style={{ width: 18, flex: "none", color: "var(--text-2)" }}>
              {columnLetter(i)}
            </span>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {c.longName || <span className="hint">no name</span>}
              {c.units ? <span className="hint"> ({c.units})</span> : null}
            </span>
            <span className="hint" style={{ flex: "none" }}>
              {c.formula ? "ƒ · " : ""}
              {DESIGNATION_SHORT[c.designation]}
            </span>
          </div>
        ))}
      </Group>
      <Group title="Plotted in">
        {used.map((g) => (
          <div key={g.id} className="list-item" title="Open this graph" onClick={() => st().openTab({ kind: "graph", id: g.id })}>
            <Icon name="chart" size={13} /> <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</span>
          </div>
        ))}
        {used.length === 0 && <div className="note">No graph uses this sheet yet.</div>}
        <button className="btn small" style={{ marginTop: 6 }} title="Choose columns and make a graph of them" onClick={() => useDialogs.getState().setPlotDialog({ sheetId })}>
          <Icon name="plus" size={12} /> Plot columns…
        </button>
      </Group>
    </div>
  );
}

function ColumnInspector({ sheetId, colId }: { sheetId: string; colId: string }) {
  const sheet = useStore((s) => s.project.sheets.find((x) => x.id === sheetId));
  const idx = sheet?.columns.findIndex((c) => c.id === colId) ?? -1;
  const col = sheet?.columns[idx];
  if (!sheet || !col) return <SheetInspector sheetId={sheetId} />;
  const update = (patch: Partial<Column>) => useStore.getState().updateColumn(sheetId, colId, patch);
  const n = col.values.filter((v) => v !== null).length;
  return (
    <InspectorPanel kind="column" defaultOpen="Properties">
      <div className="head">
        <Icon name="table" size={14} /> Column {columnLetter(idx)}
      </div>
      <Group title="Properties">
        <Row label="Long name">
          <TextField value={col.longName} onCommit={(longName) => update({ longName })} placeholder="e.g. Time" />
        </Row>
        <Row label="Units">
          <TextField value={col.units} onCommit={(units) => update({ units })} placeholder="e.g. s" />
        </Row>
        <Row label="Plot as">
          <SelectField<Designation>
            value={col.designation}
            options={[
              { value: "X", label: "X" },
              { value: "Y", label: "Y" },
              { value: "yErr", label: "Y error" },
              { value: "xErr", label: "X error" },
              { value: "label", label: "Label" },
              { value: "none", label: "None" },
            ]}
            onChange={(designation) => update({ designation })}
          />
        </Row>
      </Group>
      <Group title="Formula" info="Use column letters (A, B…) or long names. Aggregates: mean, sum, min, max, std, median, count. Row index: i, row count: n.">
        <TextField value={col.formula ?? ""} onCommit={(formula) => update({ formula })} mono multiline placeholder="e.g. B*2 or (A-mean(A))/std(A)" />
        {col.formulaError && <div style={{ color: "var(--danger)", fontSize: 11, marginTop: 4 }}>{col.formulaError}</div>}
      </Group>
      <Group title="Statistics">
        <ColumnStats values={col.values} n={n} />
      </Group>
    </InspectorPanel>
  );
}

function ColumnStats({ values, n }: { values: (number | string | null)[]; n: number }) {
  const nums = values.filter((v): v is number => typeof v === "number");
  if (!nums.length) return <div className="note">{n} non-empty cells, no numeric data</div>;
  const sum = nums.reduce((a, b) => a + b, 0);
  const mean = sum / nums.length;
  const sd = nums.length > 1 ? Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / (nums.length - 1)) : NaN;
  const f = (x: number) => (Number.isFinite(x) ? Number(x.toPrecision(6)).toString() : "–");
  const items: [string, string][] = [
    ["N", String(nums.length)],
    ["Mean", f(mean)],
    ["SD", f(sd)],
    ["Min", f(nums.reduce((a, b) => (b < a ? b : a), Infinity))],
    ["Max", f(nums.reduce((a, b) => (b > a ? b : a), -Infinity))],
    ["Sum", f(sum)],
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 10px", fontVariantNumeric: "tabular-nums" }}>
      {items.map(([k, v]) => (
        <span key={k} style={{ display: "contents" }}>
          <span style={{ color: "var(--text-2)" }}>{k}</span>
          <span>{v}</span>
        </span>
      ))}
    </div>
  );
}
