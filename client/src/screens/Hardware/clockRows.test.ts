import { describe, expect, it } from "vitest";
import { clockHint, coreClockTooltip, formatFreqRange } from "./index";

// English-only translator: fills {name} placeholders in the fallback.
const tr = (
  _key: string,
  vars?: Record<string, string | number>,
  fallback?: string,
) =>
  (fallback ?? _key).replace(/\{(\w+)\}/g, (_, k: string) =>
    String(vars?.[k] ?? ""),
  );

describe("per-core CPU clock value", () => {
  it("shows the lowest–highest core clock", () => {
    expect(formatFreqRange(2844, 3500)).toBe("2.84–3.50 GHz");
  });
  it("shows one figure when every core agrees", () => {
    expect(formatFreqRange(3200, 3200)).toBe("3.20 GHz");
  });
  it("shows a dash when no core is known", () => {
    expect(formatFreqRange(0, 0)).toBe("—");
  });
});

describe("clock row hint", () => {
  const read = "SMU P-state clock, read on request";
  it("asks for a click before the first read", () => {
    expect(clockHint(tr, null, false, read)).toBe(
      "Click Read sensors for a live reading",
    );
  });
  it("says so when the console refused the read", () => {
    expect(
      clockHint(tr, { gpu_clock_src: "unsupported" }, false, read),
    ).toMatch(/doesn't answer/);
  });
  it("says so when the helper is too old to send clocks", () => {
    expect(clockHint(tr, { gpu_clock_src: "" }, false, read)).toMatch(
      /helper version/,
    );
    expect(clockHint(tr, {}, false, read)).toMatch(/helper version/);
  });
  it("says there was no reading for an out-of-range value", () => {
    expect(clockHint(tr, { gpu_clock_src: "mp1" }, false, read)).toMatch(
      /no reading/,
    );
  });
  it("names the source once read", () => {
    expect(clockHint(tr, { gpu_clock_src: "mp1" }, true, read)).toBe(read);
  });
});

describe("per-core tooltip", () => {
  it("lists all eight cores, unknown ones as a dash", () => {
    const t = coreClockTooltip(tr, [3500, 2844, 0, 2844, 2844, 2844, 2844, 2844]);
    expect(t?.split("\n")).toHaveLength(8);
    expect(t).toContain("Core 0: 3500 MHz");
    expect(t).toContain("Core 2: —");
  });
  it("has none before a read", () => {
    expect(coreClockTooltip(tr, undefined)).toBeUndefined();
    expect(coreClockTooltip(tr, [])).toBeUndefined();
  });
});
