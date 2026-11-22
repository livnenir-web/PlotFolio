// The start screen: what an empty project shows in place of a blank sheet. Four ways to begin (import, paste,
// an empty sheet, open a project), the recent projects (Mac app) and the bundled samples with a small picture.

import { useEffect, useState } from "react";
import { create } from "zustand";
import { useStore } from "../model/store";
import { useDialogs } from "./dialogs";
import { Icon } from "../ui/Icon";
import { isTauri } from "../io/platform";
import { importViaDialog } from "../io/importFiles";
import { recentFiles } from "../io/recent";
import { guardedOpen } from "./menu";
import { listSamples, loadSample } from "./openFile";
import { layoutGraph, type GraphLayout } from "../graph/layout";
import { GraphSvg } from "../graph/render/GraphSvg";
import { keyHint } from "./shortcuts";
import { formatKeys } from "./menuModel";

/** The start screen is put away for the project loaded as number `seq`; a new or opened project shows it again. */
const useStart = create<{ dismissedSeq: number | null; dismiss: (seq: number) => void }>((set) => ({
  dismissedSeq: null,
  dismiss: (dismissedSeq) => set({ dismissedSeq }),
}));

/** True while the project is untouched (no file, no graph, no data) and the start screen has not been put away. */
export function useShowStart(): boolean {
  const empty = useStore((s) => !s.filePath && s.project.graphs.length === 0 && !s.project.sheets.some((sh) => sh.columns.some((c) => c.values.length > 0 || c.formula)));
  const seq = useStore((s) => s.loadSeq);
  const dismissedSeq = useStart((s) => s.dismissedSeq);
  return empty && dismissedSeq !== seq;
}

/** Hand text from the clipboard to the import dialog, where the columns can be checked before they become a sheet. */
function importPasted(text: string | undefined | null): void {
  if (text && text.trim()) useDialogs.getState().setImportSource({ name: "Pasted data", text });
  else useDialogs.getState().showToast("The clipboard holds no text. Copy the cells in Excel or Numbers first, then paste.");
}

async function pasteFromClipboard(): Promise<void> {
  try {
    importPasted(await navigator.clipboard.readText());
  } catch {
    useDialogs.getState().showToast(`Press ${formatKeys("Mod+V")} to paste the copied cells.`);
  }
}

const fileName = (path: string) => path.split(/[\\/]/).pop()!.replace(/\.plotproj$/i, "");
const folderName = (path: string) => path.split(/[\\/]/).slice(-2, -1)[0] ?? "";

export function StartScreen() {
  const seq = useStore((s) => s.loadSeq);
  const [samples, setSamples] = useState<{ file: string; name: string }[]>([]);
  const recent = isTauri() ? recentFiles().slice(0, 6) : [];
  useEffect(() => {
    void listSamples().then(setSamples);
  }, []);
  // ⌘V anywhere on the start screen pastes copied cells
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (useDialogs.getState().importSource) return;
      e.preventDefault();
      importPasted(e.clipboardData?.getData("text/plain"));
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  return (
    <div className="start">
      <div className="start-inner">
        <div className="start-title">Start a figure</div>
        <div className="start-sub">Drop a data file anywhere in the window, or pick one of these.</div>
        <div className="start-tiles">
          <button className="start-tile" onClick={() => void importViaDialog()} title={`CSV, TSV, text or Excel${keyHint("import") ? ` (${keyHint("import")})` : ""}`}>
            <Icon name="import" size={22} />
            <span>Import a data file</span>
          </button>
          <button className="start-tile" onClick={() => void pasteFromClipboard()} title="Cells copied from Excel, Numbers or a text file">
            <Icon name="copy" size={22} />
            <span>Paste data</span>
          </button>
          <button className="start-tile" onClick={() => useStart.getState().dismiss(seq)} title="Type the numbers in yourself">
            <Icon name="table" size={22} />
            <span>Empty sheet</span>
          </button>
          <button className="start-tile" onClick={() => void guardedOpen()} title={`A PlotFolio project (.plotproj)${keyHint("open") ? ` (${keyHint("open")})` : ""}`}>
            <Icon name="folder" size={22} />
            <span>Open a project</span>
          </button>
        </div>
        <div className={"start-lists" + (recent.length ? "" : " single")}>
          {recent.length > 0 && (
            <div>
              <div className="start-label">Recent projects</div>
              {recent.map((p) => (
                <button key={p} className="start-recent" onClick={() => void guardedOpen(p)} title={p}>
                  <span className="name">{fileName(p)}</span>
                  <span className="where">{folderName(p)}</span>
                </button>
              ))}
            </div>
          )}
          {samples.length > 0 && (
            <div>
              <div className="start-label">Samples</div>
              <div className="start-samples">
                {samples.map((s) => (
                  <button key={s.file} className="start-sample" onClick={() => void loadSample(s.file, s.name)} title={`Open the sample "${s.name}"`}>
                    <SampleThumb file={s.file} />
                    <span>{s.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const thumbs = new Map<string, Promise<GraphLayout | null>>();

/** Layout of a sample's first graph, loaded once per session. */
function sampleLayout(file: string): Promise<GraphLayout | null> {
  let p = thumbs.get(file);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(`samples/${file}`);
        if (!res.ok) return null;
        const { deserializeProjectFile } = await import("../io/project");
        const { project } = deserializeProjectFile(await res.text());
        return project.graphs[0] ? layoutGraph(project, project.graphs[0]) : null;
      } catch {
        return null;
      }
    })();
    thumbs.set(file, p);
  }
  return p;
}

function SampleThumb({ file }: { file: string }) {
  const [layout, setLayout] = useState<GraphLayout | null>(null);
  useEffect(() => {
    let live = true;
    void sampleLayout(file).then((l) => live && setLayout(l));
    return () => {
      live = false;
    };
  }, [file]);
  return <div className="thumb">{layout ? <GraphSvg layout={layout} background widthCss="100%" heightCss="100%" /> : <Icon name="chart" size={22} />}</div>;
}
