/** ⌘B / ⌘I / ⌘U in a text control wrap the selected text (or the whole line) in \\bf{} \\it{} \\ul{} markup. Returns true when handled. */
export function applyMarkupShortcut(e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>, setValue: (v: string) => void): boolean {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return false;
  const k = e.key.toLowerCase();
  const cmd = k === "b" ? "bf" : k === "i" ? "it" : k === "u" ? "ul" : null;
  if (!cmd) return false;
  e.preventDefault();
  e.stopPropagation();
  const el = e.currentTarget;
  const v = el.value;
  let a = el.selectionStart ?? 0;
  let b = el.selectionEnd ?? a;
  if (a === b) {
    // no selection: the current line
    a = v.lastIndexOf("\n", a - 1) + 1;
    const nl = v.indexOf("\n", b);
    b = nl < 0 ? v.length : nl;
  }
  const inner = v.slice(a, b);
  const wrapped = `\\${cmd}{${inner}}`;
  const next = v.slice(0, a) + wrapped + v.slice(b);
  setValue(next);
  requestAnimationFrame(() => {
    el.value = next;
    el.setSelectionRange(a + cmd.length + 3, a + cmd.length + 3 + inner.length);
  });
  return true;
}
