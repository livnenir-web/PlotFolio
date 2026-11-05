// Thin wrapper over Tauri file APIs with browser fallbacks, so the UI also runs in a plain Vite dev server.

export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface FileFilter {
  name: string;
  extensions: string[];
}

export async function pickOpenFile(filters: FileFilter[], multiple = false): Promise<string[] | null> {
  if (!isTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const res = await open({ multiple, filters, directory: false });
  if (!res) return null;
  return Array.isArray(res) ? res : [res];
}

export async function pickSaveFile(filters: FileFilter[], defaultName?: string): Promise<string | null> {
  if (!isTauri()) return null;
  const { save } = await import("@tauri-apps/plugin-dialog");
  const res = await save({ filters, defaultPath: defaultName });
  return res ?? null;
}

export async function readText(path: string): Promise<string> {
  const { readTextFile } = await import("@tauri-apps/plugin-fs");
  return readTextFile(path);
}

export async function readBinary(path: string): Promise<Uint8Array> {
  const { readFile } = await import("@tauri-apps/plugin-fs");
  return readFile(path);
}

export async function writeText(path: string, text: string): Promise<void> {
  const { writeTextFile } = await import("@tauri-apps/plugin-fs");
  await writeTextFile(path, text);
}

export async function writeBinary(path: string, data: Uint8Array): Promise<void> {
  const { writeFile } = await import("@tauri-apps/plugin-fs");
  await writeFile(path, data);
}

/** Browser fallback: trigger a download. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Browser fallback: open a file picker and read the files. */
export function browserPickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.click();
  });
}

/** Save text either to a chosen path (Tauri) or as a download (browser). Returns the path used, if any. */
export async function saveTextAs(text: string, filters: FileFilter[], defaultName: string): Promise<string | null> {
  if (isTauri()) {
    const path = await pickSaveFile(filters, defaultName);
    if (!path) return null;
    await writeText(path, text);
    return path;
  }
  downloadBlob(new Blob([text], { type: "text/plain" }), defaultName);
  return null;
}

export async function saveBinaryAs(data: Uint8Array | Blob, filters: FileFilter[], defaultName: string): Promise<string | null> {
  if (isTauri()) {
    const path = await pickSaveFile(filters, defaultName);
    if (!path) return null;
    const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
    await writeBinary(path, bytes);
    return path;
  }
  downloadBlob(data instanceof Blob ? data : new Blob([data as BlobPart]), defaultName);
  return null;
}

export async function appDataDir(): Promise<string | null> {
  if (!isTauri()) return null;
  const { appDataDir } = await import("@tauri-apps/api/path");
  return appDataDir();
}

export async function ensureDir(path: string): Promise<void> {
  const { mkdir, exists } = await import("@tauri-apps/plugin-fs");
  if (!(await exists(path))) await mkdir(path, { recursive: true });
}

export async function fileExists(path: string): Promise<boolean> {
  if (!isTauri()) return false;
  const { exists } = await import("@tauri-apps/plugin-fs");
  return exists(path);
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

export async function setWindowTitle(title: string): Promise<void> {
  document.title = title;
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTitle(title);
  } catch {
    /* ignore */
  }
}
