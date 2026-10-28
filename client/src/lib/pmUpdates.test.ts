import { describe, expect, it } from "vitest";

import type { PayloadReleaseInfo } from "../api/ps5";
import { catalogueMatch, isRepoManaged, pmUpdateFor, swapAutoloadKey } from "./pmUpdates";

const rel = (tag: string, url = "https://x/a.elf"): PayloadReleaseInfo => ({
  payload_id: "nanodns",
  tag,
  name: tag,
  body: "",
  published_at: "",
  html_url: "",
  picked_asset_url: url,
  picked_asset_name: "a.elf",
  picked_asset_size: 1,
  cached_age_secs: 0,
});

describe("pmUpdateFor", () => {
  it("offers the newer release only for something this app stored", () => {
    expect(pmUpdateFor({ id: "nanodns", tag: "v0.4" }, rel("v0.5"))?.tag).toBe("v0.5");
    expect(pmUpdateFor({ id: "nanodns", tag: "v0.5" }, rel("v0.5"))).toBeNull();
    expect(pmUpdateFor(undefined, rel("v0.5"))).toBeNull();
    expect(pmUpdateFor({ id: "nanodns", tag: "v0.4" }, rel("v0.5", ""))).toBeNull();
  });
});

describe("swapAutoloadKey", () => {
  it("keeps the boot position and the pauses", () => {
    expect(swapAutoloadKey(["a.elf", "!3000", "old.elf", "!3000", "c.elf"], "old.elf", "new.elf")).toEqual([
      "a.elf",
      "!3000",
      "new.elf",
      "!3000",
      "c.elf",
    ]);
  });
  it("does not list the new one twice", () => {
    expect(swapAutoloadKey(["new.elf", "old.elf"], "old.elf", "new.elf")).toEqual(["new.elf"]);
  });
  it("leaves a list without the old one alone", () => {
    const l = ["a.elf"];
    expect(swapAutoloadKey(l, "old.elf", "new.elf")).toBe(l);
  });
});

describe("isRepoManaged", () => {
  it("knows Payload Manager's own repository installs", () => {
    expect(isRepoManaged({ slot: "", path: "/data/pldmgr/payloads/repo/nanodns@e8cce5d1/nanoDNS_0.4.elf" })).toBe(true);
    expect(isRepoManaged({ slot: "repo/nanodns@x", path: "/data/pldmgr/payloads/repo/x" })).toBe(true);
    expect(isRepoManaged({ slot: "local/nanodns", path: "/data/pldmgr/payloads/local/nanodns/n.elf" })).toBe(false);
  });
});

describe("catalogueMatch", () => {
  const inv = [
    { payload_id: "kstuff", path: "/cache/kstuff/1.6/kstuff.elf" },
    { payload_id: "nanodns", path: "C:\\cache\\nanodns\\nanoDNS_0.4.elf" },
  ];
  it("matches a hand-stored payload to the catalogue file with the same name", () => {
    expect(catalogueMatch({ slot: "local/kstuff", path: "/data/pldmgr/payloads/local/kstuff/kstuff.elf", filename: "kstuff.elf" }, inv)).toBe("kstuff");
    expect(catalogueMatch({ slot: "", path: "/data/pldmgr/payloads/nanodns/NANODNS_0.4.ELF", filename: "NANODNS_0.4.ELF" }, inv)).toBe("nanodns");
  });
  it("leaves repository payloads, USB finds and unknown files alone", () => {
    expect(catalogueMatch({ slot: "repo/kstuff@x", path: "/data/pldmgr/payloads/repo/kstuff@x/kstuff.elf", filename: "kstuff.elf" }, inv)).toBeNull();
    expect(catalogueMatch({ slot: "", path: "/mnt/usb0/kstuff.elf", filename: "kstuff.elf" }, inv)).toBeNull();
    expect(catalogueMatch({ slot: "local/x", path: "/data/pldmgr/payloads/local/x/x.elf", filename: "x.elf" }, inv)).toBeNull();
  });
});
