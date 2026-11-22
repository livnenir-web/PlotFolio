import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { useStore } from "../../model/store";
import type { Graph, GroupColors, Layer, Plot, PlotGroup, Selection } from "../../model/types";
import { PALETTES } from "../../model/palettes";
import { setPlotShown } from "../../model/figure";
import { GROUP_GRADIENTS, createGroup, extendCandidates, extendGroup, groupMembers, moveGroup, placeBlock, placeInGroup, plotBlocks, setGroupShown, ungroup } from "../../model/plotGroups";
import { CheckField, ColorField, Group, Row, TextField } from "../../ui/Fields";
import { Icon } from "../../ui/Icon";
import { reorderRow } from "../../ui/reorder";
import { ALT_KEY } from "../../app/menuModel";

/** Groups whose curves are folded away in the lists (kept while the app runs). */
export const useFoldedGroups = create<{ folded: Record<string, boolean>; toggle: (id: string) => void }>((set) => ({
  folded: {},
  toggle: (id) => set((s) => ({ folded: { ...s.folded, [id]: !s.folded[id] } })),
}));

const plotSel = (graph: Graph, layerId: string, plotId: string): Selection => ({ kind: "plot", graphId: graph.id, layerId, plotId });

/** Select every curve of a group (in all layers); the first one of `layerId` is the one shown in the inspector. */
export function selectGroup(graph: Graph, groupId: string, layerId?: string, plotId?: string): void {
  const members = groupMembers(graph, groupId);
  const first = members.find((m) => m.plot.id === plotId) ?? members.find((m) => m.layer.id === layerId) ?? members[0];
  if (!first) return;
  useStore.getState().selectMany(
    plotSel(graph, first.layer.id, first.plot.id),
    members.filter((m) => m !== first).map((m) => plotSel(graph, m.layer.id, m.plot.id)),
  );
}

/** A checkbox that can show "some" (a dash) besides ticked and empty. A click ticks it unless everything is ticked already. */
export function TriCheck({ state, onChange, title }: { state: "all" | "some" | "none"; onChange: (v: boolean) => void; title?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "some";
  }, [state]);
  return <input ref={ref} type="checkbox" checked={state !== "none"} title={title} onClick={(e) => e.stopPropagation()} onChange={() => onChange(state !== "all")} />;
}

const triOf = (plots: { visible: boolean }[]): "all" | "some" | "none" => {
  const n = plots.filter((p) => p.visible).length;
  return n === 0 ? "none" : n === plots.length ? "all" : "some";
};

/** The colors of a group's curves as a small strip. */
function Strip({ plots }: { plots: Plot[] }) {
  const shown = plots.slice(0, 6);
  return (
    <span className="group-strip">
      {shown.map((p) => (
        <span key={p.id} style={{ background: p.color }} />
      ))}
    </span>
  );
}

/**
 * The plots of a layer in drawing order, curve groups as foldable blocks. Clicking a plot selects it; clicking a
 * group's name selects all its curves (in every layer) for editing together.
 */
export function PlotList({ graph, layer }: { graph: Graph; layer: Layer }) {
  const st = useStore;
  const folded = useFoldedGroups((s) => s.folded);
  // plots picked in the list (click; ⌘- or Shift-click for several): to group, or to edit together
  const [marked, setMarked] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);
  const alt = useRef(false);
  const blocks = plotBlocks(graph, layer);
  const loose = layer.plots.filter((p) => !p.groupId);
  const upd = (fn: (g: Graph) => void) => st.getState().updateGraph(graph.id, fn);
  /** A click on a row: alone it picks that plot, with ⌘ it adds or removes it, with Shift it picks the range from the last one. */
  const pick = (id: string, e: React.MouseEvent) => {
    const order = layer.plots.map((p) => p.id);
    if (e.shiftKey && anchor.current && order.includes(anchor.current)) {
      const [a, b] = [order.indexOf(anchor.current), order.indexOf(id)].sort((x, y) => x - y);
      setMarked(order.slice(a, b + 1));
      return;
    }
    anchor.current = id;
    if (e.metaKey || e.ctrlKey) setMarked((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
    else setMarked([id]);
  };
  /** Open the details of the picked plots: one plot, or several to edit together. */
  const openPlots = (ids: string[]) => {
    const sels = layer.plots.filter((p) => ids.includes(p.id)).map((p) => plotSel(graph, layer.id, p.id));
    if (sels.length) st.getState().selectMany(sels[0], sels.slice(1));
  };
  const makeGroup = (ids: string[]) => {
    let id = "";
    upd((g) => void (id = createGroup(g, ids)));
    setMarked([]);
    const now = st.getState().project.graphs.find((g) => g.id === graph.id);
    if (now && id) selectGroup(now, id, layer.id);
  };
  const spans = blocks.some((b) => b.group && groupMembers(graph, b.group.id).some((m) => m.layer.id !== layer.id));

  // dragging a row: a plot or a whole group among the blocks of the list, a curve of a group among its curves
  const blockScope = `plots:${layer.id}`;
  const dropBlock = (from: number, to: number) => upd((g) => placeBlock(g, g.layers.find((l) => l.id === layer.id)!, from, to));
  const plotRow = (p: Plot, i: number, n: number, group: PlotGroup | null) => (
    <div
      key={p.id}
      {...(group
        ? reorderRow(`group:${group.id}:${layer.id}`, p.id, (_from, to) => upd((g) => placeInGroup(g, g.layers.find((l) => l.id === layer.id)!, p.id, to)))
        : reorderRow(blockScope, p.id, dropBlock))}
      className={"list-item" + (group ? " in-group" : "") + (marked.includes(p.id) ? " marked" : "")}
      onClick={(e) => pick(p.id, e)}
      onDoubleClick={() => openPlots([p.id])}
    >
      <span className="swatch" style={{ background: p.color, opacity: p.visible ? 1 : 0.35 }} />
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: p.visible ? 1 : 0.55 }}>{p.name}</span>
      <button
        className="icon-btn tiny"
        title={group ? "Draw later (on top), within the group" : "Draw later (on top)"}
        disabled={i === n - 1}
        onClick={(e) => {
          e.stopPropagation();
          st.getState().movePlot(graph.id, layer.id, p.id, 1);
        }}
      >
        <Icon name="chevron" size={11} style={{ transform: "rotate(90deg)" }} />
      </button>
      <button
        className="icon-btn tiny"
        title={group ? "Draw earlier (behind), within the group" : "Draw earlier (behind)"}
        disabled={i === 0}
        onClick={(e) => {
          e.stopPropagation();
          st.getState().movePlot(graph.id, layer.id, p.id, -1);
        }}
      >
        <Icon name="chevron" size={11} style={{ transform: "rotate(-90deg)" }} />
      </button>
      <input
        type="checkbox"
        checked={p.visible}
        title={group && spans ? `Visible. With ${ALT_KEY}: the curve of this name in every panel of the group` : "Visible"}
        onClick={(e) => {
          e.stopPropagation();
          alt.current = e.altKey;
        }}
        onChange={(e) => {
          const v = e.target.checked;
          // a plot's fit curves are hidden and shown with it (setPlotShown)
          if (group && alt.current) upd((g) => groupMembers(g, group.id).forEach((m) => m.plot.name === p.name && setPlotShown(m.layer, m.plot, v)));
          else
            st.getState().updateLayer(graph.id, layer.id, (l) => {
              const pl = l.plots.find((x) => x.id === p.id);
              if (pl) setPlotShown(l, pl, v);
            });
        }}
      />
    </div>
  );

  return (
    <>
      {layer.plots.length === 0 && <div className="note">No plots yet.</div>}
      {blocks.map((b, bi) => {
        if (!b.group) return plotRow(b.plots[0], bi, blocks.length, null);
        const g = b.group;
        const all = groupMembers(graph, g.id).map((m) => m.plot);
        const open = !folded[g.id];
        return (
          <div key={g.id + ":" + bi} className="plot-group" {...reorderRow(blockScope, "group:" + g.id, dropBlock)}>
            <div
              className={"list-item group-head" + (b.plots.every((p) => marked.includes(p.id)) ? " marked" : "")}
              onClick={() => {
                anchor.current = b.plots[0].id;
                setMarked(b.plots.map((p) => p.id));
              }}
              onDoubleClick={() => selectGroup(graph, g.id, layer.id)}
              title="Double-click to open the group: what you change then applies to all its curves"
            >
              <button
                className="icon-btn tiny"
                title={open ? "Fold the group" : "Unfold the group"}
                onClick={(e) => {
                  e.stopPropagation();
                  useFoldedGroups.getState().toggle(g.id);
                }}
              >
                <Icon name="chevron" size={11} style={{ transform: open ? "rotate(90deg)" : "none" }} />
              </button>
              <Strip plots={b.plots} />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>{g.name}</span>
              <span className="hint" style={{ flex: "none" }}>
                {b.plots.length}
              </span>
              <button
                className="icon-btn tiny"
                title="Draw the group later (on top)"
                disabled={bi === blocks.length - 1}
                onClick={(e) => {
                  e.stopPropagation();
                  upd((gr) => moveGroup(gr, layer.id, g.id, 1));
                }}
              >
                <Icon name="chevron" size={11} style={{ transform: "rotate(90deg)" }} />
              </button>
              <button
                className="icon-btn tiny"
                title="Draw the group earlier (behind)"
                disabled={bi === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  upd((gr) => moveGroup(gr, layer.id, g.id, -1));
                }}
              >
                <Icon name="chevron" size={11} style={{ transform: "rotate(-90deg)" }} />
              </button>
              <TriCheck
                state={triOf(all)}
                title={all.length > b.plots.length ? "Show or hide the group, in every panel. Showing it brings back the curves that were shown before." : "Show or hide the group. Showing it brings back the curves that were shown before."}
                // a group with some curves shown is hidden by the click (showing it again brings those curves back)
                onChange={() => upd((gr) => setGroupShown(gr, g.id, triOf(all) === "none"))}
              />
            </div>
            {open && b.plots.map((p, i) => plotRow(p, i, b.plots.length, g))}
          </div>
        );
      })}
      {layer.plots.length > 0 && (
        <Row label="" wrap>
          {marked.length >= 2 ? (
            <button className="btn small" title="Make one group of the selected plots" onClick={() => makeGroup(marked)}>
              Group {marked.length}
            </button>
          ) : (
            <button className="btn small" disabled={loose.length < 2} title="Make one group of the plots of this layer that are not in a group yet" onClick={() => makeGroup(loose.map((p) => p.id))}>
              Group all
            </button>
          )}
          <button className="btn small" disabled={marked.length === 0} title={marked.length > 1 ? "Open the selected plots: what you change applies to all of them" : "Open the details of the selected plot (or double-click it)"} onClick={() => openPlots(marked)}>
            {marked.length > 1 ? `Edit ${marked.length}` : "Details"}
          </button>
        </Row>
      )}
    </>
  );
}

const schemeOf = (c: GroupColors | undefined): string => (!c ? "" : c.type === "palette" ? `palette:${c.paletteId}` : c.type === "shades" ? "shades" : `map:${c.name}`);

/** Settings of the curve group a plot belongs to (PlotInspector): name, colors, where it reaches, and leaving it. */
export function PlotGroupSection({ graph, layer, plot, group, whole }: { graph: Graph; layer: Layer; plot: Plot; group: PlotGroup; whole?: boolean }) {
  const st = useStore;
  const members = groupMembers(graph, group.id);
  const layers = new Set(members.map((m) => m.layer.id));
  const here = members.filter((m) => m.layer.id === layer.id).map((m) => m.plot);
  const more = extendCandidates(graph, group.id).length;
  const updGroup = (fn: (g: PlotGroup) => void) =>
    st.getState().updateGraph(graph.id, (gr) => {
      const g = gr.plotGroups?.find((x) => x.id === group.id);
      if (g) fn(g);
    });
  const reselect = () => {
    const now = st.getState().project.graphs.find((g) => g.id === graph.id);
    if (now) selectGroup(now, group.id, layer.id, plot.id);
  };
  const setScheme = (v: string) =>
    updGroup((g) => {
      if (!v) delete g.colors;
      else if (v === "shades") g.colors = { type: "shades", base: g.colors?.type === "shades" ? g.colors.base : plot.color };
      else if (v.startsWith("palette:")) g.colors = { type: "palette", paletteId: v.slice(8) };
      else g.colors = { type: "colormap", name: v.slice(4) as never };
    });
  return (
    <Group title="Group" tab={whole ? "*" : "style"}>
      <Row label="Name">
        <TextField value={group.name} onCommit={(v) => v.trim() && updGroup((g) => void (g.name = v.trim()))} />
      </Row>
      <Row label="Colors" title="Where the curves of the group get their colors from. A gradient or shades run from the first curve of each panel to the last.">
        <select className="input" value={schemeOf(group.colors)} onChange={(e) => setScheme(e.target.value)}>
          <option value="">Each curve its own</option>
          <optgroup label="In order (light to dark)">
            <option value="shades">Shades of one color</option>
            {GROUP_GRADIENTS.map((g) => (
              <option key={g.name} value={`map:${g.name}`}>
                {g.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Palettes">
            {PALETTES.map((p) => (
              <option key={p.id} value={`palette:${p.id}`}>
                {p.name}
              </option>
            ))}
          </optgroup>
        </select>
      </Row>
      {group.colors?.type === "shades" && (
        <Row label="Shades of">
          <ColorField value={group.colors.base} onChange={(v) => updGroup((g) => void (g.colors = { type: "shades", base: v }))} />
        </Row>
      )}
      {group.colors && (
        <Row label="">
          <CheckField label="Reverse the order" checked={!!group.reverse} onChange={(v) => updGroup((g) => void (g.reverse = v || undefined))} />
        </Row>
      )}
      <Row label="">
        <span className="group-strip wide">
          {here.map((p) => (
            <span key={p.id} style={{ background: p.color, opacity: p.visible ? 1 : 0.3 }} title={p.name + (p.visible ? "" : " (hidden)")} />
          ))}
        </span>
      </Row>
      <div className="note">
        {members.length} curve{members.length === 1 ? "" : "s"}
        {layers.size > 1 ? ` in ${layers.size} panels` : ""}
      </div>
      <Row label="" wrap>
        <button className="btn small" title="Select every curve of the group: what you change then applies to all of them" onClick={reselect}>
          Select all {members.length}
        </button>
        <button
          className="btn small"
          disabled={more === 0}
          title={more ? `Add the ${more} curve${more === 1 ? "" : "s"} with the same names in the other panels to this group` : "No other curve of the figure has the name of a curve of this group"}
          onClick={() => {
            st.getState().updateGraph(graph.id, (gr) => void extendGroup(gr, group.id));
            reselect();
          }}
        >
          Extend to all panels
        </button>
      </Row>
      <Row label="" wrap>
        <button className="btn small" title="Take this curve out of the group" onClick={() => st.getState().updatePlot(graph.id, layer.id, plot.id, (p) => void delete p.groupId)}>
          Remove this curve
        </button>
        <button
          className="btn small"
          title="Dissolve the group; the curves stay as they are"
          onClick={() => {
            st.getState().updateGraph(graph.id, (gr) => ungroup(gr, group.id));
            st.getState().setSelection({ kind: "layer", graphId: graph.id, layerId: layer.id });
          }}
        >
          Ungroup
        </button>
      </Row>
    </Group>
  );
}
