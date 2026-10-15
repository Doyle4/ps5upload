import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Play, RefreshCw, Trash2 } from "lucide-react";

import { Badge, Button, Callout, ErrorCard, Spinner, Toggle } from "../../components";
import { useConfirm } from "../../components/ConfirmDialog";
import {
  autoloadKey,
  pmDelete,
  pmLaunch,
  pmOverview,
  pmSetAutoload,
  type PmOverview,
  type PmStoredPayload,
} from "../../api/payloadManager";
import { useConnectionStore } from "../../state/connection";
import { useTr } from "../../state/lang";
import { pushNotification } from "../../state/notifications";
import { withConsolePrefix } from "../../state/roster";

/** Move `name` within an autoload list, keeping pauses (`!ms`) where they are. */
export function moveEntry(list: string[], name: string, dir: -1 | 1): string[] {
  const i = list.indexOf(name);
  if (i < 0) return list;
  const names = list.map((e, idx) => ({ e, idx })).filter((x) => !x.e.startsWith("!"));
  const pos = names.findIndex((x) => x.idx === i);
  const swapWith = names[pos + dir];
  if (!swapWith) return list;
  const out = [...list];
  out[i] = swapWith.e;
  out[swapWith.idx] = name;
  return out;
}

/** The payloads stored in the console's Payload Manager (:8084): launch, delete, and the
 *  boot autoload list. Storing into it is on the Catalog tab's cards. */
export default function PayloadManagerPanel() {
  const tr = useTr();
  const host = useConnectionStore((s) => s.host);
  const { confirm, dialog } = useConfirm();
  const [view, setView] = useState<PmOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const h = host.trim();
    if (!h) return;
    setLoading(true);
    setError(null);
    try {
      setView(await pmOverview(h));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [host]);

  useEffect(() => {
    setView(null);
    void refresh();
  }, [refresh]);

  const run = async (key: string, work: () => Promise<void>, failTitle: string) => {
    setBusy(key);
    try {
      await work();
      await refresh();
    } catch (e) {
      pushNotification("error", withConsolePrefix(host, failTitle), {
        body: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(null);
    }
  };

  const launch = (p: PmStoredPayload) =>
    run(
      `launch:${p.path}`,
      async () => {
        await pmLaunch(host, p.path);
        pushNotification(
          "success",
          withConsolePrefix(host, tr("pm_launched", { name: p.filename }, `Launched ${p.filename}`)),
          { body: tr("pm_launched_body", undefined, "Check the PS5 for its notification.") },
        );
      },
      tr("pm_launch_failed", { name: p.filename }, `Couldn't launch ${p.filename}`),
    );

  const remove = async (p: PmStoredPayload) => {
    const ok = await confirm({
      title: tr("pm_delete_confirm_title", { name: p.filename }, `Delete ${p.filename} from Payload Manager?`),
      message: tr(
        "pm_delete_confirm_body",
        undefined,
        "The stored file and its details are removed from the console. A copy downloaded to this computer stays.",
      ),
      confirmLabel: tr("delete", undefined, "Delete"),
      destructive: true,
    });
    if (!ok) return;
    await run(
      `delete:${p.path}`,
      () => pmDelete(host, p.filename),
      tr("pm_delete_failed", { name: p.filename }, `Couldn't delete ${p.filename}`),
    );
  };

  const setAutoload = (enabled: boolean, list: string[]) =>
    run(
      "autoload",
      () => pmSetAutoload(host, enabled, list),
      tr("pm_autoload_failed", undefined, "Couldn't update the autoload list"),
    );

  if (!host.trim()) {
    return (
      <ErrorCard title={tr("payloads_no_host", undefined, "No PS5 host set. Connect on the Connection screen first.")} />
    );
  }
  if (error) {
    return (
      <ErrorCard
        title={tr("pm_error_title", undefined, "Couldn't reach Payload Manager")}
        detail={error}
        onRetry={() => void refresh()}
      />
    );
  }
  if (!view) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
        <Spinner size={14} />
        {tr("pm_probing", undefined, "Looking for Payload Manager on the PS5…")}
      </div>
    );
  }
  if (!view.present) {
    return (
      <Callout tone="info" title={tr("pm_absent_title", undefined, "Payload Manager isn't running on this PS5")}>
        {tr(
          "pm_absent_body",
          undefined,
          "Payload Manager (itsPLK) keeps payloads on the console and can load them at boot. Send it from the Catalog tab, or start it on the PS5, then come back here.",
        )}
      </Callout>
    );
  }

  const autoload = view.autoload;
  const inList = (p: PmStoredPayload) => !!autoload?.list.includes(autoloadKey(p));
  const stored = view.payloads.filter((p) => p.path.startsWith("/data/pldmgr/"));
  const onUsb = view.payloads.filter((p) => !p.path.startsWith("/data/pldmgr/"));

  const row = (p: PmStoredPayload) => {
    const listed = inList(p);
    const key = autoloadKey(p);
    const order = autoload ? autoload.list.filter((e) => !e.startsWith("!")) : [];
    const pos = order.indexOf(key);
    return (
      <li
        key={p.path}
        className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-[var(--glass-edge)] bg-[var(--color-surface-raised)] px-3.5 py-2.5 text-sm"
      >
        <div className="min-w-[min(100%,14rem)] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{p.name || p.filename}</span>
            {p.version && (
              <Badge tone="neutral" variant="outline">
                {p.version}
              </Badge>
            )}
            {listed && autoload && (
              <Badge tone="good" variant="outline">
                {tr("pm_autoload_badge", { n: pos + 1 }, `boot #${pos + 1}`)}
              </Badge>
            )}
          </div>
          <div className="mt-0.5 truncate font-mono text-xs text-[var(--color-muted)]" title={p.path}>
            {p.path}
          </div>
          {p.source && (
            <div className="text-xs text-[var(--color-muted)]">
              {tr("pm_source", { source: p.source }, `from ${p.source}`)}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {autoload && (
            <>
              <Button
                variant={listed ? "secondary" : "ghost"}
                size="sm"
                disabled={busy !== null}
                onClick={() =>
                  void setAutoload(
                    autoload.enabled,
                    listed ? autoload.list.filter((e) => e !== key) : [...autoload.list, key],
                  )
                }
                title={tr(
                  "pm_autoload_toggle_tooltip",
                  undefined,
                  "Payload Manager loads the listed payloads, in order, when the PS5 starts.",
                )}
              >
                {listed
                  ? tr("pm_autoload_remove", undefined, "Don't load at boot")
                  : tr("pm_autoload_add", undefined, "Load at boot")}
              </Button>
              {listed && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy !== null || pos <= 0}
                    onClick={() => void setAutoload(autoload.enabled, moveEntry(autoload.list, key, -1))}
                    title={tr("pm_autoload_earlier", undefined, "Load earlier")}
                  >
                    <ArrowUp size={12} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy !== null || pos >= order.length - 1}
                    onClick={() => void setAutoload(autoload.enabled, moveEntry(autoload.list, key, 1))}
                    title={tr("pm_autoload_later", undefined, "Load later")}
                  >
                    <ArrowDown size={12} />
                  </Button>
                </>
              )}
            </>
          )}
          <Button
            variant="primary"
            size="sm"
            leftIcon={busy === `launch:${p.path}` ? <Spinner size={12} tone="inherit" /> : <Play size={12} />}
            disabled={busy !== null}
            onClick={() => void launch(p)}
          >
            {tr("pm_launch", undefined, "Launch")}
          </Button>
          {p.path.startsWith("/data/pldmgr/") && (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Trash2 size={12} />}
              disabled={busy !== null}
              onClick={() => void remove(p)}
            >
              {tr("delete", undefined, "Delete")}
            </Button>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-5">
      {dialog}
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="text-[var(--color-muted)]">
          {tr("pm_detected", { version: view.version }, `Payload Manager ${view.version} on the PS5`)}
        </div>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={loading ? <Spinner size={12} tone="inherit" /> : <RefreshCw size={12} />}
          disabled={loading}
          onClick={() => void refresh()}
        >
          {tr("refresh", undefined, "Refresh")}
        </Button>
      </div>

      {autoload ? (
        <section className="surface-panel p-4">
          <Toggle
            checked={autoload.enabled}
            disabled={busy !== null}
            onChange={(on) => void setAutoload(on, autoload.list)}
            label={tr("pm_autoload_title", undefined, "Load payloads at boot")}
            hint={tr(
              "pm_autoload_hint",
              { n: autoload.list.filter((e) => !e.startsWith("!")).length, delay: autoload.delay_s },
              `Payload Manager starts the marked payloads in order ${autoload.delay_s}s after the PS5 boots. ${autoload.list.filter((e) => !e.startsWith("!")).length} listed. Pauses between them are kept as set in Payload Manager.`,
            )}
          />
        </section>
      ) : (
        view.autoloadError && (
          <ErrorCard
            title={tr("pm_autoload_read_failed", undefined, "Couldn't read the autoload list")}
            detail={view.autoloadError}
          />
        )
      )}

      {view.payloadsError && (
        <ErrorCard
          title={tr("pm_list_failed", undefined, "Couldn't list the stored payloads")}
          detail={view.payloadsError}
        />
      )}

      <section>
        <header className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          {tr("pm_stored_header", { n: stored.length }, `Stored on the PS5 · ${stored.length}`)}
        </header>
        {stored.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">
            {tr(
              "pm_stored_empty",
              undefined,
              "Nothing stored yet. On the Catalog tab, “Store in Payload Manager” keeps a payload on the console.",
            )}
          </p>
        ) : (
          <ul className="grid gap-1.5">{stored.map(row)}</ul>
        )}
      </section>

      {onUsb.length > 0 && (
        <section>
          <header className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            {tr("pm_usb_header", { n: onUsb.length }, `On USB · ${onUsb.length}`)}
          </header>
          <ul className="grid gap-1.5">{onUsb.map(row)}</ul>
        </section>
      )}
    </div>
  );
}
