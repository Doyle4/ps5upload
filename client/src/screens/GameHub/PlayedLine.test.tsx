import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PlayedLine } from "./PlayedLine";

const html = (p: Parameters<typeof PlayedLine>[0]) => renderToStaticMarkup(<PlayedLine {...p} />);

describe("PlayedLine", () => {
  it("says the total and when it was last played", () => {
    const out = html({ seconds: 2 * 3600 + 300, lastSeenMs: Date.UTC(2026, 9, 3, 12), consoleSeconds: undefined });
    expect(out).toContain("Played 2h 5m");
    expect(out).toContain("Last played");
  });

  it("falls back to the console's own count when nothing was tracked", () => {
    expect(html({ seconds: undefined, lastSeenMs: undefined, consoleSeconds: 3600 })).toContain("Played 1h 0m");
  });

  it("adds the console's count only when it differs", () => {
    expect(html({ seconds: 3600, lastSeenMs: undefined, consoleSeconds: 7200 })).toContain("2h 0m by the console");
    expect(html({ seconds: 3600, lastSeenMs: undefined, consoleSeconds: 3620 })).not.toContain("by the console");
  });

  it("renders nothing for a game with no play on record", () => {
    expect(html({ seconds: 0, lastSeenMs: undefined, consoleSeconds: undefined })).toBe("");
  });
});
