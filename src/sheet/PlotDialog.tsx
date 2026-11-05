import { useMemo, useState } from "react";
import { Dialog } from "../ui/Dialog";
import { Row, SelectField, Segmented } from "../ui/Fields";
import { useDialogs } from "../app/dialogs";
import { useStore } from "../model/store";
import { columnLetter } from "../model/defaults";
import { sheetSelectionRef, DESIGNATION_LABEL } from "./SheetView";
import type { PlotSource, PlotType } from "../model/types";
import { PLOT_TYPE_OPTIONS, isMatrixType } from "../graph/inspector/PlotSourceFields";
import { defaultMatrixSource } from "../graph/matrix";

export function PlotDialog({ sheetId }: { sheetId: string }) {
  const close = () => useDialogs.getState().setPlotDialog(null);
  const sheet = useStore((s) => s.project.sheets.find((x) => x.id === sheetId));
  const graphs = useStore((s) => s.project.graphs);
  const activeTab = useStore((s) => s.ui.activeTab);

  const initialY = useMemo(() => {
    if (!sheet) return [];
    const sel = sheetSelectionRef.sheetId === sheetId ? sheetSelectionRef.cols : [];
    const fromSel = sel.filter((i) => sheet.columns[i] && sheet.columns[i].designation !== "X" && sheet.columns[i].designation !== "yErr" && sheet.columns[i].designation !== "xErr" && sheet.columns[i].designation !== "label");
    if (fromSel.length) return fromSel.map((i) => sheet.columns[i].id);
    return sheet.columns.filter((c) => c.designation === "Y").map((c) => c.id);
  }, [sheet, sheetId]);

  const initialX = useMemo(() => {
    if (!sheet) return "";
    const sel = sheetSelectionRef.sheetId === sheetId ? sheetSelectionRef.cols : [];
    const firstY = sel.length ? Math.min(...sel) : sheet.columns.length;
    for (let i = firstY; i >= 0; i--) if (sheet.columns[i]?.designation === "X" || sheet.columns[i]?.designation === "label") return sheet.columns[i].id;
    return sheet.columns.find((c) => c.designation === "X")?.id ?? "";
  }, [sheet, sheetId]);

  const [yIds, setYIds] = useState<string[]>(initialY);
  const [xId, setXId] = useState<string>(initialX);
  const [zId, setZId] = useState<string>("");
  const [layoutMode, setLayoutMode] = useState<"block" | "xyz">("block");
  const [type, setType] = useState<PlotType>("scatter");
  const [target, setTarget] = useState<string>(activeTab?.kind === "graph" ? activeTab.id : "new");
  const targetGraph = graphs.find((g) => g.id === target);
  const [layerId, setLayerId] = useState<string>("new");

  if (!sheet) return null;
  const matrix = isMatrixType(type);
  const xyz = matrix && layoutMode === "xyz";
  const needsZ = xyz || type === "scatter3d";
  const noXy = type === "histogram" || type === "box";
  const ready = matrix && !xyz ? true : needsZ ? yIds.length === 1 && !!zId : yIds.length > 0;

  const doPlot = () => {
    if (!ready) return;
    const st = useStore.getState();
    const t = target === "new" ? null : { graphId: target, layerId: layerId || "new" };
    if (matrix || type === "scatter3d") {
      const graphId = t?.graphId ?? st.addGraph();
      const lid = t?.layerId ?? st.project.graphs.find((g) => g.id === graphId)?.layers[0].id ?? "new";
      const src: PlotSource = { sheetId, xColId: xId || null, yColId: yIds[0] ?? "", zColId: zId || null };
      if (matrix) src.matrix = { ...defaultMatrixSource(sheet), mode: layoutMode, zColId: zId || null };
      useStore.getState().addPlot(graphId, lid, type, src);
    } else st.plotColumns(sheetId, yIds, noXy ? null : xId || null, t, type);
    close();
  };

  const colLabel = (i: number) => {
    const c = sheet.columns[i];
    const d = DESIGNATION_LABEL[c.designation];
    return `${columnLetter(i)}${d ? ` (${d})` : ""}${c.longName ? ` — ${c.longName}` : ""}`;
  };
  const colOpts = sheet.columns.map((c, i) => ({ value: c.id, label: colLabel(i) }));

  return (
    <Dialog
      title="Plot columns"
      onClose={close}
      width={540}
      actions={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" onClick={doPlot} disabled={!ready}>
            Plot
          </button>
        </>
      }
    >
      <Row label="Plot type">
        <SelectField value={type} options={PLOT_TYPE_OPTIONS} onChange={setType} />
      </Row>
      {matrix && (
        <Row label="Data layout">
          <Segmented value={layoutMode} options={[{ value: "block", label: "Column block (Z grid)" }, { value: "xyz", label: "X, Y, Z columns" }]} onChange={setLayoutMode} />
        </Row>
      )}
      {matrix && !xyz && <div className="hint">The Y columns of this sheet form the Z grid: each column is one X position (numeric column names give the X values), each row one Y position; an X column gives the row Y values. Adjustable in the plot inspector.</div>}
      {(!matrix || xyz) && !noXy && (
        <Row label="X column">
          <SelectField value={xId} options={[{ value: "", label: "Row index" }, ...colOpts]} onChange={setXId} />
        </Row>
      )}
      {(!matrix || xyz) && (
        <Row label={noXy ? "Data columns" : needsZ ? "Y column" : "Y columns"}>
          <div style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 4, maxHeight: 180, overflow: "auto", width: "100%" }}>
            {sheet.columns.map((c, i) => (
              <label key={c.id} className="check" style={{ padding: "2px 4px" }}>
                <input
                  type={needsZ ? "radio" : "checkbox"}
                  name="ycol"
                  checked={yIds.includes(c.id)}
                  onChange={(e) => setYIds(needsZ ? [c.id] : e.target.checked ? [...yIds, c.id] : yIds.filter((id) => id !== c.id))}
                />
                <span>{colLabel(i)}</span>
                {c.designation === "yErr" && <span className="hint">(used automatically as error of the column before it)</span>}
              </label>
            ))}
          </div>
        </Row>
      )}
      {needsZ && (
        <Row label="Z column">
          <SelectField value={zId} options={[{ value: "", label: "Choose…" }, ...colOpts]} onChange={setZId} />
        </Row>
      )}
      <Row label="Target">
        <SelectField
          value={target}
          options={[{ value: "new", label: "New graph" }, ...graphs.map((g) => ({ value: g.id, label: g.name }))]}
          onChange={(v) => {
            setTarget(v);
            setLayerId("new");
          }}
        />
      </Row>
      {targetGraph && (
        <Row label="Layer">
          <SelectField value={layerId} options={[{ value: "new", label: "New layer (below the existing ones)" }, ...targetGraph.layers.map((l) => ({ value: l.id, label: `Add to ${l.name}` }))]} onChange={setLayerId} />
        </Row>
      )}
      {type === "bar" && <div className="hint">Each Y column becomes a bar series; a text or X column gives the category labels. Grouping, stacking and direction are in the plot inspector.</div>}
      {type === "box" && <div className="hint">One box per selected column.</div>}
    </Dialog>
  );
}
