import { Dialog } from "../ui/Dialog";
import { CheckField, FontFields, Group, NumberField, Row, Segmented, SelectField } from "../ui/Fields";
import { PALETTES, paletteIdOf } from "../model/palettes";
import { useDialogs } from "./dialogs";
import { useStore } from "../model/store";
import { defaultGraphDefaults } from "../model/defaults";
import type { GraphDefaults } from "../model/types";


export function SettingsDialog() {
  const close = () => useDialogs.getState().setSettingsOpen(false);
  const d = useStore((s) => s.project.defaults);
  const upd = (fn: (d: GraphDefaults) => void) =>
    useStore.setState((s) => {
      const copy: GraphDefaults = JSON.parse(JSON.stringify(s.project.defaults));
      fn(copy);
      return { project: { ...s.project, defaults: copy }, dirty: true };
    });
  return (
    <Dialog
      title="Settings — defaults for new graphs"
      onClose={close}
      width={560}
      actions={
        <>
          <button className="btn" onClick={() => upd((x) => Object.assign(x, defaultGraphDefaults()))}>
            Reset to factory defaults
          </button>
          <button className="btn primary" onClick={close}>
            Done
          </button>
        </>
      }
    >
      <div className="hint" style={{ marginBottom: 6 }}>
        These defaults are stored in the project and applied to new graphs, layers and plots. Existing graphs are not changed.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px" }}>
        <div>
          <Group title="Figure">
            <Row label="Canvas width">
              <NumberField value={d.canvasWidthMm} min={10} onCommit={(v) => upd((x) => void (x.canvasWidthMm = v))} style={{ width: 70 }} />
              <span className="hint">mm</span>
            </Row>
            <Row label="Data area">
              <NumberField value={d.frame.wMm} min={5} onCommit={(v) => upd((x) => void (x.frame.wMm = v))} />
              <NumberField value={d.frame.hMm} min={5} onCommit={(v) => upd((x) => void (x.frame.hMm = v))} />
            </Row>
            <Row label="Area offset">
              <NumberField value={d.frame.xMm} onCommit={(v) => upd((x) => void (x.frame.xMm = v))} />
              <NumberField value={d.frame.yMm} onCommit={(v) => upd((x) => void (x.frame.yMm = v))} />
            </Row>
          </Group>
          <Group title="Axes">
            <Row label="Line (pt)">
              <NumberField value={d.axisLineWidthPt} step={0.25} min={0} onCommit={(v) => upd((x) => void (x.axisLineWidthPt = v))} style={{ width: 70 }} />
            </Row>
            <Row label="Ticks">
              <Segmented value={d.tickDir} options={[{ value: "out", label: "Out" }, { value: "in", label: "In" }, { value: "none", label: "None" }]} onChange={(v) => upd((x) => void (x.tickDir = v))} />
            </Row>
            <Row label="Tick length">
              <NumberField value={d.majorTickMm} step={0.1} min={0} onCommit={(v) => upd((x) => void (x.majorTickMm = v))} />
              <NumberField value={d.minorTickMm} step={0.1} min={0} onCommit={(v) => upd((x) => void (x.minorTickMm = v))} />
            </Row>
            <Row label="Minor ticks">
              <NumberField value={d.minorCount} step={1} min={0} onCommit={(v) => upd((x) => void (x.minorCount = Math.round(v)))} style={{ width: 70 }} />
            </Row>
          </Group>
          <Group title="Data">
            <Row label="Symbol (pt)">
              <NumberField value={d.markerSizePt} step={0.5} min={0.1} onCommit={(v) => upd((x) => void (x.markerSizePt = v))} style={{ width: 70 }} />
            </Row>
            <Row label="Line (pt)">
              <NumberField value={d.lineWidthPt} step={0.25} min={0} onCommit={(v) => upd((x) => void (x.lineWidthPt = v))} style={{ width: 70 }} />
            </Row>
            <Row label="Palette" title="Colours given to new plots, in this order">
              <SelectField
                value={paletteIdOf(d.colors) ?? ""}
                options={[...(paletteIdOf(d.colors) ? [] : [{ value: "", label: "Custom" }]), ...PALETTES.map((p) => ({ value: p.id, label: p.name }))]}
                onChange={(id) => {
                  const pal = PALETTES.find((p) => p.id === id);
                  if (pal) upd((x) => void (x.colors = [...pal.colors]));
                }}
              />
            </Row>
            {PALETTES.find((p) => p.id === paletteIdOf(d.colors))?.note && <div className="hint" style={{ marginLeft: 88 }}>{PALETTES.find((p) => p.id === paletteIdOf(d.colors))!.note}</div>}
            <div style={{ display: "flex", gap: 3, marginLeft: 88 }}>
              {d.colors.map((c, i) => (
                <input key={i} type="color" value={c} className="input" style={{ width: 22, padding: 0 }} onChange={(e) => upd((x) => void (x.colors[i] = e.target.value))} />
              ))}
            </div>
          </Group>
        </div>
        <div>
          <Group title="Axis title font">
            <FontFields style={d.axisTitle} onChange={(p) => upd((x) => void Object.assign(x.axisTitle, p))} />
          </Group>
          <Group title="Tick label font">
            <FontFields style={d.tickLabel} onChange={(p) => upd((x) => void Object.assign(x.tickLabel, p))} />
          </Group>
          <Group title="Legend font">
            <FontFields style={d.legend} onChange={(p) => upd((x) => void Object.assign(x.legend, p))} />
          </Group>
          <Group title="Export">
            <Row label="Format">
              <Segmented value={d.exportFormat} options={[{ value: "png", label: "PNG" }, { value: "jpeg", label: "JPEG" }, { value: "svg", label: "SVG" }]} onChange={(v) => upd((x) => void (x.exportFormat = v))} />
            </Row>
            <Row label="DPI">
              <NumberField value={d.exportDpi} step={50} min={36} onCommit={(v) => upd((x) => void (x.exportDpi = v))} style={{ width: 70 }} />
            </Row>
            <Row label="">
              <CheckField label="JPEG quality 92%" checked={d.jpegQuality >= 0.92} onChange={(v) => upd((x) => void (x.jpegQuality = v ? 0.92 : 0.8))} />
            </Row>
          </Group>
        </div>
      </div>
    </Dialog>
  );
}
