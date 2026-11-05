import { isTauri } from "../io/platform";

/** Native yes/no dialog (Tauri) with a browser fallback. Always awaited: window.confirm does not block in WKWebView. */
export async function confirmDialog(message: string, title = "PlotFolio"): Promise<boolean> {
  if (isTauri()) {
    const { ask } = await import("@tauri-apps/plugin-dialog");
    return ask(message, { title, kind: "warning", okLabel: "OK", cancelLabel: "Cancel" });
  }
  return window.confirm(message);
}
