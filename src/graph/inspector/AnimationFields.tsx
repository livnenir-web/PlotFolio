import { useMemo } from "react";
import { create } from "zustand";
import { useStore } from "../../model/store";
import { useDialogs } from "../../app/dialogs";
import type { Animation, Graph, LineStyle, MarkerShape } from "../../model/types";
import { shownLayers } from "../../model/figure";
import { CheckField, ColorField, Group, NumberField, Row, Segmented, SelectField } from "../../ui/Fields";
import { Icon } from "../../ui/Icon";
import { moveItem, reorderRow } from "../../ui/reorder";
import { Info } from "../../ui/Tooltip";
import { buildUpUnits, frameSchedule, isRevealable, rangeLayerOf, revealRange } from "../animation";
import { plotBlocks } from "../../model/plotGroups";
import { TriCheck } from "./PlotGroups";
import { toggleAnimation, usePlayback } from "../animationPlayback";
import { keyHint, useShortcuts } from "../../app/shortcuts";
import { layoutGraph } from "../layout";

const SHAPES: { value: MarkerShape; label: string }[] = [
  { value: "circle", label: "Circle" },
  { value: "square", label: "Square" },
  { value: "triangle", label: "Triangle" },
  { value: "diamond", label: "Diamond" },
  { value: "cross", label: "Cross" },
  { value: "plus", label: "Plus" },
];
const STYLES: { value: LineStyle; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "dash", label: "Dash" },
  { value: "dot", label: "Dot" },
  { value: "dashdot", label: "Dash-dot" },
];
const num = (v: number) => Number(v.toPrecision(6));
const short = (v: number) => Number(v.toPrecision(3));

/** Which nodes of the plot tree are folded (true) or unfolded (false); nodes not listed follow their default. */
const useAnimTree = create<{ folded: Record<string, boolean>; set: (key: string, folded: boolean) => void }>((set) => ({
  folded: {},
  set: (key, folded) => set((s) => ({ folded: { ...s.folded, [key]: folded } })),
}));

function Fold({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button className="icon-btn tiny" title={open ? "Fold" : "Unfold"} onClick={onClick}>
      <Icon name="chevron" size={11} style={{ transform: open ? "rotate(90deg)" : "none" }} />
    </button>
  );
}

function PlotNode({ name, color, checked, onChange, pad }: { name: string; color: string; checked: boolean; onChange: (v: boolean) => void; pad?: boolean }) {
  return (
    <label className="node">
      {pad && <span style={{ width: 18, flex: "none" }} />}
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="swatch" style={{ background: color }} />
      <span className="name" title={name}>
        {name}
      </span>
    </label>
  );
}
/** The Animation tab of the figure inspector: the switch, the timing and one section per effect (reveal, turn, build up). */
export function AnimationGroup({ graph }: { graph: Graph }) {
  const st = useStore;
  const sheets = useStore((s) => s.project.sheets);
  const picking = useDialogs((s) => s.rangePick);
  const overrides = useShortcuts((s) => s.overrides);
  // folded / unfolded nodes of the plot tree: "anim:<layerId>" for layers, the group id for groups
  const folded = useAnimTree((s) => s.folded);
  const setFolded = useAnimTree((s) => s.set);
  const anim = graph.animation;
  const layout = useMemo(() => layoutGraph(st.getState().project, graph), [sheets, graph, st]);
  const upd = (fn: (a: Animation) => void) => st.getState().updateGraph(graph.id, (g) => void (g.animation && fn(g.animation)));
  const on = !!anim?.enabled;

  if (!anim || !on) {
    return (
      <Group>
        <div className="anim-master">
          <CheckField label="Animate this figure" checked={false} onChange={() => toggleAnimation(graph.id, true)} />
          <Info text="Reveal the data over time with the current point marked, turn a 3D view, or let the plots appear one by one. A timeline appears under the figure; the animation is saved with the project and exports as a video, a GIF or numbered pictures." />
        </div>
      </Group>
    );
  }

  const r = anim.reveal;
  const sch = frameSchedule(anim);
  // hidden layers are not animated: their plots are left out of every list here
  const layers = shownLayers(graph);
  const plots = layers.flatMap((l) => l.plots.filter((p) => p.visible).map((p) => ({ plot: p, layer: l })));
  const revealable = plots.filter((x) => isRevealable(x.plot));
  const has3d = layers.some((l) => l.view3d && l.axes.z);
  const view = layers.find((l) => l.view3d && l.axes.z)?.view3d;
  // the layer whose x range the reveal sweeps (the first with plots that reveal along x)
  const rangeLayer = rangeLayerOf(layout, r) ?? undefined;
  const range = rangeLayer ? revealRange(rangeLayer, { ...r, enabled: true }) : null;
  const span = range ? range.to - range.from : null;
  const isOn = (id: string) => r.plotIds === null || r.plotIds.includes(id);
  /** Tick or untick several plots of the reveal at once (a plot, a group, a layer or all of them). */
  const togglePlots = (ids: string[], v: boolean) =>
    upd((a) => {
      const all = revealable.map((x) => x.plot.id);
      const cur = new Set(a.reveal.plotIds ?? all);
      for (const id of ids) {
        if (v) cur.add(id);
        else cur.delete(id);
      }
      a.reveal.plotIds = all.every((x) => cur.has(x)) ? null : all.filter((x) => cur.has(x));
    });
  const triOf = (ids: string[]): "all" | "some" | "none" => {
    const n = ids.filter(isOn).length;
    return n === 0 ? "none" : n === ids.length ? "all" : "some";
  };
  // the plots that can be revealed, layer by layer, the curves of a group together
  const tree = layers
    .map((l) => ({
      layer: l,
      blocks: plotBlocks(graph, l)
        .map((b) => ({ group: b.group, plots: b.plots.filter((p) => p.visible && isRevealable(p)) }))
        .filter((b) => b.plots.length > 0),
    }))
    .filter((x) => x.blocks.length > 0);
  // in a figure with many panels the layers start folded: the list stays short and a layer is ticked as a whole
  const foldedByDefault = tree.length > 3;
  // with layers or groups in the list, single plots line up with the folding arrows of the rows around them
  const nested = tree.length > 1 || tree.some((x) => x.blocks.some((b) => b.group));
  const isOpen = (key: string, byDefault: boolean) => (folded[key] === undefined ? byDefault : !folded[key]);
  const pickRange = () => {
    if (picking) return useDialogs.getState().setRangePick(null);
    if (!rangeLayer) return;
    // pick on the complete figure, not on a half-drawn frame
    usePlayback.getState().reset();
    useDialogs.getState().setRangePick({
      graphId: graph.id,
      layerId: rangeLayer.layer.id,
      what: "range to animate",
      onPick: (from, to) => {
        useDialogs.getState().setRangePick(null);
        if (to > from)
          upd((a) => {
            a.reveal.from = num(from);
            a.reveal.to = num(to);
          });
      },
    });
  };
  const units = buildUpUnits(graph, anim.buildUp);
  const order = units.map((u) => u.key);
  const move = (id: string, by: number) =>
    upd((a) => {
      const o = [...order];
      const i = o.indexOf(id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= o.length) return;
      [o[i], o[j]] = [o[j], o[i]];
      a.buildUp.order = o;
    });
  const unit = anim.buildUp.unit ?? "plot";
  const hasGroups = plots.some((x) => x.plot.groupId);
  const manyLayers = layers.filter((l) => l.plots.some((p) => p.visible)).length > 1;
  const stepOptions: { value: "plot" | "group" | "layer"; label: string }[] = [{ value: "plot", label: "Plot" }, ...(hasGroups || unit === "group" ? [{ value: "group" as const, label: "Group" }] : []), ...(manyLayers || unit === "layer" ? [{ value: "layer" as const, label: "Panel" }] : [])];
  const layerOfPlot = (id: string) => plots.find((x) => x.plot.id === id)?.layer.name;

  const about =
    [keyHint("playAnimation", overrides) && `${keyHint("playAnimation", overrides)} plays and pauses`, keyHint("animStepBack", overrides) && keyHint("animStepForward", overrides) && `${keyHint("animStepBack", overrides)} and ${keyHint("animStepForward", overrides)} step one frame`].filter(Boolean).join("; ") +
    (keyHint("playAnimation", overrides) || keyHint("animStepBack", overrides) ? ". " : "") +
    "Pictures and copies of the figure always show it complete.";
  /** Title of an effect's section; says when the effect is on, so the closed sections tell what plays. */
  const effectTitle = (name: string, enabled: boolean) => (
    <>
      {name}
      {enabled && <span className="anim-state">on</span>}
    </>
  );

  return (
    <>
      <Group>
        <div className="anim-master">
          <CheckField label="Animate this figure" checked={on} onChange={(v) => toggleAnimation(graph.id, v)} />
          <Info text={about} />
        </div>
      </Group>
      <Group title="Timing">
      <Row label="Duration" title="How long the animation runs, without the pause at the end">
        <NumberField value={anim.durationS} min={0.1} max={600} step={0.5} onCommit={(v) => v > 0 && upd((a) => void (a.durationS = Math.min(600, v)))} style={{ width: 60 }} />
        <span className="hint">s</span>
      </Row>
      <Row label="Frame rate" title="Frames per second of the preview and of the exported video. 30 is smooth; 60 is smoother and twice the work.">
        <NumberField value={anim.fps} min={1} max={60} step={1} onCommit={(v) => v >= 1 && upd((a) => void (a.fps = Math.min(60, Math.round(v))))} style={{ width: 60 }} />
        <span className="hint">per second</span>
      </Row>
      <Row label="At the end" title="Start again from the beginning, or stay on the last frame">
        <Segmented
          value={anim.loop ? "loop" : "stop"}
          options={[
            { value: "loop", label: "Loop" },
            { value: "stop", label: "Stop" },
          ]}
          onChange={(v) => upd((a) => void (a.loop = v === "loop"))}
        />
      </Row>
      <Row label="Pause at end" title="How long the complete figure stays before the animation ends or starts again">
        <NumberField value={anim.holdEndS} min={0} max={60} step={0.5} onCommit={(v) => v >= 0 && upd((a) => void (a.holdEndS = Math.min(60, v)))} style={{ width: 60 }} />
        <span className="hint">s</span>
      </Row>
      <div className="note" title={r.enabled && span !== null && span > 0 ? `The x range ${short(range!.from)} … ${short(range!.to)} plays in ${short(anim.durationS)} s.` : undefined}>
        {sch.count} frames{r.enabled && span !== null && span > 0 ? ` · ${short(span / anim.durationS)} x units per second` : ""}
      </div>
      </Group>
      <Group id="reveal" title={effectTitle("Reveal the data", r.enabled)}>
      <div className="anim-check">
        <CheckField label="Reveal the data over time" checked={r.enabled} onChange={(v) => upd((a) => void (a.reveal.enabled = v))} />
      </div>
      {r.enabled && (
        <>
          <Row label="Along" title="X axis: every plot is drawn up to the same x value, like time passing. Point order: each plot is drawn point by point (always used for trajectories whose x goes back and forth, and in 3D).">
            <Segmented
              value={r.mode}
              options={[
                { value: "x", label: "X axis" },
                { value: "order", label: "Point order" },
              ]}
              onChange={(v) => upd((a) => void (a.reveal.mode = v))}
            />
          </Row>
          {r.mode === "x" && !rangeLayer && revealable.length > 0 && (
            <div className="note" title="They are in 3D, or their x values go back and forth.">
              These plots are drawn in point order.
            </div>
          )}
          {r.mode === "x" && rangeLayer && (
            <>
              <Row label="Range" title="The x values the animation runs through. Empty fields use the data inside the x axis. In a figure with several layers the range is for the first animated one and for layers with the same x axis title; other layers run through their own range.">
                <NumberField value={r.from} placeholder={range ? String(short(range.from)) : "start"} onCommit={(v) => upd((a) => void (a.reveal.from = v))} />
                <span className="hint">to</span>
                <NumberField value={r.to} placeholder={range ? String(short(range.to)) : "end"} onCommit={(v) => upd((a) => void (a.reveal.to = v))} />
              </Row>
              <Row label="">
                <button className={"btn small" + (picking ? " on" : "")} title="Drag across the data area of the figure to choose the range" onClick={pickRange}>
                  {picking ? "Cancel" : "Pick…"}
                </button>
                <button
                  className="btn small"
                  disabled={r.from === null && r.to === null}
                  title="Animate everything the x axis shows"
                  onClick={() =>
                    upd((a) => {
                      a.reveal.from = null;
                      a.reveal.to = null;
                    })
                  }
                >
                  Whole axis
                </button>
              </Row>
              <Row label="X axis" title="Fixed: the axis stays as it is while the data appears. Follow: the axis shows a window that moves with the current point, like an oscilloscope.">
                <Segmented
                  value={r.axes}
                  options={[
                    { value: "fixed", label: "Fixed" },
                    { value: "follow", label: "Follow" },
                  ]}
                  onChange={(v) => upd((a) => void (a.reveal.axes = v))}
                />
              </Row>
              {r.axes === "follow" && (
                <Row label="Window" title="Width of the moving window, in x units">
                  <NumberField value={r.followWindow} min={0} onCommit={(v) => v > 0 && upd((a) => void (a.reveal.followWindow = v))} style={{ width: 70 }} />
                  <span className="hint">wide</span>
                </Row>
              )}
            </>
          )}
          {revealable.length > 1 && (
            <>
              <div className="anim-label" title="The others (a fit, a reference curve) are there from the start. Tick a layer or a group to take all its plots.">
                Plots drawn over time
              </div>
              <div className="anim-tree">
                {tree.length > 1 && (
                  <div className="node top">
                    <span style={{ width: 18, flex: "none" }} />
                    <TriCheck state={triOf(revealable.map((x) => x.plot.id))} onChange={(v) => togglePlots(revealable.map((x) => x.plot.id), v)} />
                    <span className="name">All plots</span>
                    <span className="hint">
                      {revealable.filter((x) => isOn(x.plot.id)).length}/{revealable.length}
                    </span>
                  </div>
                )}
                {tree.map(({ layer: l, blocks }) => {
                  const ids = blocks.flatMap((b) => b.plots.map((p) => p.id));
                  const lKey = "anim:" + l.id;
                  const lOpen = tree.length === 1 || isOpen(lKey, !foldedByDefault);
                  const kids = blocks.map((b) => {
                    if (!b.group) {
                      const p = b.plots[0];
                      return <PlotNode key={p.id} name={p.name} color={p.color} checked={isOn(p.id)} onChange={(v) => togglePlots([p.id], v)} pad={nested} />;
                    }
                    const gIds = b.plots.map((p) => p.id);
                    const gKey = "anim:" + l.id + ":" + b.group.id;
                    const gOpen = isOpen(gKey, false);
                    return (
                      <div key={gKey}>
                        <div className="node top">
                          <Fold open={gOpen} onClick={() => setFolded(gKey, gOpen)} />
                          <TriCheck state={triOf(gIds)} onChange={(v) => togglePlots(gIds, v)} />
                          <span className="name" title={b.group.name}>
                            {b.group.name}
                          </span>
                          <span className="hint">
                            {gIds.filter(isOn).length}/{gIds.length}
                          </span>
                        </div>
                        {gOpen && (
                          <div className="kids">
                            {b.plots.map((p) => (
                              <PlotNode key={p.id} name={p.name} color={p.color} checked={isOn(p.id)} onChange={(v) => togglePlots([p.id], v)} pad={nested} />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  });
                  if (tree.length === 1) return <div key={l.id}>{kids}</div>;
                  return (
                    <div key={l.id}>
                      <div className="node top">
                        <Fold open={lOpen} onClick={() => setFolded(lKey, lOpen)} />
                        <TriCheck state={triOf(ids)} onChange={(v) => togglePlots(ids, v)} />
                        <span className="name" title={l.name}>
                          {l.name}
                        </span>
                        <span className="hint">
                          {ids.filter(isOn).length}/{ids.length}
                        </span>
                      </div>
                      {lOpen && <div className="kids">{kids}</div>}
                    </div>
                  );
                })}
              </div>
            </>
          )}
          {revealable.length === 0 && <div className="note">This figure has no line or scatter plot to reveal.</div>}
          <Row label="Current point">
            <CheckField label="Mark it" checked={r.marker.show} onChange={(v) => upd((a) => void (a.reveal.marker.show = v))} />
          </Row>
          {r.marker.show && (
            <>
              <Row label="Symbol">
                <SelectField value={r.marker.shape === "none" ? "circle" : r.marker.shape} options={SHAPES} onChange={(v) => upd((a) => void (a.reveal.marker.shape = v))} />
              </Row>
              <Row label="Size">
                <NumberField value={r.marker.sizePt} min={0.5} max={30} step={0.5} onCommit={(v) => v > 0 && upd((a) => void (a.reveal.marker.sizePt = v))} style={{ width: 56 }} />
                <span className="hint">pt</span>
                <CheckField label="Filled" checked={r.marker.filled} onChange={(v) => upd((a) => void (a.reveal.marker.filled = v))} />
              </Row>
              <Row label="Color">
                <ColorField value={r.marker.color} onChange={(v) => upd((a) => void (a.reveal.marker.color = v))} />
              </Row>
            </>
          )}
          {r.mode === "x" && rangeLayer && (
            <Row label="Cursor line" title="A vertical line through the current x value">
              <CheckField label="Show" checked={r.cursor.show} onChange={(v) => upd((a) => void (a.reveal.cursor.show = v))} />
            </Row>
          )}
          {r.mode === "x" && rangeLayer && r.cursor.show && (
            <>
              <Row label="Line">
                <SelectField value={r.cursor.style === "custom" ? "dash" : r.cursor.style} options={STYLES} onChange={(v) => upd((a) => void (a.reveal.cursor.style = v))} />
              </Row>
              <Row label="Line width">
                <NumberField value={r.cursor.widthPt} min={0.1} max={10} step={0.25} onCommit={(v) => v > 0 && upd((a) => void (a.reveal.cursor.widthPt = v))} style={{ width: 56 }} />
                <span className="hint">pt</span>
              </Row>
              <Row label="Line color">
                <ColorField value={r.cursor.color} onChange={(v) => upd((a) => void (a.reveal.cursor.color = v))} />
              </Row>
            </>
          )}
          <Row label="Values" title="The x and y of the current point as text">
            <CheckField label="Show" checked={r.readout.show} onChange={(v) => upd((a) => void (a.reveal.readout.show = v))} />
          </Row>
          {r.readout.show && (
            <>
              <Row label="Placed" title="Next to the current point, or in the top-left corner of the data area">
                <Segmented
                  value={r.readout.position}
                  options={[
                    { value: "marker", label: "At the point" },
                    { value: "corner", label: "Corner" },
                  ]}
                  onChange={(v) => upd((a) => void (a.reveal.readout.position = v))}
                />
              </Row>
              <Row label="Decimals">
                <NumberField value={r.readout.decimals} min={0} max={10} step={1} onCommit={(v) => v >= 0 && upd((a) => void (a.reveal.readout.decimals = Math.round(v)))} style={{ width: 48 }} />
              </Row>
            </>
          )}
          <Row label="Older data" title="Keep everything that was drawn, or only the stretch just behind the current point (a moving trace)">
            <SelectField
              value={r.tail.mode}
              options={[
                { value: "none", label: "Stays" },
                { value: "fade", label: "Fades out" },
                { value: "hide", label: "Disappears" },
              ]}
              onChange={(v) => upd((a) => void (a.reveal.tail.mode = v))}
            />
          </Row>
          {r.tail.mode !== "none" && (
            <Row label="Trace length" title="How much stays behind the current point: in x units, or in points for plots drawn in point order">
              <NumberField value={r.tail.window} min={0} onCommit={(v) => v > 0 && upd((a) => void (a.reveal.tail.window = v))} style={{ width: 70 }} />
              <span className="hint">{r.mode === "x" && rangeLayer ? "x units" : "points"}</span>
            </Row>
          )}
        </>
      )}
      </Group>

      {has3d && (
        <Group id="turn" title={effectTitle("Turn the 3D view", anim.rotate.enabled)}>
          <div className="anim-check">
            <CheckField label="Turn the 3D view" checked={anim.rotate.enabled} onChange={(v) => upd((a) => void (a.rotate.enabled = v))} />
          </div>
          {anim.rotate.enabled && (
            <>
              <Row label="Azimuth" title="Rotation about the vertical axis, in degrees, at the start and at the end. 360° apart is a full turn.">
                <NumberField value={anim.rotate.azimuthFrom} step={5} onCommit={(v) => upd((a) => void (a.rotate.azimuthFrom = v))} />
                <span className="hint">to</span>
                <NumberField value={anim.rotate.azimuthTo} step={5} onCommit={(v) => upd((a) => void (a.rotate.azimuthTo = v))} />
              </Row>
              <Row label="Elevation" title="Tilt of the view, in degrees, at the start and at the end">
                <NumberField value={anim.rotate.elevationFrom} step={5} min={-89} max={89} onCommit={(v) => upd((a) => void (a.rotate.elevationFrom = Math.max(-89, Math.min(89, v))))} />
                <span className="hint">to</span>
                <NumberField value={anim.rotate.elevationTo} step={5} min={-89} max={89} onCommit={(v) => upd((a) => void (a.rotate.elevationTo = Math.max(-89, Math.min(89, v))))} />
              </Row>
              <Row label="Motion" title="Steady: constant speed, best for a loop. Ease: starts and ends gently.">
                <Segmented
                  value={anim.rotate.easing}
                  options={[
                    { value: "linear", label: "Steady" },
                    { value: "inOut", label: "Ease" },
                  ]}
                  onChange={(v) => upd((a) => void (a.rotate.easing = v))}
                />
              </Row>
              <Row label="">
                <button
                  className="btn small"
                  disabled={!view}
                  title="One full turn that starts and ends at the angles set in the layer's 3D view"
                  onClick={() =>
                    view &&
                    upd((a) => {
                      a.rotate.azimuthFrom = view.azimuth;
                      a.rotate.azimuthTo = view.azimuth + 360;
                      a.rotate.elevationFrom = view.elevation;
                      a.rotate.elevationTo = view.elevation;
                    })
                  }
                >
                  Full turn
                </button>
              </Row>
            </>
          )}
        </Group>
      )}

      <Group id="buildup" title={effectTitle("Build up", anim.buildUp.enabled)}>
      <div className="anim-check">
        <CheckField label="Let the plots appear one by one" checked={anim.buildUp.enabled} onChange={(v) => upd((a) => void (a.buildUp.enabled = v))} />
      </div>
      {anim.buildUp.enabled && (
        <>
          <Row label="Transition">
            <Segmented
              value={anim.buildUp.transition}
              options={[
                { value: "cut", label: "Cut" },
                { value: "fade", label: "Fade in" },
              ]}
              onChange={(v) => upd((a) => void (a.buildUp.transition = v))}
            />
          </Row>
          {stepOptions.length > 1 && (
            <Row label="Step by" title="What appears in one step: each plot on its own, the curves of a group together, or a whole panel (layer) with all its plots">
              <Segmented value={unit} options={stepOptions} onChange={(v) => upd((a) => void (a.buildUp.unit = v === "plot" ? undefined : v))} />
            </Row>
          )}
          <div className="anim-label">
            Order
            <Info text={`Each ${unit === "plot" ? "plot" : "step"} gets an equal share of the duration and its legend ${unit === "plot" ? "entry appears" : "entries appear"} with it.${r.enabled ? ` With the reveal on, ${unit === "plot" ? "each plot is" : "its plots are"} drawn during that share.` : ""}`} />
          </div>
          <div className="anim-tree">
              {units.map(({ key: id, label, plotIds }, i) => (
                <div key={id} className="reorder-row" style={{ display: "flex", alignItems: "center", gap: 4 }} {...reorderRow(`buildup:${graph.id}`, id, (from, to) => upd((a) => void (a.buildUp.order = moveItem(order, from, to))))}>
                  <span className="hint" style={{ width: 14 }}>
                    {i + 1}
                  </span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={label}>
                    {label}
                    {unit === "plot" && manyLayers ? <span className="hint"> · {layerOfPlot(id)}</span> : plotIds.length > 1 ? <span className="hint"> · {plotIds.length} plots</span> : null}
                  </span>
                  <button className="btn small" disabled={i === 0} title="Earlier" onClick={() => move(id, -1)}>
                    ↑
                  </button>
                  <button className="btn small" disabled={i === order.length - 1} title="Later" onClick={() => move(id, 1)}>
                    ↓
                  </button>
                </div>
              ))}
            </div>
        </>
      )}
      </Group>
      <Group>
        <button className="btn" onClick={() => useDialogs.getState().setAnimationExport({ graphId: graph.id })}>
          <Icon name="export" size={13} /> Export as video, GIF or frames…
        </button>
      </Group>
    </>
  );
}
