import { useEffect, useMemo, useState } from "react";
import { FolderOpen, HardDriveDownload, Square, X } from "lucide-react";
import { useNavigate } from "react-router";

import { listDumps, type DumpRecord } from "../../api/appDump";
import { listVolumes, type InstalledTitle, type Volume } from "../../api/ps5";
import {
  Badge,
  Button,
  Callout,
  ProgressBar,
  Select,
  Toggle,
} from "../../components";
import { transferAddr } from "../../lib/addr";
import { formatBytes } from "../../lib/format";
import { parsePS5Firmware } from "../../lib/ps5Firmware";
import {
  dumpErrorKey,
  useAppDumpStore,
  type DumpJob,
} from "../../state/appDump";
import { useConnectionStore } from "../../state/connection";
import { openInFileSystem } from "../../state/fsNavigation";
import { useTr } from "../../state/lang";

/** Dumps go in this folder on the chosen drive, one `<ID>-app` folder each. */
export const DUMP_FOLDER = "ps5upload-dumps";

/** The last firmware the helper decrypts on; above it a dump is a plain copy. */
const LAST_DECRYPT_FW = [13, 60];

/** Drives a dump can go to: USB and extended storage first, the internal drive last. */
export function dumpDrives(vols: Volume[]): Volume[] {
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

/** A game can be dumped when it is a game (not a system app). */
export function isDumpable(t: Pick<InstalledTitle, "system">): boolean {
  return !t.system;
}

/** Firmware ("14.00") above the last one the helper decrypts on. */
export function aboveDecryptLimit(fw: string | null): boolean {
  if (!fw) return false;
  const [maj, min] = fw.split(".").map((n) => Number.parseInt(n, 10));
  if (!Number.isFinite(maj)) return false;
  return (
    maj > LAST_DECRYPT_FW[0] ||
    (maj === LAST_DECRYPT_FW[0] && (min || 0) > LAST_DECRYPT_FW[1])
  );
}

/** This console's dumps of this title, oldest first. */
export function useTitleDumpJobs(host: string, titleId: string): DumpJob[] {
  const all = useAppDumpStore((s) => s.jobs);
  return useMemo(
    () => all.filter((j) => j.host === host && j.req.titleId === titleId),
    [all, host, titleId],
  );
}

/** One dump: its state, progress while it runs, what it made once done, why it stopped. */
export function DumpJobRow({ job }: { job: DumpJob }) {
  const tr = useTr();
  const navigate = useNavigate();
  const cancel = useAppDumpStore((s) => s.cancel);
  const dismiss = useAppDumpStore((s) => s.dismiss);
  const frac = job.total > 0 ? job.done / job.total : null;
  const err = job.error ? dumpErrorKey(job.error) : null;
  const live = job.state === "running" || job.state === "waiting";
  return (
    <div
      className="space-y-2 rounded-[var(--radius-card)] border border-[var(--color-border)] p-3"
      data-testid="dump-job"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {job.name}
        </span>
        {job.req.decrypt && (
          <Badge tone="warn">
            {tr("dump_badge_decrypt", undefined, "Decrypt")}
          </Badge>
        )}
        {job.state === "running" && (
          <Badge tone="accent">
            {tr("dump_running", undefined, "Dumping")}
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
        {live && (
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
        {!live && (
          <Button
            size="sm"
            variant="ghost"
            aria-label={tr("dump_dismiss", undefined, "Dismiss")}
            title={tr("dump_dismiss", undefined, "Dismiss")}
            onClick={() => dismiss(job.id)}
          >
            <X size={12} aria-hidden />
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
        <p className="break-words text-xs text-[var(--color-muted)]">
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
        <p className="break-words text-xs text-[var(--color-bad)]">
          {tr(err.key, undefined, err.fallback)}
          <span className="ms-1 font-mono text-[var(--color-muted)]">
            {job.error}
          </span>
        </p>
      )}
    </div>
  );
}

/**
 * How to dump one installed game: the drive, its DLC, and whether to decrypt its executables
 * (with why that is riskier: the helper briefly points a pager the whole kernel uses at its own
 * while it reads each one, and a game reading files right then could freeze the console). A
 * plain copy is the default. Starting puts it in the console's dump queue (state/appDump), whose
 * progress shows in the task list too. Says when this drive already holds a dump of it.
 */
export function DumpOptions({
  host,
  titleId,
  name,
  onStarted,
}: {
  host: string;
  titleId: string;
  name: string;
  onStarted?: () => void;
}) {
  const tr = useTr();
  const navigate = useNavigate();
  const add = useAppDumpStore((s) => s.add);
  const kernel = useConnectionStore((s) => s.ps5Kernel);
  const fw = parsePS5Firmware(kernel);
  const [vols, setVols] = useState<Volume[] | null>(null);
  const [drive, setDrive] = useState("");
  const [decrypt, setDecrypt] = useState(false);
  const [fself, setFself] = useState(false);
  const [dlc, setDlc] = useState(true);
  const [existing, setExisting] = useState<DumpRecord | null>(null);

  const drives = useMemo(() => dumpDrives(vols ?? []), [vols]);
  const root = drive ? `${drive}/${DUMP_FOLDER}` : "";
  const freeOn = drives.find((d) => d.path === drive);

  useEffect(() => {
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
  // A dump of this game already on that drive: the helper refuses to overwrite it.
  useEffect(() => {
    if (!root) return;
    let live = true;
    setExisting(null);
    void listDumps(transferAddr(host), root).then((d) => {
      if (!live) return;
      const id = titleId.toUpperCase();
      setExisting(
        d.find((r) =>
          (r.folder.split("/").pop() ?? "").toUpperCase().startsWith(id),
        ) ?? null,
      );
    });
    return () => {
      live = false;
    };
  }, [host, root, titleId]);

  const start = () => {
    if (!root) return;
    add(host, name || titleId, {
      titleId,
      dest: root,
      decrypt,
      fself: decrypt && fself,
      dlc,
    });
    onStarted?.();
  };

  return (
    <div className="space-y-3" data-testid="dump-form">
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
      <p className="break-words text-xs text-[var(--color-muted)]">
        {tr(
          "dump_how",
          { folder: root || `…/${DUMP_FOLDER}` },
          `The game's files are copied to ${root || `…/${DUMP_FOLDER}`}. Its files exist only while it runs, so it is started if it is not running; leave it running until the dump finishes.`,
        )}
      </p>
      {existing && (
        <Callout
          tone="info"
          title={tr(
            "dump_exists_here",
            undefined,
            "This drive already has a dump of this game",
          )}
        >
          <span className="break-words font-mono text-xs">
            {existing.folder}
          </span>
          {existing.incomplete && (
            <span className="ms-2">
              <Badge tone="warn">
                {tr("dump_incomplete", undefined, "Incomplete")}
              </Badge>
            </span>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<FolderOpen size={12} />}
              onClick={() => openInFileSystem(navigate, existing.folder)}
            >
              {tr("dump_open", undefined, "Open in Files")}
            </Button>
            <span className="text-xs text-[var(--color-muted)]">
              {tr(
                "dump_exists_hint",
                undefined,
                "Delete or rename it there to dump again.",
              )}
            </span>
          </div>
        </Callout>
      )}
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
            {aboveDecryptLimit(fw) && (
              <p className="mt-1 font-medium">
                {tr(
                  "dump_decrypt_fw_over",
                  { fw: fw ?? "" },
                  "This PS5 is on {fw}: its dump will be a plain copy.",
                )}
              </p>
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
      <Button
        variant="primary"
        size="sm"
        leftIcon={<HardDriveDownload size={14} />}
        disabled={!root || !!existing}
        onClick={start}
        data-testid="dump-start"
      >
        {tr("dump_start", undefined, "Dump")}
      </Button>
    </div>
  );
}

/**
 * Dumping, on an installed game's page: its dumps on this console (queued, running, finished),
 * and the options when `open`. Nothing when there is neither.
 */
export function DumpThisGame({
  host,
  title,
  open,
  onStarted,
}: {
  host: string;
  title: InstalledTitle;
  open: boolean;
  onStarted: () => void;
}) {
  const tr = useTr();
  const jobs = useTitleDumpJobs(host, title.titleId);
  if (!open && jobs.length === 0) return null;
  return (
    <section
      className="mt-4 space-y-3 border-t border-[var(--color-border)] pt-4"
      data-testid="game-dump"
      aria-label={tr("dump_this_game", undefined, "Dump this game")}
    >
      {jobs.map((j) => (
        <DumpJobRow key={j.id} job={j} />
      ))}
      {open && (
        <DumpOptions
          host={host}
          titleId={title.titleId}
          name={title.titleName || title.titleId}
          onStarted={onStarted}
        />
      )}
    </section>
  );
}
