import { X } from "lucide-react";

import { formatCollectionBytes } from "../../lib/collectionView";
import {
  cancelCopyChecks,
  checkPercent,
  useCopyCheck,
} from "../../state/copyChecks";
import { useTr } from "../../state/lang";

/** A copy's check, under its row: progress while it runs, then what was found. */
export function CopyCheckLine({ path }: { path: string }) {
  const tr = useTr();
  const c = useCopyCheck(path);
  if (!c) return null;
  const how =
    c.method === "package"
      ? tr(
          "copycheck.how_package",
          undefined,
          "verified against its own digests",
        )
      : c.method === "archive"
        ? tr(
            "copycheck.how_archive",
            undefined,
            "every file's checksum checked",
          )
        : c.method === "files"
          ? tr("copycheck.how_files", undefined, "every file read back")
          : tr(
              "copycheck.how_bytes",
              undefined,
              "read start to end (finds a copy cut short or unreadable, not one with wrong bytes)",
            );
  if (c.state === "queued" || c.state === "running") {
    const pct = checkPercent(c);
    return (
      <div
        className="mt-1 flex items-center gap-2 text-[0.6875rem] text-[var(--color-muted)]"
        data-testid="copy-check"
      >
        <span>
          {c.state === "queued"
            ? tr("copycheck.queued", undefined, "Waiting to be checked")
            : pct === null
              ? tr("copycheck.running", undefined, "Checking…")
              : tr(
                  "copycheck.running_pct",
                  {
                    pct,
                    done: formatCollectionBytes(c.bytes_done),
                    total: formatCollectionBytes(c.bytes_total),
                  },
                  "Checking {pct}% ({done} of {total})",
                )}
        </span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 hover:bg-[var(--color-surface-raised)]"
          onClick={() => void cancelCopyChecks(path)}
        >
          <X size={11} aria-hidden />
          {tr("cancel", undefined, "Cancel")}
        </button>
      </div>
    );
  }
  if (c.state === "ok") {
    return (
      <div
        className="mt-1 text-[0.6875rem] text-[var(--color-good)]"
        data-testid="copy-check"
      >
        {tr("copycheck.ok", { how }, "Checked, no problems: {how}.")}
      </div>
    );
  }
  if (c.state === "cancelled") {
    return (
      <div
        className="mt-1 text-[0.6875rem] text-[var(--color-muted)]"
        data-testid="copy-check"
      >
        {tr("copycheck.cancelled", undefined, "Check stopped.")}
      </div>
    );
  }
  if (c.state === "failed") {
    return (
      <div
        className="mt-1 text-[0.6875rem] text-[var(--color-warn)]"
        data-testid="copy-check"
      >
        {tr(
          "copycheck.failed",
          { why: c.error ?? "" },
          "Could not be checked: {why}",
        )}
      </div>
    );
  }
  return (
    <div
      className="mt-1 text-[0.6875rem] text-[var(--color-bad)]"
      data-testid="copy-check"
    >
      <div className="font-medium">
        {tr(
          "copycheck.problems",
          { n: c.problems_total, how },
          "{n} problem(s) found ({how}). This copy may not install or play; replace it from a good source.",
        )}
      </div>
      <ul className="mt-0.5 list-disc ps-4 font-mono">
        {c.problems.slice(0, 5).map((p, i) => (
          <li key={i} className="break-all">
            {p.file ? `${p.file}: ` : ""}
            {p.error}
          </li>
        ))}
        {c.problems_total > 5 && (
          <li>
            {tr("copycheck.more", { n: c.problems_total - 5 }, "and {n} more")}
          </li>
        )}
      </ul>
    </div>
  );
}
