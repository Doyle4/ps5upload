import { MonitorPlay, Square } from "lucide-react";
import { useLocation, useNavigate } from "react-router";

import { Button, Spinner } from "../components";
import { useTr } from "../state/lang";
import { useRemotePlayStore } from "../state/remotePlay";

/** A stream keeps running on other screens: this bar says so, with the way back and Stop. */
export default function RemotePlayBanner() {
  const tr = useTr();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const stream = useRemotePlayStore((s) => s.stream);
  const phase = useRemotePlayStore((s) => s.phase);
  const target = useRemotePlayStore((s) => s.target);
  const stop = useRemotePlayStore((s) => s.stop);
  if (!stream || !phase || phase === "ended" || pathname === "/play") return null;
  const name = target?.name ?? "";
  return (
    <div
      className="mx-3 mt-3 rounded-[var(--radius-card)] border border-[color-mix(in_srgb,var(--color-accent)_35%,transparent)] bg-[var(--color-accent-soft,var(--color-surface-raised))] px-4 py-2 md:mx-5"
      data-testid="rp-banner"
    >
      <div className="flex flex-wrap items-center gap-3">
        {phase === "playing" ? (
          <MonitorPlay size={18} className="shrink-0 text-[var(--color-accent)]" />
        ) : (
          <Spinner size={14} />
        )}
        <p className="min-w-0 flex-1 text-sm font-medium">
          {phase === "moved"
            ? tr("rp_banner_moved", { name }, `Remote Play on ${name} is showing in another window`)
            : tr("rp_banner_playing", { name }, `Remote Play is on: ${name}`)}
        </p>
        <Button size="sm" variant="primary" onClick={() => navigate("/play")}>
          {tr("rp_banner_return", undefined, "Return to it")}
        </Button>
        <Button size="sm" variant="ghost" leftIcon={<Square size={12} />} onClick={stop}>
          {tr("rp_stop", undefined, "Stop")}
        </Button>
      </div>
    </div>
  );
}
