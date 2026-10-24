import { consoleAddr } from "../lib/addr";
import type { DoctorFacts } from "../lib/netDoctor";
import { getEngineUrl } from "./engine";
import { runNetDoctor, type NetDoctorDeps } from "./netDoctor";
import { speedTestFor, useSpeedTestStore } from "./speedTest";
import { startSpeedTest } from "./speedTestRuntime";
import { useTaskStore } from "./tasks";
import { useUploadSettingsStore } from "./uploadSettings";

/** The engine's doctor routes, read over its HTTP API directly (as the job summaries are), so
 *  the desktop app and the web UI share them with no Tauri command in between. */
async function getJson<T>(path: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${getEngineUrl()}${path}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

const q = (host: string) => `?addr=${encodeURIComponent(consoleAddr(host))}`;

/** The doctor's real dependencies. */
export const netDoctorDeps: NetDoctorDeps = {
  // Reading this computer's link runs a system tool or two (PowerShell on Windows is slow to
  // start), and the console is asked for its interfaces: allow for both.
  facts: (host) => getJson<DoctorFacts>(`/api/net/doctor${q(host)}`, 30_000),
  replyMs: async (host) =>
    (
      await getJson<{ median_ms: number | null }>(
        `/api/net/doctor/reply${q(host)}`,
        15_000,
      )
    ).median_ms,
  runSpeedTest: (host, sizeMib) => startSpeedTest(host, sizeMib),
  speedTest: (host) => speedTestFor(useSpeedTestStore.getState(), host),
  // Every running transfer or job shares this computer's connection, whichever console it is for.
  otherWork: () =>
    useTaskStore.getState().tasks.filter((t) => t.status === "running").length,
  bandwidthCapMbps: () => useUploadSettingsStore.getState().bandwidthCapMbps,
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/** Runs the doctor against `host` (does nothing if one is running). */
export function startNetDoctor(host: string): Promise<void> {
  return runNetDoctor(host, netDoctorDeps);
}
