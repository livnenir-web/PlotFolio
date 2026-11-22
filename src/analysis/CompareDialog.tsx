import { useMemo, useState } from "react";
import { Dialog } from "../ui/Dialog";
import { CheckField, Row, Segmented, SelectField } from "../ui/Fields";
import { useDialogs } from "../app/dialogs";
import { oneUndoStep, useStore } from "../model/store";
import { columnLetter, newColumn, uid, uniqueName } from "../model/defaults";
import type { Column, Sheet } from "../model/types";
import { anova, formatP, ksTest, mean, pairwiseKs, pairwiseT, stars, tTest, tukeyHsd, variance, type PairResult, type TTestKind } from "./compare";
import { distributionLayers, groupLayers, boxPlotOf, withBrackets, type BracketPair } from "./compareGraph";
import { plotKind } from "../graph/plotKinds";
import { dataCurves } from "./graphCurves";
import { isExcludedPlot } from "../model/exclude";

export interface CompareInit {
  /** opened from a sheet: the groups are its columns */
  sheetId?: string;
  /** columns to start with (default: the Y columns of the sheet) */
  colIds?: string[];
  /**
   * Opened from a graph (no sheetId): the groups are the plots of the figure, each with the numbers of its data
   * column, whichever sheets they read. The layer is the first choice for "Add to graph".
   */
  graphId?: string;
  layerId?: string;
  /** the plots selected on the graph: ticked to start with when there are two or more */
  plotIds?: string[];
  /** the test to start with (default: t-test for two groups, ANOVA for more) */
  test?: Test;
}

type Test = "t" | "anova" | "ks";

const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : NaN);
const sig = (v: number, digits = 4) => (Number.isFinite(v) ? Number(v.toPrecision(digits)).toString() : "–");
const colName = (sheet: Sheet, c: Column) => c.longName || columnLetter(sheet.columns.indexOf(c));
const enough = (values: Column["values"]) => values.filter((v) => Number.isFinite(num(v))).length >= 2;

/** One group that can be compared: a column of a sheet, or — from a graph — the data column of one of its plots. */
interface Candidate {
  key: string;
  name: string;
  /** in the list of groups, when the name alone does not tell two of them apart */
  label?: string;
  sheetId: string;
  colId: string;
  values: number[];
  /** from a graph */
  plotId?: string;
  layerId?: string;
  color?: string;
  type?: string;
  visible?: boolean;
}

interface Outcome {
  /** the result in one line, e.g. "F(2, 61) = 18.6, p < 0.0001" */
  headline: string;
  detail?: string;
  /** what the pairwise rows show */
  pairNote?: string;
  diffLabel: string;
  pairs: PairResult[];
}

export function CompareDialog({ init }: { init: CompareInit }) {
  const close = () => useDialogs.getState().setCompare(null);
  const project = useStore((s) => s.project);
  const graph = init.graphId ? project.graphs.find((g) => g.id === init.graphId) : undefined;
  const fromGraph = !init.sheetId && !!graph;
  const [sheetId, setSheetId] = useState(init.sheetId ?? "");
  const sheet = project.sheets.find((s) => s.id === sheetId);
  const candidates = useMemo((): Candidate[] => {
    if (!fromGraph) return sheet ? sheet.columns.filter((c) => enough(c.values)).map((c) => ({ key: c.id, name: colName(sheet, c), sheetId: sheet.id, colId: c.id, values: c.values.map(num) })) : [];
    // the plots of the figure that hold numbers, the panel the dialog was opened from first; a column drawn twice counts once
    const seen = new Set<string>();
    const out: Candidate[] = [];
    const curves = dataCurves(project, graph!, "values").filter((c) => !isExcludedPlot(project, c.plot));
    for (const c of [...curves.filter((x) => x.layer.id === init.layerId), ...curves.filter((x) => x.layer.id !== init.layerId)]) {
      const col = project.sheets.find((x) => x.id === c.plot.source.sheetId)?.columns.find((x) => x.id === c.plot.source.yColId);
      const ref = `${c.plot.source.sheetId}:${c.plot.source.yColId}`;
      if (!col || !enough(col.values) || seen.has(ref)) continue;
      seen.add(ref);
      out.push({ key: c.plot.id, name: c.plot.name, label: `${c.plot.name} — ${c.layer.name}`, sheetId: c.plot.source.sheetId, colId: col.id, values: col.values.map(num), plotId: c.plot.id, layerId: c.layer.id, color: c.plot.color, type: c.plot.type, visible: c.plot.visible });
    }
    // the panel is named only where two plots share a name
    for (const c of out) if (out.filter((x) => x.name === c.name).length < 2) c.label = undefined;
    return out;
  }, [fromGraph, sheet, project, graph, init.layerId]);
  const [picked, setPicked] = useState<string[]>(() => {
    if (fromGraph) {
      const sel = candidates.filter((c) => init.plotIds?.includes(c.key));
      if (sel.length >= 2) return sel.map((c) => c.key);
      // nothing chosen: the visible plots of one panel, its boxes and histograms when it has them
      const layerId = (candidates.find((c) => c.layerId === init.layerId) ?? candidates[0])?.layerId;
      const inLayer = candidates.filter((c) => c.layerId === layerId && c.visible);
      const groups = inLayer.filter((c) => c.type === "box" || c.type === "histogram");
      return (groups.length >= 2 ? groups : inLayer).map((c) => c.key);
    }
    const sh = project.sheets.find((s) => s.id === init.sheetId);
    if (!sh) return [];
    const fromInit = (init.colIds ?? []).filter((id) => sh.columns.some((c) => c.id === id && enough(c.values)));
    if (fromInit.length >= 2) return fromInit;
    return sh.columns.filter((c) => c.designation === "Y" && enough(c.values)).map((c) => c.id);
  });
  const cols = useMemo(() => candidates.filter((c) => picked.includes(c.key)), [candidates, picked]);
  const [test, setTest] = useState<Test>(() => init.test ?? (fromGraph && cols.length >= 2 && cols.every((c) => c.type === "histogram") ? "ks" : picked.length > 2 ? "anova" : "t"));
  const [tKind, setTKind] = useState<TTestKind>("welch");
  const [postHoc, setPostHoc] = useState<"tukey" | "holm">("tukey");
  const [labelMode, setLabelMode] = useState<"stars" | "p">("stars");
  const [onlySig, setOnlySig] = useState(false);
  const [target, setTarget] = useState<string | null>(null);

  const groups = useMemo(() => cols.map((c) => c.values), [cols]);
  const names = cols.map((c) => c.name);

  const outcome = useMemo((): Outcome | string => {
    if (groups.length < 2) return fromGraph ? "Tick at least two plots: each plot is one group." : "Tick at least two columns: each column is one group.";
    if (test === "t") {
      if (groups.length === 2) {
        const r = tTest(groups[0], groups[1], tKind);
        if (!r) return tKind === "paired" ? "A paired test needs at least two rows with a value in both columns, and differences that are not all the same." : "Each group needs at least two values, and the values must not all be the same.";
        return {
          headline: `t(${sig(r.df)}) = ${sig(r.t)}, ${formatP(r.p)}`,
          detail: `Mean difference ${sig(r.diff)} (95 % interval ${sig(r.ciLow)} to ${sig(r.ciHigh)})`,
          diffLabel: "Difference of means",
          pairs: [{ a: 0, b: 1, diff: r.diff, stat: r.t, p: r.p }],
        };
      }
      return { headline: "A t-test for every pair of groups", pairNote: "p values corrected for the number of comparisons (Holm).", diffLabel: "Difference of means", pairs: pairwiseT(groups, tKind) };
    }
    if (test === "anova") {
      const av = anova(groups);
      if (!av) return "ANOVA needs at least one value in every group, more values than groups, and some spread within the groups.";
      const pairs = postHoc === "tukey" ? (tukeyHsd(groups) ?? []) : pairwiseT(groups, "welch");
      return {
        headline: `F(${av.dfBetween}, ${av.dfWithin}) = ${sig(av.f)}, ${formatP(av.p)}`,
        pairNote: postHoc === "tukey" ? "Pairs compared with Tukey's test." : "Pairs compared with Welch t-tests, p values corrected (Holm).",
        diffLabel: "Difference of means",
        pairs,
      };
    }
    if (groups.length === 2) {
      const r = ksTest(groups[0], groups[1]);
      if (!r) return "Each group needs at least one value.";
      return {
        headline: `D = ${sig(r.d)}, ${formatP(r.p)}`,
        detail: `The two cumulative distributions are furthest apart at ${sig(r.at)}.${r.exact ? "" : " p from the large-sample formula."}`,
        diffLabel: "Largest distance D",
        pairs: [{ a: 0, b: 1, diff: r.d, stat: r.d, p: r.p }],
      };
    }
    return { headline: "A Kolmogorov–Smirnov test for every pair of groups", pairNote: "p values corrected for the number of comparisons (Holm).", diffLabel: "Largest distance D", pairs: pairwiseKs(groups) };
  }, [groups, test, tKind, postHoc]);

  // where the result can go: layers that already show these groups, or a new graph
  const targets = useMemo(() => {
    const found = cols.length >= 2 ? (test === "ks" ? distributionLayers(project, cols) : groupLayers(project, cols)) : [];
    // the graph the dialog was opened from comes first
    found.sort((a, b) => Number(b.graphId === init.graphId) - Number(a.graphId === init.graphId) || Number(b.layerId === init.layerId) - Number(a.layerId === init.layerId));
    return found;
  }, [project, cols, test, init.graphId, init.layerId]);
  if (!sheet && !fromGraph) return null;
  const result = typeof outcome === "string" ? null : outcome;
  const labelOf = (p: number) => (labelMode === "stars" ? stars(p) : formatP(p));
  const targetKey = target !== null && (target === "new" || targets.some((t) => `${t.graphId}/${t.layerId}` === target)) ? target : targets[0] ? `${targets[0].graphId}/${targets[0].layerId}` : "new";

  const addToGraph = () => {
    if (!result) return;
    oneUndoStep(() => {
      const st = useStore.getState();
      let graphId: string;
      let layerId: string;
      if (targetKey === "new") {
        const kind = plotKind(test === "ks" ? "cdf" : "box");
        if (cols.every((c) => c.sheetId === cols[0].sheetId)) {
          graphId = st.plotColumns(cols[0].sheetId, cols.map((c) => c.colId), null, null, kind.type, kind.apply);
          layerId = useStore.getState().project.graphs.find((g) => g.id === graphId)!.layers[0].id;
        } else {
          // groups from several sheets: one plot each
          graphId = st.addGraph();
          layerId = useStore.getState().project.graphs.find((g) => g.id === graphId)!.layers[0].id;
          for (const c of cols) useStore.getState().addPlot(graphId, layerId, kind.type, { sheetId: c.sheetId, xColId: null, yColId: c.colId }, undefined, kind.apply);
        }
      } else [graphId, layerId] = targetKey.split("/");
      const now = useStore.getState();
      const layer = now.project.graphs.find((g) => g.id === graphId)?.layers.find((l) => l.id === layerId);
      if (!layer) return;
      const shown = result.pairs.filter((p) => Number.isFinite(p.p) && (!onlySig || p.p <= 0.05));
      if (test === "ks") {
        // a line of text just above the data area, flush with its right edge, clear of the curves
        const lines = shown.map((p) => `${groups.length > 2 ? `${names[p.a]} – ${names[p.b]}: ` : "KS test: "}D = ${sig(p.stat, 3)}, ${formatP(p.p)}`);
        if (lines.length) {
          const style = { ...now.project.defaults.tickLabel };
          const lineMm = ((style.sizePt * 25.4) / 72) * 1.2;
          const single = now.project.graphs.find((g) => g.id === graphId)!.layers.length === 1;
          now.updateLayer(graphId, layerId, (l) => {
            // several lines need more room above the data area than a new graph leaves: move the area down
            const short = lines.length * lineMm + 2.3 - l.frame.yMm;
            if (short > 0 && single) l.frame.yMm += Math.ceil(short * 2) / 2;
            l.texts.push({ id: uid(), text: lines.join("\n"), xMm: l.frame.xMm + l.frame.wMm, yMm: l.frame.yMm - 1.8 - (lines.length - 1) * lineMm, style, rotation: 0, anchor: "end" });
          });
        }
      } else {
        const pairs: BracketPair[] = shown.flatMap((p) => {
          const a = boxPlotOf(layer, cols[p.a].sheetId, cols[p.a].colId);
          const b = boxPlotOf(layer, cols[p.b].sheetId, cols[p.b].colId);
          return a && b ? [{ a: a.id, b: b.id, label: labelOf(p.p) }] : [];
        });
        const shapes = withBrackets(now.project, layer, pairs, now.project.defaults.tickLabel);
        now.updateLayer(graphId, layerId, (l) => void (l.shapes = shapes));
      }
      useStore.getState().openTab({ kind: "graph", id: graphId });
      useStore.getState().setSelection({ kind: "layer", graphId, layerId });
      useDialogs.getState().showToast(test === "ks" ? "Result added to the graph" : shown.length ? `${shown.length} bracket${shown.length === 1 ? "" : "s"} added — click one to edit or move it` : "No pair is significant, so no bracket was added");
    });
    close();
  };

  const reportSheet = () => {
    if (!result) return;
    const st = useStore.getState();
    const mk = (name: string, d: Column["designation"], values: Column["values"]): Column => {
      const c = newColumn(d);
      c.longName = name;
      c.values = values;
      return c;
    };
    const r = (v: number) => (Number.isFinite(v) ? Number(v.toPrecision(8)) : null);
    const testName = test === "t" ? `t-test (${tKind === "welch" ? "Welch" : tKind === "student" ? "equal variances" : "paired"})` : test === "anova" ? `One-way ANOVA, ${postHoc === "tukey" ? "Tukey" : "Holm-corrected t-tests"}` : "Kolmogorov–Smirnov test";
    const head = groups.length > 2 || test === "anova";
    const out: Sheet = {
      id: uid(),
      name: uniqueName(`Comparison of ${fromGraph ? graph!.name : sheet!.name}`, st.project.sheets.map((s) => s.name)),
      columns: [
        mk("Group A", "label", [...(head ? ["All groups"] : []), ...result.pairs.map((p) => names[p.a])]),
        mk("Group B", "label", [...(head ? [""] : []), ...result.pairs.map((p) => names[p.b])]),
        mk(result.diffLabel, "none", [...(head ? [null] : []), ...result.pairs.map((p) => r(p.diff))]),
        mk("p", "none", [...(head ? [test === "anova" ? r(anova(groups)?.p ?? NaN) : null] : []), ...result.pairs.map((p) => r(p.p))]),
        mk("Significance", "label", [...(head ? [test === "anova" ? stars(anova(groups)?.p ?? NaN) : ""] : []), ...result.pairs.map((p) => stars(p.p))]),
        mk("Test", "label", [testName, result.headline, ...(result.detail ? [result.detail] : [])]),
      ],
    };
    st.addSheetObject(out);
    close();
  };

  const cell: React.CSSProperties = { padding: "3px 8px 3px 0", textAlign: "left", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
  const headCell: React.CSSProperties = { ...cell, color: "var(--text-2)", fontWeight: 400, borderBottom: "1px solid var(--border)" };

  return (
    <Dialog
      title="Compare groups"
      info={test === "t" ? "t-test: do two groups have the same mean?" : test === "anova" ? "ANOVA: do three or more groups share one mean? Then each pair is compared." : "Kolmogorov–Smirnov: do two groups follow the same distribution? Compares their cumulative distributions (CDF), whatever their shape."}
      onClose={close}
      width={680}
      actions={
        <>
          <button className="btn" onClick={close}>
            Close
          </button>
          <button className="btn" onClick={reportSheet} disabled={!result} title="Write the results to a new sheet">
            Report sheet
          </button>
          <button className="btn primary" onClick={addToGraph} disabled={!result} title={test === "ks" ? "Write the result on a graph of the cumulative distributions" : "Draw a bracket with its label over each pair of groups"}>
            Add to graph
          </button>
        </>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "210px 1fr", gap: "0 20px" }}>
        <div>
          {!fromGraph && project.sheets.length > 1 && (
            <SelectField
              value={sheetId}
              options={project.sheets.map((s) => ({ value: s.id, label: s.name }))}
              onChange={(v) => {
                setSheetId(v);
                const sh = project.sheets.find((s) => s.id === v);
                setPicked(sh ? sh.columns.filter((c) => c.designation === "Y" && enough(c.values)).map((c) => c.id) : []);
              }}
              style={{ width: "100%", marginBottom: 6 }}
            />
          )}
          <div className="group-title">{fromGraph ? `Groups (the plots of “${graph!.name}”)` : "Groups (one column each)"}</div>
          <div style={{ border: "1px solid var(--border)", borderRadius: 3, padding: 4, maxHeight: 250, overflow: "auto" }}>
            {candidates.map((c) => (
              <label key={c.key} className="check" style={{ padding: "2px 4px" }}>
                <input type="checkbox" checked={picked.includes(c.key)} onChange={(e) => setPicked(e.target.checked ? [...picked, c.key] : picked.filter((id) => id !== c.key))} />
                {fromGraph && <span style={{ width: 9, height: 9, borderRadius: 2, background: c.color, flex: "none" }} />}
                <span>{fromGraph || !sheet ? (c.label ?? c.name) : `${columnLetter(sheet.columns.findIndex((x) => x.id === c.colId))}${sheet.columns.find((x) => x.id === c.colId)?.longName ? ` — ${c.name}` : ""}`}</span>
              </label>
            ))}
            {!candidates.length && <div className="note">{fromGraph ? "This figure has no plots that read numbers from a sheet." : "This sheet has no columns with numbers."}</div>}
          </div>
        </div>
        <div style={{ minWidth: 0 }}>
          <Row label="Test">
            <Segmented
              value={test}
              options={[
                { value: "t", label: "t-test" },
                { value: "anova", label: "ANOVA" },
                { value: "ks", label: "KS test" },
              ]}
              onChange={setTest}
            />
          </Row>
          {test === "t" && (
            <Row label="Groups are">
              <SelectField
                value={tKind}
                options={[
                  { value: "welch", label: "Independent (Welch)" },
                  { value: "student", label: "Independent, equal variances" },
                  { value: "paired", label: "Paired, row by row" },
                ]}
                onChange={setTKind}
              />
            </Row>
          )}
          {test === "anova" && (
            <Row label="Pairs by">
              <SelectField
                value={postHoc}
                options={[
                  { value: "tukey", label: "Tukey's test" },
                  { value: "holm", label: "t-tests, Holm-corrected" },
                ]}
                onChange={setPostHoc}
              />
            </Row>
          )}
          {typeof outcome === "string" ? (
            <div className="note">{outcome}</div>
          ) : (
            <>
              <div style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{outcome.headline}</div>
              {outcome.detail && <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 2 }}>{outcome.detail}</div>}
              <div style={{ maxHeight: 190, overflow: "auto", marginTop: 8 }}>
                <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={headCell}>Pair</th>
                      <th style={headCell}>{outcome.diffLabel}</th>
                      <th style={headCell}>p</th>
                      <th style={headCell}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {outcome.pairs.map((p) => (
                      <tr key={`${p.a}-${p.b}`} style={{ color: onlySig && !(p.p <= 0.05) ? "var(--text-3)" : undefined }}>
                        <td style={{ ...cell, whiteSpace: "normal" }}>
                          {names[p.a]} – {names[p.b]}
                        </td>
                        <td style={cell}>{sig(p.diff)}</td>
                        <td style={cell}>{formatP(p.p).replace(/^p [=] /, "").replace(/^p /, "")}</td>
                        <td style={{ ...cell, fontWeight: 600 }}>{stars(p.p)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {outcome.pairNote && <div className="note" style={{ marginTop: 4 }}>{outcome.pairNote}</div>}
              <table style={{ borderCollapse: "collapse", fontSize: 12, marginTop: 10 }}>
                <thead>
                  <tr>
                    <th style={headCell}>Group</th>
                    <th style={headCell}>n</th>
                    <th style={headCell}>Mean</th>
                    <th style={headCell}>SD</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g, i) => {
                    const v = g.filter(Number.isFinite);
                    return (
                      <tr key={cols[i].key}>
                        <td style={cell}>{names[i]}</td>
                        <td style={cell}>{v.length}</td>
                        <td style={cell}>{sig(mean(v))}</td>
                        <td style={cell}>{sig(Math.sqrt(variance(v)))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
      {result && (
        <div style={{ borderTop: "1px solid var(--border)", marginTop: 12, paddingTop: 10 }}>
          <Row label="Add to">
            <SelectField
              value={targetKey}
              options={[...targets.map((t) => ({ value: `${t.graphId}/${t.layerId}`, label: t.name })), { value: "new", label: test === "ks" ? "A new graph of the cumulative distributions" : "A new box plot of these groups" }]}
              onChange={setTarget}
            />
          </Row>
          {test !== "ks" && (
            <Row wrap label="Labels" title="Stars: ns p > 0.05 · * p ≤ 0.05 · ** p ≤ 0.01 · *** p ≤ 0.001 · **** p ≤ 0.0001">
              <Segmented value={labelMode} options={[{ value: "stars", label: "Stars" }, { value: "p", label: "p values" }]} onChange={setLabelMode} />
              <CheckField label="Significant pairs only" checked={onlySig} onChange={setOnlySig} />
            </Row>
          )}
        </div>
      )}
    </Dialog>
  );
}
