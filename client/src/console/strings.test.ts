import { describe, expect, it } from "vitest";
import { makeT, pickLanguage } from "./strings";
import generated from "./strings.gen.json";
// @ts-expect-error plain .mjs build script shared with this test, no type declarations
import { extractConsoleStrings } from "../../../scripts/build-console-strings.mjs";

describe("console strings", () => {
  it("t_falls_back_to_english", () => {
    const t = makeT(
      { en: { cw_x: "Hello {name}", cw_y: "Both" }, "zh-CN": { cw_y: "两者" } },
      "zh-CN",
    );
    expect(t("cw_x", { name: "Ana" })).toBe("Hello Ana");
    expect(t("cw_y")).toBe("两者");
    expect(t("cw_missing_everywhere")).toBe("cw_missing_everywhere");
  });

  it("picks the closest shipped language for the browser's", () => {
    const have = ["en", "zh-CN", "zh-TW", "pt-BR", "de"];
    expect(pickLanguage("de-DE", have)).toBe("de");
    expect(pickLanguage("zh-cn", have)).toBe("zh-CN");
    expect(pickLanguage("zh-HK", have)).toBe("zh-TW");
    expect(pickLanguage("zh-Hant-TW", have)).toBe("zh-TW");
    expect(pickLanguage("zh", have)).toBe("zh-CN");
    expect(pickLanguage("pt-PT", have)).toBe("pt-BR");
    expect(pickLanguage("xx", have)).toBe("en");
    expect(pickLanguage(undefined, have)).toBe("en");
  });

  it("the committed strings module matches the locale files (run npm run build:console)", () => {
    expect(generated).toEqual(extractConsoleStrings());
  });

  it("every shipped locale translates every console key", () => {
    const maps = generated as Record<string, Record<string, string>>;
    const en = Object.keys(maps.en).sort();
    expect(en.length).toBeGreaterThan(0);
    for (const [code, map] of Object.entries(maps)) {
      expect(Object.keys(map).sort(), code).toEqual(en);
    }
  });
});
