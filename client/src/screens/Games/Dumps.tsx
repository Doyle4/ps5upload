import { useEffect, useMemo, useState } from "react";
import {
  FolderOpen,
  HardDriveDownload,
  RefreshCw,
  ShieldAlert,
  Square,
  Trash2,
} from "lucide-react";
import { useNavigate } from "react-router";

import { listDumps, type DumpRecord } from "../../api/appDump";
import { listVolumes, type Volume } from "../../api/ps5";
import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  ProgressBar,
  Select,
  Spinner,
  Toggle,
} from "../../components";
import { transferAddr } from "../../lib/addr";
import { formatBytes } from "../../lib/format";
import {
  dumpErrorKey,
  useAppDumpStore,
  type DumpJob,
} from "../../state/appDump";
import { useConnectionStore } from "../../state/connection";
import { openInFileSystem } from "../../state/fsNavigation";
import { useInstalledTitles } from "../../state/installedTitles";
import { useTr } from "../../state/lang";

/** Dumps go in this folder on the chosen drive, one `<ID>-app` folder each. */
const DUMP_FOLDER = "ps5upload-dumps";

/** Drives a dump can go to: USB and extended storage first, the internal drive last. */
function dumpDrives(vols: Volume[]): Volume[] {
  const rank = (p: string) =>
    p.startsWith("/mnt/usb")
      ? 0
      : p.startsWith("/mnt/ext")
        ? 1
        : p === "/data"
          ? 2
          : 3;
  return vols
    .filter(
      (v) =>
        (v.path.startsWith("/mnt/usb") ||
          v.path.startsWith("/mnt/ext") ||
          v.path === "/data") &&
        v.total_bytes > 0,
    )
    .sort((a, b) => rank(a.path) - rank(b.path));
}

function JobRow({ job }: { job: DumpJob }) {
  const tr = useTr();
  const navigate = useNavigate();
  const cancel = useAppDumpStore((s) => s.cancel);
  const frac = job.total > 0 ? job.done / job.total : null;
  const err = job.error ? dumpErrorKey(job.error) : null;
  return (
    <li
      className="space-y-2 rounded-[var(--radius-card)] border border-[var(--color-border)] p-3"
      data-testid="dump-job"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">
          {job.name}{" "}
          <span className="font-mono text-xs text-[var(--color-muted)]">
            {job.req.titleId}
          </span>
        </span>
        {job.req.decrypt && (
          <Badge tone="warn">
            {tr("dump_badge_decrypt", undefined, "Decrypt")}
          </Badge>
        )}
        {job.state === "waiting" && (
          <Badge>{tr("dump_waiting", undefined, "Waiting")}</Badge>
        )}
        {job.state === "done" && (
          <Badge tone="good">{tr("dump_done", undefined, "Done")}</Badge>
        )}
        {job.state === "failed" && (
          <Badge tone="bad">{tr("dump_failed", undefined, "Failed")}</Badge>
        )}
        {job.state === "cancelled" && (
          <Badge>{tr("dump_cancelled", undefined, "Stopped")}</Badge>
        )}
        {(job.state === "running" || job.state === "waiting") && (
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<Square size={12} />}
            disabled={job.stopping}
            onClick={() => cancel(job.id)}
          >
            {tr("dump_stop", undefined, "Stop")}
          </Button>
        )}
        {job.state === "done" && job.result?.path && (
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<FolderOpen size={12} />}
            onClick={() => openInFileSystem(navigate, job.result!.path)}
          >
            {tr("dump_open", undefined, "Open in Files")}
          </Button>
        )}
      </div>
      {job.state === "running" && (
        <>
          <ProgressBar value={frac} />
          <p className="text-xs text-[var(--color-muted)]">
            {job.copying
              ? tr(
                  "dump_progress",
                  {
                    done: formatBytes(job.done),
                    total: formatBytes(job.total),
                  },
                  `${formatBytes(job.done)} of ${formatBytes(job.total)}`,
                )
              : tr(
                  "dump_starting_game",
                  undefined,
                  "Starting the game so its files can be read…",
                )}
          </p>
        </>
      )}
      {job.state === "done" && job.result && (
        <p className="text-xs text-[var(--color-muted)]">
          {tr(
            "dump_done_line",
            {
              n: job.result.files,
              size: formatBytes(job.result.bytes),
              path: job.result.path,
            },
            `${job.result.files} files, ${formatBytes(job.result.bytes)}, in ${job.result.path}`,
          )}
          {job.req.decrypt &&
            (job.result.decrypt_skipped
              ? " · " +
                tr(
                  "dump_decrypt_skipped",
                  undefined,
                  "Decryption was skipped: this firmware is not supported.",
                )
              : " · " +
                tr(
                  "dump_decrypt_counts",
                  { ok: job.result.decrypted, bad: job.result.decrypt_failed },
                  `${job.result.decrypted} decrypted, ${job.result.decrypt_failed} failed`,
                ))}
        </p>
      )}
      {err && (
        <p className="text-xs text-[var(--color-danger)]">
          {tr(err.key, undefined, err.fallback)}
          <span className="ms-1 font-mono text-[var(--color-muted)]">
            {job.error}
          </span>
        </p>
      )}
    </li>
  );
}

/**
 * Dump games: an installed game's files copied to a drive by ps5upload's own helper (a port of
 * ps5-app-dumper, payload/src/app_dump.c). A plain copy is the default. Decrypting the game's
 * executables is offered on its own, with why it is riskier: the helper briefly points a pager
 * the whole kernel uses at its own while it reads each one, and a game reading files right then
 * could freeze the console.
 */
export function DumpsView() {
  const tr = useTr();
  const navigate = useNavigate();
  const host = useConnectionStore((s) => s.host);
  const titles = useInstalledTitles(host || undefined);
  const allJobs = useAppDumpStore((s) => s.jobs);
  const jobs = useMemo(
    () => allJobs.filter((j) => j.host === host),
    [allJobs, host],
  );
  const add = useAppDumpStore((s) => s.add);
  const clearFinished = useAppDumpStore((s) => s.clearFinished);
  const [vols, setVols] = useState<Volume[] | null>(null);
  const [drive, setDrive] = useState("");
  const [titleId, setTitleId] = useState("");
  const [decrypt, setDecrypt] = useState(false);
  const [fself, setFself] = useState(false);
  const [dlc, setDlc] = useState(true);
  const [dumps, setDumps] = useState<DumpRecord[] | null>(null);
  const [reload, setReload] = useState(0);

  const games = useMemo(
    () =>
      (titles ?? [])
        .filter((t) => !t.system)
        .sort((a, b) => a.titleName.localeCompare(b.titleName)),
    [titles],
  );
  const drives = useMemo(() => dumpDrives(vols ?? []), [vols]);
  const root = drive ? `${drive}/${DUMP_FOLDER}` : "";

  useEffect(() => {
    if (!host) return;
    let live = true;
    listVolumes(transferAddr(host))
      .then((v) => live && setVols(v))
      .catch(() => live && setVols([]));
    return () => {
      live = false;
    };
  }, [host]);
  useEffect(() => {
    if (!drive && drives[0]) setDrive(drives[0].path);
  }, [drive, drives]);
  // Finished jobs show up in the list of dumps.
  const finished = jobs.filter((j) => j.state === "done").length;
  useEffect(() => {
    if (!host || !root) return;
    let live = true;
    setDumps(null);
    void listDumps(transferAddr(host), root).then((d) => live && setDumps(d));
    return () => {
      live = false;
    };
  }, [host, root, reload, finished]);

  if (!host) {
    return (
      <EmptyState
        icon={HardDriveDownload}
        title={tr("dump_no_console", undefined, "Choose a PS5 first")}
      />
    );
  }

  const game = games.find((g) => g.titleId === titleId);
  const freeOn = drives.find((d) => d.path === drive);
  const start = () => {
    if (!game || !root) return;
    add(host, game.titleName || game.titleId, {
      titleId: game.titleId,
      dest: root,
      decrypt,
      fself: decrypt && fself,
      dlc,
    });
  };

  return (
    <div className="space-y-5">
      <div data-testid="dump-form">
        <Card className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label={tr("dump_game", undefined, "Game")}
              value={titleId}
              onChange={(e) => setTitleId(e.target.value)}
              disabled={titles === null}
              options={[
                {
                  value: "",
                  label:
                    titles === null
                      ? tr(
                          "dump_loading_games",
                          undefined,
                          "Reading installed games…",
                        )
                      : tr("dump_pick_game", undefined, "Choose a game"),
                },
                ...games.map((g) => ({
                  value: g.titleId,
                  label: `${g.titleName || g.titleId} (${g.titleId})`,
                })),
              ]}
            />
            <Select
              label={tr("dump_drive", undefined, "Drive")}
              value={drive}
              onChange={(e) => setDrive(e.target.value)}
              disabled={drives.length === 0}
              hint={
                freeOn
                  ? tr(
                      "dump_drive_free",
                      { free: formatBytes(freeOn.free_bytes) },
                      `${formatBytes(freeOn.free_bytes)} free`,
                    )
                  : undefined
              }
              options={
                drives.length
                  ? drives.map((d) => ({ value: d.path, label: d.path }))
                  : [
                      {
                        value: "",
                        label:
                          vols === null
                            ? "…"
                            : tr("dump_no_drive", undefined, "No drive found"),
                      },
                    ]
              }
            />
          </div>
          <p className="text-xs text-[var(--color-muted)]">
            {tr(
              "dump_how",
              { folder: root || `…/${DUMP_FOLDER}` },
              `The game's files are copied to ${root || `…/${DUMP_FOLDER}`}. Its files exist only while it runs, so it is started if it is not running; leave it running until the dump finishes.`,
            )}
          </p>
          <div className="space-y-2">
            <Toggle
              checked={dlc}
              onChange={setDlc}
              label={tr("dump_dlc", undefined, "Include installed DLC")}
            />
            <Toggle
              checked={decrypt}
              onChange={setDecrypt}
              label={tr(
                "dump_decrypt",
                undefined,
                "Decrypt the game's executables",
              )}
              hint={tr(
                "dump_decrypt_hint",
                undefined,
                "Needed to run the dump as a folder game or to backport it. Off: a plain copy.",
              )}
            />
            {decrypt && (
              <Callout
                tone="warn"
                title={tr(
                  "dump_decrypt_risk",
                  undefined,
                  "Decrypting can freeze the console",
                )}
              >
                {tr(
                  "dump_decrypt_risk_body",
                  undefined,
                  "To decrypt, the helper briefly swaps a part of the system every program uses for each executable. If the game reads a file at that moment the console can freeze and need a hard power-off. Stay on the game's start screen while it runs. Firmware up to 13.60 only; on newer firmware the dump is a plain copy.",
                )}
              </Callout>
            )}
            {decrypt && (
              <Toggle
                checked={fself}
                onChange={setFself}
                label={tr(
                  "dump_fself",
                  undefined,
                  "Also make fake-signed copies (for backporting)",
                )}
              />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              leftIcon={<HardDriveDownload size={14} />}
              disabled={!game || !root}
              onClick={start}
              data-testid="dump-start"
            >
              {tr("dump_start", undefined, "Dump")}
            </Button>
            {decrypt && (
              <ShieldAlert
                size={16}
                className="text-[var(--color-warn)]"
                aria-hidden
              />
            )}
          </div>
        </Card>
      </div>

      {jobs.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="flex-1 text-sm font-semibold">
              {tr("dump_jobs", undefined, "This session")}
            </h2>
            {jobs.some(
              (j) => j.state !== "running" && j.state !== "waiting",
            ) && (
              <Button
                size="sm"
                variant="ghost"
                leftIcon={<Trash2 size={12} />}
                onClick={clearFinished}
              >
                {tr("dump_clear", undefined, "Clear finished")}
              </Button>
            )}
          </div>
          <ul className="space-y-2">
            {jobs.map((j) => (
              <JobRow key={j.id} job={j} />
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-sm font-semibold">
            {tr("dump_list", { folder: root }, `Dumps in ${root}`)}
          </h2>
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<RefreshCw size={12} />}
            onClick={() => setReload((n) => n + 1)}
          >
            {tr("dump_refresh", undefined, "Refresh")}
          </Button>
        </div>
        {dumps === null ? (
          <Spinner size={14} />
        ) : dumps.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">
            {tr("dump_none", undefined, "No dumps on this drive yet.")}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)] rounded-[var(--radius-card)] border border-[var(--color-border)]">
            {dumps.map((d) => (
              <li
                key={d.folder}
                className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"
                data-testid="dump-record"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  {d.folder.split("/").pop()}
                </span>
                {d.incomplete && (
                  <Badge tone="warn">
                    {tr("dump_incomplete", undefined, "Incomplete")}
                  </Badge>
                )}
                {!!d.decrypted && (
                  <Badge>
                    {tr(
                      "dump_badge_decrypted",
                      { n: d.decrypted },
                      `${d.decrypted} decrypted`,
                    )}
                  </Badge>
                )}
                {!!d.bytes && (
                  <span className="text-xs text-[var(--color-muted)]">
                    {formatBytes(d.bytes)}
                  </span>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  leftIcon={<FolderOpen size={12} />}
                  onClick={() => openInFileSystem(navigate, d.folder)}
                >
                  {tr("dump_open", undefined, "Open in Files")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
