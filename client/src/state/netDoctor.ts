import { create } from "zustand";

import { hostOf } from "../lib/addr";
import {
  diagnose,
  type DoctorFacts,
  type Finding,
  type SpeedSkip,
} from "../lib/netDoctor";
import { speedTestRunning, type SpeedTestState } from "./speedTest";

/**
 * A run of the network doctor ("Diagnose slow transfers"), kept outside the screen like the
 * speed test: it carries on, and keeps its findings, when the screen is left.
 *
 * A run reads both links from the engine, times how quickly the console answers with the
 * network quiet, then runs the ordinary speed test (unless a recent one can be reused, or other
 * transfers are running and a test would only compete with them) and times the console again
 * while the test is sending. `lib/netDoctor` turns all of it into findings.
 */

export type DoctorPhase = "reading" | "testing" | "done" | "failed";

export interface DoctorRunState {
  phase: DoctorPhase;
  findings: Finding[] | null;
  error: string | null;
  finishedAtMs: number | null;
}

interface Store {
  byHost: Record<string, DoctorRunState>;
}

export const useNetDoctorStore = create<Store>(() => ({ byHost: {} }));

export function netDoctorFor(s: Store, host: string): DoctorRunState | null {
  return s.byHost[hostOf(host)] ?? null;
}

export const netDoctorRunning = (s: DoctorRunState | null) =>
  !!s && (s.phase === "reading" || s.phase === "testing");

function put(host: string, next: DoctorRunState) {
  const key = hostOf(host);
  useNetDoctorStore.setState((s) => ({ byHost: { ...s.byHost, [key]: next } }));
}

/** A speed test this recent is reused rather than run again. */
export const REUSE_SPEED_TEST_MS = 10 * 60_000;
/** The size of the doctor's own speed test, MiB: long enough to time replies mid-send. */
export const DOCTOR_TEST_MIB = 256;

/** What the run needs from the app. Injected so it is testable without a console. */
export interface NetDoctorDeps {
  facts: (host: string) => Promise<DoctorFacts>;
  /** Middle connection-open time right now, or null when nothing answered. */
  replyMs: (host: string) => Promise<number | null>;
  runSpeedTest: (host: string, sizeMib: number) => Promise<void>;
  speedTest: (host: string) => SpeedTestState | null;
  /** Transfers and jobs running in the app. */
  otherWork: (host: string) => number;
  bandwidthCapMbps: () => number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Runs the doctor to its end; the findings land in the store. A run already going for this
 *  console is left alone. */
export async function runNetDoctor(host: string, deps: NetDoctorDeps): Promise<void> {
  if (netDoctorRunning(netDoctorFor(useNetDoctorStore.getState(), host))) return;
  put(host, { phase: "reading", findings: null, error: null, finishedAtMs: null });
  try {
    let facts: DoctorFacts | null = null;
    try {
      facts = await deps.facts(host);
    } catch {
      // The checks that need the engine say so one by one; the rest still run.
      facts = null;
    }
    // Counted before the doctor's own test starts, so the test is not counted against itself.
    const otherWork = deps.otherWork(host);

    let speed: { uploadBps: number; downloadBps: number } | null = null;
    let speedSkip: SpeedSkip | null = null;
    let speedError: string | null = null;
    let loadedReplyMs: number | null = null;

    const recent = deps.speedTest(host);
    const reusable =
      recent?.phase === "done" &&
      recent.uploadBps !== null &&
      recent.downloadBps !== null &&
      recent.finishedAtMs !== null &&
      deps.now() - recent.finishedAtMs < REUSE_SPEED_TEST_MS;
    if (reusable) {
      speed = { uploadBps: recent.uploadBps!, downloadBps: recent.downloadBps! };
    } else if (otherWork > 0) {
      speedSkip = "busy";
    } else {
      put(host, { phase: "testing", findings: null, error: null, finishedAtMs: null });
      // A test someone started from the speed test card is joined, not started twice (the
      // runner leaves a running one alone and returns at once).
      let ended = false;
      void deps
        .runSpeedTest(host, DOCTOR_TEST_MIB)
        .catch(() => {})
        .finally(() => {
          ended = true;
        });
      let timed = false;
      for (;;) {
        const st = deps.speedTest(host);
        if (ended && !speedTestRunning(st)) break;
        // Time the console again once a quarter of the file is on its way: the link is full.
        if (
          !timed &&
          st?.phase === "uploading" &&
          st.total > 0 &&
          st.sent >= st.total * 0.25
        ) {
          timed = true;
          loadedReplyMs = await deps.replyMs(host).catch(() => null);
        }
        await deps.sleep(250);
      }
      const st = deps.speedTest(host);
      if (st?.phase === "done" && st.uploadBps !== null && st.downloadBps !== null) {
        speed = { uploadBps: st.uploadBps, downloadBps: st.downloadBps };
      } else if (st?.phase === "stopped") {
        speedSkip = "stopped";
      } else {
        speedSkip = "failed";
        speedError = st?.error ?? null;
      }
    }

    put(host, {
      phase: "done",
      findings: diagnose({
        facts,
        speed,
        speedSkip,
        speedError,
        loadedReplyMs,
        otherWork,
        bandwidthCapMbps: deps.bandwidthCapMbps(),
      }),
      error: null,
      finishedAtMs: deps.now(),
    });
  } catch (e) {
    put(host, { phase: "failed", findings: null, error: message(e), finishedAtMs: deps.now() });
  }
}
