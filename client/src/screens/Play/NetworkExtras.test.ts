import { describe, expect, it } from "vitest";

import { latencyParts } from "./NetworkExtras";

describe("latencyParts", () => {
  it("rounds the round trip to the engine and the decode time", () => {
    expect(latencyParts({ rttMs: 8.6, decodeMs: 4.2 })).toEqual({ engine: 9, decode: 4 });
  });

  it("has no engine part until the engine answered a ping", () => {
    expect(latencyParts({ rttMs: null, decodeMs: 3.7 })).toEqual({ engine: null, decode: 4 });
  });
});
