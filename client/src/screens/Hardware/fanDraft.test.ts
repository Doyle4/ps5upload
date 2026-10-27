import { describe, expect, it } from "vitest";
import { fanDraftStart } from "./index";

describe("fan slider start (#522)", () => {
  it("starts at the target ps5upload keeps on the console", () => {
    expect(fanDraftStart(75, 75, 91)).toBe(75);
  });
  it("starts at what the console holds when nothing is kept", () => {
    expect(fanDraftStart(0, 80, 91)).toBe(80);
  });
  it("starts at 65 °C before anything is known", () => {
    expect(fanDraftStart(0, -1, 0)).toBe(65);
  });
});

describe("fan card on reopening (#522)", () => {
  it("shows the console's kept target, not 65 °C", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { FanThresholdCard } = await import("./index");
    const html = renderToStaticMarkup(
      createElement(FanThresholdCard, {
        host: "192.168.1.20",
        payloadUp: true,
        pinnedC: 75,
        targetC: 75,
        stockC: 91,
        restores: 0,
        lastRestoreS: -1,
        guard: "",
      }),
    );
    expect(html).toMatch(/type="range"[^>]*value="75"|value="75"[^>]*type="range"/);
    expect(html).toContain("75°C");
  });
});
