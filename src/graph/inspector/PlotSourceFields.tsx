import { useState } from "react";
import { useStore } from "../../model/store";
import type { PlotSource, PlotType } from "../../model/types";
import { columnLetter } from "../../model/defaults";
import { Row, SelectField, Segmented } from "../../ui/Fields";
import { DESIGNATION_LABEL } from "../../sheet/SheetView";
import { defaultMatrixSource } from "../matrix";

function colOptions(sheetId: string): { value: string; label: string }[] {
  const sheet = useStore.getState().project.sheets.find((s) => s.id === sheetId);
  if (!sheet) return [];
  return sheet.columns.map((c, i) => {
    const d = DESIGNATION_LABEL[c.designation];
    return { value: c.id, label: `${columnLetter(i)}${d ? ` (${d})` : ""}${c.longName ? ` — ${c.longName}` : ""}` };
  });
}

export const PLOT_TYPE_OPTIONS: { value: PlotType; label: string }[] = [
  { value: "scatter", label: "Symbol" },
  { value: "line", label: "Line" },
  { value: "lineScatter", label: "Line + symbol" },
  { value: "histogram", label: "Histogram" },
  { value: "bar", label: "Bar / column" },
  { value: "box", label: "Box plot" },
  { value: "heatmap", label: "Heatmap" },
  { value: "contour", label: "Contour" },
  { value: "surface3d", label: "3D surface" },
  { value: "scatter3d", label: "3D scatter" },
];

export const isMatrixType = (t: PlotType) => t === "heatmap" || t === "contour" || t === "surface3d";

/** Sheet / X / Y / Z / error pickers shared by the "Add plot" block and the plot source editor. */
export function PlotSourceFields({
  source,
  onChange,
  showType,
  type,
  onType,
}: {
  source: PlotSource;
  onChange: (s: PlotSource) => void;
  showType?: boolean;
  type?: PlotType;
  onType?: (t: PlotType) => void;
}) {
  const sheets = useStore((s) => s.project.sheets);
  const cols = colOptions(source.sheetId);
  const none = { value: "", label: "None" };
  const t = type ?? "scatter";
  const isHist = t === "histogram" || t === "box";
  const matrix = isMatrixType(t);
  const xyz = matrix && source.matrix?.mode === "xyz";
  return (
    <>
      <Row label="Sheet">
        <SelectField
          value={source.sheetId}
          options={sheets.map((s) => ({ value: s.id, label: s.name }))}
          onChange={(sheetId) => {
            const sh = sheets.find((s) => s.id === sheetId);
            const x = sh?.columns.find((c) => c.designation === "X");
            const y = sh?.columns.find((c) => c.designation === "Y") ?? sh?.columns[1] ?? sh?.columns[0];
            onChange({ sheetId, xColId: x?.id ?? null, yColId: y?.id ?? "", yErrColId: null, xErrColId: null, zColId: null, matrix: sh && matrix ? { ...defaultMatrixSource(sh), mode: source.matrix?.mode ?? "block" } : undefined });
          }}
        />
      </Row>
      {showType && onType && (
        <Row label="Type">
          <SelectField value={t} options={PLOT_TYPE_OPTIONS} onChange={(v) => onType(v)} />
        </Row>
      )}
      {matrix && (
        <Row label="Layout">
          <Segmented
            value={xyz ? "xyz" : "block"}
            options={[
              { value: "block", label: "Column block" },
              { value: "xyz", label: "X, Y, Z columns" },
            ]}
            onChange={(v) => {
              const sh = sheets.find((s) => s.id === source.sheetId);
              onChange({ ...source, matrix: { ...(source.matrix ?? (sh ? defaultMatrixSource(sh) : { mode: "block" })), mode: v as "block" | "xyz" } });
            }}
          />
        </Row>
      )}
      {matrix && !xyz && <div className="hint">All Y columns of the sheet form the Z grid (rows = Y, columns = X). Adjust the block in the plot's inspector afterwards.</div>}
      {(!matrix || xyz) && !isHist && (
        <Row label="X">
          <SelectField value={source.xColId ?? ""} options={[{ value: "", label: "Row index" }, ...cols]} onChange={(v) => onChange({ ...source, xColId: v || null })} />
        </Row>
      )}
      {(!matrix || xyz) && (
        <Row label={isHist ? "Data" : "Y"}>
          <SelectField value={source.yColId} options={cols.length ? cols : [{ value: "", label: "(no columns)" }]} onChange={(v) => onChange({ ...source, yColId: v })} />
        </Row>
      )}
      {(xyz || t === "scatter3d") && (
        <Row label="Z">
          <SelectField value={source.zColId ?? ""} options={[none, ...cols]} onChange={(v) => onChange({ ...source, zColId: v || null })} />
        </Row>
      )}
      {!matrix && !isHist && t !== "scatter3d" && (
        <>
          <Row label="Y error">
            <SelectField value={source.yErrColId ?? ""} options={[none, ...cols]} onChange={(v) => onChange({ ...source, yErrColId: v || null })} />
          </Row>
          {t !== "bar" && (
            <Row label="X error">
              <SelectField value={source.xErrColId ?? ""} options={[none, ...cols]} onChange={(v) => onChange({ ...source, xErrColId: v || null })} />
            </Row>
          )}
        </>
      )}
    </>
  );
}

/** "Add plot" block for a layer: pick the vectors and add. */
export function AddPlotBlock({ graphId, layerId }: { graphId: string; layerId: string }) {
  const sheets = useStore((s) => s.project.sheets);
  const layer = useStore((s) => s.project.graphs.find((g) => g.id === graphId)?.layers.find((l) => l.id === layerId));
  const layerSheetId = layer?.plots[0]?.source.sheetId;
  const first = sheets.find((s) => s.id === layerSheetId) ?? sheets.find((s) => s.columns.some((c) => c.values.length > 0)) ?? sheets[0];
  const [source, setSource] = useState<PlotSource>(() => ({
    sheetId: first?.id ?? "",
    xColId: first?.columns.find((c) => c.designation === "X")?.id ?? null,
    yColId: first?.columns.find((c) => c.designation === "Y")?.id ?? first?.columns[1]?.id ?? "",
    yErrColId: null,
    xErrColId: null,
    zColId: null,
  }));
  const [type, setType] = useState<PlotType>(() => (layer?.view3d ? "scatter3d" : "scatter"));
  if (!first) return <div className="hint">No sheets with data yet. Import or type data first.</div>;
  const matrix = isMatrixType(type);
  const ready = matrix ? (source.matrix?.mode === "xyz" ? !!source.yColId && !!source.zColId : true) : type === "scatter3d" ? !!source.yColId && !!source.zColId : !!source.yColId;
  const add = () => {
    if (!ready) return;
    const st = useStore.getState();
    const src: PlotSource = { ...source };
    if (matrix) {
      const sh = sheets.find((s) => s.id === src.sheetId)!;
      src.matrix = { ...defaultMatrixSource(sh), ...(src.matrix ?? {}), zColId: src.zColId ?? null };
    }
    const id = st.addPlot(graphId, layerId, type, src);
    st.setSelection({ kind: "plot", graphId, layerId, plotId: id });
  };
  return (
    <>
      <PlotSourceFields source={source} onChange={setSource} showType type={type} onType={setType} />
      {layer?.view3d && !(type === "surface3d" || type === "scatter3d") && <div className="hint">This is a 3D layer: choose a 3D surface or 3D scatter.</div>}
      <Row label="">
        <button className="btn small primary" disabled={!ready} onClick={add}>
          Add plot
        </button>
      </Row>
    </>
  );
}
