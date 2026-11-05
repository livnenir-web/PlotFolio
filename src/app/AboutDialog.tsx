import { useState } from "react";
import { Dialog } from "../ui/Dialog";
import { Segmented } from "../ui/Fields";
import { useDialogs } from "./dialogs";
import { saveTextAs } from "../io/platform";
import notes from "../../AI_NOTES.md?raw";

/**
 * About ▸ About PlotFolio / Notes for AI Assistants. The notes are the repository's AI_NOTES.md, bundled into the
 * app so they can be copied or saved from inside PlotFolio when the sources are not at hand.
 */
export function AboutDialog({ page }: { page: "about" | "notes" }) {
  const close = () => useDialogs.getState().setAboutOpen(null);
  const [tab, setTab] = useState<"about" | "notes">(page);
  const copyNotes = async () => {
    try {
      await navigator.clipboard.writeText(notes);
      useDialogs.getState().showToast("Notes copied as Markdown");
    } catch (e) {
      useDialogs.getState().showToast(`Could not copy: ${(e as Error).message}`);
    }
  };
  const saveNotes = async () => {
    try {
      const p = await saveTextAs(notes, [{ name: "Markdown", extensions: ["md"] }], "PlotFolio AI notes.md");
      if (p) useDialogs.getState().showToast(`Saved ${p}`);
    } catch (e) {
      useDialogs.getState().showToast(`Could not save: ${(e as Error).message}`);
    }
  };
  return (
    <Dialog
      title="About PlotFolio"
      onClose={close}
      width={tab === "notes" ? 760 : 520}
      actions={
        <>
          {tab === "notes" && (
            <>
              <button className="btn" onClick={() => void copyNotes()}>
                Copy Markdown
              </button>
              <button className="btn" onClick={() => void saveNotes()}>
                Save as…
              </button>
            </>
          )}
          <button className="btn primary" onClick={close}>
            Done
          </button>
        </>
      }
    >
      <Segmented
        value={tab}
        options={[
          { value: "about", label: "About" },
          { value: "notes", label: "Notes for AI assistants" },
        ]}
        onChange={setTab}
        style={{ marginBottom: 10 }}
      />
      {tab === "about" ? (
        <div>
          <div className="about-head">
            <div>
              <div className="about-name">PlotFolio</div>
              <div className="about-version">
                Version {__APP_VERSION__} · built {__BUILD_DATE__}
              </div>
            </div>
          </div>
          <p className="hint" style={{ margin: "0 0 8px" }}>
            Sheet-based plotting, curve fitting and publication-quality figure export for macOS. Sizes are in mm, fonts and lines in pt; graphs export as SVG at their physical size or as PNG/JPEG at any resolution.
          </p>
          <table className="preview-table" style={{ width: "auto" }}>
            <tbody>
              <tr>
                <td style={{ padding: "2px 8px", color: "var(--text-2)" }}>Project files</td>
                <td style={{ padding: "2px 8px" }}>.plotproj (JSON; sheets, graphs, folders, defaults and the last view)</td>
              </tr>
              <tr>
                <td style={{ padding: "2px 8px", color: "var(--text-2)" }}>Built with</td>
                <td style={{ padding: "2px 8px" }}>Tauri 2, React 18, TypeScript, zustand, mathjs, Levenberg–Marquardt</td>
              </tr>
              <tr>
                <td style={{ padding: "2px 8px", color: "var(--text-2)" }}>Modifying PlotFolio</td>
                <td style={{ padding: "2px 8px" }}>The "Notes for AI assistants" tab holds a Markdown description of the code for an AI (or a person) making changes.</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="hint" style={{ marginBottom: 6 }}>
            Give this text to an AI assistant together with the source code before asking for changes. It is also the file AI_NOTES.md at the root of the repository.
          </div>
          <div className="about-notes">{notes}</div>
        </>
      )}
    </Dialog>
  );
}
