import type { QueueItem } from "../../state/uploadQueue";

/**
 * A queue item's steps, in order, and where it is in them: one rail per row (Upload › Install,
 * or Upload › Mount › Register) instead of a separate card per step. A plain upload has one
 * step and shows no rail.
 */
export type StageKey = "upload" | "install" | "mount" | "register";
export type StageState = "waiting" | "active" | "done" | "warn" | "failed";

export interface Stage {
  key: StageKey;
  state: StageState;
}

type StageItem = Pick<
  QueueItem,
  | "sourceKind"
  | "status"
  | "installAfterUpload"
  | "installPhase"
  | "mountAfterUpload"
  | "registerAfterUpload"
  | "mountedAt"
  | "registeredAs"
>;

export function queueStages(item: StageItem): Stage[] {
  const keys: StageKey[] = [];
  if (item.sourceKind !== "install") keys.push("upload");
  if (item.sourceKind === "install" || item.installAfterUpload)
    keys.push("install");
  if (item.mountAfterUpload) keys.push("mount");
  if (item.registerAfterUpload) keys.push("register");

  // The step under way, or the one that failed: the install once it has started, else the
  // first step.
  const installStarted =
    item.installPhase === "installing" || item.installPhase === "error";
  const current: StageKey =
    keys.includes("install") && installStarted
      ? "install"
      : (keys[0] ?? "upload");
  const at = keys.indexOf(current);

  return keys.map((key, i): Stage => {
    switch (item.status) {
      case "pending":
        return { key, state: "waiting" };
      case "running":
        return {
          key,
          state: i < at ? "done" : i === at ? "active" : "waiting",
        };
      case "failed":
        return {
          key,
          state: i < at ? "done" : i === at ? "failed" : "waiting",
        };
      default: {
        // Done: say which follow-up step did not take, rather than a plain tick.
        if (
          key === "install" &&
          (item.installPhase === "warn" || item.installPhase === "unverified")
        )
          return { key, state: "warn" };
        if (key === "mount" && !item.mountedAt) return { key, state: "warn" };
        if (key === "register" && !item.registeredAs)
          return { key, state: "warn" };
        return { key, state: "done" };
      }
    }
  });
}
