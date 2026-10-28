import { describe, expect, it } from "vitest";

import { dumpPath, jobEta, jobFraction, jobRunning, type DumperJob } from "./dumper";

const job = (over: Partial<DumperJob> = {}): DumperJob => ({
  state: "dumping",
  appDir: "PPSA01650-app0",
  title: "YouTube",
  titleId: "PPSA01650",
  dest: "/mnt/usb0/homebrew/ps5-app-dumper/dumps",
  stage: "Copying",
  currentFile: "",
  message: "",
  totalBytes: 100,
  copiedBytes: 25,
  started: 1000,
  copyStarted: 1000,
  finished: 0,
  now: 1010,
  ...over,
});

describe("ps5-app-dumper helpers", () => {
  it("puts a dump where the dumper reported it (as measured on the Fat, 2.10)", () => {
    expect(
      dumpPath({ mount: "/mnt/usb0", dir: "homebrew/ps5-app-dumper/dumps", folder: "PPSA01650-app0_YouTube" }),
    ).toBe("/mnt/usb0/homebrew/ps5-app-dumper/dumps/PPSA01650-app0_YouTube");
    expect(dumpPath({ mount: "/data", dir: "", folder: "X" })).toBe("/data/X");
  });

  it("reads progress and time left from the job", () => {
    expect(jobFraction(job())).toBe(0.25);
    expect(jobFraction(job({ totalBytes: 0 }))).toBeNull();
    // 25 bytes in 10 s: 75 left at 2.5/s
    expect(jobEta(job())).toBe(30);
    expect(jobEta(job({ copyStarted: 0 }))).toBeNull();
  });

  it("calls a job running until it ends", () => {
    expect(jobRunning(job())).toBe(true);
    expect(jobRunning(job({ state: "preparing" }))).toBe(true);
    for (const s of ["idle", "done", "failed", "aborted"]) expect(jobRunning(job({ state: s }))).toBe(false);
  });
});
