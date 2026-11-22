import { useMemo, useState } from "react";
import { Dialog } from "../ui/Dialog";
import { useDialogs } from "../app/dialogs";
import { useStore } from "../model/store";
import { describe, statisticsSheet } from "../sheet/stats";
import { dataCurves } from "./graphCurves";

/** Statistics of the plots of a graph: opened with the selected plots ticked. */
export interface StatsInit {
  graphId: string;
  plotIds: string[];
}

const sig = (v: number) => (Number.isFinite(v) ? Number(v.toPrecision(5)).toString() : "–");

/**
 * Statistics started from a graph: n, mean, SD, SEM, median, minimum and maximum of the numbers each ticked plot
 * draws (its data column), shown over the figure. The table can be copied or written to a report sheet; the figure
 * stays in front. (From a sheet, the same numbers go straight to a "Statistics of …" sheet.)
 */
export function StatsDialog({ graphId, plotIds }: StatsInit) {
  const close = () => useDialogs.getState().setStats(null);
  const project = useStore((s) => s.project);
  const graph = project.graphs.find((g) => g.id === graphId);
  const curves = useMemo(() => (graph ? dataCurves(project, graph, "values") : []), [project, graph]);
  const [picked, setPicked] = useState<string[]>(plotIds);
  if (!graph) return null;
  const manyPanels = new Set(curves.map((c) => c.layer.id)).size > 1;
  const rows = curves
    .filter((c) => picked.includes(c.plot.id))
    .map((c) => {
      const values = project.sheets.find((s) => s.id === c.plot.source.sheetId)?.columns.find((col) => col.id === c.plot.source.yColId)?.values ?? [];
      return { id: c.plot.id, name: `${c.plot.name}${manyPanels ? ` — ${c.layer.name}` : ""}`, color: c.plot.color, values, stats: describe(values.filter((v): v is number => typeof v === "number")) };
    });
  const withNumbers = rows.filter((r) => r.stats);
  const heads = ["n", "Mean", "SD", "SEM", "Median", "Min", "Max"];
  const cellsOf = (s: NonNullable<ReturnType<typeof describe>>) => [String(s.n), sig(s.mean), sig(s.sd), sig(s.sem), sig(s.median), sig(s.min), sig(s.max)];

  const copy = () => {
    const text = [["Plot", ...heads].join("\t"), ...withNumbers.map((r) => [r.name, ...cellsOf(r.stats!)].join("\t"))].join("\n");
    void navigator.clipboard.writeText(text).then(
      () => useDialogs.getState().showToast("Statistics copied: paste them into a sheet, a text or a spreadsheet"),
      () => useDialogs.getState().showToast("The clipboard is not available here; use Report sheet instead"),
    );
  };
  const report = () => {
    statisticsSheet(graph.name, withNumbers.map((r) => ({ name: r.name, values: r.values })));
    close();
  };

  const cell: React.CSSProperties = { padding: "3px 10px 3px 0", textAlign: "left", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
  const headCell: React.CSSProperties = { ...cell, color: "var(--text-2)", fontWeight: 400, borderBottom: "1px solid var(--border)" };
  return (
    <Dialog
      title="Statistics"
      info="The numbers of each ticked plot's data column (its y values): how many, their mean, standard deviation, standard error of the mean, median, smallest and largest."
      onClose={close}
      width={720}
      actions={
        <>
          <button className="btn" onClick={report} disabled={!withNumbers.length} title="Write the table to a new sheet">
            Report sheet
          </button>
          <button className="btn" onClick={copy} disabled={!withNumbers.length} title="Copy the table, tab-separated">
            Copy table
          </button>
          <button className="btn primary" onClick={close}>
            Done
          </button>
        </>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: "0 20px" }}>
        <div>
          <div className="group-title">Plots of “{graph.name}”</div>
          <div style={{ border: "1px solid var(--border)", borderRadius: 3, padding: 4, maxHeight: 260, overflow: "auto" }}>
            {curves.map((c) => (
              <label key={c.plot.id} className="check" style={{ padding: "2px 4px" }}>
                <input type="checkbox" checked={picked.includes(c.plot.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, c.plot.id] : picked.filter((k) => k !== c.plot.id))} />
                <span style={{ width: 9, height: 9, borderRadius: 2, background: c.plot.color, flex: "none" }} />
                <span>{`${c.plot.name}${manyPanels ? ` — ${c.layer.name}` : ""}`}</span>
              </label>
            ))}
          </div>
        </div>
        <div style={{ minWidth: 0, overflow: "auto", maxHeight: 290 }}>
          {withNumbers.length ? (
            <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
              <thead>
                <tr>
                  <th style={headCell}>Plot</th>
                  {heads.map((h) => (
                    <th key={h} style={headCell}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {withNumbers.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...cell, whiteSpace: "normal" }}>{r.name}</td>
                    {cellsOf(r.stats!).map((v, i) => (
                      <td key={i} style={cell}>
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="note">{rows.length ? "The ticked plots hold no numbers." : "Tick the plots to describe."}</div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
