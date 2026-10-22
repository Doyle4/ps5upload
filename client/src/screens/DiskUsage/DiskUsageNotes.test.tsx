import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../state/lang", () => ({
  useTr:
    () =>
    (key: string, vars?: Record<string, string | number>, fallback?: string) => {
      let s = fallback ?? key;
      for (const [k, v] of Object.entries(vars ?? {})) s = s.replace(`{${k}}`, String(v));
      return s;
    },
}));

import { DiskUsageNotes } from "./index";
import type { DuDir } from "./duTree";

const dir = (over: Partial<DuDir> = {}): DuDir => ({
  name: "data",
  bytes: 10,
  files: 12,
  dirs: 3,
  skipped: 0,
  children: [],
  top_files: [],
  more_files: 0,
  more_bytes: 0,
  ...over,
});

describe("what Disk usage says about a walk", () => {
  it("counts what it read and says nothing more when it read everything", () => {
    const html = renderToStaticMarkup(<DiskUsageNotes dir={dir()} />);
    expect(html).toContain("12 files in 3 folders");
    expect(html).not.toContain("not counted");
    expect(html).not.toContain("lower than the real ones");
    // The old "subfolders are not counted" caveat is gone for good.
    expect(html).not.toContain("recursively");
  });

  it("owns up to folders it skipped and to a walk cut short", () => {
    const html = renderToStaticMarkup(
      <DiskUsageNotes dir={dir({ skipped: 2 })} partial="time_limit" />,
    );
    expect(html).toContain("2 folders were not counted");
    expect(html).toContain("lower than the real ones");
  });
});
