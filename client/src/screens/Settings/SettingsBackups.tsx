// The settings backups the app keeps by itself (8.0.1, lib/settingsBackup): the engine's copies
// and every app's copy on the connected console. Restoring asks first, keeps a copy of the
// settings it replaces (or says it could not), then reloads: the running stores would otherwise
// write their in-memory state back over what was restored.

import { useCallback, useEffect, useRef, useState } from "react";
import { History, HardDrive, Monitor, RotateCcw, Save } from "lucide-react";

import { Button } from "../../components";
import { useConfirm } from "../../components/ConfirmDialog";
import { formatBytes } from "../../lib/format";
import { syncId } from "../../lib/meshShare";
import {
  applyBundle,
  backupBeforeChange,
  buildBundle,
  getEngineBackup,
  listConsoleBackups,
  listEngineBackups,
  saveConsoleBackup,
  saveEngineBackup,
  type BackupEntry,
  type Bundle,
  type ConsoleBackup,
} from "../../lib/settingsBackup";
import { backupLabel } from "../../layout/useMeshSync";
import { useConnectionStore } from "../../state/connection";
import { useTr, type Translator } from "../../state/lang";
import { meshFor, useMeshStore } from "../../state/mesh";
import { useToastStore } from "../../state/toasts";

function reasonText(tr: Translator, r: string): string {
  switch (r) {
    case "daily":
      return tr("backup_reason_daily", undefined, "Daily");
    case "before-sync":
      return tr("backup_reason_before_sync", undefined, "Before a sync from your other devices");
    case "before-restore":
      return tr("backup_reason_before_restore", undefined, "Before a restore");
    default:
      return tr("backup_reason_manual", undefined, "Made by you");
  }
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function SettingsBackups() {
  const tr = useTr();
  const { confirm, dialog } = useConfirm();
  const host = useConnectionStore((s) => s.host);
  const up = useConnectionStore((s) => s.payloadStatus === "up");
  const engineName = useMeshStore((s) => s.me?.name);
  const supported = useMeshStore((s) => meshFor(s, host).supported === true);
  const [local, setLocal] = useState<BackupEntry[] | null>(null);
  const [onConsole, setOnConsole] = useState<ConsoleBackup[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const consoleOk = !!host && up && supported;
  const me = syncId();
  const label = backupLabel(engineName);
  const seq = useRef(0);

  // Only reads: an error from an action stays on screen until the next action.
  const load = useCallback(async () => {
    const mine = ++seq.current;
    const [l, c] = await Promise.all([
      listEngineBackups().catch((e: unknown) => {
        if (mine === seq.current) setError(errText(e));
        return null;
      }),
      consoleOk ? listConsoleBackups(host).catch(() => null) : Promise.resolve(null),
    ]);
    if (mine !== seq.current) return;
    setLocal(l);
    setOnConsole(c);
  }, [consoleOk, host]);

  useEffect(() => {
    void load();
  }, [load]);

  const backUpNow = async () => {
    setBusy(true);
    setError(null);
    try {
      const b = buildBundle("manual", label);
      await saveEngineBackup(b);
      if (consoleOk) await saveConsoleBackup(host, me, label, b);
      useToastStore.getState().push({ tone: "success", message: tr("backup_saved", undefined, "Settings backed up") });
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
    await load();
  };

  const restore = async (get: () => Promise<Bundle>, what: string) => {
    const ok = await confirm({
      title: tr("backup_restore_title", undefined, "Restore these settings?"),
      message: tr(
        "backup_restore_body",
        { label: what },
        `The settings from ${what} replace this app's. A copy of the current ones is kept first, so this can be undone from the same list.`,
      ),
      confirmLabel: tr("backup_restore", undefined, "Restore"),
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const bundle = await get();
      try {
        await backupBeforeChange("before-restore", label);
      } catch (e) {
        const go = await confirm({
          title: tr("backup_no_copy_title", undefined, "No copy of the current settings could be kept"),
          message: tr(
            "backup_no_copy_body",
            { reason: errText(e) },
            `${errText(e)}. Restore anyway? The current settings cannot be brought back afterwards.`,
          ),
          confirmLabel: tr("backup_restore_anyway", undefined, "Restore anyway"),
          destructive: true,
        });
        if (!go) return;
      }
      applyBundle(bundle);
      // Reload at once: the stores in memory would write their state back over the restore.
      window.location.reload();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const when = (ms: number) => new Date(ms).toLocaleString();

  return (
    <div className="space-y-3 text-sm">
      {dialog}
      <p className="text-xs text-[var(--color-muted)]">
        {tr(
          "backup_auto_hint",
          undefined,
          "The app backs up its settings once a day, and before a sync from your other devices or a restore changes them. The engine keeps the last 14; each console you use keeps this device's latest, so a wiped device can get its set-up back from there.",
        )}
      </p>
      <Button size="sm" variant="secondary" loading={busy} leftIcon={<Save size={12} />} onClick={() => void backUpNow()}>
        {tr("backup_now", undefined, "Back up now")}
      </Button>

      <section className="space-y-1">
        <p className="flex items-center gap-1.5 text-xs font-medium">
          <Monitor size={12} aria-hidden />
          {tr("backup_on_engine", undefined, "Kept by this app")}
        </p>
        {local?.length === 0 && (
          <p className="text-xs text-[var(--color-muted)]">{tr("backup_none", undefined, "None yet.")}</p>
        )}
        <ul className="divide-y divide-[var(--color-border)] rounded-[var(--radius-input,0.5rem)] border border-[var(--color-border)] empty:hidden">
          {(local ?? []).map((b) => (
            <li key={b.id} className="flex items-center gap-2 px-3 py-1.5">
              <History size={12} className="shrink-0 text-[var(--color-muted)]" aria-hidden />
              <div className="min-w-0 flex-1 text-xs">
                <p className="truncate">
                  {when(b.at)} · {reasonText(tr, b.reason)}
                </p>
                <p className="truncate text-[var(--color-muted)]">
                  {tr("backup_keys", { count: b.keys }, `Settings: ${b.keys}`)} · {formatBytes(b.bytes)}
                  {b.device ? ` · ${b.device}` : ""}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                leftIcon={<RotateCcw size={12} />}
                onClick={() => void restore(() => getEngineBackup(b.id), when(b.at))}
              >
                {tr("backup_restore", undefined, "Restore")}
              </Button>
            </li>
          ))}
        </ul>
      </section>

      {consoleOk && (
        <section className="space-y-1">
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <HardDrive size={12} aria-hidden />
            {tr("backup_on_console", undefined, "Kept by this console")}
          </p>
          {onConsole?.length === 0 && (
            <p className="text-xs text-[var(--color-muted)]">{tr("backup_none", undefined, "None yet.")}</p>
          )}
          <ul className="divide-y divide-[var(--color-border)] rounded-[var(--radius-input,0.5rem)] border border-[var(--color-border)] empty:hidden">
            {(onConsole ?? []).map((c) => (
              <li key={c.slot} className="flex items-center gap-2 px-3 py-1.5">
                <History size={12} className="shrink-0 text-[var(--color-muted)]" aria-hidden />
                <div className="min-w-0 flex-1 text-xs">
                  <p className="truncate">
                    {c.name || tr("mesh_another_device", undefined, "Another device")}
                    {c.app === me && (
                      <span className="text-[var(--color-accent-bright)]"> · {tr("drive_you", undefined, "you")}</span>
                    )}
                  </p>
                  <p className="truncate text-[var(--color-muted)]">
                    {when(c.at)} · {tr("backup_keys", { count: c.keys }, `Settings: ${c.keys}`)}
                    {c.bundle.meta?.dropped?.length
                      ? ` · ${tr("backup_trimmed", { count: c.bundle.meta.dropped.length }, `Large items left out: ${c.bundle.meta.dropped.length}`)}`
                      : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  leftIcon={<RotateCcw size={12} />}
                  onClick={() => void restore(() => Promise.resolve(c.bundle), `${c.name}, ${when(c.at)}`)}
                >
                  {tr("backup_restore", undefined, "Restore")}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {error && <p className="text-xs text-[var(--color-bad)]">{error}</p>}
    </div>
  );
}
