import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "../ui/Dialog";
import { Segmented, TextField } from "../ui/Fields";
import { Icon } from "../ui/Icon";
import { confirmDialog } from "../ui/confirm";
import { useDialogs } from "./dialogs";
import { ALT_KEY as ALT, formatKeys, MOD_KEY as MOD } from "./menuModel";
import { commandById, commands, comboOf, conflictOf, keyHint, refusal, useShortcuts, type Command } from "./shortcuts";


/** Things done with the mouse or a held key: listed for reference, not changeable. */
const GESTURES: { title: string; rows: [string, string][] }[] = [
  {
    title: "On a graph",
    rows: [
      [`${ALT}-drag on a layer`, "Zoom into the dragged rectangle (Undo zoom on the plot steps back); on a 3D layer, turn the view"],
      [`${MOD}-scroll`, "Zoom the canvas in and out"],
      ["Hold L", "Layer mode: layers light up and a click picks the layer, even through objects on top of it"],
      ["Double-click", "Edit an axis title, a legend entry or a text label in place"],
      ["Right-click", "Menu for the object under the pointer"],
      ["Right-click a data point", "Exclude the point (it moves to a column of its own and turns gray), bring it back, or show its cell in the sheet"],
      ["Right-click a plot ▸ Analyze", "Smooth, curve math, FFT, statistics and the other commands, on the selected plots"],
    ],
  },
  {
    title: "Selecting and moving",
    rows: [
      ["Shift-click", "Add an object to the selection, or take it out"],
      ["Drag on empty canvas", "Select everything the rectangle touches"],
      ["Arrow keys", "Move the selection by 0.5 mm; with Shift by 2 mm"],
      ["Shift while moving", "Move level or upright only, without snapping"],
      ["Shift while dragging a line end", "Turn it in 45° steps, or slide it along the line"],
      ["Drag a corner", "Resize a layer; Shift keeps it square, and a drawn shape in proportion"],
      [`${ALT} while resizing a picture`, "Ignore its proportions"],
    ],
  },
  {
    title: "Drawing",
    rows: [
      ["Shift while drawing", "A line or polyline segment at 45° steps, a square or a circle"],
      ["Double-click or Enter", "Finish a polyline or polygon"],
      ["Esc", "Cancel the shape being drawn, then stop drawing"],
    ],
  },
  {
    title: "In a sheet",
    rows: [
      ["Click a column header", "Edit the column's name, units and formula in the inspector"],
      ["Right-click a column header", "Set what it is plotted as; insert, delete and sort"],
      ["Drag the grip of a column onto a graph", "Add the column to that graph as a new plot"],
    ],
  },
  {
    title: "In lists",
    rows: [
      ["Drag a row", "Change the order: plots, curve groups and layers (drawing order), legend entries, the steps of a build-up animation, the columns of a sheet"],
      ["Drag a tab", "Change the order of the open tabs"],
      ["Drag in the project list", "Between sheets, figures or folders: change their order. Onto a folder: move it inside"],
      ["Esc while dragging", "Leave the order as it was"],
    ],
  },
  {
    title: "Fitting and animation",
    rows: [
      ["Drag across the data area", "Choose a range, after “Pick on graph” in the fit panel or “Pick…” in the figure's Animation tab"],
      ["Drag the timeline slider", "Move through the animation frame by frame"],
    ],
  },
];

/** Help ▸ Shortcuts and Gestures: every shortcut, changeable in place, and the mouse gestures for reference. */
export function ShortcutsDialog() {
  const overrides = useShortcuts((s) => s.overrides);
  const [tab, setTab] = useState<"keys" | "gestures">("keys");
  const [filter, setFilter] = useState("");
  /** command whose new shortcut is being typed */
  const [capturing, setCapturing] = useState<string | null>(null);
  const [note, setNote] = useState<{ id: string; text: string; replace?: { combo: string; otherId: string } } | null>(null);
  const capturingRef = useRef(capturing);
  capturingRef.current = capturing;
  const close = () => (capturingRef.current ? setCapturing(null) : useDialogs.getState().setShortcutsOpen(false));

  // while a shortcut is being typed, every key press belongs to this sheet
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const combo = comboOf(e);
      if (!combo) return; // a modifier on its own: wait for the key
      if (combo === "Escape") return void setCapturing(null);
      const sc = useShortcuts.getState();
      if (combo === "Delete") {
        sc.set(capturing, null);
        setNote(null);
        return void setCapturing(null);
      }
      const why = refusal(capturing, combo);
      if (why) return void setNote({ id: capturing, text: why });
      const other = conflictOf(capturing, combo);
      if (other) {
        setNote({ id: capturing, text: `${formatKeys(combo)} is the shortcut of “${other.label}”.`, replace: { combo, otherId: other.id } });
        return void setCapturing(null);
      }
      sc.set(capturing, combo);
      setNote(null);
      setCapturing(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing]);

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const out: { title: string; items: Command[] }[] = [];
    for (const c of commands()) {
      if (q && !`${c.label} ${c.group} ${keyHint(c.id, overrides)}`.toLowerCase().includes(q)) continue;
      const g = out.find((x) => x.title === c.group);
      if (g) g.items.push(c);
      else out.push({ title: c.group, items: [c] });
    }
    return out;
  }, [filter, overrides]);
  const changed = Object.keys(overrides).length;

  const restore = async () => {
    if (await confirmDialog("Restore every shortcut to its default? Your own shortcuts will be removed.")) {
      useShortcuts.getState().resetAll();
      setNote(null);
      setCapturing(null);
    }
  };

  return (
    <Dialog
      title="Shortcuts and gestures"
      info={
        tab === "keys"
          ? "Click a shortcut and press the new keys. Delete removes the shortcut, Esc leaves it as it is. Your shortcuts are kept on this computer, not in the project."
          : `Copy, paste, cut, select all, undo and redo use the keys they have in every app (${keyHint("copy")}, ${keyHint("paste")}, ${keyHint("cut")}, ${keyHint("selectAll")}, ${keyHint("undo")}, ${keyHint("redo")}); Delete removes the selection.`
      }
      onClose={close}
      width={600}
      actions={
        <>
          <button className="btn" style={{ marginRight: "auto" }} disabled={!changed} title="Remove your own shortcuts and use the built-in ones again" onClick={() => void restore()}>
            Restore default settings
          </button>
          <button className="btn primary" onClick={() => useDialogs.getState().setShortcutsOpen(false)}>
            Done
          </button>
        </>
      }
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "2px 0 8px" }}>
        <Segmented
          value={tab}
          options={[
            { value: "keys", label: "Keyboard shortcuts" },
            { value: "gestures", label: "Mouse and gestures" },
          ]}
          onChange={setTab}
        />
        {tab === "keys" && <TextField value={filter} onCommit={setFilter} placeholder="Find a command" style={{ flex: 1 }} />}
      </div>
      {tab === "keys" ? (
        <>
          <div className="shortcut-list">
            {groups.map((g) => (
              <section key={g.title}>
                <h4>{g.title}</h4>
                {g.items.map((c) => {
                  const mine = !c.fixed && c.id in overrides;
                  const hint = keyHint(c.id, overrides);
                  const isCapturing = capturing === c.id;
                  return (
                    <div key={c.id} className="shortcut-row">
                      <div className="shortcut-line">
                        <span className="shortcut-label">
                          {c.label}
                          {c.when && <span className="hint"> · in a {c.when}</span>}
                        </span>
                        {mine && (
                          <button
                            className="icon-btn tiny"
                            title={`Back to the default${c.keys ? ` (${formatKeys(c.keys)})` : " (no shortcut)"}`}
                            onClick={() => {
                              const def = commandById(c.id)!.keys;
                              const other = def ? conflictOf(c.id, def) : null;
                              if (other) return setNote({ id: c.id, text: `The default ${formatKeys(def!)} is now the shortcut of “${other.label}”.`, replace: { combo: def!, otherId: other.id } });
                              useShortcuts.getState().reset(c.id);
                              setNote(null);
                            }}
                          >
                            <Icon name="undo" size={12} />
                          </button>
                        )}
                        {c.fixed ? (
                          <kbd className="keycap fixed" title="The same in every app: it cannot be changed">
                            {hint}
                          </kbd>
                        ) : (
                          <button
                            className={"keycap" + (isCapturing ? " capturing" : "") + (mine ? " mine" : "") + (hint ? "" : " none")}
                            title="Click, then press the keys for this command"
                            onClick={() => {
                              setNote(null);
                              setCapturing(isCapturing ? null : c.id);
                            }}
                          >
                            {isCapturing ? "Press the keys…" : hint || "None"}
                          </button>
                        )}
                      </div>
                      {note?.id === c.id && (
                        <div className="shortcut-note">
                          <span>{note.text}</span>
                          {note.replace && (
                            <>
                              <button
                                className="btn small"
                                title="Give the shortcut to this command; the other command is left without one"
                                onClick={() => {
                                  const sc = useShortcuts.getState();
                                  sc.set(note.replace!.otherId, null);
                                  sc.set(c.id, note.replace!.combo);
                                  setNote(null);
                                }}
                              >
                                Use it here
                              </button>
                              <button className="btn small" onClick={() => setNote(null)}>
                                Keep as it is
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
            ))}
            {groups.length === 0 && <div className="note">No command matches “{filter}”.</div>}
          </div>
        </>
      ) : (
        <div className="shortcut-list">
          {GESTURES.map((g) => (
            <section key={g.title}>
              <h4>{g.title}</h4>
              {g.rows.map(([how, what]) => (
                <div key={how} className="gesture-row">
                  <span className="gesture-how">{how}</span>
                  <span>{what}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </Dialog>
  );
}
