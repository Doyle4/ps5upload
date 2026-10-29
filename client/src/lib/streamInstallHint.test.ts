import { describe, expect, it } from "vitest";

import { streamInstallFailHelp } from "./streamInstallHint";

const failed = (over: Record<string, unknown> = {}) => ({
  status: "failed",
  sourceKind: "install",
  install: { via: "stream", source: "/Users/me/game.pkg" },
  error: "The PS5 declined the install.",
  ...over,
});

describe("streamInstallFailHelp", () => {
  it("offers the firewall hint and Upload & install for a failed local stream install", () => {
    expect(streamInstallFailHelp(failed())).toEqual({ retryViaUpload: true, hint: true });
  });

  it("leaves the hint to the unreachable-stream message, which already names the firewall", () => {
    const r = streamInstallFailHelp(
      failed({ error: "The PS5 never reached this computer to fetch the package." }),
    );
    expect(r).toEqual({ retryViaUpload: true, hint: false });
  });

  it("offers nothing for a saved-server stream, a staged install or a row that did not fail", () => {
    const none = { retryViaUpload: false, hint: false };
    expect(streamInstallFailHelp(failed({ install: { via: "stream", source: "remote://nas1/games/game.pkg" } }))).toEqual(none);
    expect(streamInstallFailHelp(failed({ install: { via: "library", source: "/data/pkg/game.pkg" } }))).toEqual(none);
    expect(streamInstallFailHelp(failed({ status: "running" }))).toEqual(none);
    expect(streamInstallFailHelp(failed({ sourceKind: "file" }))).toEqual(none);
  });
});
