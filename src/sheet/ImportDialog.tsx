import { useEffect, useMemo, useState } from "react";
import { Dialog } from "../ui/Dialog";
import { CheckField, NumberField, Row, SelectField, TextField } from "../ui/Fields";
import { useDialogs, type ImportSource } from "../app/dialogs";
import { useStore } from "../model/store";
import { guessOptions, parseDelimited, tableToSheet, type TextImportOptions, defaultTextImportOptions, looksLikeHeader } from "../io/importText";

export function ImportDialog({ source }: { source: ImportSource }) {
  const close = () => useDialogs.getState().setImportSource(null);
  const [sheetName, setSheetName] = useState(source.name);
  const [wsName, setWsName] = useState(source.workbook?.sheetNames[0] ?? "");
  const [opts, setOpts] = useState<TextImportOptions>(() => (source.text ? guessOptions(source.text) : defaultTextImportOptions));

  const rows = useMemo(() => {
    if (source.text) return parseDelimited(source.text, opts.delimiter).rows;
    if (source.workbook) return source.workbook.table(wsName);
    return [];
  }, [source, opts.delimiter, wsName]);

  useEffect(() => {
    if (!source.workbook) return;
    const header = looksLikeHeader(rows);
    setOpts((o) => ({ ...o, headerRow: header ? 1 : 0, firstDataRow: header ? 2 : 1 }));
  }, [rows, source.workbook]);

  const nCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const preview = rows.slice(0, 30);

  const doImport = () => {
    const sheet = tableToSheet(rows, opts, sheetName.trim() || source.name);
    useStore.getState().addSheetObject(sheet);
    close();
  };

  return (
    <Dialog
      title={`Import ${source.name}`}
      onClose={close}
      width={720}
      actions={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" onClick={doImport} disabled={rows.length === 0}>
            Import
          </button>
        </>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 24px" }}>
        <div>
          <Row label="Sheet name">
            <TextField value={sheetName} onCommit={setSheetName} />
          </Row>
          {source.workbook && (
            <Row label="Worksheet">
              <SelectField value={wsName} options={source.workbook.sheetNames.map((n) => ({ value: n, label: n }))} onChange={setWsName} />
            </Row>
          )}
          {source.text && (
            <Row label="Delimiter">
              <SelectField
                value={opts.delimiter}
                options={[
                  { value: "auto", label: "Auto-detect" },
                  { value: ",", label: "Comma" },
                  { value: "\t", label: "Tab" },
                  { value: ";", label: "Semicolon" },
                  { value: " ", label: "Whitespace" },
                  { value: "|", label: "Pipe" },
                ]}
                onChange={(delimiter) => setOpts({ ...opts, delimiter })}
              />
            </Row>
          )}
        </div>
        <div>
          <Row label="Header row">
            <NumberField value={opts.headerRow} step={1} min={0} onCommit={(headerRow) => setOpts({ ...opts, headerRow })} style={{ width: 64 }} />
            <span className="hint">0 = none</span>
          </Row>
          <Row label="Units row">
            <NumberField value={opts.unitsRow} step={1} min={0} onCommit={(unitsRow) => setOpts({ ...opts, unitsRow })} style={{ width: 64 }} />
            <span className="hint">0 = none</span>
          </Row>
          <Row label="First data row">
            <NumberField value={opts.firstDataRow} step={1} min={1} onCommit={(firstDataRow) => setOpts({ ...opts, firstDataRow })} style={{ width: 64 }} />
          </Row>
          <Row label="">
            <CheckField label="Decimal comma (1,5)" checked={opts.decimalComma} onChange={(decimalComma) => setOpts({ ...opts, decimalComma })} />
          </Row>
        </div>
      </div>
      <div className="hint" style={{ marginTop: 8 }}>
        {rows.length} rows × {nCols} columns. First column becomes X, the rest Y; change designations later from the column header menu.
      </div>
      <div style={{ maxHeight: 300, overflow: "auto", border: "1px solid var(--border)", borderRadius: 6, marginTop: 6 }}>
        <table className="preview-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              {Array.from({ length: nCols }, (_, i) => (
                <th key={i}>{String.fromCharCode(65 + (i % 26))}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.map((r, i) => {
              const n = i + 1;
              const cls = n === opts.headerRow ? "header" : n === opts.unitsRow ? "units" : n < opts.firstDataRow ? "skip" : "";
              return (
                <tr key={i} className={cls}>
                  <td style={{ color: "var(--text-3)" }}>{n}</td>
                  {Array.from({ length: nCols }, (_, c) => (
                    <td key={c}>{r[c] ?? ""}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}
