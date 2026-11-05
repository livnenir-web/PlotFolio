import { useState } from "react";
import { Dialog } from "../ui/Dialog";
import { CheckField, NumberField, Row, Segmented } from "../ui/Fields";
import { useDialogs } from "../app/dialogs";
import { useStore } from "../model/store";
import { exportGraphAs, rasterSize } from "./exportGraph";
import { layoutGraph } from "../graph/layout";

export function ExportDialog({ graphId }: { graphId: string }) {
  const close = () => useDialogs.getState().setExportDialog(null);
  const project = useStore((s) => s.project);
  const graph = project.graphs.find((g) => g.id === graphId);
  const d = project.defaults;
  const [format, setFormat] = useState<"png" | "jpeg" | "svg">(d.exportFormat);
  const [dpi, setDpi] = useState(d.exportDpi);
  const [quality, setQuality] = useState(d.jpegQuality);
  const [transparent, setTransparent] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!graph) return null;
  const layout = layoutGraph(project, graph);
  const px = rasterSize(project, graph, dpi);

  const run = async (target: "file" | "clipboard") => {
    setBusy(true);
    try {
      useStore.getState().updateGraph(graphId, () => {});
      useStore.setState((s) => ({ project: { ...s.project, defaults: { ...s.project.defaults, exportFormat: format, exportDpi: dpi, jpegQuality: quality } } }));
      if (target === "clipboard") await exportGraphAs(graphId, format === "svg" ? "clipboard-svg" : "clipboard-png", { dpi, transparent, jpegQuality: quality });
      else await exportGraphAs(graphId, format, { dpi, transparent, jpegQuality: quality });
    } finally {
      setBusy(false);
      close();
    }
  };

  return (
    <Dialog
      title={`Export ${graph.name}`}
      onClose={close}
      width={460}
      actions={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn" disabled={busy} onClick={() => void run("clipboard")}>
            Copy to clipboard
          </button>
          <button className="btn primary" disabled={busy} onClick={() => void run("file")}>
            Save…
          </button>
        </>
      }
    >
      <Row label="Format">
        <Segmented
          value={format}
          options={[
            { value: "png", label: "PNG" },
            { value: "jpeg", label: "JPEG" },
            { value: "svg", label: "SVG" },
          ]}
          onChange={setFormat}
        />
      </Row>
      <Row label="Size">
        <span>
          {layout.widthMm} × {layout.heightMm} mm
          {format !== "svg" && (
            <span className="hint">
              {" "}
              → {px.width} × {px.height} px
            </span>
          )}
        </span>
      </Row>
      {format !== "svg" && (
        <Row label="Resolution">
          <NumberField value={dpi} step={50} min={36} max={2400} onCommit={setDpi} style={{ width: 70 }} />
          <span className="hint">dpi</span>
          {[150, 300, 600].map((v) => (
            <button key={v} className="btn small" onClick={() => setDpi(v)}>
              {v}
            </button>
          ))}
        </Row>
      )}
      {format === "jpeg" && (
        <Row label="Quality">
          <input type="range" min={0.5} max={1} step={0.01} value={quality} onChange={(e) => setQuality(Number(e.target.value))} style={{ flex: 1 }} />
          <span className="hint" style={{ width: 36 }}>
            {Math.round(quality * 100)}%
          </span>
        </Row>
      )}
      {format === "png" && (
        <Row label="">
          <CheckField label="Transparent background" checked={transparent} onChange={setTransparent} />
        </Row>
      )}
      <div className="hint" style={{ marginTop: 8 }}>
        {format === "svg"
          ? "SVG is exported at the physical canvas size with no background. Axes, ticks, labels and each dataset are grouped so they stay editable in Illustrator or Inkscape."
          : "Raster exports render the canvas at the chosen resolution. Fonts are the installed ones (Arial by default)."}
      </div>
    </Dialog>
  );
}
