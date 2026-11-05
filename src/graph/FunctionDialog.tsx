import { useState } from "react";
import { Dialog } from "../ui/Dialog";
import { CheckField, NumberField, Row, SelectField, TextField } from "../ui/Fields";
import { useDialogs } from "../app/dialogs";
import { useStore } from "../model/store";
import { validateFunction } from "./functionPlot";

const EXAMPLES = ["sin(x)", "sin(x)/x", "exp(-x^2/2)/sqrt(2*pi)", "1/(1+exp(-x))", "x^2 - 3*x + 1", "log(x)", "abs(x)", "floor(x)", "2*cos(3*x)*exp(-x/5)"];

export function FunctionDialog({ graphId, layerId }: { graphId: string; layerId: string | "new" }) {
  const close = () => useDialogs.getState().setFunctionDialog(null);
  const graph = useStore((s) => s.project.graphs.find((g) => g.id === graphId));
  const [expr, setExpr] = useState("sin(x)/x");
  const [name, setName] = useState("");
  const [useRange, setUseRange] = useState(false);
  const [from, setFrom] = useState<number | null>(-10);
  const [to, setTo] = useState<number | null>(10);
  const [points, setPoints] = useState(400);
  const [target, setTarget] = useState<string>(layerId);
  const error = validateFunction(expr);
  if (!graph) return null;

  const add = () => {
    if (error) return;
    const st = useStore.getState();
    const id = st.addFunctionPlot(graphId, target as string | "new", expr, name.trim() || undefined);
    const lid = useStore
      .getState()
      .project.graphs.find((g) => g.id === graphId)!
      .layers.find((l) => l.plots.some((p) => p.id === id))!.id;
    useStore.getState().updatePlot(graphId, lid, id, (p) => {
      if (p.func) {
        p.func.points = Math.round(points);
        p.func.from = useRange ? from : null;
        p.func.to = useRange ? to : null;
      }
    });
    close();
  };

  return (
    <Dialog
      title="Insert function"
      onClose={close}
      width={520}
      actions={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" onClick={add} disabled={!!error}>
            Add to graph
          </button>
        </>
      }
    >
      <Row label="y =">
        <TextField value={expr} onCommit={setExpr} mono placeholder="sin(x)/x" />
      </Row>
      {error ? <div style={{ color: "var(--danger)", fontSize: 11.5, marginLeft: 88 }}>{error}</div> : <div className="hint" style={{ marginLeft: 88 }}>Use x as the variable; functions like sin, cos, exp, log, log10, sqrt, abs, floor, and constants pi, e.</div>}
      <Row label="Examples">
        <SelectField value="" options={[{ value: "", label: "Pick an example…" }, ...EXAMPLES.map((e) => ({ value: e, label: e }))]} onChange={(v) => v && setExpr(v)} />
      </Row>
      <Row label="Name">
        <TextField value={name} onCommit={setName} placeholder={expr} />
      </Row>
      <Row label="Range">
        <CheckField label="Fixed x range" checked={useRange} onChange={setUseRange} />
        <span className="hint">{useRange ? "" : "(follows the axis range)"}</span>
      </Row>
      {useRange && (
        <Row label="From · To">
          <NumberField value={from} onCommit={setFrom} />
          <NumberField value={to} onCommit={setTo} />
        </Row>
      )}
      <Row label="Points">
        <NumberField value={points} step={100} min={10} max={5000} onCommit={(v) => setPoints(Math.round(v))} style={{ width: 80 }} />
      </Row>
      <Row label="Layer">
        <SelectField value={target} options={[...graph.layers.map((l) => ({ value: l.id, label: l.name })), { value: "new", label: "New layer" }]} onChange={setTarget} />
      </Row>
    </Dialog>
  );
}
