// Recently opened/saved project files (persisted in the webview's local storage) and the native "Open Recent" submenu.
import { isTauri } from "./platform";

const KEY = "plotkit.recent";
const MAX = 10;

export function recentFiles(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function syncRecentMenu(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_recent_files", { paths: recentFiles() });
  } catch (e) {
    console.warn("recent menu", e);
  }
}

export function addRecent(path: string): void {
  const list = [path, ...recentFiles().filter((p) => p !== path)].slice(0, MAX);
  localStorage.setItem(KEY, JSON.stringify(list));
  void syncRecentMenu();
  if (isTauri()) void import("@tauri-apps/api/core").then(({ invoke }) => invoke("note_recent_document", { path }).catch(() => {}));
}

export function removeRecent(path: string): void {
  localStorage.setItem(KEY, JSON.stringify(recentFiles().filter((p) => p !== path)));
  void syncRecentMenu();
}

export function clearRecent(): void {
  localStorage.removeItem(KEY);
  void syncRecentMenu();
}
