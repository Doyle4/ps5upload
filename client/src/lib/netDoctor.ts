/**
 * The network doctor's judgement: from what the engine saw of both links, the speed test's
 * figures and what else the app is doing, a short list of findings, most important first.
 *
 * Plain functions over plain inputs, so every verdict is tested without a console. The rule
 * is the health check's: never guess. Anything that could not be measured is a `skip` with
 * its reason, never a pass and never a problem.
 *
 * The ceilings are what the link types deliver to a PS5 in practice: a gigabit cable runs
 * about 105 MiB/s (90–115 MB/s), Wi-Fi about 30, and a 100 Mb/s link tops out near 11.
 */

import type { BottleneckCause } from "./jobLive";

const MIB = 1024 * 1024;
export const CABLE_BPS = 105 * MIB;
export const WIFI_BPS = 30 * MIB;

export type LinkKind = "wired" | "wifi" | "vpn" | "virtual" | "unknown";

/** One side's link, as the engine read it (`/api/net/doctor`). */
export interface DoctorLink {
  iface: string | null;
  kind: LinkKind;
  link_mbps: number | null;
  mtu: number | null;
  /** Why it could not be read: mobile, container, no_route, unreadable, not_found, helper. */
  skip: string | null;
  detail: string | null;
}

export interface DoctorFacts {
  host: DoctorLink;
  console: DoctorLink;
  in_container: boolean;
  bridged_without_pin: boolean;
  /** Middle connection-open time to the console with the network quiet. */
  reply_ms: number | null;
  reply_samples: number;
}

/** Why the doctor has no speed figures. */
export type SpeedSkip = "busy" | "failed" | "stopped" | "none";

export interface DoctorInput {
  /** Null when the engine could not be asked. */
  facts: DoctorFacts | null;
  speed: { uploadBps: number; downloadBps: number } | null;
  speedSkip: SpeedSkip | null;
  speedError?: string | null;
  /** Connection-open time measured while the speed test was sending. */
  loadedReplyMs: number | null;
  /** Transfers and jobs running in the app, besides the doctor's own test. */
  otherWork: number;
  bandwidthCapMbps: number;
}

export type Severity = "problem" | "warn" | "skip" | "ok";

export type FindingId =
  | "console_link"
  | "host_link"
  | "link_speed"
  | "load_latency"
  | "mtu"
  | "container"
  | "other_work"
  | "speed_cap"
  | "limit";

export interface Finding {
  id: FindingId;
  severity: Severity;
  /** Which wording: the screen maps `id` + `variant` to its text. */
  variant: string;
  /** What this link can be expected to do, bytes per second, where known. */
  ceilingBps?: number;
  vars: Record<string, string | number>;
}

/** "about 30 MiB/s" style: whole numbers above ten, one decimal below. */
export function rate(bps: number): string {
  const v = bps / MIB;
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)} MiB/s`;
}

/** What a link of `mbps` megabits carries at most, in bytes per second (about 90 %). */
export const linkBps = (mbps: number) => (mbps * 1_000_000 * 0.9) / 8;

/** The most the path can be expected to carry, or null when a side's link is not known. */
export function expectedCeiling(facts: DoctorFacts | null): number | null {
  if (!facts) return null;
  const { host, console: ps5 } = facts;
  const slowCable =
    host.kind === "wired" && host.link_mbps && host.link_mbps < 1000
      ? linkBps(host.link_mbps)
      : null;
  if (slowCable !== null) return slowCable;
  if (ps5.kind === "wifi" || host.kind === "wifi") return WIFI_BPS;
  if (ps5.kind === "wired" && host.kind === "wired") return CABLE_BPS;
  return null;
}

const SEVERITY_ORDER: Record<Severity, number> = {
  problem: 0,
  warn: 1,
  skip: 2,
  ok: 3,
};

/** Most common causes first within a severity. */
const ID_ORDER: FindingId[] = [
  "console_link",
  "host_link",
  "link_speed",
  "load_latency",
  "mtu",
  "container",
  "other_work",
  "speed_cap",
  "limit",
];

export function rankFindings(list: Finding[]): Finding[] {
  return [...list].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      ID_ORDER.indexOf(a.id) - ID_ORDER.indexOf(b.id),
  );
}

function consoleLink(facts: DoctorFacts | null): Finding {
  const c = facts?.console;
  if (!c || c.skip || c.kind === "unknown")
    return {
      id: "console_link",
      severity: "skip",
      variant: !facts ? "engine" : c?.skip === "helper" ? "helper" : "unknown",
      vars: {},
    };
  if (c.kind === "wifi")
    return {
      id: "console_link",
      severity: "problem",
      variant: "wifi",
      ceilingBps: WIFI_BPS,
      vars: { wifi: rate(WIFI_BPS), cable: rate(CABLE_BPS) },
    };
  return { id: "console_link", severity: "ok", variant: "wired", vars: {} };
}

function hostLink(facts: DoctorFacts | null): Finding {
  const h = facts?.host;
  const iface = h?.iface ?? "";
  if (!h) return { id: "host_link", severity: "skip", variant: "engine", vars: {} };
  if (h.skip === "mobile" || h.skip === "container")
    return { id: "host_link", severity: "skip", variant: h.skip, vars: {} };
  switch (h.kind) {
    case "wifi":
      return {
        id: "host_link",
        severity: "warn",
        variant: "wifi",
        ceilingBps: WIFI_BPS,
        vars: { iface, wifi: rate(WIFI_BPS), cable: rate(CABLE_BPS) },
      };
    case "vpn":
      return { id: "host_link", severity: "problem", variant: "vpn", vars: { iface } };
    case "virtual":
      return { id: "host_link", severity: "skip", variant: "virtual", vars: { iface } };
    case "wired":
      return { id: "host_link", severity: "ok", variant: "wired", vars: { iface } };
    default:
      return { id: "host_link", severity: "skip", variant: "unknown", vars: {} };
  }
}

/** True when the speed test's slower leg sits in the band a 100 Mb/s link produces. */
function measuredHundredMbit(speed: DoctorInput["speed"]): boolean {
  if (!speed) return false;
  const slower = Math.min(speed.uploadBps, speed.downloadBps) / MIB;
  return slower >= 9 && slower < 13;
}

function linkSpeed(input: DoctorInput): Finding {
  const h = input.facts?.host;
  if (!h || h.kind !== "wired")
    return { id: "link_speed", severity: "skip", variant: "not_cable", vars: {} };
  if (!h.link_mbps)
    return { id: "link_speed", severity: "skip", variant: "unknown", vars: {} };
  if (h.link_mbps < 1000)
    return {
      id: "link_speed",
      severity: "problem",
      variant: "slow",
      ceilingBps: linkBps(h.link_mbps),
      vars: {
        mbps: h.link_mbps,
        ceiling: rate(linkBps(h.link_mbps)),
        cable: rate(CABLE_BPS),
      },
    };
  // This computer's cable is fast, both ends are cables, yet the test topped out where a
  // 100 Mb/s link does: the slow hop is further along (the PS5's cable, a switch port).
  if (input.facts?.console.kind === "wired" && measuredHundredMbit(input.speed))
    return {
      id: "link_speed",
      severity: "problem",
      variant: "hop",
      ceilingBps: linkBps(100),
      vars: { mbps: h.link_mbps, ceiling: rate(linkBps(100)) },
    };
  return { id: "link_speed", severity: "ok", variant: "ok", vars: { mbps: h.link_mbps } };
}

/** Reply times that grow this much while sending point at a queue that fills under load. */
export function latencyBalloons(idleMs: number, loadedMs: number): boolean {
  return loadedMs >= idleMs + 30 && loadedMs >= idleMs * 3;
}

function loadLatency(input: DoctorInput): Finding {
  const idle = input.facts?.reply_ms ?? null;
  if (idle === null)
    return { id: "load_latency", severity: "skip", variant: "no_idle", vars: {} };
  if (input.loadedReplyMs === null)
    return {
      id: "load_latency",
      severity: "skip",
      variant: "no_loaded",
      vars: { idle },
    };
  const vars = { idle, loaded: input.loadedReplyMs };
  return latencyBalloons(idle, input.loadedReplyMs)
    ? { id: "load_latency", severity: "warn", variant: "balloons", vars }
    : { id: "load_latency", severity: "ok", variant: "steady", vars };
}

function mtu(facts: DoctorFacts | null): Finding {
  const c = facts?.console.mtu ?? null;
  const usable = facts && !facts.host.skip && facts.host.kind !== "virtual";
  const h = usable ? facts.host.mtu : null;
  if (!c || !h) return { id: "mtu", severity: "skip", variant: "unknown", vars: {} };
  if (c !== h)
    return { id: "mtu", severity: "warn", variant: "mismatch", vars: { console: c, host: h } };
  return { id: "mtu", severity: "ok", variant: "match", vars: { mtu: c } };
}

function container(facts: DoctorFacts | null): Finding | null {
  if (!facts?.in_container) return null;
  return facts.bridged_without_pin
    ? { id: "container", severity: "problem", variant: "bridged", vars: {} }
    : { id: "container", severity: "ok", variant: "ok", vars: {} };
}

function otherWork(input: DoctorInput): Finding {
  return input.otherWork > 0
    ? { id: "other_work", severity: "warn", variant: "busy", vars: { count: input.otherWork } }
    : { id: "other_work", severity: "ok", variant: "idle", vars: {} };
}

function speedCap(input: DoctorInput): Finding | null {
  if (!(input.bandwidthCapMbps > 0)) return null;
  return {
    id: "speed_cap",
    severity: "warn",
    variant: "on",
    vars: { cap: input.bandwidthCapMbps },
  };
}

/** Which side holds transfers back, from the speed test against the link's ceiling. */
function limit(input: DoctorInput): Finding {
  const s = input.speed;
  if (!s) {
    const variant =
      input.speedSkip === "busy"
        ? "busy"
        : input.speedSkip === "failed"
          ? "failed"
          : input.speedSkip === "stopped"
            ? "stopped"
            : "none";
    return {
      id: "limit",
      severity: "skip",
      variant,
      vars: { error: input.speedError ?? "" },
    };
  }
  const up = s.uploadBps;
  const down = s.downloadBps;
  const ceiling = expectedCeiling(input.facts);
  const vars = {
    up: rate(up),
    down: rate(down),
    ceiling: ceiling ? rate(ceiling) : "",
  };
  // Reading back is quick but writing is slow: the network carried the data fine, the PS5
  // took it slowly (its drive, or its own workers). Judged only with a cable at both ends:
  // Wi-Fi is often lopsided by itself.
  const driveSlow = ceiling === CABLE_BPS && down >= 20 * MIB && up < down * 0.5;
  if (driveSlow) return { id: "limit", severity: "warn", variant: "drive", vars };
  if (ceiling === null)
    return { id: "limit", severity: "skip", variant: "measured", vars };
  const slower = Math.min(up, down);
  if (slower >= ceiling * 0.7)
    return { id: "limit", severity: "ok", variant: "at_link", ceilingBps: ceiling, vars };
  if (slower < ceiling * 0.5)
    return { id: "limit", severity: "warn", variant: "below_link", ceilingBps: ceiling, vars };
  return { id: "limit", severity: "ok", variant: "near_link", ceilingBps: ceiling, vars };
}

/** Every finding, most important first. */
export function diagnose(input: DoctorInput): Finding[] {
  const all: (Finding | null)[] = [
    consoleLink(input.facts),
    hostLink(input.facts),
    linkSpeed(input),
    loadLatency(input),
    mtu(input.facts),
    container(input.facts),
    otherWork(input),
    speedCap(input),
    limit(input),
  ];
  return rankFindings(all.filter((f): f is Finding => f !== null));
}

/** What a running upload must look like before the Upload screen explains why it is slow:
 *  the engine names what holds it back, it has been so for half a minute, and it runs well
 *  below what the speed test measured (or, with no test, below what even a 100 Mb/s link
 *  carries). The network is one cause; the source on this computer, the console's drive and
 *  its file-creating workers are the others, and the speed test says nothing about those —
 *  a Discord report had a gigabit speed test at 82.8 MiB/s and uploads at 4–5 MiB/s, and the
 *  app only said so when the network was the limit. A speed limit the user set is a cause of
 *  its own. Conservative on purpose: it must never nag. */
export const HINT_AFTER_MS = 30_000;

export type SlowCause = Exclude<BottleneckCause, "memory"> | "cap";

export function slowTransferHint(input: {
  bytesPerSec: number;
  bottleneck: BottleneckCause | null;
  /** How long the transfer has looked like this, in milliseconds. */
  sustainedMs: number;
  speedTestUploadBps: number | null;
  bandwidthCapMbps: number;
}): { cause: SlowCause; expectedBps: number | null } | null {
  if (!(input.bytesPerSec > 0) || input.sustainedMs < HINT_AFTER_MS) return null;
  const tested = input.speedTestUploadBps && input.speedTestUploadBps > 0 ? input.speedTestUploadBps : null;
  if (input.bandwidthCapMbps > 0) {
    // The limit is in MiB/s despite the setting's name (the Upload card and Settings say
    // "about {n} MiB/s"), so compare loosely: running at it, while the link could do clearly
    // more, means the limit is what holds it back.
    const capBps = input.bandwidthCapMbps * MIB;
    const atCap = input.bytesPerSec >= capBps * 0.7 && input.bytesPerSec <= capBps * 1.3;
    const linkFaster = tested === null || tested > capBps * 1.5;
    return atCap && linkFaster ? { cause: "cap", expectedBps: tested } : null;
  }
  // "console memory" is AVA1's full receive window, which on its own says too little (a slow
  // link fills it too) to tell anyone what to change.
  if (!input.bottleneck || input.bottleneck === "memory") return null;
  if (tested) {
    return input.bytesPerSec < tested * 0.4 ? { cause: input.bottleneck, expectedBps: tested } : null;
  }
  return input.bytesPerSec < linkBps(100) ? { cause: input.bottleneck, expectedBps: null } : null;
}

/** Whether a running upload meets the hint's condition right now (before the time test). */
export function slowNow(input: {
  bytesPerSec: number;
  bottleneck: BottleneckCause | null;
  speedTestUploadBps: number | null;
  bandwidthCapMbps: number;
}): boolean {
  return slowTransferHint({ ...input, sustainedMs: HINT_AFTER_MS }) !== null;
}
