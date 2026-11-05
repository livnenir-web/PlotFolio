import { useStore } from "../../model/store";
import { defaultColormap, newAxis } from "../../model/defaults";
import type { Axis, BandConnect, DataLabels, Graph, Layer, LineConnect, LineStyle, MarkerShape, NumberFormat, Plot, Selection, TextItem } from "../../model/types";
import { CheckField, ColorField, FontFields, Group, InspectorPanel, NumberField, OpacityField, Row, Segmented, SelectField, TextField } from "../../ui/Fields";
import { Icon } from "../../ui/Icon";
import { layoutGraph, layoutLayer, CANVAS_MARGIN_MM } from "../layout";
import { useMemo, useState } from "react";
import { SYMBOL_LIST } from "../textMarkup";
import { defaultHistogramOptions } from "../data";
import { shapeSmoothing } from "../paths";
import { useDialogs } from "../../app/dialogs";
import { validateFunction } from "../functionPlot";
import { isLogScale } from "../ticks";
import type { CoordMode, Shape } from "../../model/types";

/** mm ⇄ axis-units switch for a positioned object; converts the stored values so the object stays put. */
function CoordModeField({ graph, layer, mode, onSwitch }: { graph: Graph; layer: Layer; mode: CoordMode; onSwitch: (to: CoordMode, ll: ReturnType<typeof layoutLayer>) => void }) {
  const sheets = useStore((s) => s.project.sheets);
  const ll = useMemo(() => layoutLayer(useStore.getState().project, layer), [sheets, layer]);
  void graph;
  return (
    <Row label="Position in" title="Millimetres on the canvas, or values on this layer's axes (the object then follows the axis range)">
      <Segmented
        value={mode}
        options={[
          { value: "mm", label: "mm" },
          { value: "data", label: "Axis units" },
        ]}
        onChange={(v) => v !== mode && onSwitch(v, ll)}
      />
    </Row>
  );
}
import { confirmDialog } from "../../ui/confirm";
import { AddPlotBlock, PlotSourceFields } from "./PlotSourceFields";
import { BreaksEditor } from "./BreaksEditor";
import { formatCustomTicks, parseCustomTicks } from "../customTicks";
import { PALETTES, paletteIdOf } from "../../model/palettes";
import { applyPalette, applyPlotStyle, applyStyleToPlots, copyPlotStyle, forEachTextStyle, pastedPlotStyle, plotStyleOf, textStylesOf } from "../../model/figure";
import { FONT_FAMILIES } from "../../ui/Fields";
import { loadImageSize, pickImageFile } from "../../io/images";
import { BarFields, BoxFields, ColormapFields, ColorScaleFields, ContourFields, MatrixSourceFields, SurfaceFields, View3DFields } from "./PlotTypeFields";

export function GraphInspector({ graphId }: { graphId: string }) {
  const graph = useStore((s) => s.project.graphs.find((g) => g.id === graphId));
  const selection = useStore((s) => s.ui.selection);
  if (!graph) return null;
  const sel = "graphId" in selection && selection.graphId === graphId ? selection : ({ kind: "canvas", graphId } as Selection);
  const layer = "layerId" in sel ? graph.layers.find((l) => l.id === sel.layerId) : undefined;
  if (sel.kind === "axis" && layer) return <AxisInspector graph={graph} layer={layer} which={sel.axis} />;
  if (sel.kind === "plot" && layer) {
    const plot = layer.plots.find((p) => p.id === sel.plotId);
    if (plot) return <PlotInspector key={plot.id} graph={graph} layer={layer} plot={plot} />;
  }
  if (sel.kind === "legend" && layer) return <LegendInspector graph={graph} layer={layer} />;
  if (sel.kind === "colorScale" && layer)
    return (
      <InspectorPanel kind="colorScale" defaultOpen="Color scale">
        <Head icon="legend" title="Color scale" />
        <Breadcrumb graph={graph} layer={layer} />
        <ColorScaleFields graph={graph} layer={layer} />
      </InspectorPanel>
    );
  if (sel.kind === "text" && layer) {
    const t = layer.texts.find((x) => x.id === sel.textId);
    if (t) return <TextInspector key={t.id} graph={graph} layer={layer} text={t} />;
  }
  if (sel.kind === "shape" && layer) {
    const sh = layer.shapes?.find((x) => x.id === sel.shapeId);
    if (sh) return <ShapeInspector key={sh.id} graph={graph} layer={layer} shape={sh} />;
  }
  if (sel.kind === "layer" && layer) return <LayerInspector graph={graph} layer={layer} />;
  return <CanvasInspector graph={graph} />;
}

function Head({ icon, title, children }: { icon: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="head">
      <Icon name={icon} size={14} /> <span style={{ flex: 1 }}>{title}</span>
      {children}
    </div>
  );
}

function Breadcrumb({ graph, layer }: { graph: Graph; layer?: Layer }) {
  const st = useStore;
  return (
    <div className="crumbs">
      <span onClick={() => st.getState().setSelection({ kind: "canvas", graphId: graph.id })}>{graph.name}</span>
      {layer && (
        <>
          <span className="sep">›</span>
          <span onClick={() => st.getState().setSelection({ kind: "layer", graphId: graph.id, layerId: layer.id })}>{layer.name}</span>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- canvas

function CanvasInspector({ graph }: { graph: Graph }) {
  const st = useStore;
  const sheets = useStore((s) => s.project.sheets);
  const update = (fn: (g: Graph) => void) => st.getState().updateGraph(graph.id, fn);
  const layout = useMemo(() => layoutGraph(st.getState().project, graph), [sheets, graph, st]);
  return (
    <InspectorPanel kind="canvas" defaultOpen="Canvas">
      <Head icon="chart" title={graph.name} />
      <Group title="Canvas">
        <Row label="Name">
          <TextField value={graph.name} onCommit={(v) => v.trim() && st.getState().renameGraph(graph.id, v.trim())} />
        </Row>
        <Row label="Width (mm)">
          <NumberField value={graph.canvas.widthMm} min={10} step={1} onCommit={(v) => update((g) => void (g.canvas.widthMm = v))} />
        </Row>
        <Row label="Height (mm)">
          <NumberField value={layout.heightMm} min={10} step={1} disabled={graph.canvas.autoHeight} onCommit={(v) => update((g) => void (g.canvas.heightMm = v))} />
        </Row>
        <Row label="">
          <CheckField label="Auto height (fit content)" checked={graph.canvas.autoHeight} onChange={(v) => update((g) => void (g.canvas.autoHeight = v))} />
        </Row>
        <Row label="">
          <button
            className="btn small"
            onClick={() =>
              update((g) => {
                g.canvas.widthMm = Math.ceil((layout.content.x1 + CANVAS_MARGIN_MM) * 2) / 2;
                g.canvas.heightMm = Math.ceil((layout.content.y1 + CANVAS_MARGIN_MM) * 2) / 2;
                g.canvas.autoHeight = false;
              })
            }
          >
            Fit canvas to content
          </button>
        </Row>
        <Row label="Background">
          <ColorField value={graph.canvas.background} onChange={(v) => update((g) => void (g.canvas.background = v))} />
        </Row>
        <div className="hint">Figure size is set per layer (the data area). The canvas is the exported page; SVG exports have no background.</div>
      </Group>
      <FigureGroup graph={graph} />
      <Group
        title="Layers"
        right={
          <button className="btn small" onClick={() => st.getState().setSelection({ kind: "layer", graphId: graph.id, layerId: st.getState().addLayer(graph.id) })}>
            Add
          </button>
        }
      >
        {graph.layers.map((l) => (
          <div key={l.id} className="list-item" onClick={() => st.getState().setSelection({ kind: "layer", graphId: graph.id, layerId: l.id })}>
            <Icon name="layer" size={13} /> {l.name}
            <span className="hint" style={{ marginLeft: "auto" }}>
              {l.plots.length} plot{l.plots.length === 1 ? "" : "s"}
            </span>
          </div>
        ))}
      </Group>
      <Group title="Export">
        <button className="btn" onClick={() => useDialogs.getState().setExportDialog({ graphId: graph.id })}>
          <Icon name="export" size={13} /> Export as PNG / JPEG / SVG…
        </button>
      </Group>
    </InspectorPanel>
  );
}

/** Edits that touch the whole figure: one font for every text, one palette for every plot. */
function FigureGroup({ graph }: { graph: Graph }) {
  const st = useStore;
  const defaults = useStore((s) => s.project.defaults);
  const update = (fn: (g: Graph) => void) => st.getState().updateGraph(graph.id, fn);
  const styles = textStylesOf(graph);
  const fonts = new Set(styles.map((x) => x.font));
  const font = fonts.size === 1 ? styles[0].font : "";
  const colors = new Set(styles.map((x) => x.color));
  const plotColors = graph.layers.flatMap((l) => l.plots.map((p) => p.color));
  const nPlots = plotColors.length;
  // the palette currently in use: the one whose cycle matches every layer's plots in order
  const currentPalette =
    PALETTES.find((p) => graph.layers.every((l) => l.plots.every((pl, i) => pl.color.toLowerCase() === p.colors[i % p.colors.length].toLowerCase()))) ?? null;
  const resize = (fn: (pt: number) => number) =>
    update((g) => forEachTextStyle(g, (x) => void (x.sizePt = Math.max(1, Math.round(fn(x.sizePt) * 2) / 2))));
  return (
    <Group title="Whole figure">
      <Row label="Font" title="Font family of every text in the figure: axis titles, tick labels, legends, colour-scale titles and text labels">
        <SelectField
          value={font}
          options={[...(font ? [] : [{ value: "", label: fonts.size > 1 ? "Mixed" : "—" }]), ...FONT_FAMILIES.map((f) => ({ value: f, label: f }))]}
          onChange={(f) => f && update((g) => forEachTextStyle(g, (x) => void (x.font = f)))}
        />
      </Row>
      <Row label="Text sizes" title="Make every text in the figure smaller or larger by 1 pt, or set them all to one size">
        <button className="btn small" onClick={() => resize((pt) => pt - 1)}>
          −1 pt
        </button>
        <button className="btn small" onClick={() => resize((pt) => pt + 1)}>
          +1 pt
        </button>
        <NumberField value={null} placeholder="all = …" step={0.5} min={1} onCommit={(v) => v > 0 && resize(() => v)} style={{ width: 62 }} />
      </Row>
      <Row label="Text colour" title="Colour of every text in the figure">
        <ColorField value={colors.size === 1 ? styles[0].color : "#000000"} onChange={(c) => update((g) => forEachTextStyle(g, (x) => void (x.color = c)))} />
        {colors.size > 1 && <span className="hint">mixed</span>}
      </Row>
      <Row label="Palette" title="Recolour every plot of every layer with this palette, in order">
        <SelectField
          value={currentPalette?.id ?? ""}
          options={[...(currentPalette ? [] : [{ value: "", label: nPlots ? "Custom colours" : "—" }]), ...PALETTES.map((p) => ({ value: p.id, label: p.name }))]}
          onChange={(id) => {
            const pal = PALETTES.find((p) => p.id === id);
            if (pal) update((g) => applyPalette(g, pal.colors));
          }}
        />
      </Row>
      <div style={{ display: "flex", gap: 3, marginLeft: 88, marginBottom: 4 }}>
        {(currentPalette?.colors ?? defaults.colors).map((c, i) => (
          <span key={i} title={c} style={{ width: 14, height: 14, borderRadius: 3, background: c, border: "1px solid var(--border)" }} />
        ))}
      </div>
      <Row label="">
        <button
          className="btn small"
          disabled={!currentPalette || paletteIdOf(defaults.colors) === currentPalette.id}
          title="Use this palette for new plots in every graph of the project (Settings ▸ Colors)"
          onClick={() => currentPalette && useStore.setState((s) => ({ project: { ...s.project, defaults: { ...s.project.defaults, colors: [...currentPalette.colors] } }, dirty: true }))}
        >
          Make it the project default
        </button>
      </Row>
      <div className="hint">{currentPalette ? `${currentPalette.name}${currentPalette.note ? ` — ${currentPalette.note}` : ""}.` : "Plots keep their own colours until you pick a palette."}</div>
    </Group>
  );
}

// ---------------------------------------------------------------- layer

/** Other selected objects of a kind (from the multi-selection), for editing several at once. */
function useCoSelected<K extends Selection["kind"]>(kind: K): Extract<Selection, { kind: K }>[] {
  return useStore((s) => s.ui.multi).filter((x): x is Extract<Selection, { kind: K }> => x.kind === kind);
}
function MultiHint({ n, what }: { n: number; what: string }) {
  return n > 0 ? <div className="hint">Editing {n + 1} selected {what} together.</div> : null;
}

function LayerInspector({ graph, layer }: { graph: Graph; layer: Layer }) {
  const st = useStore;
  const others = useCoSelected("layer").filter((x) => x.layerId !== layer.id);
  const updOne = (fn: (l: Layer) => void) => st.getState().updateLayer(graph.id, layer.id, fn);
  // size, position and style changes apply to every selected layer in one undo step
  const upd = (fn: (l: Layer) => void) =>
    st.getState().updateGraph(graph.id, (g) => {
      for (const id of [layer.id, ...others.map((x) => x.layerId)]) {
        const l = g.layers.find((x) => x.id === id);
        if (l) fn(l);
      }
    });
  const f = layer.frame;
  return (
    <InspectorPanel kind="layer" defaultOpen="Layer">
      <Head icon="layer" title={layer.name} />
      <Breadcrumb graph={graph} />
      <Group title="Layer">
        <Row label="Name">
          <TextField value={layer.name} onCommit={(v) => v.trim() && updOne((l) => void (l.name = v.trim()))} />
        </Row>
        <MultiHint n={others.length} what="layers" />
      </Group>
      <Group title="Figure size (data area, mm)">
        <Row label="Width × height">
          <NumberField value={f.wMm} min={5} step={1} onCommit={(v) => upd((l) => void (l.frame.wMm = v))} />
          <NumberField value={f.hMm} min={5} step={1} onCommit={(v) => upd((l) => void (l.frame.hMm = v))} />
        </Row>
        <Row label="Position">
          <NumberField value={f.xMm} step={1} onCommit={(v) => upd((l) => void (l.frame.xMm = v))} />
          <NumberField value={f.yMm} step={1} onCommit={(v) => upd((l) => void (l.frame.yMm = v))} />
        </Row>
        <div className="hint">Drag the layer on the canvas to move it, or drag a corner to resize. Shift keeps it square.</div>
      </Group>
      <Group title="Axes">
        {(["x", "y", "y2", "z"] as const).map((w) =>
          layer.axes[w] ? (
            <div key={w} className="list-item" onClick={() => st.getState().setSelection({ kind: "axis", graphId: graph.id, layerId: layer.id, axis: w })}>
              <Icon name="axis" size={13} /> {w === "x" ? "X axis" : w === "y" ? "Y axis" : w === "z" ? "Z axis" : "Right Y axis"}
              <span className="hint" style={{ marginLeft: "auto" }}>
                {{ linear: "linear", log: "log₁₀", log2: "log₂", ln: "ln" }[layer.axes[w]!.scale]}
              </span>
            </div>
          ) : null,
        )}
        {!layer.view3d && (
        <Row label="">
          {layer.axes.y2 ? (
            <button className="btn small" onClick={() => upd((l) => void delete l.axes.y2)}>
              Remove right Y axis
            </button>
          ) : (
            <button className="btn small" onClick={() => upd((l) => void (l.axes.y2 = newAxis(st.getState().project.defaults, "y2", "Y2 axis title")))}>
              Add right Y axis
            </button>
          )}
        </Row>
        )}
        <Row label="">
          <button
            className="btn small"
            title="Copy this layer's axis styling (fonts, ticks, line widths) to every layer in this graph"
            onClick={() =>
              st.getState().updateGraph(graph.id, (g) => {
                const src = g.layers.find((l) => l.id === layer.id)!;
                for (const l of g.layers) {
                  if (l.id === layer.id) continue;
                  for (const w of ["x", "y", "y2"] as const) {
                    const a = l.axes[w];
                    const s = src.axes[w] ?? src.axes.x;
                    if (!a) continue;
                    Object.assign(a, {
                      titleStyle: { ...s.titleStyle },
                      tickLabelStyle: { ...s.tickLabelStyle },
                      tickDir: s.tickDir,
                      majorTickMm: s.majorTickMm,
                      minorTickMm: s.minorTickMm,
                      lineWidthPt: s.lineWidthPt,
                      color: s.color,
                      minorCount: s.minorCount,
                      titleGapMm: s.titleGapMm,
                      mirror: s.mirror,
                      grid: s.grid,
                    });
                  }
                  l.legend.style = { ...src.legend.style };
                }
              })
            }
          >
            Apply axis style to all layers
          </button>
        </Row>
      </Group>
      {layer.view3d && <View3DFields graph={graph} layer={layer} />}
      {layer.colorScale && (
        <Group title="Color scale">
          <Row label="">
            <CheckField label="Show color scale" checked={layer.colorScale.visible} onChange={(v) => upd((l) => void (l.colorScale!.visible = v))} />
            <button className="btn small" onClick={() => st.getState().setSelection({ kind: "colorScale", graphId: graph.id, layerId: layer.id })}>
              Settings…
            </button>
          </Row>
        </Group>
      )}
      <Group title="Plots">
        {layer.plots.length === 0 && <div className="hint">No plots yet. Pick the vectors below, or use Plot on a sheet.</div>}
        {layer.plots.map((p, i) => (
          <div key={p.id} className="list-item" onClick={() => st.getState().setSelection({ kind: "plot", graphId: graph.id, layerId: layer.id, plotId: p.id })}>
            <span className="swatch" style={{ background: p.color }} />
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
            <button className="icon-btn tiny" title="Draw later (on top)" disabled={i === layer.plots.length - 1} onClick={(e) => { e.stopPropagation(); st.getState().movePlot(graph.id, layer.id, p.id, 1); }}>
              <Icon name="chevron" size={11} style={{ transform: "rotate(90deg)" }} />
            </button>
            <button className="icon-btn tiny" title="Draw earlier (behind)" disabled={i === 0} onClick={(e) => { e.stopPropagation(); st.getState().movePlot(graph.id, layer.id, p.id, -1); }}>
              <Icon name="chevron" size={11} style={{ transform: "rotate(-90deg)" }} />
            </button>
            <input type="checkbox" checked={p.visible} onClick={(e) => e.stopPropagation()} onChange={(e) => st.getState().updatePlot(graph.id, layer.id, p.id, (pl) => void (pl.visible = e.target.checked))} title="Visible" />
          </div>
        ))}
        {layer.plots.length > 1 && <div className="hint">Order = drawing order: lower in the list draws on top. The legend follows it.</div>}
      </Group>
      <Group title="Add plot">
        <AddPlotBlock key={layer.id} graphId={graph.id} layerId={layer.id} />
      </Group>
      <Group title="Legend">
        <CheckField label="Show legend" checked={layer.legend.visible} onChange={(v) => upd((l) => void (l.legend.visible = v))} />
        <Row label="">
          <button className="btn small" onClick={() => st.getState().setSelection({ kind: "legend", graphId: graph.id, layerId: layer.id })}>
            Legend settings…
          </button>
        </Row>
      </Group>
      <Group title="Actions">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button className="btn small" onClick={() => st.getState().setSelection({ kind: "layer", graphId: graph.id, layerId: st.getState().addLayer(graph.id, layer) })}>
            Duplicate
          </button>
          <button className="btn small" onClick={() => st.getState().setLayerClipboard([layer])}>
            Copy
          </button>
          <button className="btn small" disabled={graph.layers.length < 2} onClick={() => void confirmDialog("Delete this layer and its plots?").then((ok) => ok && st.getState().deleteLayer(graph.id, layer.id))}>
            Delete
          </button>
        </div>
        <div className="hint">Paste a copied layer into any graph with ⌘V.</div>
      </Group>
    </InspectorPanel>
  );
}

// ---------------------------------------------------------------- axis

function AxisInspector({ graph, layer, which }: { graph: Graph; layer: Layer; which: "x" | "y" | "y2" | "z" }) {
  const st = useStore;
  const sheets = useStore((s) => s.project.sheets);
  const axis = layer.axes[which];
  const ll = useMemo(() => layoutLayer(useStore.getState().project, layer), [sheets, layer]);
  const others = useCoSelected("axis").filter((x) => !(x.layerId === layer.id && x.axis === which));
  if (!axis) return null;
  const scale = which === "x" ? ll.x.scale : which === "y" ? ll.y.scale : which === "y2" ? ll.y2?.scale : ll.zScale;
  const eff = scale ? { from: scale.from, to: scale.to, step: scale.step } : { from: axis.from, to: axis.to, step: axis.majorStep ?? 1 };
  // edits apply to every selected axis (any layer) in one undo step
  const upd = (fn: (a: Axis) => void) =>
    others.length === 0
      ? st.getState().updateAxis(graph.id, layer.id, which, fn)
      : st.getState().updateGraph(graph.id, (g) => {
          for (const ref of [{ layerId: layer.id, axis: which }, ...others]) {
            const a = g.layers.find((l) => l.id === ref.layerId)?.axes[ref.axis];
            if (a) fn(a);
          }
        });
  const linked = which !== "x" && axis.sameAsX;
  const styleSrc = linked ? layer.axes.x : axis;
  const name = which === "x" ? "X axis" : which === "y" ? "Y axis" : which === "z" ? "Z axis" : "Right Y axis";
  return (
    <InspectorPanel kind="axis" defaultOpen="Scale">
      <Head icon="axis" title={name} />
      <Breadcrumb graph={graph} layer={layer} />
      <MultiHint n={others.length} what="axes" />
      <Group title="Title">
        <TextField value={axis.title} onCommit={(v) => upd((a) => void (a.title = v))} placeholder="Axis title" multiline />
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
          <CheckField label="Show" checked={axis.showTitle} onChange={(v) => upd((a) => void (a.showTitle = v))} />
          <SymbolPicker onPick={(s) => upd((a) => void (a.title = a.title + s))} />
        </div>
        <div className="hint">
          Shift+Enter starts a second line. Markup: \alpha \mu \Delta, x^{"{2}"}, A_{"{0}"}, \times \pm \degree, \it{"{...}"} \bf{"{...}"}
        </div>
      </Group>
      <Group title="Scale">
        <Row label="Type">
          <Segmented
            value={axis.scale}
            options={[
              { value: "linear", label: "Linear" },
              { value: "log", label: "Log₁₀" },
              { value: "log2", label: "Log₂" },
              { value: "ln", label: "ln" },
            ]}
            onChange={(v) =>
              upd((a) => {
                const wasLog = isLogScale(a.scale);
                a.scale = v;
                // sensible default minor ticks when switching families
                if (isLogScale(v) && !wasLog) a.minorCount = v === "log" ? 8 : 1;
                if (!isLogScale(v) && wasLog) a.minorCount = 1;
              })
            }
          />
        </Row>
        <Row label="">
          <CheckField
            label="Auto range"
            checked={axis.auto}
            onChange={(v) =>
              upd((a) => {
                a.auto = v;
                if (!v) {
                  a.from = eff.from;
                  a.to = eff.to;
                }
              })
            }
          />
        </Row>
        <Row label="From · To">
          <NumberField value={axis.auto ? eff.from : axis.from} placeholder="from" disabled={axis.auto} onCommit={(v) => upd((a) => void (a.from = v))} />
          <NumberField value={axis.auto ? eff.to : axis.to} placeholder="to" disabled={axis.auto} onCommit={(v) => upd((a) => void (a.to = v))} />
        </Row>
        <Row label="">
          <CheckField label="Reversed (high values first)" checked={!!axis.reversed} onChange={(v) => upd((a) => void (a.reversed = v || undefined))} />
        </Row>
        <Row label="Major ticks">
          <Segmented
            value={axis.majorMode ?? "step"}
            options={[
              { value: "step", label: "By step" },
              { value: "count", label: "By count" },
            ]}
            onChange={(v) => upd((a) => void (a.majorMode = v))}
          />
        </Row>
        {(axis.majorMode ?? "step") === "step" ? (
          <Row label="Major step">
            <NumberField value={axis.majorStep} placeholder={isLogScale(axis.scale) ? "powers of the base" : `auto (${Number(eff.step.toPrecision(6))})`} disabled={isLogScale(axis.scale)} onCommit={(v) => upd((a) => void (a.majorStep = v > 0 ? v : null))} />
            <button className="btn small" disabled={axis.majorStep === null} onClick={() => upd((a) => void (a.majorStep = null))}>
              Auto
            </button>
          </Row>
        ) : (
          <Row label="Tick count">
            <NumberField value={axis.majorCount ?? 5} step={1} min={2} max={50} disabled={isLogScale(axis.scale)} onCommit={(v) => upd((a) => void (a.majorCount = Math.max(2, Math.round(v))))} style={{ width: 60 }} />
            <span className="hint">evenly over the range, ends included</span>
          </Row>
        )}
        <Row label="Minor ticks">
          <NumberField value={axis.minorCount} step={1} min={0} max={20} disabled={linked} onCommit={(v) => upd((a) => void (a.minorCount = Math.round(v)))} />
          <span className="hint">{isLogScale(axis.scale) ? (axis.scale === "log" ? "between decades (0 = none, 8 = 2…9)" : "between powers (0 = none)") : "between majors"}</span>
        </Row>
        {which !== "z" && which !== "y2" && (
          <Row label="Crosses at" title={`Draw this axis across the data area at this ${which === "x" ? "Y" : "X"} value instead of on the frame edge`}>
            <NumberField value={axis.crossAt ?? null} placeholder="frame edge" onCommit={(v) => upd((a) => void (a.crossAt = v))} />
            <button className="btn small" disabled={axis.crossAt == null} onClick={() => upd((a) => void (a.crossAt = null))}>
              Edge
            </button>
          </Row>
        )}
      </Group>
      <Group title="Tick labels">
        <Row label="Number format">
          <SelectField<NumberFormat>
            value={axis.numberFormat}
            options={[
              { value: "auto", label: "Auto" },
              { value: "fixed", label: "Fixed decimals" },
              { value: "scientific", label: "Scientific (×10ⁿ)" },
              { value: "exponent", label: "Exponent (1e3)" },
              { value: "engineering", label: "Engineering (k, M, µ)" },
            ]}
            onChange={(v) => upd((a) => void (a.numberFormat = v))}
          />
          <NumberField value={axis.decimals} step={1} min={0} max={10} disabled={axis.numberFormat === "auto"} onCommit={(v) => upd((a) => void (a.decimals = Math.round(v)))} style={{ width: 50 }} />
        </Row>
        <Row label="">
          <CheckField label="Show tick labels" checked={axis.showTickLabels} onChange={(v) => upd((a) => void (a.showTickLabels = v))} />
          <CheckField label="Thousands separators" checked={!!axis.thousands} onChange={(v) => upd((a) => void (a.thousands = v || undefined))} />
        </Row>
        <Row label="Gap · every" title="Distance between the tick marks and the labels (mm), and show only every n-th label">
          <NumberField value={axis.labelGapMm ?? 0.8} placeholder="gap mm" step={0.2} min={0} onCommit={(v) => upd((a) => void (a.labelGapMm = v === 0.8 ? undefined : v))} style={{ width: 60 }} />
          <NumberField value={axis.labelEvery ?? 1} placeholder="every" step={1} min={1} max={20} onCommit={(v) => upd((a) => void (a.labelEvery = v > 1 ? Math.round(v) : undefined))} style={{ width: 50 }} />
          <span className="hint">n-th</span>
        </Row>
        <Row label="Prefix · suffix" title="Text added before and after every tick label">
          <TextField value={axis.labelPrefix ?? ""} placeholder="e.g. $" onCommit={(v) => upd((a) => void (a.labelPrefix = v || undefined))} />
          <TextField value={axis.labelSuffix ?? ""} placeholder="e.g. %" onCommit={(v) => upd((a) => void (a.labelSuffix = v || undefined))} />
        </Row>
        <Row label="Label angle">
          <NumberField value={axis.labelRotation ?? 0} step={15} min={-90} max={90} onCommit={(v) => upd((a) => void (a.labelRotation = v || undefined))} style={{ width: 60 }} />
          <span className="hint">degrees</span>
        </Row>
        <Row label="Custom ticks" title="Ticks at the values you list, separated by commas; add =label to give one its own text (markup such as \\pi works)">
          <TextField
            value={formatCustomTicks(axis.customTicks)}
            placeholder="e.g. 0, 3.1416=\pi, 6.2832=2\pi"
            onCommit={(v) =>
              upd((a) => {
                const ticks = parseCustomTicks(v);
                a.customTicks = ticks.length ? ticks : undefined;
              })
            }
          />
        </Row>
        {!!axis.customTicks?.length && (
          <Row label="">
            <Segmented
              value={axis.customTicksMode ?? "add"}
              options={[
                { value: "add", label: "In addition" },
                { value: "replace", label: "Only these" },
              ]}
              onChange={(v) => upd((a) => void (a.customTicksMode = v))}
            />
            <span className="hint">{(axis.customTicksMode ?? "add") === "add" ? "to the regular ticks" : "no regular or minor ticks"}</span>
          </Row>
        )}
      </Group>
      <BreaksEditor axis={axis} eff={eff} upd={upd} />
      <Group title="Style">
        {which !== "x" && (
          <Row label="">
            <CheckField label="Same style as X axis" checked={axis.sameAsX} onChange={(v) => upd((a) => void (a.sameAsX = v))} />
          </Row>
        )}
        <div style={{ opacity: linked ? 0.5 : 1, pointerEvents: linked ? "none" : undefined }}>
          <Row label="Ticks">
            <Segmented value={styleSrc.tickDir} options={[{ value: "out", label: "Out" }, { value: "in", label: "In" }, { value: "none", label: "None" }]} onChange={(v) => upd((a) => void (a.tickDir = v))} />
          </Row>
          <Row label="Tick length" title="Major and minor tick length in mm">
            <NumberField value={styleSrc.majorTickMm} step={0.1} min={0} onCommit={(v) => upd((a) => void (a.majorTickMm = v))} />
            <NumberField value={styleSrc.minorTickMm} step={0.1} min={0} onCommit={(v) => upd((a) => void (a.minorTickMm = v))} />
          </Row>
          <Row label="Line (pt)">
            <NumberField value={styleSrc.lineWidthPt} step={0.25} min={0} onCommit={(v) => upd((a) => void (a.lineWidthPt = v))} style={{ width: 60 }} />
            <ColorField value={styleSrc.color} onChange={(v) => upd((a) => void (a.color = v))} />
          </Row>
          <Row label="Title gap">
            <NumberField value={styleSrc.titleGapMm} step={0.5} min={0} onCommit={(v) => upd((a) => void (a.titleGapMm = v))} style={{ width: 60 }} />
            <span className="hint">mm</span>
          </Row>
          <Row label="">
            <CheckField label="Mirror (box frame)" checked={styleSrc.mirror} onChange={(v) => upd((a) => void (a.mirror = v))} />
            <CheckField label="Grid" checked={styleSrc.grid} onChange={(v) => upd((a) => void (a.grid = v))} />
          </Row>
          <div className="group-title">Title font</div>
          <FontFields style={styleSrc.titleStyle} onChange={(p) => upd((a) => void Object.assign(a.titleStyle, p))} />
          <div className="group-title">Tick label font</div>
          <FontFields style={styleSrc.tickLabelStyle} onChange={(p) => upd((a) => void Object.assign(a.tickLabelStyle, p))} />
        </div>
      </Group>
      <Group>
        <CheckField label="Axis visible" checked={axis.visible} onChange={(v) => upd((a) => void (a.visible = v))} />
      </Group>
    </InspectorPanel>
  );
}

function SymbolPicker({ onPick }: { onPick: (s: string) => void }) {
  return (
    <select className="input" style={{ width: 90 }} value="" onChange={(e) => e.target.value && onPick(e.target.value)} title="Insert a symbol">
      <option value="">Symbol…</option>
      {SYMBOL_LIST.map((s) => (
        <option key={s.code} value={s.code}>
          {s.char} {s.code}
        </option>
      ))}
      <option value="^{2}">x² (^{"{2}"})</option>
      <option value="_{0}">x₀ (_{"{0}"})</option>
    </select>
  );
}

// ---------------------------------------------------------------- plot

function PlotInspector({ graph, layer, plot }: { graph: Graph; layer: Layer; plot: Plot }) {
  const st = useStore;
  const sheet = useStore((s) => s.project.sheets.find((x) => x.id === plot.source.sheetId));
  const others = useCoSelected("plot").filter((x) => x.plotId !== plot.id);
  // edits apply to every selected plot (possibly on other layers) in one undo step
  const upd = (fn: (p: Plot) => void) =>
    others.length === 0
      ? st.getState().updatePlot(graph.id, layer.id, plot.id, fn)
      : st.getState().updateGraph(graph.id, (g) => {
          for (const ref of [{ layerId: layer.id, plotId: plot.id }, ...others]) {
            const pl = g.layers.find((l) => l.id === ref.layerId)?.plots.find((x) => x.id === ref.plotId);
            if (pl) fn(pl);
          }
        });
  const [styleWithColor, setStyleWithColor] = useState(false);
  const applyStyle = (scope: "layer" | "graph") =>
    st.getState().updateGraph(graph.id, (g) => {
      const src = g.layers.find((l) => l.id === layer.id)?.plots.find((x) => x.id === plot.id);
      if (!src) return;
      const style = plotStyleOf(src, styleWithColor);
      applyStyleToPlots(scope === "graph" ? g : g.layers.find((l) => l.id === layer.id)!, style, plot.id);
    });

  const colName = (id: string | null | undefined) => {
    if (!sheet || !id) return "–";
    const i = sheet.columns.findIndex((c) => c.id === id);
    return i < 0 ? "(missing)" : sheet.columns[i].longName || String.fromCharCode(65 + i);
  };
  const isHist = plot.type === "histogram";
  const isFit = plot.type === "fitCurve";
  const isMatrix = plot.type === "heatmap" || plot.type === "contour" || plot.type === "surface3d";
  const isBar = plot.type === "bar";
  const isBox = plot.type === "box";
  const is3dScatter = plot.type === "scatter3d";
  const isFunc = plot.type === "function";
  const xyLike = !isHist && !isFit && !isMatrix && !isBar && !isBox && !is3dScatter && !isFunc;
  return (
    <InspectorPanel kind="plot" defaultOpen="Plot">
      <Head icon="chart" title={plot.name || "Plot"} />
      <Breadcrumb graph={graph} layer={layer} />
      <Group title="Plot">
        <MultiHint n={others.length} what="plots" />
        <Row label="Name">
          <TextField value={plot.name} onCommit={(v) => st.getState().updatePlot(graph.id, layer.id, plot.id, (p) => void (p.name = v))} />
        </Row>
        {xyLike && (
          <Row label="Type">
            <Segmented
              value={plot.type}
              options={[
                { value: "scatter", label: "Symbol" },
                { value: "line", label: "Line" },
                { value: "lineScatter", label: "Both" },
              ]}
              onChange={(v) =>
                upd((p) => {
                  p.type = v;
                  p.showMarkers = v !== "line";
                  p.showLine = v !== "scatter";
                })
              }
            />
          </Row>
        )}
        {!isMatrix && !(is3dScatter && plot.colormap) && (
          <Row label="Color">
            <ColorField value={plot.color} onChange={(v) => upd((p) => void (p.color = v))} />
          </Row>
        )}
        {layer.axes.y2 && !layer.view3d && (
          <Row label="Y axis">
            <Segmented value={plot.yAxis} options={[{ value: "y", label: "Left" }, { value: "y2", label: "Right" }]} onChange={(v) => upd((p) => void (p.yAxis = v))} />
          </Row>
        )}
        <Row label="">
          <CheckField label="Visible" checked={plot.visible} onChange={(v) => upd((p) => void (p.visible = v))} />
        </Row>
        <Row label="Apply style" title="Give the other plots this plot's symbols, line, error-bar, label and bar settings (not their data or names)">
          <button className="btn small" disabled={layer.plots.length < 2} onClick={() => applyStyle("layer")}>
            To layer
          </button>
          <button className="btn small" disabled={graph.layers.reduce((n, l) => n + l.plots.length, 0) < 2} onClick={() => applyStyle("graph")}>
            To graph
          </button>
          <CheckField label="with colour" checked={styleWithColor} onChange={setStyleWithColor} />
        </Row>
        <Row label="">
          <button className="btn small" title="Copy this plot's style; paste it on another plot from its right-click menu or here" onClick={() => copyPlotStyle(plot, true)}>
            Copy style
          </button>
          <button className="btn small" disabled={!pastedPlotStyle()} title="Apply the copied style to this plot (and the other selected plots)" onClick={() => upd((p) => void (pastedPlotStyle() && applyPlotStyle(p, pastedPlotStyle()!)))}>
            Paste style
          </button>
        </Row>
      </Group>
      {isFunc && plot.func && (
        <Group title="Function">
          <Row label="y =">
            <TextField value={plot.func.expression} mono onCommit={(v) => upd((p) => void (p.func && (p.func.expression = v)))} />
          </Row>
          {validateFunction(plot.func.expression) && <div style={{ color: "var(--danger)", fontSize: 11.5, marginLeft: 88 }}>{validateFunction(plot.func.expression)}</div>}
          <Row label="">
            <CheckField
              label="Fixed x range"
              checked={plot.func.from !== null || plot.func.to !== null}
              onChange={(v) =>
                upd((p) => {
                  if (!p.func) return;
                  p.func.from = v ? -10 : null;
                  p.func.to = v ? 10 : null;
                })
              }
            />
          </Row>
          {(plot.func.from !== null || plot.func.to !== null) && (
            <Row label="From · To">
              <NumberField value={plot.func.from} onCommit={(v) => upd((p) => void (p.func && (p.func.from = v)))} />
              <NumberField value={plot.func.to} onCommit={(v) => upd((p) => void (p.func && (p.func.to = v)))} />
            </Row>
          )}
          <Row label="Points">
            <NumberField value={plot.func.points} step={100} min={10} max={5000} onCommit={(v) => upd((p) => void (p.func && (p.func.points = Math.round(v))))} style={{ width: 80 }} />
          </Row>
          <div className="hint">Without a fixed range the curve follows the x axis, so zooming or rescaling re-samples it.</div>
        </Group>
      )}
      {isMatrix && <MatrixSourceFields plot={plot} upd={upd} />}
      {(isMatrix || is3dScatter) && <ColormapFields plot={plot} upd={upd} />}
      {plot.type === "contour" && <ContourFields plot={plot} upd={upd} />}
      {plot.type === "surface3d" && <SurfaceFields plot={plot} upd={upd} />}
      {isBar && <BarFields plot={plot} upd={upd} updAllBars={(fn) => st.getState().updateLayer(graph.id, layer.id, (l) => l.plots.filter((p) => p.type === "bar").forEach((p) => p.bar && fn(p.bar)))} sheet={sheet} />}
      {isBox && <BoxFields plot={plot} upd={upd} />}
      {((xyLike && plot.showMarkers) || isFunc || isBox || is3dScatter) && (
        <Group title="Symbol">
          {!xyLike && (
            <Row label="">
              <CheckField label={isBox ? "Show outlier symbols" : "Show symbols"} checked={plot.showMarkers} onChange={(v) => upd((p) => void (p.showMarkers = v))} />
            </Row>
          )}
          {plot.showMarkers && (
          <>
          <Row label="Shape">
            <SelectField<MarkerShape>
              value={plot.marker.shape}
              options={[
                { value: "circle", label: "Circle" },
                { value: "square", label: "Square" },
                { value: "triangle", label: "Triangle" },
                { value: "diamond", label: "Diamond" },
                { value: "cross", label: "Cross" },
                { value: "plus", label: "Plus" },
              ]}
              onChange={(v) => upd((p) => void (p.marker.shape = v))}
            />
          </Row>
          <Row label="Fill colour">
            <CheckField label="Plot colour" checked={!plot.marker.fillColor} onChange={(v) => upd((p) => void (p.marker.fillColor = v ? null : p.color))} />
            {plot.marker.fillColor && <ColorField value={plot.marker.fillColor} onChange={(v) => upd((p) => void (p.marker.fillColor = v))} />}
          </Row>
          <Row label="Edge">
            <CheckField label="Plot colour" checked={!plot.marker.edgeColor} onChange={(v) => upd((p) => void (p.marker.edgeColor = v ? null : "#000000"))} />
            {plot.marker.edgeColor && <ColorField value={plot.marker.edgeColor} onChange={(v) => upd((p) => void (p.marker.edgeColor = v))} />}
            <NumberField value={plot.marker.edgeWidthPt ?? null} placeholder="auto" step={0.25} min={0} onCommit={(v) => upd((p) => void (p.marker.edgeWidthPt = v > 0 ? v : null))} style={{ width: 50 }} />
            <span className="hint">pt</span>
          </Row>
          <Row label="Size (pt)">
            <NumberField value={plot.marker.sizePt} step={0.5} min={0.1} onCommit={(v) => upd((p) => void (p.marker.sizePt = v))} style={{ width: 60 }} />
            <CheckField label="Filled" checked={plot.marker.filled} onChange={(v) => upd((p) => void (p.marker.filled = v))} />
          </Row>
          <Row label="Opacity" title="Transparency of the symbols: 100 % is opaque; lower values show overlapping points">
            <OpacityField value={plot.marker.opacity ?? 1} onChange={(v) => upd((p) => void (p.marker.opacity = v >= 1 ? undefined : v))} />
          </Row>
          </>
          )}
        </Group>
      )}
      {((xyLike && plot.showLine) || isFit || isFunc || isHist || isBox || plot.type === "contour" || plot.type === "surface3d" || is3dScatter) && (
      <Group id="line" title={isHist ? "Outline" : plot.type === "contour" ? "Contour lines" : isBox ? "Lines" : plot.type === "surface3d" ? "Mesh lines" : isFit ? "Fit line" : "Line"}>
        {isFunc && (
          <Row label="">
            <CheckField label="Show line" checked={plot.showLine} onChange={(v) => upd((p) => void (p.showLine = v))} />
          </Row>
        )}
        {is3dScatter && (
          <Row label="">
            <CheckField label="Drop lines to the floor" checked={plot.showLine} onChange={(v) => upd((p) => void (p.showLine = v))} />
          </Row>
        )}
        {(!(isFunc || is3dScatter) || plot.showLine) && (
        <>
        <Row label="Width (pt)">
          <NumberField value={plot.line.widthPt} step={0.25} min={0} onCommit={(v) => upd((p) => void (p.line.widthPt = v))} style={{ width: 60 }} />
          <SelectField<LineStyle>
            value={plot.line.style}
            options={[
              { value: "solid", label: "Solid" },
              { value: "dash", label: "Dash" },
              { value: "dot", label: "Dot" },
              { value: "dashdot", label: "Dash-dot" },
              { value: "custom", label: "Custom…" },
            ]}
            onChange={(v) => upd((p) => void (p.line.style = v))}
          />
        </Row>
        <Row label="Opacity" title="Transparency of the line: 100 % is opaque">
          <OpacityField value={plot.line.opacity ?? 1} onChange={(v) => upd((p) => void (p.line.opacity = v >= 1 ? undefined : v))} />
        </Row>
        {plot.line.style === "custom" && (
          <Row label="Dash · gap (pt)" title="Illustrator-style pattern: dash, gap, dash, gap… in points">
            <TextField
              value={(plot.line.dashPt ?? []).join(" ")}
              mono
              placeholder="4 2 1 2"
              onCommit={(v) =>
                upd((p) => {
                  const arr = v.split(/[\s,]+/).map(Number).filter((x) => Number.isFinite(x) && x >= 0);
                  p.line.dashPt = arr.length ? arr : [4, 2];
                })
              }
            />
          </Row>
        )}
        {xyLike && (
          <Row label="Connect">
            <SelectField<LineConnect>
              value={plot.line.connect ?? "straight"}
              options={[
                { value: "straight", label: "Straight segments" },
                { value: "spline", label: "Smooth (through points)" },
                { value: "bspline", label: "B-spline (smoothed)" },
                { value: "stepH", label: "Step: horizontal first" },
                { value: "stepV", label: "Step: vertical first" },
              ]}
              onChange={(v) => upd((p) => void (p.line.connect = v))}
            />
          </Row>
        )}
        </>
        )}
      </Group>
      )}
      {(xyLike || isBar) && (
        <Group title={isBar ? "Value labels" : "Data labels"} id="Data labels">
          <Row label="">
            <CheckField label={isBar ? "Write the value on every bar" : "Label every point"} checked={!!plot.labels?.show} onChange={(v) => upd((p) => void (p.labels = { ...(p.labels ?? { source: "y", colId: null, decimals: 2, position: "above", offsetMm: 1.2, sizePt: 7 }), show: v }))} />
          </Row>
          {plot.labels?.show && (
            <>
              <Row label="Text">
                <SelectField<DataLabels["source"]>
                  value={plot.labels.source}
                  options={[
                    { value: "y", label: "Y value" },
                    { value: "x", label: "X value" },
                    { value: "xy", label: "X, Y" },
                    { value: "column", label: "A column of the sheet" },
                  ]}
                  onChange={(v) => upd((p) => void (p.labels!.source = v))}
                />
              </Row>
              {plot.labels.source === "column" && sheet && (
                <Row label="Column">
                  <SelectField value={plot.labels.colId ?? ""} options={[{ value: "", label: "—" }, ...sheet.columns.map((c, i) => ({ value: c.id, label: c.longName || String.fromCharCode(65 + i) }))]} onChange={(v) => upd((p) => void (p.labels!.colId = v || null))} />
                </Row>
              )}
              <Row label="Decimals · size">
                <NumberField value={plot.labels.decimals} step={1} min={0} max={8} onCommit={(v) => upd((p) => void (p.labels!.decimals = Math.round(v)))} style={{ width: 50 }} />
                <NumberField value={plot.labels.sizePt} step={0.5} min={3} onCommit={(v) => upd((p) => void (p.labels!.sizePt = v))} style={{ width: 50 }} />
                <span className="hint">pt</span>
              </Row>
              <Row label="Position">
                <SelectField<DataLabels["position"]>
                  value={plot.labels.position}
                  options={[
                    { value: "above", label: "Above" },
                    { value: "below", label: "Below" },
                    { value: "left", label: "Left" },
                    { value: "right", label: "Right" },
                  ]}
                  onChange={(v) => upd((p) => void (p.labels!.position = v))}
                />
                <NumberField value={plot.labels.offsetMm} step={0.2} min={0} onCommit={(v) => upd((p) => void (p.labels!.offsetMm = v))} style={{ width: 50 }} />
                <span className="hint">mm</span>
              </Row>
            </>
          )}
        </Group>
      )}
      {xyLike && (
        <Group title="Drop lines">
          <Row label="">
            <CheckField label="To the X axis" checked={!!plot.dropLines?.toX} onChange={(v) => upd((p) => void (p.dropLines = { toX: v, toY: p.dropLines?.toY ?? false }))} />
            <CheckField label="To the Y axis" checked={!!plot.dropLines?.toY} onChange={(v) => upd((p) => void (p.dropLines = { toX: p.dropLines?.toX ?? false, toY: v }))} />
          </Row>
        </Group>
      )}
      {xyLike && (
        <Group title="Colour by column">
          <Row label="">
            <CheckField
              label="Colour the symbols by a column"
              checked={!!plot.colorBy}
              onChange={(v) =>
                upd((p) => {
                  if (v) {
                    p.colorBy = { colId: p.colorBy?.colId ?? null };
                    if (!p.colormap) p.colormap = defaultColormap();
                  } else p.colorBy = undefined;
                })
              }
            />
          </Row>
          {plot.colorBy && sheet && (
            <Row label="Column">
              <SelectField value={plot.colorBy.colId ?? ""} options={[{ value: "", label: "—" }, ...sheet.columns.map((c, i) => ({ value: c.id, label: c.longName || String.fromCharCode(65 + i) }))]} onChange={(v) => upd((p) => void (p.colorBy!.colId = v || null))} />
            </Row>
          )}
          {plot.colorBy && <div className="hint">Add a colour scale to the layer (Layer → Colour scale) to show the mapping.</div>}
        </Group>
      )}
      {plot.colorBy && <ColormapFields plot={plot} upd={upd} />}
      {(xyLike || isBar) && (
        <Group title="Error bars">
          <Row label="">
            <CheckField label="Show errors" checked={plot.errorBars.show} onChange={(v) => upd((p) => void (p.errorBars.show = v))} />
          </Row>
          {plot.errorBars.show && (
          <>
          {!isBar && (
            <Row label="Style">
              <Segmented
                value={plot.errorBars.style ?? "bars"}
                options={[
                  { value: "bars", label: "Bars" },
                  { value: "band", label: "Shaded band" },
                ]}
                onChange={(v) => upd((p) => void (p.errorBars.style = v))}
              />
            </Row>
          )}
          {(plot.errorBars.style ?? "bars") === "bars" || isBar ? (
            <Row label="Cap (mm)">
              <NumberField value={plot.errorBars.capMm} step={0.2} min={0} onCommit={(v) => upd((p) => void (p.errorBars.capMm = v))} style={{ width: 60 }} />
              <NumberField value={plot.errorBars.widthPt} step={0.25} min={0} onCommit={(v) => upd((p) => void (p.errorBars.widthPt = v))} style={{ width: 60 }} />
              <span className="hint">pt</span>
            </Row>
          ) : (
            <>
              <Row label="Edges">
                <SelectField<BandConnect>
                  value={plot.errorBars.bandConnect ?? "straight"}
                  options={[
                    { value: "straight", label: "Straight segments" },
                    { value: "spline", label: "Smooth (through points)" },
                    { value: "bspline", label: "B-spline (smoothed)" },
                  ]}
                  onChange={(v) => upd((p) => void (p.errorBars.bandConnect = v))}
                />
              </Row>
              <Row label="Opacity">
                <input type="range" min={0.05} max={1} step={0.05} value={plot.errorBars.bandOpacity ?? 0.2} onChange={(e) => upd((p) => void (p.errorBars.bandOpacity = Number(e.target.value)))} style={{ flex: 1 }} />
                <span className="hint" style={{ width: 36 }}>
                  {Math.round((plot.errorBars.bandOpacity ?? 0.2) * 100)}%
                </span>
              </Row>
              <Row label="Color">
                <CheckField label="Same as plot" checked={!plot.errorBars.bandColor} onChange={(v) => upd((p) => void (p.errorBars.bandColor = v ? null : p.color))} />
                {plot.errorBars.bandColor && <ColorField value={plot.errorBars.bandColor} onChange={(v) => upd((p) => void (p.errorBars.bandColor = v))} />}
              </Row>
              <Row label="">
                <CheckField label="Outline the edges" checked={!!plot.errorBars.bandOutline} onChange={(v) => upd((p) => void (p.errorBars.bandOutline = v))} />
                {plot.errorBars.bandOutline && (
                  <>
                    <NumberField value={plot.errorBars.widthPt} step={0.25} min={0} onCommit={(v) => upd((p) => void (p.errorBars.widthPt = v))} style={{ width: 50 }} />
                    <span className="hint">pt</span>
                  </>
                )}
              </Row>
              <div className="hint">The band spans y − error … y + error (Y errors only; X errors are still drawn as bars).</div>
            </>
          )}
          </>
          )}
        </Group>
      )}
      {isHist && <HistogramFields plot={plot} upd={upd} />}
      {isFit && plot.fit && <FitSummary plot={plot} graph={graph} layer={layer} />}
      <Group title="Source">
        {isFit ? (
          <div className="hint">Fitted from: {sheet?.name ?? "(missing)"} · {colName(plot.source.yColId)}</div>
        ) : isMatrix ? (
          <div className="hint">See "Matrix data" above.</div>
        ) : isFunc ? (
          <div className="hint">Computed from the expression above; no sheet data.</div>
        ) : (
          <PlotSourceFields source={plot.source} type={plot.type} onChange={(s) => upd((p) => void (p.source = s))} />
        )}
        {xyLike && (
          <Row label="">
            <button className="btn small" onClick={() => useDialogs.getState().setFitDialog({ graphId: graph.id, layerId: layer.id, plotId: plot.id })}>
              <Icon name="fit" size={12} /> Fit a curve…
            </button>
          </Row>
        )}
        <Row label="">
          <button className="btn small" onClick={() => st.getState().deletePlot(graph.id, layer.id, plot.id)}>
            Remove plot
          </button>
        </Row>
      </Group>
    </InspectorPanel>
  );
}

function HistogramFields({ plot, upd }: { plot: Plot; upd: (fn: (p: Plot) => void) => void }) {
  const h = plot.histogram ?? defaultHistogramOptions();
  const u = (fn: (o: NonNullable<Plot["histogram"]>) => void) =>
    upd((p) => {
      if (!p.histogram) p.histogram = defaultHistogramOptions();
      fn(p.histogram);
    });
  return (
    <Group title="Bins">
      <Row label="Bin by">
        <Segmented value={h.binMode} options={[{ value: "count", label: "Count" }, { value: "width", label: "Width" }]} onChange={(v) => u((o) => void (o.binMode = v))} />
      </Row>
      {h.binMode === "count" ? (
        <Row label="Bins">
          <NumberField value={h.binCount} step={1} min={1} onCommit={(v) => u((o) => void (o.binCount = Math.round(v)))} style={{ width: 70 }} />
        </Row>
      ) : (
        <Row label="Bin width">
          <NumberField value={h.binWidth} min={0} onCommit={(v) => u((o) => void (o.binWidth = v))} style={{ width: 70 }} />
        </Row>
      )}
      <Row label="">
        <CheckField label="Auto range" checked={h.rangeAuto} onChange={(v) => u((o) => void (o.rangeAuto = v))} />
      </Row>
      <Row label="From · To">
        <NumberField value={h.from} disabled={h.rangeAuto} onCommit={(v) => u((o) => void (o.from = v))} />
        <NumberField value={h.to} disabled={h.rangeAuto} onCommit={(v) => u((o) => void (o.to = v))} />
      </Row>
      <Row label="Normalize">
        <SelectField
          value={h.normalization}
          options={[
            { value: "count", label: "Counts" },
            { value: "probability", label: "Probability" },
            { value: "density", label: "Density" },
          ]}
          onChange={(v) => u((o) => void (o.normalization = v))}
        />
      </Row>
      <Row label="">
        <CheckField label="Filled bars" checked={h.filled} onChange={(v) => u((o) => void (o.filled = v))} />
      </Row>
    </Group>
  );
}

function FitSummary({ plot, graph, layer }: { plot: Plot; graph: Graph; layer: Layer }) {
  const st = useStore;
  const fit = plot.fit!;
  const f = (x: number) => (Number.isFinite(x) ? Number(x.toPrecision(5)).toString() : "–");
  return (
    <Group title="Fit">
      <div className="mono" style={{ fontSize: 11, marginBottom: 6, wordBreak: "break-all" }}>
        y = {fit.expression}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 10px", fontVariantNumeric: "tabular-nums" }}>
        {fit.paramNames.map((n, i) => (
          <span key={n} style={{ display: "contents" }}>
            <span style={{ color: "var(--text-2)" }}>{n}</span>
            <span>
              {f(fit.params[i])} ± {f(fit.errors[i])}
            </span>
          </span>
        ))}
        {fit.stats && (
          <>
            <span style={{ color: "var(--text-2)" }}>R²</span>
            <span>{f(fit.stats.rSquared)}</span>
            <span style={{ color: "var(--text-2)" }}>Red. χ²</span>
            <span>{f(fit.stats.reducedChiSquared)}</span>
          </>
        )}
      </div>
      <Row label="">
        <CheckField label="95% confidence band" checked={fit.showBand} onChange={(v) => st.getState().updatePlot(graph.id, layer.id, plot.id, (p) => void (p.fit!.showBand = v))} />
      </Row>
      <Row label="">
        <CheckField label="95% prediction band" checked={!!fit.showPredBand} onChange={(v) => st.getState().updatePlot(graph.id, layer.id, plot.id, (p) => void (p.fit!.showPredBand = v))} />
      </Row>
      <Row label="">
        <button
          className="btn small"
          title="Copy the parameters and statistics as a tab-separated table"
          onClick={() => {
            const rows: string[] = [`Fit of ${layer.plots.find((p) => p.id === fit.sourcePlotId)?.name ?? "data"}: y = ${fit.expression}`, "Parameter\tValue\tStd. error"];
            fit.paramNames.forEach((n, i) => rows.push(`${n}\t${f(fit.params[i])}\t${f(fit.errors[i])}`));
            if (fit.stats) rows.push(`R²\t${f(fit.stats.rSquared)}`, `Adj. R²\t${f(fit.stats.adjRSquared)}`, `χ²\t${f(fit.stats.chiSquared)}`, `Reduced χ²\t${f(fit.stats.reducedChiSquared)}`, `N\t${fit.stats.n}`, `DOF\t${fit.stats.dof}`);
            void navigator.clipboard.writeText(rows.join("\n")).then(() => useDialogs.getState().showToast("Fit results copied"));
          }}
        >
          Copy results
        </button>
      </Row>
      <Row label="">
        <CheckField label="Frozen (don't refit on data change)" checked={fit.frozen} onChange={(v) => st.getState().updatePlot(graph.id, layer.id, plot.id, (p) => void (p.fit!.frozen = v))} />
      </Row>
      <Row label="">
        <button className="btn small" onClick={() => useDialogs.getState().setFitDialog({ graphId: graph.id, layerId: layer.id, plotId: fit.sourcePlotId })}>
          Refit…
        </button>
      </Row>
    </Group>
  );
}

// ---------------------------------------------------------------- legend

function LegendInspector({ graph, layer }: { graph: Graph; layer: Layer }) {
  const st = useStore;
  const lg = layer.legend;
  const others = useCoSelected("legend").filter((x) => x.layerId !== layer.id);
  const upd = (fn: (l: Layer) => void) =>
    st.getState().updateGraph(graph.id, (g) => {
      for (const id of [layer.id, ...others.map((x) => x.layerId)]) {
        const l = g.layers.find((x) => x.id === id);
        if (l) fn(l);
      }
    });
  return (
    <InspectorPanel kind="legend" defaultOpen="Legend">
      <Head icon="legend" title="Legend" />
      <Breadcrumb graph={graph} layer={layer} />
      <Group title="Legend">
        <MultiHint n={others.length} what="legends" />
        <Row label="">
          <CheckField label="Visible" checked={lg.visible} onChange={(v) => upd((l) => void (l.legend.visible = v))} />
        </Row>
        <Row label="Position (mm)" title="Relative to the top-left corner of the data area">
          <NumberField value={lg.xMm} step={0.5} onCommit={(v) => upd((l) => void (l.legend.xMm = v))} />
          <NumberField value={lg.yMm} step={0.5} onCommit={(v) => upd((l) => void (l.legend.yMm = v))} />
        </Row>
        <Row label="Symbol width">
          <NumberField value={lg.symbolWidthMm} step={0.5} min={0} onCommit={(v) => upd((l) => void (l.legend.symbolWidthMm = v))} style={{ width: 60 }} />
          <span className="hint">mm</span>
        </Row>
        <Row label="Columns · padding">
          <NumberField value={lg.columns ?? 1} step={1} min={1} max={10} onCommit={(v) => upd((l) => void (l.legend.columns = Math.max(1, Math.round(v))))} style={{ width: 50 }} />
          <NumberField value={lg.paddingMm ?? 1} step={0.5} min={0} onCommit={(v) => upd((l) => void (l.legend.paddingMm = v))} style={{ width: 50 }} />
          <span className="hint">mm</span>
        </Row>
        <Row label="">
          <CheckField label="Border" checked={lg.border} onChange={(v) => upd((l) => void (l.legend.border = v))} />
          <CheckField label="White background" checked={lg.background} onChange={(v) => upd((l) => void (l.legend.background = v))} />
        </Row>
        <FontFields style={lg.style} onChange={(p) => upd((l) => void Object.assign(l.legend.style, p))} />
      </Group>
      <Group title="Entries">
        {layer.plots.map((p) => (
          <Row key={p.id} label={<span className="swatch" style={{ background: p.color, display: "inline-block", verticalAlign: -2 }} />}>
            <CheckField label="" checked={p.showInLegend !== false} onChange={(v) => st.getState().updatePlot(graph.id, layer.id, p.id, (pl) => void (pl.showInLegend = v))} />
            <TextField value={p.name} onCommit={(v) => st.getState().updatePlot(graph.id, layer.id, p.id, (pl) => void (pl.name = v))} />
          </Row>
        ))}
        <div className="hint">Untick an entry to leave it out of the legend. Double-click an entry on the graph to rename it in place.</div>
      </Group>
    </InspectorPanel>
  );
}

// ---------------------------------------------------------------- shape

function ShapeInspector({ graph, layer, shape }: { graph: Graph; layer: Layer; shape: Shape }) {
  const st = useStore;
  const coShapes = useCoSelected("shape").filter((x) => x.shapeId !== shape.id);
  // style edits apply to every selected shape of the same kind, in one undo step
  const sameKind = coShapes.filter((x) => graph.layers.find((l) => l.id === x.layerId)?.shapes?.find((sh) => sh.id === x.shapeId)?.kind === shape.kind);
  const upd = (fn: (s: Shape) => void) =>
    sameKind.length
      ? st.getState().updateGraph(graph.id, (g) => {
          for (const t of [{ layerId: layer.id, shapeId: shape.id }, ...sameKind]) {
            const sh = g.layers.find((l) => l.id === t.layerId)?.shapes?.find((x) => x.id === t.shapeId);
            if (sh) fn(sh);
          }
        })
      : st.getState().updateShape(graph.id, layer.id, shape.id, fn);
  const isLine = shape.kind === "line" || shape.kind === "arrow";
  const isImage = shape.kind === "image";
  const title = { line: "Line", arrow: "Arrow", rect: "Rectangle", ellipse: "Ellipse", image: "Image", polyline: "Polyline", polygon: "Polygon", freehand: "Free-form line" }[shape.kind];
  const isPoints = !!shape.points;
  const mode: CoordMode = shape.coord ?? "mm";
  const unit = mode === "mm" ? "mm" : "axis units";
  // image size in mm (bounds may be in axis units; convert through the layer layout)
  const ll = useMemo(() => layoutLayer(useStore.getState().project, layer), [layer]);
  const mmBounds = ll.shapeMm.get(shape.id) ?? { x1: shape.x1, y1: shape.y1, x2: shape.x2, y2: shape.y2 };
  const wMm = Math.abs(mmBounds.x2 - mmBounds.x1);
  const hMm = Math.abs(mmBounds.y2 - mmBounds.y1);
  const cropMode = useDialogs((s) => s.cropShapeId);
  /** Change one crop edge by a percentage of the full picture; the visible part shrinks/grows on that side. */
  const setCropPct = (side: "l" | "r" | "t" | "b", pct: number) =>
    upd((s) => {
      const c = { ...(s.crop ?? { x: 0, y: 0, w: 1, h: 1 }) };
      const f = Math.min(0.98, Math.max(0, pct / 100));
      const x0 = Math.min(mmBounds.x1, mmBounds.x2);
      const y0 = Math.min(mmBounds.y1, mmBounds.y2);
      const fullW = wMm / c.w;
      const fullH = hMm / c.h;
      let nx0 = x0;
      let ny0 = y0;
      let nx1 = x0 + wMm;
      let ny1 = y0 + hMm;
      if (side === "l") {
        const nf = Math.min(f, c.x + c.w - 0.02);
        nx0 = x0 + (nf - c.x) * fullW;
        c.w = c.x + c.w - nf;
        c.x = nf;
      } else if (side === "r") {
        const right = Math.max(c.x + 0.02, 1 - f);
        nx1 = x0 + (right - c.x) * fullW;
        c.w = right - c.x;
      } else if (side === "t") {
        const nf = Math.min(f, c.y + c.h - 0.02);
        ny0 = y0 + (nf - c.y) * fullH;
        c.h = c.y + c.h - nf;
        c.y = nf;
      } else {
        const bottom = Math.max(c.y + 0.02, 1 - f);
        ny1 = y0 + (bottom - c.y) * fullH;
        c.h = bottom - c.y;
      }
      const a = s.coord === "data" ? ll.toData(nx0, ny0) : { x: nx0, y: ny0 };
      const b = s.coord === "data" ? ll.toData(nx1, ny1) : { x: nx1, y: ny1 };
      Object.assign(s, { x1: a.x, y1: a.y, x2: b.x, y2: b.y, crop: c.x === 0 && c.y === 0 && c.w === 1 && c.h === 1 ? undefined : c });
    });
  const resetCrop = () =>
    upd((s) => {
      const c = s.crop;
      if (!c) return;
      const x0 = Math.min(mmBounds.x1, mmBounds.x2);
      const y0 = Math.min(mmBounds.y1, mmBounds.y2);
      const fullW = wMm / c.w;
      const fullH = hMm / c.h;
      const nx0 = x0 - c.x * fullW;
      const ny0 = y0 - c.y * fullH;
      const a = s.coord === "data" ? ll.toData(nx0, ny0) : { x: nx0, y: ny0 };
      const b = s.coord === "data" ? ll.toData(nx0 + fullW, ny0 + fullH) : { x: nx0 + fullW, y: ny0 + fullH };
      Object.assign(s, { x1: a.x, y1: a.y, x2: b.x, y2: b.y, crop: undefined });
    });
  const setSizeMm = (w: number, h: number) =>
    upd((s) => {
      // keep the top-left corner, resize towards the bottom-right
      const x0 = Math.min(mmBounds.x1, mmBounds.x2);
      const y0 = Math.min(mmBounds.y1, mmBounds.y2);
      const a = s.coord === "data" ? ll.toData(x0, y0) : { x: x0, y: y0 };
      const b = s.coord === "data" ? ll.toData(x0 + w, y0 + h) : { x: x0 + w, y: y0 + h };
      Object.assign(s, { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    });
  return (
    <InspectorPanel kind="shape" defaultOpen="bounds">
      <Head icon={isImage ? "image" : "shapes"} title={title} />
      <Breadcrumb graph={graph} layer={layer} />
      <MultiHint n={sameKind.length} what={`${title.toLowerCase()}s`} />
      <Group id="bounds" title={isLine ? `End points (${unit})` : `Bounds (${unit})`}>
        <CoordModeField
          graph={graph}
          layer={layer}
          mode={mode}
          onSwitch={(to, ll) =>
            upd((s) => {
              if (to === "data") {
                const a = ll.toData(s.x1, s.y1);
                const b = ll.toData(s.x2, s.y2);
                Object.assign(s, { x1: a.x, y1: a.y, x2: b.x, y2: b.y, coord: "data" });
              } else {
                const a = ll.toMm(s.x1, s.y1);
                const b = ll.toMm(s.x2, s.y2);
                Object.assign(s, { x1: Math.round(a.x * 10) / 10, y1: Math.round(a.y * 10) / 10, x2: Math.round(b.x * 10) / 10, y2: Math.round(b.y * 10) / 10, coord: "mm" });
              }
            })
          }
        />
        {isPoints && (
          <div className="hint">
            {shape.points!.length} points · drag a vertex to reshape, or the whole shape to move it.
          </div>
        )}
        {!isPoints && (
        <>
        <Row label={isLine ? "Start" : "Corner 1"}>
          <NumberField value={shape.x1} step={0.5} onCommit={(v) => upd((s) => void (s.x1 = v))} />
          <NumberField value={shape.y1} step={0.5} onCommit={(v) => upd((s) => void (s.y1 = v))} />
        </Row>
        <Row label={isLine ? "End" : "Corner 2"}>
          <NumberField value={shape.x2} step={0.5} onCommit={(v) => upd((s) => void (s.x2 = v))} />
          <NumberField value={shape.y2} step={0.5} onCommit={(v) => upd((s) => void (s.y2 = v))} />
        </Row>
        </>
        )}
        {isPoints && (
          <Row label="Smoothing" title="0 % joins the points with straight segments, 100 % draws a spline through them">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(shapeSmoothing(shape) * 100)}
              onChange={(e) => {
                const v = Number(e.target.value) / 100;
                upd((s) => {
                  s.smoothing = v;
                  delete s.smooth;
                });
              }}
              style={{ width: 90 }}
            />
            <NumberField
              value={Math.round(shapeSmoothing(shape) * 100)}
              step={5}
              min={0}
              max={100}
              onCommit={(v) =>
                upd((s) => {
                  s.smoothing = Math.min(100, Math.max(0, v)) / 100;
                  delete s.smooth;
                })
              }
              style={{ width: 52 }}
            />
            <span className="hint">%</span>
          </Row>
        )}
        {shape.kind === "rect" && (
          <Row label="Rounded corners" title="Radius of the corners; 0 gives square corners">
            <input type="range" min={0} max={20} step={0.5} value={shape.cornerRadiusMm ?? 0} onChange={(e) => upd((s) => void (s.cornerRadiusMm = Number(e.target.value) > 0 ? Number(e.target.value) : undefined))} style={{ width: 90 }} />
            <NumberField value={shape.cornerRadiusMm ?? 0} step={0.5} min={0} onCommit={(v) => upd((s) => void (s.cornerRadiusMm = v > 0 ? v : undefined))} style={{ width: 52 }} />
            <span className="hint">mm</span>
          </Row>
        )}
        <div className="hint">
          {mode === "data" ? "Attached to the axes: the shape follows the data when the axis range changes. " : ""}
          {isImage ? "Drag the picture to move it; drag a corner handle to resize (hold ⌥ to ignore the proportions)." : "Drag the shape to move it; drag its handles to reshape. Hold Shift while drawing for a straight line or a square/circle."}
        </div>
      </Group>
      {isImage && (
        <Group title="Picture">
          {shape.name && (
            <Row label="File">
              <span className="hint" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={shape.name}>
                {shape.name}
              </span>
            </Row>
          )}
          <Row label="Size (mm)">
            <NumberField value={Number(wMm.toFixed(2))} step={1} min={0.1} onCommit={(v) => setSizeMm(v, shape.lockAspect !== false && wMm > 0 ? (v * hMm) / wMm : hMm)} />
            <NumberField value={Number(hMm.toFixed(2))} step={1} min={0.1} onCommit={(v) => setSizeMm(shape.lockAspect !== false && hMm > 0 ? (v * wMm) / hMm : wMm, v)} />
          </Row>
          <Row label="">
            <CheckField label="Keep proportions" checked={shape.lockAspect !== false} onChange={(v) => upd((s) => void (s.lockAspect = v))} />
          </Row>
          <Row label="">
            <button
              className="btn small"
              title="Width and height from the pixel size at 96 dpi"
              disabled={!shape.naturalW || !shape.naturalH}
              onClick={() => shape.naturalW && shape.naturalH && setSizeMm((shape.naturalW * (shape.crop?.w ?? 1)) / (96 / 25.4), (shape.naturalH * (shape.crop?.h ?? 1)) / (96 / 25.4))}
            >
              Natural size
            </button>
            <button
              className="btn small"
              onClick={() => {
                void pickImageFile().then(async (img) => {
                  if (!img) return;
                  const size = await loadImageSize(img.dataUrl);
                  upd((s) => {
                    s.href = img.dataUrl;
                    s.naturalW = size.w;
                    s.naturalH = size.h;
                    s.name = img.name;
                  });
                });
              }}
            >
              Replace…
            </button>
          </Row>
          {shape.naturalW && shape.naturalH ? (
            <div className="hint">
              {shape.naturalW} × {shape.naturalH} px · {Math.round(((shape.naturalW * (shape.crop?.w ?? 1)) / wMm) * 25.4)} dpi at this size
            </div>
          ) : null}
          <Row label="Crop">
            <CheckField
              label="Trim edges on the canvas"
              checked={useDialogs.getState().cropShapeId === shape.id && cropMode === shape.id}
              onChange={(v) => useDialogs.getState().setCropShapeId(v ? shape.id : null)}
            />
          </Row>
          <Row label="Left · Right" title="Percent of the picture cut away on each side">
            <NumberField value={Number((((shape.crop?.x ?? 0) * 100)).toFixed(1))} min={0} max={98} step={1} onCommit={(v) => setCropPct("l", v)} style={{ width: 56 }} />
            <NumberField value={Number((((1 - (shape.crop?.x ?? 0) - (shape.crop?.w ?? 1)) * 100)).toFixed(1))} min={0} max={98} step={1} onCommit={(v) => setCropPct("r", v)} style={{ width: 56 }} />
            <span className="hint">%</span>
          </Row>
          <Row label="Top · Bottom">
            <NumberField value={Number((((shape.crop?.y ?? 0) * 100)).toFixed(1))} min={0} max={98} step={1} onCommit={(v) => setCropPct("t", v)} style={{ width: 56 }} />
            <NumberField value={Number((((1 - (shape.crop?.y ?? 0) - (shape.crop?.h ?? 1)) * 100)).toFixed(1))} min={0} max={98} step={1} onCommit={(v) => setCropPct("b", v)} style={{ width: 56 }} />
            <button className="btn small" disabled={!shape.crop} onClick={() => resetCrop()}>
              Uncrop
            </button>
          </Row>
          <Row label="Opacity">
            <input type="range" min={0} max={1} step={0.05} value={shape.opacity ?? 1} onChange={(e) => upd((s) => void (s.opacity = Number(e.target.value)))} style={{ flex: 1 }} />
            <span className="hint" style={{ width: 36 }}>
              {Math.round((shape.opacity ?? 1) * 100)}%
            </span>
          </Row>
        </Group>
      )}
      <Group id="stroke" title={isImage ? "Border" : "Stroke"}>
        <Row label="Color">
          <ColorField value={shape.stroke} onChange={(v) => upd((s) => void (s.stroke = v))} />
        </Row>
        <Row label="Width (pt)">
          <NumberField value={shape.strokeWidthPt} step={0.25} min={0} onCommit={(v) => upd((s) => void (s.strokeWidthPt = v))} style={{ width: 60 }} />
          <SelectField<LineStyle>
            value={shape.dash}
            options={[
              { value: "solid", label: "Solid" },
              { value: "dash", label: "Dash" },
              { value: "dot", label: "Dot" },
              { value: "dashdot", label: "Dash-dot" },
              { value: "custom", label: "Custom…" },
            ]}
            onChange={(v) => upd((s) => void (s.dash = v))}
          />
        </Row>
        {shape.dash === "custom" && (
          <Row label="Dash · gap (pt)">
            <TextField
              value={shape.dashPt.join(" ")}
              mono
              onCommit={(v) =>
                upd((s) => {
                  const arr = v.split(/[\s,]+/).map(Number).filter((x) => Number.isFinite(x) && x >= 0);
                  s.dashPt = arr.length ? arr : [4, 2];
                })
              }
            />
          </Row>
        )}
      </Group>
      {isImage || shape.kind === "polyline" || shape.kind === "freehand" ? null : isLine ? (
        <Group title="Arrow heads">
          <Row label="">
            <CheckField label="At start" checked={shape.headStart} onChange={(v) => upd((s) => void (s.headStart = v))} />
            <CheckField label="At end" checked={shape.headEnd} onChange={(v) => upd((s) => void (s.headEnd = v))} />
          </Row>
          <Row label="Head size">
            <NumberField value={shape.headSizeMm} step={0.5} min={0.5} onCommit={(v) => upd((s) => void (s.headSizeMm = v))} style={{ width: 60 }} />
            <span className="hint">mm</span>
          </Row>
        </Group>
      ) : (
        <Group title="Fill">
          <Row label="">
            <CheckField label="Filled" checked={shape.fill !== null} onChange={(v) => upd((s) => void (s.fill = v ? "#0072B2" : null))} />
          </Row>
          {shape.fill !== null && (
            <>
              <Row label="Color">
                <ColorField value={shape.fill} onChange={(v) => upd((s) => void (s.fill = v))} />
              </Row>
              <Row label="Opacity">
                <input type="range" min={0} max={1} step={0.05} value={shape.fillOpacity} onChange={(e) => upd((s) => void (s.fillOpacity = Number(e.target.value)))} style={{ flex: 1 }} />
                <span className="hint" style={{ width: 36 }}>
                  {Math.round(shape.fillOpacity * 100)}%
                </span>
              </Row>
            </>
          )}
        </Group>
      )}
      <Group title="Order">
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          <button className="btn small" onClick={() => st.getState().moveShape(graph.id, layer.id, shape.id, 1)}>Bring forward</button>
          <button className="btn small" onClick={() => st.getState().moveShape(graph.id, layer.id, shape.id, -1)}>Send backward</button>
          <button className="btn small" onClick={() => st.getState().moveShape(graph.id, layer.id, shape.id, "front")}>To front</button>
          <button className="btn small" onClick={() => st.getState().moveShape(graph.id, layer.id, shape.id, "back")}>To back</button>
        </div>
        <Row label="">
          <CheckField label="Behind the data (under the plots)" checked={!!shape.behindData} onChange={(v) => upd((s) => void (s.behindData = v))} />
        </Row>
      </Group>
      <Group>
        <button className="btn small" onClick={() => st.getState().deleteShape(graph.id, layer.id, shape.id)}>
          Delete {title.toLowerCase()}
        </button>
      </Group>
    </InspectorPanel>
  );
}

// ---------------------------------------------------------------- text

function TextInspector({ graph, layer, text }: { graph: Graph; layer: Layer; text: TextItem }) {
  const st = useStore;
  const coTexts = useCoSelected("text").filter((x) => x.textId !== text.id);
  const upd = (fn: (t: TextItem) => void) =>
    st.getState().updateGraph(graph.id, (g) => {
      for (const tg of [{ layerId: layer.id, textId: text.id }, ...coTexts]) {
        const t = g.layers.find((l) => l.id === tg.layerId)?.texts.find((x) => x.id === tg.textId);
        if (t) fn(t);
      }
    });
  return (
    <InspectorPanel kind="text" defaultOpen="Text">
      <Head icon="text" title="Text" />
      <Breadcrumb graph={graph} layer={layer} />
      <MultiHint n={coTexts.length} what="texts" />
      <Group title="Text">
        <TextField value={text.text} onCommit={(v) => upd((t) => void (t.text = v))} multiline />
        <div style={{ marginTop: 4 }}>
          <SymbolPicker onPick={(s) => upd((t) => void (t.text = t.text + s))} />
        </div>
      </Group>
      <Group title="Position">
        <CoordModeField
          graph={graph}
          layer={layer}
          mode={text.coord ?? "mm"}
          onSwitch={(to, ll) =>
            upd((t) => {
              if (to === "data") {
                const p = ll.toData(t.xMm, t.yMm);
                Object.assign(t, { xMm: p.x, yMm: p.y, coord: "data" });
              } else {
                const p = ll.toMm(t.xMm, t.yMm);
                Object.assign(t, { xMm: Math.round(p.x * 10) / 10, yMm: Math.round(p.y * 10) / 10, coord: "mm" });
              }
            })
          }
        />
        <Row label={`X · Y (${(text.coord ?? "mm") === "mm" ? "mm" : "axis units"})`}>
          <NumberField value={text.xMm} step={0.5} onCommit={(v) => upd((t) => void (t.xMm = v))} />
          <NumberField value={text.yMm} step={0.5} onCommit={(v) => upd((t) => void (t.yMm = v))} />
        </Row>
        <Row label="Align">
          <Segmented value={text.anchor} options={[{ value: "start", label: "Left" }, { value: "middle", label: "Center" }, { value: "end", label: "Right" }]} onChange={(v) => upd((t) => void (t.anchor = v))} />
        </Row>
        <Row label="Rotation">
          <NumberField value={text.rotation} step={15} onCommit={(v) => upd((t) => void (t.rotation = v))} style={{ width: 60 }} />
          <span className="hint">degrees</span>
        </Row>
      </Group>
      <Group title="Font">
        <FontFields style={text.style} onChange={(p) => upd((t) => void Object.assign(t.style, p))} />
      </Group>
      <Group>
        <button className="btn small" onClick={() => st.getState().updateLayer(graph.id, layer.id, (l) => void (l.texts = l.texts.filter((x) => x.id !== text.id)))}>
          Delete text
        </button>
      </Group>
    </InspectorPanel>
  );
}
