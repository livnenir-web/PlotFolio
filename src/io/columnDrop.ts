// Receive a column drag (see columnDrag.ts) dropped on this window: add the columns to the graph
// under the cursor (its layer when the drop lands on one), to a graph row in the sidebar, or to the
// visible graph.
import { useStore } from "../model/store";
import { useDialogs } from "../app/dialogs";
import { addColumnsToGraph } from "../graph/addData";
import { DRAG_EXT, type ColumnDragPayload } from "./columnDrag";
import { readText } from "./platform";
import { insertImageIntoGraph, isImagePath, pathToDataUrl } from "./images";

export function isColumnDragFile(path: string): boolean {
  return path.endsWith(DRAG_EXT);
}

/** Handle a dropped drag file at a window position (logical CSS pixels). */
export async function handleColumnDrop(path: string, x: number, y: number): Promise<void> {
  let payload: ColumnDragPayload;
  try {
    payload = JSON.parse(await readText(path));
  } catch {
    return;
  }
  try {
    const { remove } = await import("@tauri-apps/plugin-fs");
    await remove(path);
  } catch {
    /* temp file; ignore */
  }
  if (payload.kind !== "columns") return;
  const st = useStore.getState();
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  // 1. a layer of the graph shown here
  const layerEl = el?.closest<HTMLElement>("[data-layer-id]");
  const layerId = layerEl?.dataset.layerId;
  // 2. a graph row in the sidebar
  const sidebarGraph = el?.closest<HTMLElement>("[data-graph-id]")?.dataset.graphId;
  let graphId: string | undefined = sidebarGraph;
  if (!graphId && st.ui.activeTab?.kind === "graph") graphId = st.ui.activeTab.id;
  if (!graphId) {
    useDialogs.getState().showToast("Drop the columns on a graph");
    return;
  }
  const n = addColumnsToGraph(payload.sheetId, payload.cols, graphId, layerId && st.project.graphs.find((g) => g.id === graphId)?.layers.some((l) => l.id === layerId) ? layerId : undefined);
  useDialogs.getState().showToast(n ? `${n} column${n > 1 ? "s" : ""} added (axes kept)` : "No Y columns in the dragged selection");
}

/** Listen for native drops in this window; returns an unlisten function. */
export async function installColumnDropHandler(): Promise<() => void> {
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  return getCurrentWebview().onDragDropEvent((ev) => {
    if (ev.payload.type !== "drop") return;
    const scale = window.devicePixelRatio || 1;
    const pos = ev.payload.position;
    const ours = ev.payload.paths.filter(isColumnDragFile);
    for (const p of ours) void handleColumnDrop(p, pos.x / scale, pos.y / scale);
    const images = ev.payload.paths.filter(isImagePath);
    for (const p of images) void handleImageDrop(p, pos.x / scale, pos.y / scale);
  });
}

/** An image file dropped on a graph window becomes a picture on the layer under the cursor (or the first layer). */
async function handleImageDrop(path: string, x: number, y: number): Promise<void> {
  const st = useStore.getState();
  if (st.ui.activeTab?.kind !== "graph") return; // other windows import files as data
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const layerId = el?.closest<HTMLElement>("[data-layer-id]")?.dataset.layerId;
  try {
    const url = await pathToDataUrl(path);
    await insertImageIntoGraph(st.ui.activeTab.id, url, { layerId, name: path.split("/").pop() });
  } catch (e) {
    useDialogs.getState().showToast(`Could not insert the image: ${(e as Error).message}`);
  }
}
