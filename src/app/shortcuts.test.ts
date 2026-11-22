import { beforeEach, describe, expect, it } from "vitest";
import { accessKey, formatKeys, WEB_MENUS, WINDOWS_MENUS } from "./menuModel";
import { bindingOf, commandById, commandForCombo, commands, comboOf, conflictOf, keyHint, refusal, toAccelerator, useShortcuts } from "./shortcuts";

const ev = (code: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}, key = "") => ({ key, code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

describe("shortcuts", () => {
  beforeEach(() => useShortcuts.getState().resetAll());

  it("names key presses by position, whatever the layout", () => {
    expect(comboOf(ev("KeyS", { metaKey: true }), true)).toBe("Mod+S");
    expect(comboOf(ev("KeyS", { metaKey: true, altKey: true }, "ß"), true)).toBe("Mod+Alt+S");
    expect(comboOf(ev("KeyE", { ctrlKey: true, shiftKey: true }), false)).toBe("Mod+Shift+E");
    expect(comboOf(ev("Slash", { shiftKey: true }, "?"), true)).toBe("Shift+/");
    expect(comboOf(ev("Space"), true)).toBe("Space");
    expect(comboOf(ev("ShiftLeft", { shiftKey: true }, "Shift"), true)).toBeNull();
    expect(comboOf(ev("", {}, "Delete"), true)).toBe("Delete");
    expect(formatKeys("Shift+/", true)).toBe("?");
    expect(formatKeys("Mod+Alt+S", true)).toBe("⌥⌘S");
    expect(formatKeys("Space", true)).toBe("Space");
  });

  it("lists every command once with the defaults of the build", () => {
    const ids = commands("browser").map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("shortcuts");
    expect(ids).toContain("group");
    expect(ids).not.toContain("popOut"); // the Mac app only
    expect(commands("browser").find((c) => c.id === "new")!.keys).toBeNull(); // the browser keeps ⌘N
    expect(commands("mac").find((c) => c.id === "new")!.keys).toBe("Mod+N");
    expect(commands("mac").map((c) => c.id)).toContain("popOut");
    commands("browser");
    expect(commandById("copy")!.fixed).toBe(true);
    expect(bindingOf("exportGraph")).toBe("Mod+Shift+E");
  });

  it("keeps the user's choice, finds conflicts and restores the defaults", () => {
    commands("browser");
    const s = useShortcuts.getState();
    s.set("animate", "Mod+Shift+A");
    expect(bindingOf("animate")).toBe("Mod+Shift+A");
    expect(commandForCombo("Mod+Shift+A", "graph")!.id).toBe("animate");
    expect(commandForCombo("Mod+Shift+A", "sheet")).toBeNull(); // a graph command
    expect(conflictOf("copySvg", "Mod+Shift+A")!.id).toBe("animate");
    // a sheet command may share a key with a graph command
    expect(conflictOf("plot", "Mod+F")).toBeNull();
    expect(conflictOf("exportAnimation", "Mod+F")!.id).toBe("fit");
    s.set("exportGraph", null);
    expect(bindingOf("exportGraph")).toBeNull();
    expect(keyHint("exportGraph")).toBe("");
    s.set("exportGraph", "Mod+Shift+E"); // back to the default: no override is kept
    expect("exportGraph" in useShortcuts.getState().overrides).toBe(false);
    s.set("copy", "Mod+K"); // fixed commands do not change
    expect(bindingOf("copy")).toBe("Mod+C");
    useShortcuts.getState().resetAll();
    expect(bindingOf("animate")).toBeNull();
    expect(useShortcuts.getState().overrides).toEqual({});
  });

  it("refuses shortcuts that would break typing, editing or the system", () => {
    commands("browser");
    expect(refusal("animate", "Mod+C", "browser")).toMatch(/Copy/);
    expect(refusal("animate", "Enter", "browser")).toMatch(/editing/);
    expect(refusal("save", "S", "browser")).toMatch(/typing/);
    expect(refusal("animate", "A", "browser")).toBeNull(); // a graph command may take a plain key
    expect(refusal("save", "F5", "browser")).toBeNull();
    expect(refusal("save", "Mod+T", "browser")).toMatch(/browser/);
    expect(refusal("save", "Mod+T", "mac")).toBeNull();
    expect(refusal("save", "Mod+Q", "mac")).toMatch(/macOS/);
    expect(refusal("copy", "Mod+K", "browser")).toMatch(/cannot be changed/);
  });

  it("gives the Windows app its own menus, keys and reserved shortcuts", () => {
    const win = commands("windows");
    const ids = win.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const by = (id: string) => win.find((c) => c.id === id)!;
    // commands the Mac app has in its native menu sit in the Windows menus
    for (const id of ["quit", "closeWindow", "popOut", "settings", "about", "shortcuts", "appearance"]) expect(ids).toContain(id);
    expect(by("settings").group).toBe("File");
    expect(by("about").group).toBe("Help");
    // the desktop keys a browser keeps for itself, and the Windows habits
    expect(by("new").keys).toBe("Mod+N");
    expect(by("rescale").keys).toBe("Mod+R");
    expect(by("redo").keys).toBe("Mod+Y");
    expect(by("fullscreen").keys).toBe("F11");
    expect(by("shortcuts").keys).toBe("F1");
    expect(formatKeys(by("redo").keys!, false)).toBe("Ctrl+Y");
    expect(formatKeys("Delete", false)).toBe("Del");
    // no native menu there: the page handles every shortcut
    expect(win.some((c) => c.native)).toBe(false);
    // every command of the Mac app exists in the Windows app too
    for (const c of commands("mac")) expect(ids, c.id).toContain(c.id);
    expect(refusal("save", "Alt+F4", "windows")).toMatch(/Windows keeps/);
    expect(refusal("animate", "Alt+F", "windows")).toMatch(/File menu/);
    expect(refusal("animate", "Alt+F", "mac")).toBeNull(); // a graph command may take it elsewhere
    expect(refusal("save", "Mod+Q", "windows")).toBeNull(); // only macOS keeps that one
    expect(refusal("save", "Mod+T", "windows")).toBeNull();
  });

  it("opens each Windows menu with Alt and a letter of its own", () => {
    const letters = WINDOWS_MENUS.map(accessKey);
    expect(new Set(letters).size).toBe(letters.length);
    expect(letters.join("")).toBe("FEDAGVH");
    // the two layouts hold the same commands, apart from the ones only a desktop window has
    const idsOf = (menus: typeof WINDOWS_MENUS) => {
      const out = new Set<string>();
      const walk = (es: (typeof WINDOWS_MENUS)[number]["items"]) => es.forEach((e) => ("submenu" in e ? Array.isArray(e.submenu) && walk(e.submenu) : "id" in e && out.add(e.id)));
      menus.forEach((m) => walk(m.items));
      return out;
    };
    const web = idsOf(WEB_MENUS);
    const win = idsOf(WINDOWS_MENUS);
    for (const id of web) expect(win.has(id), id).toBe(true);
    expect([...win].filter((id) => !web.has(id)).sort()).toEqual(["closeWindow", "popOut", "quit"]);
  });

  it("zooms in with either way of typing the plus", () => {
    commands("browser");
    expect(commandForCombo("Mod+=", "graph")!.id).toBe("zoomIn");
    expect(commandForCombo("Mod+Shift+=", "graph")!.id).toBe("zoomIn");
  });

  it("writes Mac menu shortcuts only for keys a menu should own", () => {
    expect(toAccelerator("Mod+Shift+E")).toBe("CmdOrCtrl+Shift+E");
    expect(toAccelerator("Mod+=")).toBe("CmdOrCtrl+=");
    expect(toAccelerator("Mod+Alt+ArrowLeft")).toBe("CmdOrCtrl+Alt+Left");
    expect(toAccelerator("F5")).toBe("F5");
    expect(toAccelerator("Space")).toBeNull(); // would swallow typing
    expect(toAccelerator("Shift+/")).toBeNull();
    expect(toAccelerator(null)).toBeNull();
  });
});
