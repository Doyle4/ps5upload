import {
  AlertTriangle,
  CheckCircle2,
  MinusCircle,
  Stethoscope,
  XCircle,
} from "lucide-react";

import { Button, Card, Spinner } from "../../components";
import type { Finding, Severity } from "../../lib/netDoctor";
import { WORDING, type Text } from "./netDoctorWording";
import { useTr } from "../../state/lang";
import {
  netDoctorFor,
  netDoctorRunning,
  useNetDoctorStore,
} from "../../state/netDoctor";
import { startNetDoctor } from "../../state/netDoctorRuntime";

const SEVERITY_UI: Record<Severity, { icon: typeof CheckCircle2; cls: string; ring: string }> = {
  problem: {
    icon: XCircle,
    cls: "text-[var(--color-bad)]",
    ring: "border-[var(--color-bad)]/50",
  },
  warn: {
    icon: AlertTriangle,
    cls: "text-[var(--color-warn)]",
    ring: "border-[var(--color-warn)]/40",
  },
  // Muted, as on the health check: "could not measure this here" is not a problem.
  skip: {
    icon: MinusCircle,
    cls: "text-[var(--color-muted)]",
    ring: "border-[var(--color-border)]",
  },
  ok: {
    icon: CheckCircle2,
    cls: "text-[var(--color-good)]",
    ring: "border-[var(--color-border)]",
  },
};

/** "Diagnose slow transfers": one button, then the findings, most important first. The run
 *  lives in a store (state/netDoctor), so it carries on when the screen is left. */
export function NetworkDoctorCard({ host }: { host: string }) {
  const tr = useTr();
  const run = useNetDoctorStore((s) => netDoctorFor(s, host));
  const running = netDoctorRunning(run);
  const findings = run?.findings ?? null;
  const toFix = findings?.filter((f) => f.severity === "problem" || f.severity === "warn") ?? [];

  return (
    <div className="mb-5" data-testid="net-doctor-card" id="network-doctor">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-[1_1_18rem] items-center gap-3">
            <Stethoscope
              size={18}
              aria-hidden
              className="shrink-0 text-[var(--color-muted)]"
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">
                {tr("netdoctor.title", undefined, "Diagnose slow transfers")}
              </div>
              <div className="text-xs text-[var(--color-muted)]">
                {tr(
                  "netdoctor.help",
                  undefined,
                  "Checks the connection between this computer and the PS5 and lists what slows transfers down, most important first. It runs a speed test too, unless one ran in the last few minutes.",
                )}
              </div>
            </div>
          </div>
          <Button
            variant="primary"
            size="sm"
            disabled={running}
            onClick={() => void startNetDoctor(host)}
            data-testid="net-doctor-run"
          >
            {run
              ? tr("netdoctor.again", undefined, "Check again")
              : tr("netdoctor.run", undefined, "Diagnose")}
          </Button>
        </div>

        {running && (
          <div
            className="mt-3 flex items-center gap-2 text-xs text-[var(--color-muted)]"
            role="status"
          >
            <Spinner size={12} />
            {run?.phase === "testing"
              ? tr(
                  "netdoctor.testing",
                  undefined,
                  "Running a speed test and timing replies while it sends…",
                )
              : tr("netdoctor.reading", undefined, "Reading both connections…")}
          </div>
        )}

        {run?.phase === "failed" && (
          <p role="alert" className="mt-2 text-xs text-[var(--color-bad)]">
            {tr(
              "netdoctor.failed",
              { error: run.error ?? "" },
              "The checks could not finish: {error}",
            )}
          </p>
        )}

        {findings && (
          <div className="mt-3 flex flex-col gap-2" data-testid="net-doctor-findings">
            {toFix.length === 0 && (
              <p className="text-xs text-[var(--color-good)]">
                {tr(
                  "netdoctor.all_clear",
                  undefined,
                  "Nothing found that slows transfers down.",
                )}
              </p>
            )}
            {findings.map((f) => (
              <FindingRow key={f.id} finding={f} tr={tr} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function FindingRow({
  finding,
  tr,
}: {
  finding: Finding;
  tr: ReturnType<typeof useTr>;
}) {
  const w = WORDING[`${finding.id}.${finding.variant}`];
  if (!w) return null;
  const ui = SEVERITY_UI[finding.severity];
  const Icon = ui.icon;
  const say = ([key, en]: Text) => tr(key, finding.vars, en);
  // Each wording with a known ceiling names it in its own detail line.
  return (
    <div
      className={`flex items-start gap-3 rounded-[var(--radius-field)] border ${ui.ring} bg-[var(--color-surface-2)] p-3`}
      data-testid={`net-doctor-${finding.id}`}
      data-severity={finding.severity}
    >
      <Icon size={16} aria-hidden className={`mt-0.5 shrink-0 ${ui.cls}`} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{say(w.title)}</div>
        <div className="mt-0.5 text-xs text-[var(--color-muted)]">{say(w.detail)}</div>
        {w.fix && finding.severity !== "ok" && finding.severity !== "skip" && (
          <div className="mt-1.5 text-xs text-[var(--color-text)]">{say(w.fix)}</div>
        )}
      </div>
    </div>
  );
}
