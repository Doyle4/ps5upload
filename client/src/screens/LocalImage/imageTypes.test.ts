import { describe, expect, it } from "vitest";

import en from "../../i18n/locales/en";
import { LOCAL_IMAGE_EXTENSIONS } from "./imageTypes";

describe("Open as a Drive: what it opens", () => {
  const text = en as Record<string, string>;

  it("names every type the picker offers, in the empty state", () => {
    for (const key of ["localimage_none_hint"]) {
      for (const ext of LOCAL_IMAGE_EXTENSIONS) {
        expect(text[key], `${key} names .${ext}`).toContain(`.${ext}`);
      }
    }
  });

  it("does not promise a .ffpkg, which no desktop OS mounts", () => {
    expect(LOCAL_IMAGE_EXTENSIONS).not.toContain("ffpkg");
    expect(text.localimage_none_hint).not.toContain("ffpkg");
  });
});
