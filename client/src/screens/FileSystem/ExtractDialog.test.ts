import { describe, expect, it } from "vitest";
import { extractChoice } from "./ExtractDialog";

describe("extractChoice", () => {
  const taken = (names: string[]) => (n: string) => names.includes(n);

  it("a free folder is used as it is, never merged", () => {
    expect(extractChoice("g", "merge", taken([]), "")).toEqual({ folder: "g", merge: false, replace: false, password: "" });
  });

  it("Keep both picks the next free name", () => {
    expect(extractChoice("g", "new", taken(["g", "g (2)"]), "pw")).toEqual({ folder: "g (3)", merge: false, replace: false, password: "pw" });
  });

  it("Merge writes into the folder already there, skipping or replacing", () => {
    expect(extractChoice("g", "merge", taken(["g"]), "")).toEqual({ folder: "g", merge: true, replace: false, password: "" });
    expect(extractChoice("g", "replace", taken(["g"]), "")).toEqual({ folder: "g", merge: true, replace: true, password: "" });
  });
});
