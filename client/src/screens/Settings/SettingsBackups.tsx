// The settings backups the app keeps by itself (8.0.1, lib/settingsBackup): the engine's copies
// and, per device, the copy on the connected console. Restoring asks first, keeps a copy of the
// settings it replaces, and offers a reload.

import { useCallback, useEffect, useState } from "react";
import { History, HardDrive, Monitor, RotateCcw, Save } from "lucide-react";

import { Button } from "../../components";
import { useConfirm } from "../../components/ConfirmDialog";
import { formatBytes } from "../../lib/format";
import {
  applyBundle,
  backupBeforeChange,
  buildBundle,
  getConsoleBackup,
  getEngineBackup,
  listEngineBackups,
  saveConsoleBackup,
  saveEngineBackup,
  type BackupEntry,
  type Bundle,
} from "../../lib/settingsBackup";
import { useConnectionStore } from "../../state/connection";
import { useTr, type Translator } from "../../state/lang";
import { deviceName, meshFor, useMeshStore } from "../../state/mesh";
import { useToastStore } from "../../state/toasts";

interface ConsoleCopy {
  deviceId: string;
  name: string;
  me: boolean;
  bundle: Bundle;
}

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

export function SettingsBackups() {
  const tr = useTr();
  const { confirm, dialog } = useConfirm();
  const host = useConnectionStore((s) => s.host);
  const up = useConnectionStore((s) => s.payloadStatus === "up");
  const me = useMeshStore((s) => s.me);
  const mesh = useMeshStore((s) => meshFor(s, host));
  const [local, setLocal] = useState<BackupEntry[] | null>(null);
  const [onConsole, setOnConsole] = useState<ConsoleCopy[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const consoleOk = !!host && up && mesh.supported === true;
  // Who to look for: every device the console knows (a wiped device is a new one, and restores
  // from its old self's copy).
  const deviceKey = (mesh.state?.devices ?? []).map((d) => d.id).join(",");

  const load = useCallback(async () => {
    setError(null);
    try {
      setLocal(await listEngineBackups());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    if (!consoleOk) {
      setOnConsole(null);
      return;
    }
    const devices = useMeshStore.getState();
    const known = meshFor(devices, host).state?.devices ?? [];
    const copies = await Promise.all(
      known.map(async (d) => {
        const b = await getConsoleBackup(host, d.id).catch(() => null);
        return b ? { deviceId: d.id, name: deviceName(d), me: d.id === devices.me?.id, bundle: b } : null;
      }),
    );
    setOnConsole(
      copies
        .filter((c): c is ConsoleCopy => !!c)
        .sort((a, b) => Number(b.me) - Number(a.me) || b.bundle.meta.generated_at_ms - a.bundle.meta.generated_at_ms),
    );
    // deviceKey: look again when the console's device list changes.
  }, [consoleOk, host, deviceKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void load();
  }, [load]);

  const backUpNow = async () => {
    setBusy(true);
    setError(null);
    try {
      const b = buildBundle("manual", me?.name ?? "");
      await saveEngineBackup(b);
      if (consoleOk && me?.id) await saveConsoleBackup(host, me.id, b);
      useToastStore.getState().push({ tone: "success", message: tr("backup_saved", undefined, "Settings backed up") });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      void load();
    }
  };

  const restore = async (get: () => Promise<Bundle>, label: string) => {
    const ok = await confirm({
      title: tr("backup_restore_title", undefined, "Restore these settings?"),
      message: tr(
        "backup_restore_body",
        { label },
        `The settings from ${label} replace this app's. A copy of the current ones is kept first, so this can be undone from the same list.`,
      ),
      confirmLabel: tr("backup_restore", undefined, "Restore"),
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const bundle = await get();
      await backupBeforeChange("before-restore", me?.name ?? "");
      const n = applyBundle(bundle);
      useToastStore.getState().push({
        tone: "success",
        duration: 15_000,
        message: tr("settings_backup_restored", { count: n }, `Restored ${n} setting(s). Restart the app for all changes to take effect.`),
        action: { label: tr("mesh_reload", undefined, "Reload"), onClick: () => window.location.reload() },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      void load();
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
              <span className="min-w-0 flex-1 truncate text-xs">
                {when(b.at)} · {reasonText(tr, b.reason)}
                <span className="text-[var(--color-muted)]">
                  {" · "}
                  {tr("backup_keys", { count: b.keys }, `${b.keys} settings`)} · {formatBytes(b.bytes)}
                  {b.device ? ` · ${b.device}` : ""}
                </span>
              </span>
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
              <li key={c.deviceId} className="flex items-center gap-2 px-3 py-1.5">
                <History size={12} className="shrink-0 text-[var(--color-muted)]" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-xs">
                  {c.name}
                  {c.me && <span className="text-[var(--color-accent-bright)]"> · {tr("drive_you", undefined, "you")}</span>}
                  <span className="text-[var(--color-muted)]">
                    {" · "}
                    {when(c.bundle.meta.generated_at_ms)} ·{" "}
                    {tr(
                      "backup_keys",
                      { count: Object.keys(c.bundle.local_storage).length },
                      `${Object.keys(c.bundle.local_storage).length} settings`,
                    )}
                    {c.bundle.meta.dropped?.length
                      ? ` · ${tr("backup_trimmed", { count: c.bundle.meta.dropped.length }, `${c.bundle.meta.dropped.length} large items left out`)}`
                      : ""}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  leftIcon={<RotateCcw size={12} />}
                  onClick={() => void restore(() => Promise.resolve(c.bundle), `${c.name}, ${when(c.bundle.meta.generated_at_ms)}`)}
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
