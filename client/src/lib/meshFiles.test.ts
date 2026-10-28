import { describe, expect, it } from "vitest";

import { isMeshInternal } from "./meshFiles";

describe("Mesh Drive's own files", () => {
  it("are hidden, the trash is not", () => {
    expect(isMeshInternal(".ps5upload-mesh")).toBe(true);
    expect(isMeshInternal(".ps5upload-mesh-base")).toBe(true);
    expect(isMeshInternal(".ps5upload-trash")).toBe(false);
    expect(isMeshInternal("save.dat")).toBe(false);
  });
});
