// Work waiting in a queue that has not started: the console queue's pending uploads and
// installs, and the Convert queue's pending builds. Neither is a task until it starts (the
// queue runners register the task then), so the activity bar reads the queues for the
// "Waiting" list. Pure over the queue items; the bar subscribes to the two stores.

import { hostOf } from "../lib/addr";
import type { QueuedRow } from "./activitySummary";
import type { TaskKind } from "./tasks";

/** The fields of a console queue item this reads (state/uploadQueue QueueItem). */
export interface QueueItemLike {
  id: string;
  status: string;
  sourceKind: string;
  displayName: string;
  addr: string;
  estimatedBytes?: number | null;
  totalBytes?: number;
}

/** The fields of a Convert queue item this reads (state/convertQueue ConvertItem). */
export interface ConvertItemLike {
  id: string;
  status: string;
  source: string;
  host: string | null;
  build?: { kind: string; compress?: boolean };
}

function queueKind(sourceKind: string): TaskKind {
  if (sourceKind === "install") return "pkg-install";
  if (sourceKind === "archive") return "upload-archive";
  if (sourceKind === "folder" || sourceKind === "game-folder") return "upload-dir";
  return "upload-file";
}

function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).pop() || trimmed;
}

export function queuedWork(
  queueItems: readonly QueueItemLike[],
  convertItems: readonly ConvertItemLike[],
): QueuedRow[] {
  const rows: QueuedRow[] = [];
  for (const it of queueItems) {
    if (it.status !== "pending") continue;
    const size = it.estimatedBytes || it.totalBytes || 0;
    rows.push({
      id: it.id,
      owner: "upload-queue",
      kind: queueKind(it.sourceKind),
      label: it.displayName,
      consoleId: hostOf(it.addr),
      route: "/send",
      sizeBytes: size > 0 ? size : null,
    });
  }
  for (const it of convertItems) {
    if (it.status !== "pending") continue;
    rows.push({
      id: it.id,
      owner: "convert-queue",
      kind: it.build?.kind === "image" && it.build.compress ? "ffpfsc-compress" : "fpkg-convert",
      label: baseName(it.source),
      consoleId: hostOf(it.host ?? ""),
      route: "/workshop",
      sizeBytes: null,
    });
  }
  return rows;
}

/**
 * Whether a "Waiting" row is still waiting now. The panel's row was drawn from an earlier
 * render: the item may have started since, and removing a started upload would stop a running
 * job without the confirmation the Cancel path asks for. Read the queues at click time.
 */
export function stillWaiting(
  row: Pick<QueuedRow, "id" | "owner">,
  queueItems: readonly Pick<QueueItemLike, "id" | "status">[],
  convertItems: readonly Pick<ConvertItemLike, "id" | "status">[],
): boolean {
  const items = row.owner === "upload-queue" ? queueItems : convertItems;
  return items.some((it) => it.id === row.id && it.status === "pending");
}
