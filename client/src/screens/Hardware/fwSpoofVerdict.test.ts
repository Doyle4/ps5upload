import { describe, expect, it } from "vitest";

import type { FwSpoofStatusResponse } from "../../api/ps5";
import { friendlyFw, fwSpoofVerdict } from "./fwSpoofVerdict";

const status = (over: Partial<FwSpoofStatusResponse>): FwSpoofStatusResponse => ({
  system_sw_version: "13.60.00",
  system_sw_raw: "0x13600000",
  kernel_release: "12.00",
  kernel_fw_version: "13.60.00",
  spoofed: false,
  ...over,
});

describe("fwSpoofVerdict", () => {
  it("reports a flagged version as spoofed", () => {
    expect(fwSpoofVerdict(status({ spoofed: true }))).toBe("spoofed");
  });

  it("does not call an unreadable version genuine", () => {
    // The payload answers spoofed=false when it couldn't read the kernel word at all.
    expect(fwSpoofVerdict(status({ system_sw_version: "unknown" }))).toBe("unknown");
    expect(fwSpoofVerdict(status({ system_sw_version: "" }))).toBe("unknown");
  });

  it("reports a readable, unflagged version as clean", () => {
    expect(fwSpoofVerdict(status({}))).toBe("clean");
  });
});

describe("friendlyFw", () => {
  it("drops the leading zero and a zero revision", () => {
    expect(friendlyFw("09.60.00")).toBe("9.60");
    expect(friendlyFw("13.60.00")).toBe("13.60");
  });

  it("keeps a non-zero revision", () => {
    expect(friendlyFw("13.60.01")).toBe("13.60.01");
  });

  it("leaves anything else alone", () => {
    expect(friendlyFw("unknown")).toBe("unknown");
  });
});
