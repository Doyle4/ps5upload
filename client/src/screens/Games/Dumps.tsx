import { useCallback, useEffect, useState } from "react";
import { ExternalLink, FolderOpen, HardDrive, KeyRound, Package, Play, Square, Trash2 } from "lucide-react";
import { useNavigate } from "react-router";

import {
  dumperApi,
  DumperError,
  dumpPath,
  jobEta,
  jobFraction,
  jobRunning,
  type DumperDevices,
  type DumperDumps,
  type DumperLibrary,
  type DumperOverview,
} from "../../api/dumper";
import { Badge, Button, Callout, Card, EmptyState, Input, ProgressBar, Select, Spinner } from "../../components";
import { useConfirm } from "../../components/ConfirmDialog";
import { hostOf } from "../../lib/addr";
import { consoleSource } from "../../lib/collectionActions";
import { formatBytes } from "../../lib/format";
import { openExternalUrl } from "../../lib/openExternalUrl";
import { useDocumentVisible } from "../../lib/visibility";
import { useConnectionStore } from "../../state/connection";
import { openInFileSystem } from "../../state/fsNavigation";
import { useTr } from "../../state/lang";

const POLL_MS = 2_000;

function eta(s: number | null): string {
  if (s == null) return "";
  const m = Math.floor(s / 60);
  return m > 0 ? `${m} min ${s % 60} s` : `${s} s`;
}

/**
 * Games → Dumps: dumping installed games with EchoStretch's ps5-app-dumper (GPLv3), which runs on
 * the console and copies the running game, decrypted, to a drive. The app finds it, asks for the
 * code the TV shows once, and then starts a dump of the running game, starts a game to dump it,
 * runs a queue, follows the progress and lists finished dumps, which open in Files or Workshop.
 * The dumper's own settings (decrypt, FSELF, backport) stay on its own page.
 */
export function DumpsView() {
  const tr = useTr();
  const navigate = useNavigate();
  const { confirm, dialog } = useConfirm();
  const host = useConnectionStore((s) => s.host?.trim() ?? "");
  const up = useConnectionStore((s) => s.payloadStatus === "up");
  const visible = useDocumentVisible();
  const [ov, setOv] = useState<DumperOverview | null>(null);
  const [devices, setDevices] = useState<DumperDevices | null>(null);
  const [library, setLibrary] = useState<DumperLibrary | null>(null);
  const [dumps, setDumps] = useState<DumperDumps | null>(null);
  const [target, setTarget] = useState("");
  const [queue, setQueue] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const present = ov?.present === true;
  const unlocked = present && (!ov.required || ov.unlocked);

  const poll = useCallback(async () => {
    if (!host || !up) return;
    try {
      const o = await dumperApi.overview(host);
      setOv(o);
      if (!o.present) return;
      const [d, l] = await Promise.all([
        dumperApi.read<DumperDevices>(host, "devices"),
        dumperApi.read<DumperLibrary>(host, "library"),
      ]);
      setDevices(d);
      setLibrary(l);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [host, up]);

  const loadDumps = useCallback(async () => {
    if (!host || !up) return;
    try {
      setDumps(await dumperApi.read<DumperDumps>(host, "dumps"));
    } catch {
      /* the list is a convenience; the job card says what went wrong */
    }
  }, [host, up]);

  useEffect(() => {
    setOv(null);
    setDevices(null);
    setLibrary(null);
    setDumps(null);
    setQueue([]);
  }, [host]);

  useEffect(() => {
    void poll();
    void loadDumps();
    if (!visible) return;
    const id = window.setInterval(() => void poll(), POLL_MS);
    return () => window.clearInterval(id);
  }, [poll, loadDumps, visible]);

  // A drive that can take a dump: the first USB drive, else the console's own.
  const writable = (devices?.targets ?? []).filter((t) => t.writable);
  useEffect(() => {
    if (writable.length && !writable.some((t) => t.mount === target)) {
      setTarget((writable.find((t) => !t.internal) ?? writable[0]).mount);
    }
  }, [writable, target]);

  const job = present ? ov.status?.job : undefined;
  const q = present ? ov.status?.queue : undefined;
  const working = !!job && jobRunning(job);
  const queueActive = !!q?.active;
  // When a dump ends, the finished list is read again.
  const ended = job ? `${job.state}:${job.finished}` : "";
  useEffect(() => {
    if (ended) void loadDumps();
  }, [ended, loadDumps]);

  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
      await poll();
    } catch (e) {
      if (e instanceof DumperError && e.locked) setOv((o) => (o?.present ? { ...o, unlocked: false } : o));
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const dump = (app: string, overwrite = false): Promise<void> =>
    run(async () => {
      try {
        await dumperApi.call(host, "/api/dump", { app, target, overwrite });
      } catch (e) {
        if (e instanceof DumperError && e.body.exists === true && !overwrite) {
          const ok = await confirm({
            title: tr("dumps_exists_title", undefined, "Replace the dump that is there?"),
            message: e.message,
            confirmLabel: tr("dumps_replace", undefined, "Replace"),
            destructive: true,
          });
          if (ok) await dumperApi.call(host, "/api/dump", { app, target, overwrite: true });
          return;
        }
        throw e;
      }
    });

  const launch = (titleId: string): Promise<void> =>
    run(async () => {
      try {
        await dumperApi.call(host, "/api/launch", { title: titleId });
      } catch (e) {
        if (e instanceof DumperError && e.body.needsClose === true) {
          const ok = await confirm({
            title: tr("dumps_close_running_title", undefined, "Close the game that is running?"),
            message: tr(
              "dumps_close_running_body",
              undefined,
              "A PS5 runs one game at a time. Starting this one closes the game that is running now.",
            ),
            confirmLabel: tr("dumps_close_and_start", undefined, "Close and Start"),
          });
          if (ok) await dumperApi.call(host, "/api/launch", { title: titleId, force: true });
          return;
        }
        throw e;
      }
    });

  if (!host || !up) {
    return (
      <EmptyState
        icon={HardDrive}
        title={tr("dumps_need_console", undefined, "Connect to a PS5 to dump its games")}
      />
    );
  }
  if (ov === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
        <Spinner size={14} /> {tr("dumps_looking", undefined, "Looking for ps5-app-dumper on the PS5…")}
      </div>
    );
  }
  if (!present) {
    return (
      <Card>
        <div className="flex flex-col items-start gap-3">
          <h2 className="text-base font-semibold">{tr("dumps_absent_title", undefined, "ps5-app-dumper isn't running")}</h2>
          <p className="max-w-2xl text-sm text-[var(--color-muted)]">
            {tr(
              "dumps_absent_body",
              undefined,
              "Dumping is done on the PS5 by EchoStretch's ps5-app-dumper, an open-source payload. It copies the running game, decrypted, to a USB drive or the console's own drive. Send it from Payloads, then come back here.",
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" leftIcon={<Package size={14} />} onClick={() => navigate("/payloads?tab=catalog")}>
              {tr("dumps_open_payloads", undefined, "Open Payloads")}
            </Button>
            <Button variant="ghost" onClick={() => void poll()}>
              {tr("refresh", undefined, "Refresh")}
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  const pageUrl = `http://${hostOf(host)}:${ov.port}/`;
  const running = devices?.apps ?? [];
  const titles = (library?.titles ?? []).filter((t) => !running.some((a) => a.titleId === t.titleId));
  const frac = job ? jobFraction(job) : null;

  return (
    <div className="flex flex-col gap-4">
      {dialog}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-[var(--color-muted)]">
        <span>{tr("dumps_found", { version: ov.version, port: ov.port }, "ps5-app-dumper {version}, port {port}")}</span>
        <Button variant="ghost" size="sm" leftIcon={<ExternalLink size={14} />} onClick={() => void openExternalUrl(pageUrl)}>
          {tr("dumps_open_page", undefined, "Its Settings Page")}
        </Button>
      </div>

      {error && (
        <Callout tone="error" title={tr("dumps_failed", undefined, "That didn't work")}>
          {error}
        </Callout>
      )}

      {!unlocked && (
        <Card>
          <div className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <KeyRound size={16} aria-hidden /> {tr("dumps_code_title", undefined, "Enter the code from the TV")}
            </h2>
            <p className="text-sm text-[var(--color-muted)]">
              {tr(
                "dumps_code_body",
                undefined,
                "ps5-app-dumper lets a phone or PC start, stop or delete something only after the six-digit code it shows on the TV is entered once. This app keeps what it gets for this console.",
              )}
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-40">
                <Input
                  id="dumps-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  aria-label={tr("dumps_code_title", undefined, "Enter the code from the TV")}
                />
              </div>
              <Button
                variant="primary"
                disabled={busy || code.length !== 6}
                onClick={() => void run(() => dumperApi.unlock(host, code)).then(() => setCode(""))}
              >
                {tr("dumps_unlock", undefined, "Unlock")}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => void run(() => dumperApi.showCode(host))}>
                {tr("dumps_show_code", undefined, "Show the Code on the TV")}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {(working || queueActive) && job && (
        <Card>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium">{job.title || job.titleId || tr("dumps_preparing", undefined, "Preparing…")}</div>
                <div className="truncate text-xs text-[var(--color-muted)]">
                  {job.stage}
                  {job.currentFile ? ` · ${job.currentFile}` : ""}
                </div>
              </div>
              <Button
                variant="danger"
                size="sm"
                leftIcon={<Square size={14} />}
                disabled={busy || !unlocked}
                onClick={() => void run(() => dumperApi.call(host, "/api/abort"))}
              >
                {queueActive
                  ? tr("dumps_stop_queue", undefined, "Stop the Queue")
                  : tr("dumps_stop", undefined, "Stop")}
              </Button>
            </div>
            <ProgressBar value={frac ?? undefined} />
            <div className="text-xs tabular-nums text-[var(--color-muted)]">
              {formatBytes(job.copiedBytes)} / {formatBytes(job.totalBytes)}
              {jobEta(job) != null ? ` · ${tr("dumps_eta", { t: eta(jobEta(job)) }, "about {t} left")}` : ""}
              {queueActive && q ? ` · ${tr("dumps_queue_pos", { n: q.current + 1, total: q.items.length }, "queue {n} of {total}")}` : ""}
            </div>
          </div>
        </Card>
      )}

      {job && !working && job.state !== "idle" && job.message && (
        <Callout tone={job.state === "done" ? "success" : "warn"} title={job.title || job.titleId}>
          {job.message}
        </Callout>
      )}

      <Card>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-base font-semibold">{tr("dumps_dump_title", undefined, "Dump a Game")}</h2>
            <div className="w-72 max-w-full">
              <Select
                id="dumps-target"
                label={tr("dumps_to", undefined, "To")}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                options={writable.map((t) => ({
                  value: t.mount,
                  label: `${t.internal ? tr("dumps_console_drive", undefined, "This PS5") : t.mount} · ${tr("dumps_free", { size: formatBytes(t.freeBytes) }, "{size} free")}`,
                }))}
              />
            </div>
          </div>
          {writable.length === 0 && (
            <p className="text-sm text-[var(--color-warn)]">
              {tr("dumps_no_drive", undefined, "No drive can take a dump. Plug a USB drive into the PS5.")}
            </p>
          )}

          {running.map((a) => (
            <div key={a.dir} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--color-border)] p-3">
              <div className="min-w-0">
                <div className="truncate font-medium">{a.title}</div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-muted)]">
                  <span className="font-mono">{a.titleId}</span>
                  <span>{a.version}</span>
                  <Badge tone="good">{tr("installed_badge_playing", undefined, "Playing")}</Badge>
                  {a.installing && <Badge tone="warn">{tr("dumps_installing", { n: a.installed }, "Installing {n}%")}</Badge>}
                </div>
              </div>
              <Button
                variant="primary"
                size="sm"
                disabled={busy || working || queueActive || !unlocked || !target || a.installing}
                onClick={() => void dump(a.dir)}
              >
                {tr("dumps_dump", undefined, "Dump")}
              </Button>
            </div>
          ))}
          {running.length === 0 && (
            <p className="text-sm text-[var(--color-muted)]">
              {tr(
                "dumps_none_running",
                undefined,
                "The dumper copies the game that is running. Start one below (or on the console), or tick several and dump them in a queue.",
              )}
            </p>
          )}

          {titles.length > 0 && (
            <ul className="flex max-h-96 flex-col divide-y divide-[var(--color-border)] overflow-y-auto rounded-md border border-[var(--color-border)]">
              {titles.map((t) => (
                <li key={t.titleId} className="flex items-center gap-3 px-3 py-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    aria-label={tr("dumps_add_to_queue", { title: t.title }, "Add {title} to the queue")}
                    checked={queue.includes(t.titleId)}
                    disabled={t.installing}
                    onChange={(e) =>
                      setQueue((qq) => (e.target.checked ? [...qq, t.titleId] : qq.filter((x) => x !== t.titleId)))
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{t.title}</span>
                    <span className="flex gap-1.5 text-xs text-[var(--color-muted)]">
                      <span className="font-mono">{t.titleId}</span>
                      {t.media === "disc" && <span>{t.discIn ? "DISC" : tr("dumps_disc_out", undefined, "DISC OUT")}</span>}
                    </span>
                  </span>
                  {library?.canLaunch && (
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={<Play size={13} />}
                      disabled={busy || working || queueActive || !unlocked}
                      onClick={() => void launch(t.titleId)}
                    >
                      {tr("dumps_start_game", undefined, "Start")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {queue.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                disabled={busy || working || queueActive || !unlocked || !target}
                onClick={() =>
                  void run(async () => {
                    const discs = queue.filter((id) => library?.titles.find((t) => t.titleId === id)?.media === "disc");
                    await dumperApi.call(host, "/api/queue/start", {
                      target,
                      titles: queue.join(","),
                      discs: discs.join(","),
                    });
                    setQueue([]);
                  })
                }
              >
                {tr("dumps_queue_start", { n: queue.length }, "Dump {n} in a Queue")}
              </Button>
              <span className="text-xs text-[var(--color-muted)]">
                {tr(
                  "dumps_queue_hint",
                  undefined,
                  "Each game is started (which closes the one before it), given time to load, then dumped.",
                )}
              </span>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">{tr("dumps_finished_title", undefined, "Dumps")}</h2>
          {(dumps?.dumps ?? []).length === 0 ? (
            <p className="text-sm text-[var(--color-muted)]">{tr("dumps_finished_none", undefined, "No dumps on the PS5's drives yet.")}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--color-border)]">
              {dumps!.dumps.map((d) => {
                const path = dumpPath(d);
                return (
                  <li key={path} className="flex flex-wrap items-center gap-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{d.title}</span>
                      <span className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-muted)]">
                        <span className="font-mono">{d.titleId}</span>
                        <span>{formatBytes(d.bytes)}</span>
                        <span>{d.internal ? tr("dumps_console_drive", undefined, "This PS5") : d.mount}</span>
                        {d.state !== "done" && <Badge tone="warn">{tr("dumps_unfinished", undefined, "Unfinished")}</Badge>}
                        {d.fself > 0 && <Badge tone="neutral">FSELF</Badge>}
                      </span>
                    </span>
                    <Button variant="ghost" size="sm" leftIcon={<FolderOpen size={13} />} onClick={() => openInFileSystem(navigate, path)}>
                      {tr("dumps_show_in_files", undefined, "Show in Files")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={d.state !== "done"}
                      onClick={() => navigate("/workshop", { state: { source: consoleSource(host, path) } })}
                    >
                      {tr("open_workshop", undefined, "Open Workshop")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={<Trash2 size={13} />}
                      disabled={busy || d.inUse || !unlocked}
                      aria-label={tr("dumps_delete", { title: d.title }, "Delete the dump of {title}")}
                      onClick={() =>
                        void (async () => {
                          const ok = await confirm({
                            title: tr("dumps_delete", { title: d.title }, "Delete the dump of {title}"),
                            message: path,
                            confirmLabel: tr("delete", undefined, "Delete"),
                            destructive: true,
                          });
                          if (ok)
                            await run(async () => {
                              // the dumper deletes only what it is told twice: confirm repeats the folder (its own page does the same)
                              await dumperApi.call(host, "/api/dumps/remove", {
                                mount: d.mount,
                                dir: d.dir,
                                folder: d.folder,
                                confirm: d.folder,
                              });
                              await loadDumps();
                            });
                        })()
                      }
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
