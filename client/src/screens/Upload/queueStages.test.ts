import { describe, expect, it } from "vitest";

import { queueStages } from "./queueStages";

const base = {
  sourceKind: "file" as const,
  status: "pending" as const,
  installAfterUpload: false,
  installPhase: null,
  mountAfterUpload: false,
  registerAfterUpload: false,
  mountedAt: null,
  registeredAs: null,
};
const states = (s: ReturnType<typeof queueStages>) =>
  s.map((x) => `${x.key}:${x.state}`).join(" ");

describe("a queue row's steps", () => {
  it("is one step for a plain upload", () => {
    expect(states(queueStages(base))).toBe("upload:waiting");
  });

  it("walks an upload then install", () => {
    const pkg = { ...base, installAfterUpload: true };
    expect(states(queueStages({ ...pkg, status: "running" }))).toBe(
      "upload:active install:waiting",
    );
    expect(
      states(
        queueStages({
          ...pkg,
          status: "running",
          installPhase: "installing",
        }),
      ),
    ).toBe("upload:done install:active");
    expect(
      states(
        queueStages({
          ...pkg,
          status: "done",
          installPhase: "done",
        }),
      ),
    ).toBe("upload:done install:done");
    expect(
      states(
        queueStages({
          ...pkg,
          status: "done",
          installPhase: "unverified",
        }),
      ),
    ).toBe("upload:done install:warn");
  });

  it("puts a failure on the step that failed", () => {
    const pkg = { ...base, installAfterUpload: true };
    expect(states(queueStages({ ...pkg, status: "failed" }))).toBe(
      "upload:failed install:waiting",
    );
    expect(
      states(
        queueStages({
          ...pkg,
          status: "failed",
          installPhase: "error",
        }),
      ),
    ).toBe("upload:done install:failed");
  });

  it("is install only for a link or a package already on the console", () => {
    const inst = {
      ...base,
      sourceKind: "install" as const,
      installPhase: "installing" as const,
      status: "running" as const,
    };
    expect(states(queueStages(inst))).toBe("install:active");
  });

  it("marks a mount or register that did not take", () => {
    const img = {
      ...base,
      mountAfterUpload: true,
      registerAfterUpload: true,
      status: "done" as const,
    };
    expect(
      states(
        queueStages({
          ...img,
          mountedAt: "/mnt/ext0/x",
          registeredAs: "PPSA01325",
        }),
      ),
    ).toBe("upload:done mount:done register:done");
    expect(states(queueStages({ ...img, mountedAt: "/mnt/ext0/x" }))).toBe(
      "upload:done mount:done register:warn",
    );
  });
});
