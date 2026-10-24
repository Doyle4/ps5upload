import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../state/lang", () => {
  const tr = (key: string, vars?: Record<string, string | number>, fallback?: string) => {
    // Clean up's shared drive names come without a fallback.
    const known: Record<string, string> = {
      cw_cleanup_drive_internal: "Internal",
      cw_cleanup_drive_ext: "Extended {n}",
      cw_cleanup_drive_usb: "USB {n}",
    };
    let s = fallback ?? known[key] ?? key;
    for (const [k, v] of Object.entries(vars ?? {})) s = s.replace(`{${k}}`, String(v));
    return s;
  };
  return { useTr: () => tr, useLangStore: (sel: (s: { lang: string }) => unknown) => sel({ lang: "en" }) };
});

import { planSpace, planWithSelection, type SpaceCandidate, type SpacePlanInput } from "../../lib/spacePlan";
import { confirmLines, planSummary, SpacePlanView } from "./SpacePlanner";

const GB = 1024 ** 3;
const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const tr = ((key: string, vars?: Record<string, string | number>, fallback?: string) => {
  let s = fallback ?? (key === "cw_cleanup_drive_usb" ? "USB {n}" : key);
  for (const [k, v] of Object.entries(vars ?? {})) s = s.replace(`{${k}}`, String(v));
  return s;
}) as Parameters<typeof planSummary>[0];

const cands: SpaceCandidate[] = [
  { id: "leftover:1", kind: "leftover", label: "CUSA1.pkg", bytes: 4 * GB, lastPlayedMs: null, cleanupId: 1 },
  { id: "move:A", kind: "move", label: "Astro", bytes: 60 * GB, lastPlayedMs: NOW - 200 * DAY, moveTargets: ["/mnt/usb0"], path: "/data/homebrew/A" },
  { id: "move:B", kind: "move", label: "Bloodborne", bytes: 30 * GB, lastPlayedMs: null, moveTargets: ["/mnt/usb0"], path: "/data/homebrew/B" },
  { id: "uninstall:C", kind: "uninstall", label: "Control", titleId: "PPSA3", bytes: 50 * GB, lastPlayedMs: NOW - 400 * DAY, hasCopy: true },
];
const input = (over: Partial<SpacePlanInput> = {}): SpacePlanInput => ({
  neededBytes: 140 * GB,
  roomBytes: 0,
  candidates: cands,
  destRoom: { "/mnt/usb0": 100 * GB },
  nowMs: NOW,
  ...over,
});

describe("space plan text", () => {
  it("sums up the plan in one line", () => {
    const plan = planSpace(input());
    expect(planSummary(tr, plan)).toBe(
      "Free 144 GiB: clear 4.00 GiB of leftovers; move Astro, Bloodborne to USB 1; uninstall Control (your Collection has a copy)",
    );
  });

  it("lists every step in the confirm dialog, the deletes said plainly", () => {
    const lines = confirmLines(tr, planSpace(input())).split("\n");
    expect(lines).toEqual([
      "• Delete 1 leftovers (4.00 GiB): CUSA1.pkg",
      "• Move Astro (60.0 GiB) to USB 1: copied first, then the original is deleted",
      "• Move Bloodborne (30.0 GiB) to USB 1: copied first, then the original is deleted",
      "• Uninstall Control (50.0 GiB): install it again from your Collection",
    ]);
  });
});

describe("SpacePlanView", () => {
  it("shows the totals, groups, last played (unknown when absent) and destinations", () => {
    const html = renderToStaticMarkup(
      <SpacePlanView plan={planSpace(input())} progress={{}} locked={false} lang="en" onToggle={() => {}} />,
    );
    expect(html).toContain("Frees 144 GiB of the 140 GiB needed");
    expect(html).toContain("Leftovers");
    expect(html).toContain("Move to another drive");
    expect(html).toContain("Uninstall (your Collection has a copy)");
    expect(html).toContain("Last played: unknown");
    expect(html).toContain("To USB 1");
    expect(html).not.toContain("Not enough yet");
  });

  it("says what is still missing when the ticked steps fall short", () => {
    const plan = planWithSelection(input(), new Set(["move:A"]));
    const html = renderToStaticMarkup(<SpacePlanView plan={plan} progress={{}} locked={false} lang="en" onToggle={() => {}} />);
    expect(html).toContain("Not enough yet");
    expect(html).toContain("80.0 GiB is still missing");
  });

  it("says plainly when nothing on the drive can safely go", () => {
    const plan = planSpace(input({ candidates: [] }));
    const html = renderToStaticMarkup(<SpacePlanView plan={plan} progress={{}} locked={false} lang="en" onToggle={() => {}} />);
    expect(html).toContain("Nothing on this drive can safely make room");
  });

  it("says it already fits", () => {
    const plan = planSpace(input({ roomBytes: 200 * GB }));
    const html = renderToStaticMarkup(<SpacePlanView plan={plan} progress={{}} locked={false} lang="en" onToggle={() => {}} />);
    expect(html).toContain("It already fits");
  });

  it("shows each step's outcome while and after it runs", () => {
    const html = renderToStaticMarkup(
      <SpacePlanView
        plan={planSpace(input())}
        progress={{
          "leftover:1": { state: "done" },
          "move:B": { state: "running", bytesDone: 10 * GB, bytesTotal: 30 * GB },
          "move:A": { state: "failed", detail: "both_copies" },
          "uninstall:C": { state: "waiting" },
        }}
        locked
        lang="en"
        onToggle={() => {}}
      />,
    );
    expect(html).toContain("Done");
    expect(html).toContain("10.0 GiB of 30.0 GiB");
    expect(html).toContain("both copies are there now");
    expect(html).toContain("Waiting");
  });
});
