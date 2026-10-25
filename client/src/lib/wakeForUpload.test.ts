import { describe, expect, it } from "vitest";

import { shouldWakeForUpload, WAKE_FOR_UPLOAD_RETRY_MS } from "./wakeForUpload";

describe("shouldWakeForUpload", () => {
  const base = { enabled: true, canWake: true, lastSentAt: undefined, now: 1_000_000 };

  it("wakes a console with wake set up", () => {
    expect(shouldWakeForUpload(base)).toBe(true);
  });

  it("never wakes when the setting is off", () => {
    expect(shouldWakeForUpload({ ...base, enabled: false })).toBe(false);
  });

  it("never wakes a console without a wake credential", () => {
    expect(shouldWakeForUpload({ ...base, canWake: false })).toBe(false);
  });

  it("does not resend while the last wake is still recent", () => {
    expect(shouldWakeForUpload({ ...base, lastSentAt: base.now - 10_000 })).toBe(false);
  });

  it("sends again once the retry window has passed", () => {
    expect(
      shouldWakeForUpload({ ...base, lastSentAt: base.now - WAKE_FOR_UPLOAD_RETRY_MS }),
    ).toBe(true);
  });
});
