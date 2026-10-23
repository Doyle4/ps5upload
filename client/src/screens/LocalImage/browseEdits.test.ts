import { describe, expect, it } from "vitest";

import type { ImageEdit } from "../../api/fpkg";
import { baseName, crumbs, folderOf, joinPath, parentDir, pendingState, queueEdit } from "./browseEdits";

describe("image browser paths", () => {
  it("joins, splits and climbs paths inside an image", () => {
    expect(joinPath("", "eboot.bin")).toBe("eboot.bin");
    expect(joinPath("data/sub", "a.bin")).toBe("data/sub/a.bin");
    expect(parentDir("data/sub")).toBe("data");
    expect(parentDir("data")).toBe("");
    expect(parentDir("")).toBe("");
    expect(crumbs("data/sub")).toEqual([
      { name: "data", path: "data" },
      { name: "sub", path: "data/sub" },
    ]);
    expect(crumbs("")).toEqual([]);
  });

  it("names files on this computer on any OS", () => {
    expect(baseName("/Users/me/patch.bin")).toBe("patch.bin");
    expect(baseName("C:\\games\\mod\\")).toBe("mod");
    expect(folderOf("C:\\out\\eboot.bin")).toBe("C:\\out");
    expect(folderOf("/out/data")).toBe("/out");
  });
});

describe("queued changes for an edited copy", () => {
  const put = (path: string, from = `/local/${path}`): ImageEdit => ({ op: "put", path, from });
  const del = (path: string): ImageEdit => ({ op: "delete", path });

  it("marks what a change touches, the last change winning", () => {
    const edits = [del("data"), put("eboot.bin")];
    expect(pendingState(edits, "data")).toBe("deleted");
    expect(pendingState(edits, "data/sub/a.bin")).toBe("deleted");
    expect(pendingState(edits, "data2")).toBe(null);
    expect(pendingState(edits, "eboot.bin")).toBe("replaced");
    // A folder put back after its deletion is no longer deleted.
    expect(pendingState([del("data"), put("data")], "data/a.bin")).toBe(null);
  });

  it("drops changes a later one makes pointless", () => {
    let edits = queueEdit([], put("eboot.bin", "/a"));
    edits = queueEdit(edits, put("eboot.bin", "/b"));
    expect(edits).toEqual([put("eboot.bin", "/b")]);
    edits = queueEdit(edits, put("data/new.bin"));
    edits = queueEdit(edits, del("data"));
    expect(edits).toEqual([put("eboot.bin", "/b"), del("data")]);
  });
});
