import { beforeEach, describe, expect, it } from "vitest";

import type { DoctorFacts } from "../lib/netDoctor";
import {
  DOCTOR_TEST_MIB,
  REUSE_SPEED_TEST_MS,
  netDoctorFor,
  runNetDoctor,
  useNetDoctorStore,
  type NetDoctorDeps,
} from "./netDoctor";
import type { SpeedTestState } from "./speedTest";

const A = "10.0.0.5";
const MIB = 1024 * 1024;
const NOW = 1_000_000_000;
const at = () => netDoctorFor(useNetDoctorStore.getState(), A);

const FACTS: DoctorFacts = {
  host: { iface: "en0", kind: "wired", link_mbps: 1000, mtu: 1500, skip: null, detail: null },
  console: { iface: "eth0", kind: "wired", link_mbps: null, mtu: 1500, skip: null, detail: null },
  in_container: false,
  bridged_without_pin: false,
  reply_ms: 2,
  reply_samples: 5,
};

const speed = (over: Partial<SpeedTestState>): SpeedTestState => ({
  phase: "done",
  sizeBytes: 256 * MIB,
  sent: 0,
  total: 0,
  uploadBps: 100 * MIB,
  downloadBps: 104 * MIB,
  error: null,
  failedLeg: null,
  stopRequested: false,
  finishedAtMs: NOW - 60_000,
  ...over,
});

/** A speed test that goes through its phases one poll at a time. */
function world(over: Partial<NetDoctorDeps> = {}, script?: SpeedTestState[]) {
  const log: string[] = [];
  let st: SpeedTestState | null = null;
  let step = 0;
  const steps = script ?? [
    speed({ phase: "preparing", uploadBps: null, downloadBps: null }),
    speed({ phase: "uploading", sent: 10 * MIB, total: 256 * MIB, uploadBps: null, downloadBps: null }),
    speed({ phase: "uploading", sent: 128 * MIB, total: 256 * MIB, uploadBps: null, downloadBps: null }),
    speed({ phase: "downloading", uploadBps: 100 * MIB, downloadBps: null }),
    speed({ finishedAtMs: NOW }),
  ];
  let finish: (() => void) | null = null;
  const deps: NetDoctorDeps = {
    facts: async () => (log.push("facts"), FACTS),
    replyMs: async () => (log.push(`reply during ${st?.phase}`), 60),
    runSpeedTest: (_h, mib) => {
      log.push(`speedtest ${mib}`);
      st = steps[0];
      return new Promise<void>((r) => {
        finish = r;
      });
    },
    speedTest: () => st,
    otherWork: () => 0,
    bandwidthCapMbps: () => 0,
    now: () => NOW,
    // Each wait moves the test one phase on; the last one ends it.
    sleep: async () => {
      if (!finish) return;
      step += 1;
      if (step < steps.length) st = steps[step];
      if (step >= steps.length - 1) finish();
    },
    ...over,
  };
  return { deps, log, setSpeed: (s: SpeedTestState | null) => (st = s) };
}

beforeEach(() => useNetDoctorStore.setState({ byHost: {} }));

describe("runNetDoctor", () => {
  it("reads the facts, runs a speed test and times replies mid-upload", async () => {
    const { deps, log } = world();
    await runNetDoctor(A, deps);
    expect(log).toEqual(["facts", `speedtest ${DOCTOR_TEST_MIB}`, "reply during uploading"]);
    const run = at()!;
    expect(run.phase).toBe("done");
    const latency = run.findings!.find((f) => f.id === "load_latency")!;
    expect(latency).toMatchObject({ severity: "warn", vars: { idle: 2, loaded: 60 } });
    expect(run.findings!.find((f) => f.id === "limit")).toMatchObject({ variant: "at_link" });
  });

  it("reuses a recent speed test instead of running another", async () => {
    const { deps, log, setSpeed } = world();
    setSpeed(speed({}));
    await runNetDoctor(A, deps);
    expect(log).toEqual(["facts"]);
    const f = at()!.findings!;
    expect(f.find((x) => x.id === "limit")?.variant).toBe("at_link");
    // Not timed while sending this time: said so, not guessed.
    expect(f.find((x) => x.id === "load_latency")).toMatchObject({
      severity: "skip",
      variant: "no_loaded",
    });
  });

  it("runs a new test when the last one is old", async () => {
    const { deps, log, setSpeed } = world();
    setSpeed(speed({ finishedAtMs: NOW - REUSE_SPEED_TEST_MS - 1 }));
    await runNetDoctor(A, deps);
    expect(log).toContain(`speedtest ${DOCTOR_TEST_MIB}`);
  });

  it("does not compete with transfers already running", async () => {
    const { deps, log } = world({ otherWork: () => 2 });
    await runNetDoctor(A, deps);
    expect(log).toEqual(["facts"]);
    const f = at()!.findings!;
    expect(f.find((x) => x.id === "limit")).toMatchObject({ severity: "skip", variant: "busy" });
    expect(f.find((x) => x.id === "other_work")).toMatchObject({ severity: "warn" });
  });

  it("an engine that does not answer leaves each check skipped, and the run still ends", async () => {
    const { deps } = world({
      facts: async () => {
        throw new Error("HTTP 404");
      },
    });
    await runNetDoctor(A, deps);
    const run = at()!;
    expect(run.phase).toBe("done");
    expect(run.findings!.find((x) => x.id === "console_link")).toMatchObject({
      severity: "skip",
      variant: "engine",
    });
  });

  it("a failed speed test is reported with its error", async () => {
    const { deps } = world({}, [
      speed({ phase: "preparing", uploadBps: null, downloadBps: null }),
      speed({ phase: "failed", failedLeg: "upload", error: "connection reset", uploadBps: null, downloadBps: null }),
    ]);
    await runNetDoctor(A, deps);
    expect(at()!.findings!.find((x) => x.id === "limit")).toMatchObject({
      severity: "skip",
      variant: "failed",
      vars: { error: "connection reset" },
    });
  });
});
