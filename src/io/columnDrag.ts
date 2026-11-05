// Drag selected columns out of a sheet. In the Mac app this is a native drag session (works across
// pop-out windows); the payload travels as a small JSON file that the receiving window reads back.
import { useDialogs } from "../app/dialogs";
import { appDataDir, ensureDir, isTauri, writeBinary, writeText } from "./platform";

export const DRAG_EXT = ".plotkit-columns.json";

export interface ColumnDragPayload {
  kind: "columns";
  sheetId: string;
  cols: number[];
  label: string;
}

let iconPath: string | null = null;

/** A small graph icon (PNG) used as the drag preview; written once into the app data folder. */
async function dragIcon(): Promise<string> {
  if (iconPath) return iconPath;
  const dir = await appDataDir();
  if (!dir) throw new Error("no app data dir");
  await ensureDir(dir);
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.roundRect(2, 2, 60, 60, 12);
  g.fill();
  g.strokeStyle = "rgba(0,0,0,0.25)";
  g.lineWidth = 2;
  g.stroke();
  g.strokeStyle = "#0072B2";
  g.lineWidth = 4;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(12, 46);
  g.lineTo(24, 30);
  g.lineTo(34, 38);
  g.lineTo(52, 16);
  g.stroke();
  g.strokeStyle = "#1d1d1f";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(10, 10);
  g.lineTo(10, 54);
  g.lineTo(56, 54);
  g.stroke();
  const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("icon"))), "image/png"));
  const path = `${dir}/drag-icon.png`;
  await writeBinary(path, new Uint8Array(await blob.arrayBuffer()));
  iconPath = path;
  return path;
}

/** Start dragging columns. Returns false when a native drag is not available (browser build). */
export async function startNativeColumnDrag(payload: ColumnDragPayload): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const dir = await appDataDir();
    if (!dir) return false;
    await ensureDir(dir);
    const file = `${dir}/drag-${Date.now()}${DRAG_EXT}`;
    await writeText(file, JSON.stringify(payload));
    const { startDrag } = await import("@crabnebula/tauri-plugin-drag");
    await startDrag({ item: [file], icon: await dragIcon(), mode: "copy" });
    return true;
  } catch (e) {
    console.warn("native drag failed", e);
    useDialogs.getState().showToast("Could not start the drag");
    return false;
  }
}
