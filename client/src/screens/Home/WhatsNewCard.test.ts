import { describe, expect, it } from "vitest";
import { whatsNewState } from "./WhatsNewCard";

describe("whatsNewState", () => {
  it("says nothing on a first run", () => {
    expect(whatsNewState(null, "8.5.0", 1).show).toBe(false);
  });
  it("announces a new version, then stops after a week or a dismiss", () => {
    const { show, next } = whatsNewState({ version: "8.4.0", since: 0, dismissed: true }, "8.5.0", 10);
    expect(show).toBe(true);
    expect(whatsNewState(next, "8.5.0", 10 + 3600_000).show).toBe(true);
    expect(whatsNewState(next, "8.5.0", 10 + 8 * 24 * 3600_000).show).toBe(false);
    expect(whatsNewState({ ...next, dismissed: true }, "8.5.0", 20).show).toBe(false);
  });
});
