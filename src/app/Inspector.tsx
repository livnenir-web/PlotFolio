import { memo } from "react";
import { useStore } from "../model/store";
import { columnLetter } from "../model/defaults";
import type { Column, Designation } from "../model/types";
import { Group, InspectorPanel, Row, SelectField, TextField } from "../ui/Fields";
import { Icon } from "../ui/Icon";
import { GraphInspector } from "../graph/inspector/GraphInspector";

export const Inspector = memo(function Inspector() {
  const activeTab = useStore((s) => s.ui.activeTab);
  const selection = useStore((s) => s.ui.selection);

  if (activeTab?.kind === "graph") return <GraphInspector graphId={activeTab.id} />;
  if (activeTab?.kind === "sheet") {
    if (selection.kind === "column" && selection.sheetId === activeTab.id) return <ColumnInspector sheetId={selection.sheetId} colId={selection.colId} />;
    return <SheetInspector sheetId={activeTab.id} />;
  }
  return (
    <div className="inspector">
      <div className="empty">Select a sheet or graph</div>
    </div>
  );
});

function SheetInspector({ sheetId }: { sheetId: string }) {
  const sheet = useStore((s) => s.project.sheets.find((x) => x.id === sheetId));
  if (!sheet) return null;
  return (
    <InspectorPanel kind="sheet" defaultOpen="">
      <div className="head">
        <Icon name="table" size={14} /> {sheet.name}
      </div>
      <Group>
        <Row label="Name">
          <TextField value={sheet.name} onCommit={(v) => v.trim() && useStore.getState().renameSheet(sheetId, v.trim())} />
        </Row>
        <div className="hint">Click a column header to edit its properties. Right-click a header for designations, insert, delete and sort.</div>
      </Group>
    </InspectorPanel>
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
      <Group title="Formula">
        <TextField value={col.formula ?? ""} onCommit={(formula) => update({ formula })} mono multiline placeholder="e.g. B*2 or (A-mean(A))/std(A)" />
        {col.formulaError && <div style={{ color: "var(--danger)", fontSize: 11, marginTop: 4 }}>{col.formulaError}</div>}
        <div className="hint">
          Use column letters (A, B…) or long names. Aggregates: mean, sum, min, max, std, median, count. Row index: i, row count: n.
        </div>
      </Group>
      <Group title="Statistics">
        <ColumnStats values={col.values} n={n} />
      </Group>
    </InspectorPanel>
  );
}

function ColumnStats({ values, n }: { values: (number | string | null)[]; n: number }) {
  const nums = values.filter((v): v is number => typeof v === "number");
  if (!nums.length) return <div className="hint">{n} non-empty cells, no numeric data</div>;
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
