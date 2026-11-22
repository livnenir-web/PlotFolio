import { useMemo, useState } from "react";
import { Dialog } from "../ui/Dialog";
import { Row, SelectField, Segmented } from "../ui/Fields";
import { useDialogs } from "../app/dialogs";
import { useStore } from "../model/store";
import { columnLetter } from "../model/defaults";
import { sheetSelectionRef, DESIGNATION_LABEL } from "./SheetView";
import type { PlotSource } from "../model/types";
import { isMatrixType } from "../graph/inspector/PlotSourceFields";
import { defaultMatrixSource } from "../graph/matrix";
import { PLOT_KINDS, PLOT_KIND_GROUPS, plotKind } from "../graph/plotKinds";
import { PlotKindIcon } from "./PlotKindIcon";
import { previewGraph } from "./plotPreview";
import { layoutGraph } from "../graph/layout";
import { GraphSvg } from "../graph/render/GraphSvg";

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
  const [kindId, setKindId] = useState("scatter");
  const kind = plotKind(kindId);
  const type = kind.type;
  const project = useStore((s) => s.project);
  const [target, setTarget] = useState<string>(activeTab?.kind === "graph" ? activeTab.id : "new");
  const targetGraph = graphs.find((g) => g.id === target);
  const [layerId, setLayerId] = useState<string>("new");

  // the figure these choices would give, drawn from the real columns (never added to the project)
  const preview = useMemo(() => {
    if (!sheet) return null;
    try {
      const g = previewGraph(project, sheet, { kind, yIds, xId: xId || null, zId: zId || null, matrixMode: layoutMode });
      return g ? layoutGraph(project, g) : null;
    } catch {
      return null;
    }
  }, [project, sheet, kind, yIds, xId, zId, layoutMode]);

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
      useStore.getState().addPlot(graphId, lid, type, src, undefined, kind.apply);
    } else st.plotColumns(sheetId, yIds, noXy ? null : xId || null, t, type, kind.apply);
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
      width={840}
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
      <div className="plot-dialog">
      <div className="plot-gallery">
        {PLOT_KIND_GROUPS.map((group) => (
          <div key={group}>
            <div className="gallery-label">{group}</div>
            <div className="gallery-tiles">
              {PLOT_KINDS.filter((k) => k.group === group).map((k) => (
                <button
                  key={k.id}
                  type="button"
                  className={"gallery-tile" + (k.id === kindId ? " on" : "")}
                  title={k.hint}
                  aria-pressed={k.id === kindId}
                  onClick={() => {
                    setKindId(k.id);
                    // kinds with a single Y column keep the first ticked one
                    if ((k.type === "scatter3d" || isMatrixType(k.type)) && yIds.length > 1) setYIds(yIds.slice(0, 1));
                  }}
                  onDoubleClick={() => ready && doPlot()}
                >
                  <PlotKindIcon id={k.id} />
                  <span>{k.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="note" style={{ marginTop: 10 }}>{kind.hint}</div>
      </div>
      <div className="plot-side">
      <div className="plot-preview" aria-label="Preview">
        {preview ? <GraphSvg layout={preview} background widthCss="100%" heightCss="100%" /> : <span className="note">{ready ? "No preview for these columns" : "Choose the columns to see a preview"}</span>}
      </div>
      {matrix && (
        <Row label="Data layout" title="Column block: the Y columns of the sheet form the Z grid — each column is one X position (numeric column names give the X values), each row one Y position, and an X column gives the Y values of the rows. Adjustable in the plot inspector.">
          <Segmented value={layoutMode} options={[{ value: "block", label: "Column block (Z grid)" }, { value: "xyz", label: "X, Y, Z columns" }]} onChange={setLayoutMode} />
        </Row>
      )}
      {(!matrix || xyz) && !noXy && (
        <Row label="X column">
          <SelectField value={xId} options={[{ value: "", label: "Row index" }, ...colOpts]} onChange={setXId} />
        </Row>
      )}
      {(!matrix || xyz) && (
        <Row label={noXy ? "Data columns" : needsZ ? "Y column" : "Y columns"}>
          <div style={{ border: "1px solid var(--border)", borderRadius: 3, padding: 4, maxHeight: 132, overflow: "auto", width: "100%" }}>
            {sheet.columns.map((c, i) => (
              <label key={c.id} className="check" style={{ padding: "2px 4px" }}>
                <input
                  type={needsZ ? "radio" : "checkbox"}
                  name="ycol"
                  checked={yIds.includes(c.id)}
                  onChange={(e) => setYIds(needsZ ? [c.id] : e.target.checked ? [...yIds, c.id] : yIds.filter((id) => id !== c.id))}
                />
                <span>{colLabel(i)}</span>
                {c.designation === "yErr" && (
                  <span className="hint" title="Used automatically as the error of the column before it">
                    error
                  </span>
                )}
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
          <SelectField value={layerId} options={[{ value: "new", label: "New layer (below the existing ones)" }, ...targetGraph.layers.map((l) => ({ value: l.id, label: `Add to ${l.name}${l.hidden ? " (hidden)" : ""}` }))]} onChange={setLayerId} />
        </Row>
      )}
      </div>
      </div>
    </Dialog>
  );
}
