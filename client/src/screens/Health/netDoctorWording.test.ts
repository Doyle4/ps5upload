import { describe, expect, it } from "vitest";

import {
  diagnose,
  type DoctorFacts,
  type DoctorInput,
  type DoctorLink,
  type Finding,
} from "../../lib/netDoctor";
import { WORDING } from "./netDoctorWording";

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
  console: link({ iface: "eth0" }),
  in_container: false,
  bridged_without_pin: false,
  reply_ms: 2,
  reply_samples: 5,
  ...over,
});
const base: DoctorInput = {
  facts: facts(),
  speed: { uploadBps: 100 * MIB, downloadBps: 100 * MIB },
  speedSkip: null,
  loadedReplyMs: 3,
  otherWork: 0,
  bandwidthCapMbps: 0,
};

/** Inputs that between them reach every finding variant. */
const CASES: Partial<DoctorInput>[] = [
  {},
  { facts: null, speed: null, speedSkip: "failed", loadedReplyMs: null },
  { speed: null, speedSkip: "busy", otherWork: 3, bandwidthCapMbps: 4 },
  { speed: null, speedSkip: "stopped", loadedReplyMs: null },
  { speed: null, speedSkip: "none" },
  { loadedReplyMs: 90, speed: { uploadBps: 11 * MIB, downloadBps: 11 * MIB } },
  { speed: { uploadBps: 30 * MIB, downloadBps: 100 * MIB } },
  { speed: { uploadBps: 60 * MIB, downloadBps: 60 * MIB } },
  { facts: facts({ host: link({ link_mbps: 100, mtu: 9000 }) }) },
  { facts: facts({ host: link({ link_mbps: null }) }) },
  { facts: facts({ console: link({ kind: "wifi" }), host: link({ kind: "wifi" }) }) },
  { facts: facts({ host: link({ kind: "vpn" }), console: link({ kind: "unknown", skip: "helper" }) }) },
  { facts: facts({ host: link({ kind: "virtual" }), console: link({ kind: "unknown", skip: "unreadable" }) }) },
  { facts: facts({ host: link({ kind: "unknown", skip: "mobile" }) }) },
  { facts: facts({ host: link({ kind: "unknown", skip: "unreadable" }) }) },
  {
    facts: facts({
      host: link({ kind: "virtual", skip: "container" }),
      in_container: true,
      bridged_without_pin: true,
      reply_ms: null,
    }),
  },
  { facts: facts({ in_container: true }) },
];

describe("network doctor wording", () => {
  const seen = new Map<string, Finding>();
  for (const c of CASES) for (const f of diagnose({ ...base, ...c })) seen.set(`${f.id}.${f.variant}`, f);

  it("every finding the doctor can give has its words", () => {
    for (const k of seen.keys()) expect(WORDING[k], k).toBeDefined();
  });

  it("every wording is reachable, so none is dead text", () => {
    for (const k of Object.keys(WORDING)) expect(seen.has(k), k).toBe(true);
  });

  it("every placeholder in the words is filled by the finding", () => {
    for (const [k, f] of seen) {
      const w = WORDING[k];
      for (const [, en] of [w.title, w.detail, ...(w.fix ? [w.fix] : [])]) {
        for (const m of en.matchAll(/\{(\w+)\}/g)) expect(f.vars, `${k}: {${m[1]}}`).toHaveProperty(m[1]);
      }
    }
  });
});
