import { Dialog } from "../ui/Dialog";
import { useDialogs } from "./dialogs";
import { useStore } from "../model/store";
import { resolveClosePrompt } from "./closeGuard";

export function ClosePrompt() {
  const prompt = useDialogs((s) => s.closePrompt);
  const name = useStore((s) => s.project.name);
  if (!prompt) return null;
  return (
    <Dialog
      title={`Save changes to "${name}"?`}
      onClose={() => void resolveClosePrompt("cancel")}
      width={420}
      actions={
        <>
          <button className="btn" onClick={() => void resolveClosePrompt("discard")}>
            Don't Save
          </button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={() => void resolveClosePrompt("cancel")}>
            Cancel
          </button>
          <button className="btn primary" autoFocus onClick={() => void resolveClosePrompt("save")}>
            Save
          </button>
        </>
      }
    >
      <div style={{ fontSize: 12.5, color: "var(--text-2)" }}>Your changes will be lost if you {prompt.mode === "quit" ? "quit" : "close the window"} without saving.</div>
    </Dialog>
  );
}
