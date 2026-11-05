import { useDialogs } from "../app/dialogs";
import { baseName, browserPickFiles, isTauri, pickOpenFile, readBinary, readText, stripExt } from "./platform";
import { readWorkbook } from "./importXlsx";
import { openProject } from "./project";

const TEXT_EXT = ["csv", "tsv", "txt", "dat", "asc"];
const XLSX_EXT = ["xlsx", "xlsm", "xls"];

export const IMPORT_FILTERS = [
  { name: "Data files", extensions: [...TEXT_EXT, ...XLSX_EXT] },
  { name: "Text", extensions: TEXT_EXT },
  { name: "Excel", extensions: XLSX_EXT },
];

function ext(name: string): string {
  return (name.split(".").pop() ?? "").toLowerCase();
}

/** Open the import dialog for a file on disk (Tauri). */
export async function importPath(path: string): Promise<void> {
  const name = baseName(path);
  const e = ext(name);
  if (e === "plotproj") {
    await openProject(path);
    return;
  }
  if (XLSX_EXT.includes(e)) {
    const data = await readBinary(path);
    useDialogs.getState().setImportSource({ name: stripExt(name), workbook: readWorkbook(data) });
  } else {
    const text = await readText(path);
    useDialogs.getState().setImportSource({ name: stripExt(name), text });
  }
}

/** Open the import dialog for a browser File object. */
export async function importFileObject(file: File): Promise<void> {
  const e = ext(file.name);
  if (e === "plotproj") {
    const { deserializeProject } = await import("./project");
    const { useStore } = await import("../model/store");
    useStore.getState().loadProject(deserializeProject(await file.text()), null);
    return;
  }
  if (XLSX_EXT.includes(e)) {
    const data = new Uint8Array(await file.arrayBuffer());
    useDialogs.getState().setImportSource({ name: stripExt(file.name), workbook: readWorkbook(data) });
  } else {
    useDialogs.getState().setImportSource({ name: stripExt(file.name), text: await file.text() });
  }
}

/** File > Import… */
export async function importViaDialog(): Promise<void> {
  if (isTauri()) {
    const paths = await pickOpenFile(IMPORT_FILTERS, true);
    if (!paths) return;
    for (const p of paths) await importPath(p);
  } else {
    const files = await browserPickFiles(".csv,.tsv,.txt,.dat,.xlsx,.xls", true);
    for (const f of files) await importFileObject(f);
  }
}
