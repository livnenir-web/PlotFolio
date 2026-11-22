import { describe, expect, it } from "vitest";
import { baseName, joinPath, stripExt } from "./platform";

describe("file paths on a Mac and on Windows", () => {
  it("takes the file name off either kind of path", () => {
    expect(baseName("/Users/me/Data/run 1.plotproj")).toBe("run 1.plotproj");
    expect(baseName("C:\\Users\\me\\Data\\run 1.plotproj")).toBe("run 1.plotproj");
    expect(baseName("\\\\server\\share\\fig.png")).toBe("fig.png");
    expect(stripExt(baseName("D:\\lab\\ecg.v2.plotproj"))).toBe("ecg.v2");
  });

  it("joins with the separator the folder already uses", () => {
    expect(joinPath("/Users/me/Library/Application Support/app", "autosave.plotproj")).toBe("/Users/me/Library/Application Support/app/autosave.plotproj");
    expect(joinPath("C:\\Users\\me\\AppData\\Roaming\\app", "views.json")).toBe("C:\\Users\\me\\AppData\\Roaming\\app\\views.json");
    expect(joinPath("C:\\Users\\me\\frames\\", "fig_")).toBe("C:\\Users\\me\\frames\\fig_");
    expect(joinPath("/tmp/frames/", "fig_")).toBe("/tmp/frames/fig_");
  });
});
