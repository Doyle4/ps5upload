import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Stethoscope, X } from "lucide-react";

import { rate, slowNow, slowTransferHint } from "../../lib/netDoctor";
import type { BottleneckCause } from "../../lib/jobLive";
import { safeGetItem, safeSetItem } from "../../lib/safeStorage";
import { useTr } from "../../state/lang";
import { speedTestFor, useSpeedTestStore } from "../../state/speedTest";
import { useUploadSettingsStore } from "../../state/uploadSettings";

/** Dismissed until this time (ms), on this computer only. */
const DISMISS_KEY = "ps5upload.netdoctor.hintDismissedUntil";
const DISMISS_FOR_MS = 7 * 24 * 60 * 60_000;

function dismissedNow(): boolean {
  const until = Number(safeGetItem(DISMISS_KEY) ?? 0);
  return Number.isFinite(until) && until > Date.now();
}

/** A running upload far below what the link should do, held back by the network (the engine's
 *  own measurement), for half a minute: one quiet line offering the network doctor. Shown only
 *  with a measured reason, and dismissed for a week with one click, so it never nags. */
export function SlowTransferHint({
  host,
  bytesPerSec,
  bottleneck,
}: {
  host: string | null;
  bytesPerSec: number;
  bottleneck: BottleneckCause | null;
}) {
  const tr = useTr();
  const navigate = useNavigate();
  const tested = useSpeedTestStore((s) => {
    const st = host ? speedTestFor(s, host) : null;
    return st?.phase === "done" ? st.uploadBps : null;
  });
  const cap = useUploadSettingsStore((s) => s.bandwidthCapMbps);
  const [dismissed, setDismissed] = useState(dismissedNow);
  const [since, setSince] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const slow = slowNow({
    bytesPerSec,
    bottleneck,
    speedTestUploadBps: tested,
    bandwidthCapMbps: cap,
  });
  // The progress ticks re-render this every half second; the clock is read there.
  useEffect(() => {
    const t = Date.now();
    setNow(t);
    setSince((s) => (slow ? (s ?? t) : null));
  }, [slow, bytesPerSec]);

  if (dismissed || !host) return null;
  const hint = slowTransferHint({
    bytesPerSec,
    bottleneck,
    sustainedMs: since === null ? 0 : now - since,
    speedTestUploadBps: tested,
    bandwidthCapMbps: cap,
  });
  if (!hint) return null;

  const speed = rate(bytesPerSec);
  return (
    <div
      className="mb-2 flex flex-wrap items-center gap-2 rounded-[var(--radius-field)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs"
      data-testid="slow-transfer-hint"
      role="status"
    >
      <Stethoscope size={12} aria-hidden className="shrink-0 text-[var(--color-muted)]" />
      <span className="min-w-0 flex-[1_1_14rem] text-[var(--color-muted)]">
        {hint.expectedBps
          ? tr(
              "netdoctor.hint.tested",
              { speed, expected: rate(hint.expectedBps) },
              "This upload runs at {speed}, well below the {expected} the speed test measured, and the network is what holds it back.",
            )
          : tr(
              "netdoctor.hint.untested",
              { speed },
              "This upload runs at {speed}, and the network is what holds it back.",
            )}
      </span>
      <button
        type="button"
        className="font-medium text-[var(--color-accent)] hover:underline"
        onClick={() => navigate("/health")}
        data-testid="slow-transfer-hint-open"
      >
        {tr("netdoctor.hint.open", undefined, "Diagnose")}
      </button>
      <button
        type="button"
        className="rounded p-0.5 text-[var(--color-muted)] hover:text-[var(--color-text)]"
        aria-label={tr("netdoctor.hint.dismiss", undefined, "Dismiss")}
        title={tr("netdoctor.hint.dismiss", undefined, "Dismiss")}
        onClick={() => {
          safeSetItem(DISMISS_KEY, String(Date.now() + DISMISS_FOR_MS));
          setDismissed(true);
        }}
      >
        <X size={12} aria-hidden />
      </button>
    </div>
  );
}
