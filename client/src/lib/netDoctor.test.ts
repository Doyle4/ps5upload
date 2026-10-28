import { describe, expect, it } from "vitest";

import {
  CABLE_BPS,
  WIFI_BPS,
  diagnose,
  expectedCeiling,
  latencyBalloons,
  rate,
  slowTransferHint,
  type DoctorFacts,
  type DoctorInput,
  type DoctorLink,
  type Finding,
} from "./netDoctor";

const MIB = 1024 * 1024;

const link = (over: Partial<DoctorLink> = {}): DoctorLink => ({
  iface: "en0",
  kind: "wired",
  link_mbps: 1000,
  mtu: 1500,
  skip: null,
  detail: null,
  ...over,
});

const facts = (over: Partial<DoctorFacts> = {}): DoctorFacts => ({
  host: link(),
  console: link({ iface: "eth0", link_mbps: null }),
  in_container: false,
  bridged_without_pin: false,
  reply_ms: 2,
  reply_samples: 5,
  ...over,
});

const input = (over: Partial<DoctorInput> = {}): DoctorInput => ({
  facts: facts(),
  speed: { uploadBps: 100 * MIB, downloadBps: 104 * MIB },
  speedSkip: null,
  loadedReplyMs: 4,
  otherWork: 0,
  bandwidthCapMbps: 0,
  ...over,
});

const find = (list: Finding[], id: Finding["id"]) => list.find((f) => f.id === id);

describe("diagnose", () => {
  it("a healthy cable at both ends finds nothing to fix and says the link is the limit", () => {
    const out = diagnose(input());
    expect(out.filter((f) => f.severity === "problem" || f.severity === "warn")).toEqual([]);
    expect(find(out, "limit")).toMatchObject({ severity: "ok", variant: "at_link" });
    expect(find(out, "container")).toBeUndefined();
    expect(find(out, "speed_cap")).toBeUndefined();
  });

  it("a PS5 on Wi-Fi comes first, with the Wi-Fi and cable figures", () => {
    const out = diagnose(
      input({
        facts: facts({ console: link({ iface: "wlan0", kind: "wifi" }) }),
        speed: { uploadBps: 26 * MIB, downloadBps: 28 * MIB },
      }),
    );
    expect(out[0]).toMatchObject({ id: "console_link", severity: "problem", variant: "wifi" });
    expect(out[0].ceilingBps).toBe(WIFI_BPS);
    expect(out[0].vars).toEqual({ wifi: rate(WIFI_BPS), cable: rate(CABLE_BPS) });
    // 26 MiB/s over Wi-Fi is what Wi-Fi does: the link is the limit, not something else.
    expect(find(out, "limit")).toMatchObject({ severity: "ok", variant: "at_link" });
  });

  it("this computer on Wi-Fi or behind a VPN is named", () => {
    const wifi = diagnose(input({ facts: facts({ host: link({ kind: "wifi", link_mbps: null }) }) }));
    expect(find(wifi, "host_link")).toMatchObject({ severity: "warn", variant: "wifi" });
    expect(find(wifi, "link_speed")).toMatchObject({ severity: "skip", variant: "not_cable" });
    const vpn = diagnose(input({ facts: facts({ host: link({ iface: "utun3", kind: "vpn" }) }) }));
    expect(find(vpn, "host_link")).toMatchObject({
      severity: "problem",
      variant: "vpn",
      vars: { iface: "utun3" },
    });
  });

  it("a cable that negotiated 100 Mb/s caps near 11 MiB/s", () => {
    const out = diagnose(
      input({
        facts: facts({ host: link({ link_mbps: 100 }) }),
        speed: { uploadBps: 10.8 * MIB, downloadBps: 11 * MIB },
      }),
    );
    const f = find(out, "link_speed")!;
    expect(f).toMatchObject({ severity: "problem", variant: "slow" });
    expect(f.ceilingBps! / MIB).toBeCloseTo(10.73, 1);
    expect(expectedCeiling(facts({ host: link({ link_mbps: 100 }) }))).toBe(f.ceilingBps);
    // At the slow cable's own ceiling, the speed test is "at the link", not a second problem.
    expect(find(out, "limit")).toMatchObject({ severity: "ok", variant: "at_link" });
  });

  it("a gigabit cable here but a 100 Mb/s result points at a slow hop further along", () => {
    const out = diagnose(input({ speed: { uploadBps: 11 * MIB, downloadBps: 11.2 * MIB } }));
    expect(find(out, "link_speed")).toMatchObject({ severity: "problem", variant: "hop" });
    expect(find(out, "limit")).toMatchObject({ severity: "warn", variant: "below_link" });
  });

  it("reply time that balloons while sending is a warning; steady is fine", () => {
    expect(latencyBalloons(2, 40)).toBe(true);
    expect(latencyBalloons(2, 20)).toBe(false); // less than 30 ms more
    expect(latencyBalloons(40, 90)).toBe(false); // less than three times
    expect(find(diagnose(input({ loadedReplyMs: 80 })), "load_latency")).toMatchObject({
      severity: "warn",
      variant: "balloons",
      vars: { idle: 2, loaded: 80 },
    });
    expect(find(diagnose(input()), "load_latency")?.severity).toBe("ok");
  });

  it("what was not measured is skipped with its reason, never judged", () => {
    const noEngine = diagnose(input({ facts: null, speed: null, speedSkip: "failed", loadedReplyMs: null }));
    for (const f of noEngine) {
      if (f.id === "other_work") continue;
      expect(f.severity, f.id).toBe("skip");
    }
    expect(find(noEngine, "console_link")?.variant).toBe("engine");
    const noHelper = diagnose(
      input({
        facts: facts({ console: link({ kind: "unknown", skip: "helper", mtu: null }), reply_ms: null }),
        loadedReplyMs: null,
      }),
    );
    expect(find(noHelper, "console_link")).toMatchObject({ severity: "skip", variant: "helper" });
    expect(find(noHelper, "load_latency")).toMatchObject({ severity: "skip", variant: "no_idle" });
    expect(find(noHelper, "mtu")).toMatchObject({ severity: "skip", variant: "unknown" });
    // One side unknown: the figures are reported, not compared.
    expect(find(noHelper, "limit")).toMatchObject({ severity: "skip", variant: "measured" });
    const mobile = diagnose(input({ facts: facts({ host: link({ kind: "unknown", skip: "mobile" }) }) }));
    expect(find(mobile, "host_link")).toMatchObject({ severity: "skip", variant: "mobile" });
  });

  it("in a bridged container the host link is skipped and the bridge is a problem", () => {
    const out = diagnose(
      input({
        facts: facts({
          host: link({ iface: "eth0", kind: "virtual", link_mbps: null, skip: "container" }),
          in_container: true,
          bridged_without_pin: true,
        }),
      }),
    );
    expect(find(out, "host_link")).toMatchObject({ severity: "skip", variant: "container" });
    expect(find(out, "container")).toMatchObject({ severity: "problem", variant: "bridged" });
    // The container's own MTU says nothing about the computer's.
    expect(find(out, "mtu")?.severity).toBe("skip");
  });

  it("an MTU that differs between the two is a warning", () => {
    const out = diagnose(input({ facts: facts({ host: link({ mtu: 9000 }) }) }));
    expect(find(out, "mtu")).toMatchObject({
      severity: "warn",
      variant: "mismatch",
      vars: { console: 1500, host: 9000 },
    });
  });

  it("other work and a speed limit in the app are named", () => {
    const out = diagnose(input({ otherWork: 2, bandwidthCapMbps: 5 }));
    expect(find(out, "other_work")).toMatchObject({ severity: "warn", vars: { count: 2 } });
    expect(find(out, "speed_cap")).toMatchObject({ severity: "warn", vars: { cap: 5 } });
    const busy = diagnose(input({ speed: null, speedSkip: "busy" }));
    expect(find(busy, "limit")).toMatchObject({ severity: "skip", variant: "busy" });
  });

  it("fast reading back but slow writing blames the PS5 side, with a cable at both ends only", () => {
    const out = diagnose(input({ speed: { uploadBps: 30 * MIB, downloadBps: 100 * MIB } }));
    expect(find(out, "limit")).toMatchObject({ severity: "warn", variant: "drive" });
    const wifi = diagnose(
      input({
        facts: facts({ console: link({ kind: "wifi" }) }),
        speed: { uploadBps: 10 * MIB, downloadBps: 28 * MIB },
      }),
    );
    expect(find(wifi, "limit")?.variant).not.toBe("drive");
  });

  it("ranks problems, then warnings, then skips, then what is fine", () => {
    const out = diagnose(
      input({
        facts: facts({ console: link({ kind: "wifi" }), host: link({ mtu: 9000 }), reply_ms: null }),
        otherWork: 1,
      }),
    );
    const order = { problem: 0, warn: 1, skip: 2, ok: 3 };
    const ranks = out.map((f) => order[f.severity]);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    expect(out[0].id).toBe("console_link");
  });
});

describe("slowTransferHint", () => {
  const base = {
    bytesPerSec: 8 * MIB,
    bottleneck: "network" as const,
    sustainedMs: 31_000,
    speedTestUploadBps: null,
    bandwidthCapMbps: 0,
  };

  it("needs a measured cause, for half a minute", () => {
    expect(slowTransferHint(base)).toEqual({ cause: "network", expectedBps: null });
    expect(slowTransferHint({ ...base, bottleneck: null })).toBeNull();
    expect(slowTransferHint({ ...base, sustainedMs: 10_000 })).toBeNull();
    expect(slowTransferHint({ ...base, bytesPerSec: 0 })).toBeNull();
  });

  it("compares with the speed test when there is one, and stays quiet near it", () => {
    expect(slowTransferHint({ ...base, speedTestUploadBps: 100 * MIB })).toEqual({
      cause: "network",
      expectedBps: 100 * MIB,
    });
    expect(
      slowTransferHint({ ...base, bytesPerSec: 50 * MIB, speedTestUploadBps: 100 * MIB }),
    ).toBeNull();
    // Without a test, only below what even a 100 Mb/s link carries.
    expect(slowTransferHint({ ...base, bytesPerSec: 20 * MIB })).toBeNull();
  });

  // The Discord report: a gigabit speed test (82.8 MiB/s) and uploads at 4-5 MiB/s. When the
  // network is not the limit, the hint names what is.
  it("names the source, the console's drive or its workers when they hold it back", () => {
    const slow = { ...base, bytesPerSec: 4.5 * MIB, speedTestUploadBps: 82.8 * MIB };
    for (const cause of ["source", "disk", "workers"] as const) {
      expect(slowTransferHint({ ...slow, bottleneck: cause })).toEqual({
        cause,
        expectedBps: 82.8 * MIB,
      });
    }
    expect(slowTransferHint({ ...slow, bytesPerSec: 60 * MIB, bottleneck: "source" })).toBeNull();
    // A full receive window alone does not say what to change.
    expect(slowTransferHint({ ...slow, bottleneck: "memory" })).toBeNull();
  });

  it("blames a speed limit only when the upload runs at it and the link could do more", () => {
    const capped = { ...base, bottleneck: null, bandwidthCapMbps: 5 };
    expect(slowTransferHint({ ...capped, bytesPerSec: 5 * MIB, speedTestUploadBps: 80 * MIB })).toEqual({
      cause: "cap",
      expectedBps: 80 * MIB,
    });
    expect(slowTransferHint({ ...capped, bytesPerSec: 5 * MIB })).toEqual({ cause: "cap", expectedBps: null });
    // Well under the limit: something else holds it back, which a limit does not explain.
    expect(slowTransferHint({ ...capped, bytesPerSec: 1 * MIB, speedTestUploadBps: 80 * MIB })).toBeNull();
    // The link itself is no faster than the limit.
    expect(slowTransferHint({ ...capped, bytesPerSec: 5 * MIB, speedTestUploadBps: 6 * MIB })).toBeNull();
  });
});

