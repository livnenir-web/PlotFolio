import { useStore } from "../../model/store";
import { defaultBar, defaultBox, defaultColormap, defaultContour, defaultSurface, columnLetter } from "../../model/defaults";
import type { Graph, HeatmapInterpolation, Layer, MatrixSource, Plot, BarPattern, Sheet } from "../../model/types";
import { CheckField, ColorField, FontFields, Group, NumberField, Row, Segmented, SelectField, TextField } from "../../ui/Fields";
import { COLORMAP_NAMES, DEFAULT_CUSTOM_STOPS } from "../colormaps";
import { Icon } from "../../ui/Icon";
import { defaultMatrixSource } from "../matrix";

type Upd = (fn: (p: Plot) => void) => void;

export function ColormapFields({ plot, upd }: { plot: Plot; upd: Upd }) {
  const cm = plot.colormap ?? defaultColormap();
  const u = (fn: (c: NonNullable<Plot["colormap"]>) => void) =>
    upd((p) => {
      if (!p.colormap) p.colormap = defaultColormap();
      fn(p.colormap);
    });
  return (
    <Group title="Colormap">
      <Row label="Map">
        <SelectField value={cm.name} options={COLORMAP_NAMES} onChange={(v) => u((c) => void (c.name = v))} />
        <CheckField label="Reverse" checked={cm.reverse} onChange={(v) => u((c) => void (c.reverse = v))} />
      </Row>
      <Row label="Range">
        <NumberField value={cm.min} placeholder="auto" onCommit={(v) => u((c) => void (c.min = v))} />
        <NumberField value={cm.max} placeholder="auto" onCommit={(v) => u((c) => void (c.max = v))} />
        <button className="btn small" onClick={() => u((c) => void (c.min = c.max = null))} title="Back to automatic range">
          Auto
        </button>
      </Row>
      {cm.name === "custom" && (
        <>
          {(cm.custom?.length ? cm.custom : DEFAULT_CUSTOM_STOPS).map((stop, i, arr) => (
            <Row key={i} label={i === 0 ? "Stops" : ""}>
              <NumberField value={Number((stop.t * 100).toFixed(1))} min={0} max={100} step={5} style={{ width: 56 }} onCommit={(v) => u((c) => void ((c.custom = (c.custom?.length ? c.custom : DEFAULT_CUSTOM_STOPS.map((s) => ({ ...s })))).splice(i, 1, { ...arr[i], t: Math.min(1, Math.max(0, v / 100)) })))} />
              <span className="hint">%</span>
              <ColorField value={stop.color} onChange={(v) => u((c) => void ((c.custom = (c.custom?.length ? c.custom : DEFAULT_CUSTOM_STOPS.map((s) => ({ ...s })))).splice(i, 1, { ...arr[i], color: v })))} />
              <button className="icon-btn tiny" title="Remove this stop" disabled={arr.length <= 2} onClick={() => u((c) => void (c.custom = arr.filter((_, k) => k !== i)))}>
                <Icon name="close" size={12} />
              </button>
            </Row>
          ))}
          <Row label="">
            <button className="btn small" onClick={() => u((c) => void (c.custom = [...(c.custom?.length ? c.custom : DEFAULT_CUSTOM_STOPS), { t: 0.5, color: "#e69f00" }]))}>
              Add stop
            </button>
            <span className="hint">position (% of the range) and colour; interpolated in RGB</span>
          </Row>
        </>
      )}
      <Row label="Levels" title="Split the range into this many discrete colour bands (0 = continuous)">
        <NumberField value={cm.discrete ?? 0} step={1} min={0} max={64} onCommit={(v) => u((c) => void (c.discrete = v >= 2 ? Math.round(v) : 0))} style={{ width: 56 }} />
        <span className="hint">{cm.discrete && cm.discrete >= 2 ? "bands, labelled at their boundaries" : "continuous"}</span>
      </Row>
      <Row label="">
        <CheckField label="Logarithmic" checked={cm.log} onChange={(v) => u((c) => void (c.log = v))} />
      </Row>
      {plot.type === "heatmap" && (
        <Row label="Smoothing" title="How the colour varies between matrix points">
          <SelectField<HeatmapInterpolation>
            value={cm.interpolation ?? "none"}
            options={[
              { value: "none", label: "None (flat cells)" },
              { value: "bilinear", label: "Bilinear" },
              { value: "bicubic", label: "Bicubic" },
            ]}
            onChange={(v) => u((c) => void (c.interpolation = v))}
          />
        </Row>
      )}
    </Group>
  );
}

export function ContourFields({ plot, upd }: { plot: Plot; upd: Upd }) {
  const c = plot.contour ?? defaultContour();
  const u = (fn: (o: NonNullable<Plot["contour"]>) => void) =>
    upd((p) => {
      if (!p.contour) p.contour = defaultContour();
      fn(p.contour);
    });
  return (
    <Group title="Contours">
      <Row label="Levels">
        <NumberField value={c.levelCount} step={1} min={1} max={100} disabled={!!c.levels} onCommit={(v) => u((o) => void (o.levelCount = Math.round(v)))} style={{ width: 60 }} />
        <span className="hint">evenly spaced</span>
      </Row>
      <Row label="Custom levels">
        <TextField
          value={c.levels ? c.levels.join(", ") : ""}
          placeholder="e.g. 0.1, 0.5, 1 (empty = automatic)"
          mono
          onCommit={(v) => {
            const arr = v.split(/[\s,;]+/).map(Number).filter(Number.isFinite);
            u((o) => void (o.levels = arr.length ? arr : null));
          }}
        />
      </Row>
      <Row label="">
        <CheckField label="Filled bands" checked={c.filled} onChange={(v) => u((o) => void (o.filled = v))} />
        <CheckField label="Lines" checked={c.showLines} onChange={(v) => u((o) => void (o.showLines = v))} />
      </Row>
      <Row label="">
        <CheckField label="Labels on lines" checked={c.showLabels} onChange={(v) => u((o) => void (o.showLabels = v))} />
      </Row>
      <Row label="Line color">
        <CheckField label="From colormap" checked={c.lineColor === null} onChange={(v) => u((o) => void (o.lineColor = v ? null : "#000000"))} />
        {c.lineColor !== null && <ColorField value={c.lineColor} onChange={(v) => u((o) => void (o.lineColor = v))} />}
      </Row>
    </Group>
  );
}

export function BarFields({ plot, upd, updAllBars, sheet }: { plot: Plot; upd: Upd; updAllBars: (fn: (o: NonNullable<Plot["bar"]>) => void) => void; sheet?: Sheet }) {
  const b = plot.bar ?? defaultBar();
  const u = (fn: (o: NonNullable<Plot["bar"]>) => void) =>
    upd((p) => {
      if (!p.bar) p.bar = defaultBar();
      fn(p.bar);
    });
  const mode = b.colorMode ?? "plot";
  return (
    <Group title="Bars">
      <Row label="Group width" title="Width of the bar group as a fraction of the category spacing; shared by every bar plot of the layer">
        <input type="range" min={5} max={100} step={5} value={Math.round(b.width * 100)} onChange={(e) => updAllBars((o) => void (o.width = Number(e.target.value) / 100))} style={{ width: 90 }} />
        <NumberField value={Math.round(b.width * 100)} step={5} min={5} max={100} onCommit={(v) => updAllBars((o) => void (o.width = Math.min(100, Math.max(5, v)) / 100))} style={{ width: 52 }} />
        <span className="hint">%</span>
      </Row>
      <Row label="Arrange" title="Shared by every bar plot of the layer">
        <Segmented value={b.stacked ? "stacked" : "grouped"} options={[{ value: "grouped", label: "Grouped" }, { value: "stacked", label: "Stacked" }]} onChange={(v) => updAllBars((o) => void (o.stacked = v === "stacked"))} />
      </Row>
      <Row label="Direction" title="Shared by every bar plot of the layer">
        <Segmented value={b.horizontal ? "h" : "v"} options={[{ value: "v", label: "Vertical" }, { value: "h", label: "Horizontal" }]} onChange={(v) => updAllBars((o) => void (o.horizontal = v === "h"))} />
      </Row>
      <Row label="Bar colours" title="One colour for the plot, a palette colour per category, or colours from a column (set under Colour by column)">
        <SelectField<"plot" | "category" | "column">
          value={mode}
          options={[
            { value: "plot", label: "Plot colour" },
            { value: "category", label: "Per category (palette)" },
            { value: "column", label: "By a column" },
          ]}
          onChange={(v) =>
            upd((p) => {
              if (!p.bar) p.bar = defaultBar();
              p.bar.colorMode = v === "plot" ? undefined : v;
              if (v === "column") {
                p.colorBy = { colId: p.colorBy?.colId ?? null };
                if (!p.colormap) p.colormap = defaultColormap();
              }
            })
          }
        />
      </Row>
      {mode === "column" && sheet && (
        <Row label="Column">
          <SelectField value={plot.colorBy?.colId ?? ""} options={[{ value: "", label: "—" }, ...sheet.columns.map((c, i) => ({ value: c.id, label: c.longName || String.fromCharCode(65 + i) }))]} onChange={(v) => upd((p) => void (p.colorBy = { colId: v || null }))} />
        </Row>
      )}
      <Row label="Pattern" title="Hatching in the bar colour over white, for figures printed in black and white">
        <SelectField<BarPattern>
          value={b.pattern ?? "none"}
          options={[
            { value: "none", label: "Solid" },
            { value: "diagonal", label: "Diagonal ////" },
            { value: "backDiagonal", label: "Diagonal \\\\" },
            { value: "crosshatch", label: "Cross-hatch" },
            { value: "horizontal", label: "Horizontal lines" },
            { value: "vertical", label: "Vertical lines" },
            { value: "dots", label: "Dots" },
          ]}
          onChange={(v) => u((o) => void (o.pattern = v === "none" ? undefined : v))}
        />
      </Row>
      <Row label="Outline">
        <CheckField label="" checked={b.outline} onChange={(v) => u((o) => void (o.outline = v))} />
        <ColorField value={b.outlineColor ?? "#000000"} onChange={(v) => u((o) => void (o.outlineColor = v))} />
        <NumberField value={b.outlineWidthPt ?? 0.5} step={0.25} min={0} onCommit={(v) => u((o) => void (o.outlineWidthPt = v))} style={{ width: 50 }} />
        <span className="hint">pt</span>
      </Row>
      <div className="hint">Group width, arrangement and direction apply to all bar plots of the layer; colours, pattern and outline are per plot.</div>
    </Group>
  );
}

export function BoxFields({ plot, upd }: { plot: Plot; upd: Upd }) {
  const b = plot.box ?? defaultBox();
  const u = (fn: (o: NonNullable<Plot["box"]>) => void) =>
    upd((p) => {
      if (!p.box) p.box = defaultBox();
      fn(p.box);
    });
  return (
    <Group title="Box">
      <Row label="Whiskers">
        <SelectField
          value={b.whisker}
          options={[
            { value: "iqr", label: "1.5 × IQR (Tukey)" },
            { value: "minmax", label: "Min to max" },
            { value: "sd", label: "Mean ± SD" },
          ]}
          onChange={(v) => u((o) => void (o.whisker = v))}
        />
      </Row>
      <Row label="Width">
        <NumberField value={b.width} step={0.05} min={0.05} max={1} onCommit={(v) => u((o) => void (o.width = v))} style={{ width: 60 }} />
      </Row>
      <Row label="">
        <CheckField label="Mean" checked={b.showMean} onChange={(v) => u((o) => void (o.showMean = v))} />
        <CheckField label="Outliers" checked={b.showOutliers} onChange={(v) => u((o) => void (o.showOutliers = v))} />
        <CheckField label="Data points" checked={b.showData} onChange={(v) => u((o) => void (o.showData = v))} />
      </Row>
    </Group>
  );
}

export function SurfaceFields({ plot, upd }: { plot: Plot; upd: Upd }) {
  const s = plot.surface ?? defaultSurface();
  const u = (fn: (o: NonNullable<Plot["surface"]>) => void) =>
    upd((p) => {
      if (!p.surface) p.surface = defaultSurface();
      fn(p.surface);
    });
  return (
    <Group title="Surface">
      <Row label="">
        <CheckField label="Fill" checked={s.fill} onChange={(v) => u((o) => void (o.fill = v))} />
        <CheckField label="Mesh" checked={s.wireframe} onChange={(v) => u((o) => void (o.wireframe = v))} />
        <CheckField label="Shading" checked={s.shading} onChange={(v) => u((o) => void (o.shading = v))} />
      </Row>
      <Row label="Mesh every">
        <NumberField value={s.meshStep} step={1} min={1} onCommit={(v) => u((o) => void (o.meshStep = Math.round(v)))} style={{ width: 60 }} />
        <span className="hint">grid lines</span>
      </Row>
    </Group>
  );
}

/** Matrix source: a block of columns, or X/Y/Z columns. */
export function MatrixSourceFields({ plot, upd }: { plot: Plot; upd: Upd }) {
  const sheets = useStore((s) => s.project.sheets);
  const sheet = sheets.find((s) => s.id === plot.source.sheetId);
  if (!sheet) return null;
  const m: MatrixSource = plot.source.matrix ?? defaultMatrixSource(sheet);
  const u = (fn: (o: MatrixSource) => void) =>
    upd((p) => {
      if (!p.source.matrix) p.source.matrix = defaultMatrixSource(sheet);
      fn(p.source.matrix);
    });
  const cols = sheet.columns.map((c, i) => ({ value: c.id, label: `${columnLetter(i)}${c.longName ? ` — ${c.longName}` : ""}` }));
  const none = { value: "", label: "None" };
  return (
    <Group title="Matrix data">
      <Row label="Sheet">
        <SelectField
          value={plot.source.sheetId}
          options={sheets.map((s) => ({ value: s.id, label: s.name }))}
          onChange={(sheetId) =>
            upd((p) => {
              p.source.sheetId = sheetId;
              const sh = sheets.find((s) => s.id === sheetId);
              if (sh) p.source.matrix = { ...defaultMatrixSource(sh), mode: p.source.matrix?.mode ?? "block" };
            })
          }
        />
      </Row>
      <Row label="Layout">
        <Segmented value={m.mode} options={[{ value: "block", label: "Column block (Z grid)" }, { value: "xyz", label: "X, Y, Z columns" }]} onChange={(v) => u((o) => void (o.mode = v))} />
      </Row>
      {m.mode === "block" ? (
        <>
          <Row label="Z columns">
            <SelectField value={m.firstColId ?? ""} options={cols} onChange={(v) => u((o) => void (o.firstColId = v))} />
            <SelectField value={m.lastColId ?? ""} options={cols} onChange={(v) => u((o) => void (o.lastColId = v))} />
          </Row>
          <Row label="Y of rows">
            <SelectField value={m.yColId ?? ""} options={[{ value: "", label: "Row number" }, ...cols]} onChange={(v) => u((o) => void (o.yColId = v || null))} />
          </Row>
          <Row label="X of columns">
            <CheckField label="From numeric column names" checked={!!m.xFromNames} onChange={(v) => u((o) => void (o.xFromNames = v))} />
          </Row>
          <div className="hint">Each Z column is one X position (its name can be the X value); each row is one Y position.</div>
        </>
      ) : (
        <>
          <Row label="X · Y">
            <SelectField value={plot.source.xColId ?? ""} options={[none, ...cols]} onChange={(v) => upd((p) => void (p.source.xColId = v || null))} />
            <SelectField value={plot.source.yColId} options={cols} onChange={(v) => upd((p) => void (p.source.yColId = v))} />
          </Row>
          <Row label="Z">
            <SelectField value={plot.source.zColId ?? ""} options={[none, ...cols]} onChange={(v) => upd((p) => void (p.source.zColId = v || null))} />
          </Row>
          <Row label="Grid points">
            <NumberField value={m.gridN ?? 50} step={10} min={5} max={200} onCommit={(v) => u((o) => void (o.gridN = Math.round(v)))} style={{ width: 60 }} />
            <span className="hint">when points are scattered</span>
          </Row>
        </>
      )}
    </Group>
  );
}

export function View3DFields({ graph, layer }: { graph: Graph; layer: Layer }) {
  const st = useStore;
  const v = layer.view3d;
  if (!v) return null;
  const u = (fn: (o: NonNullable<Layer["view3d"]>) => void) => st.getState().updateLayer(graph.id, layer.id, (l) => l.view3d && fn(l.view3d));
  return (
    <Group title="3D view">
      <Row label="Azimuth">
        <input type="range" min={-180} max={180} step={1} value={v.azimuth} onChange={(e) => u((o) => void (o.azimuth = Number(e.target.value)))} style={{ flex: 1 }} />
        <NumberField value={v.azimuth} step={5} onCommit={(x) => u((o) => void (o.azimuth = x))} style={{ width: 56 }} />
      </Row>
      <Row label="Elevation">
        <input type="range" min={-89} max={89} step={1} value={v.elevation} onChange={(e) => u((o) => void (o.elevation = Number(e.target.value)))} style={{ flex: 1 }} />
        <NumberField value={v.elevation} step={5} onCommit={(x) => u((o) => void (o.elevation = x))} style={{ width: 56 }} />
      </Row>
      <Row label="Box X·Y·Z">
        <NumberField value={v.boxX} step={0.1} min={0.1} onCommit={(x) => u((o) => void (o.boxX = x))} />
        <NumberField value={v.boxY} step={0.1} min={0.1} onCommit={(x) => u((o) => void (o.boxY = x))} />
        <NumberField value={v.boxZ} step={0.1} min={0.1} onCommit={(x) => u((o) => void (o.boxZ = x))} />
      </Row>
      <Row label="">
        <CheckField label="Panes" checked={v.showPanes} onChange={(x) => u((o) => void (o.showPanes = x))} />
        <CheckField label="Grid" checked={v.showGrid} onChange={(x) => u((o) => void (o.showGrid = x))} />
      </Row>
      <div className="hint">Drag the plot with ⌥ (Option) held to rotate it.</div>
    </Group>
  );
}

export function ColorScaleFields({ graph, layer }: { graph: Graph; layer: Layer }) {
  const st = useStore;
  const cs = layer.colorScale;
  if (!cs) return null;
  const u = (fn: (o: NonNullable<Layer["colorScale"]>) => void) => st.getState().updateLayer(graph.id, layer.id, (l) => l.colorScale && fn(l.colorScale));
  return (
    <>
      <Group title="Color scale">
        <Row label="">
          <CheckField label="Visible" checked={cs.visible} onChange={(v) => u((o) => void (o.visible = v))} />
        </Row>
        <Row label="Title">
          <TextField value={cs.title} onCommit={(v) => u((o) => void (o.title = v))} placeholder="e.g. Intensity (a.u.)" />
        </Row>
        <Row label="Position (mm)" title="Relative to the top-left corner of the data area">
          <NumberField value={cs.xMm} step={0.5} onCommit={(v) => u((o) => void (o.xMm = v))} />
          <NumberField value={cs.yMm} step={0.5} onCommit={(v) => u((o) => void (o.yMm = v))} />
        </Row>
        <Row label="Length · width">
          <NumberField value={cs.lengthMm} step={1} min={5} onCommit={(v) => u((o) => void (o.lengthMm = v))} />
          <NumberField value={cs.widthMm} step={0.5} min={1} onCommit={(v) => u((o) => void (o.widthMm = v))} />
        </Row>
        <FontFields style={cs.style} onChange={(p) => u((o) => void Object.assign(o.style, p))} />
      </Group>
    </>
  );
}
