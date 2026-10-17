import { useCallback, useEffect, useState } from "react";
import { FolderOpen, Gamepad2, HardDrive, Moon, RotateCw, Usb, X } from "lucide-react";
import { formatBytes } from "../../lib/format";
import { ApiError, call, isOffline } from "../api";
import { onNavAction } from "../nav";
import type { SectionContext } from "../sections";
import type { ConsoleStatus } from "../shell/TopBar";
import { t } from "../strings";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { TaskRow } from "./TaskRow";
import { useJobs, visibleJobs, type Job } from "./useJobs";

/** Free space moves with every write: re-read this often while Home is open. */
const VOLUMES_POLL_MS = 15_000;
/** An action's result line clears itself after this long. */
const MESSAGE_MS = 8_000;

/** One /api/volumes entry (payload/src/runtime.c handle_fs_list_volumes). */
export interface Volume {
  path: string;
  mount_from: string;
  fs_type: string;
  total_bytes: number;
  free_bytes: number;
  writable: boolean;
  source_image?: string;
}

/** Something Home asks about before doing it. */
export type Ask =
  | { kind: "cancel"; job: Job }
  | { kind: "close"; appId: number; titleId: string }
  | { kind: "power"; action: "rest" | "reboot" };

export interface Message {
  tone: "error" | "info";
  text: string;
}

/* ---- volumes ---- */

const isUsbStick = (v: Volume) => /^\/mnt\/usb\d+$/.test(v.path);
const isExt = (v: Volume) => /^\/mnt\/ext\d+$/.test(v.path);
/** A USB drive formatted as PS5 extended storage (M.2 is /dev/nvme*). */
const isUsbExt = (v: Volume) => isExt(v) && v.mount_from.startsWith("/dev/da");

/** The console's drives: internal, extended/M.2 and USB. Mounted disk images are left out. */
export function isDrive(v: Volume): boolean {
  return v.path === "/data" || isExt(v) || isUsbStick(v);
}

/** The first USB drive in the helper's order (a stick or USB extended storage), or null. */
export function firstUsbVolume(volumes: Volume[]): Volume | null {
  return volumes.find((v) => isUsbStick(v) || isUsbExt(v)) ?? null;
}

export function volumeLabel(v: Volume): string {
  if (v.path === "/data") return t("cw_home_vol_internal");
  if (isUsbStick(v)) return t("cw_home_vol_usb");
  if (isUsbExt(v)) return t("cw_home_vol_usb_ext");
  if (v.mount_from.startsWith("/dev/nvme")) return t("cw_home_vol_m2");
  return t("cw_home_vol_ext");
}

/* ---- actions ---- */

/** A failed call as one short translated line; null for a 401 (the reload banner says it). */
export function errorText(err: unknown): string | null {
  if (err instanceof ApiError) {
    if (err.status === 401) return null;
    if (isOffline(err)) return t("cw_home_err_offline");
    if (err.code === "busy") return t("cw_home_err_busy");
    if (err.code === "unknown_job") return t("cw_home_err_gone");
    return t("cw_home_err_failed", { code: err.code });
  }
  return t("cw_home_err_failed", {
    code: err instanceof Error ? err.message : String(err),
  });
}

/** A failure the dialog keeps open for (try again in a moment): 409 (busy) or 503 (stopping). */
export function keepsDialogOpen(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 409 || err.status === 503);
}

/** Do what was confirmed. Resolves to a line to show (the power actions), throws the ApiError. */
export async function runAsk(ask: Ask, deps: { cancel: (id: string) => Promise<void> }): Promise<string | null> {
  switch (ask.kind) {
    case "cancel":
      await deps.cancel(ask.job.job);
      return null;
    case "close":
      await call("/api/app/close", { app_id: ask.appId });
      return null;
    case "power":
      await call("/api/power", { action: ask.action });
      return t(ask.action === "rest" ? "cw_home_rest_sent" : "cw_home_restart_sent");
  }
}

function askCopy(ask: Ask): {
  title: string;
  body: string;
  confirm: string;
  cancel?: string;
  danger: boolean;
} {
  switch (ask.kind) {
    case "cancel":
      return {
        title: t("cw_home_confirm_cancel_title"),
        body: t(ask.job.mine ? "cw_home_confirm_cancel_body" : "cw_home_confirm_cancel_body_pc"),
        confirm: t("cw_home_cancel_task_confirm"),
        cancel: t("cw_home_keep_task"),
        danger: true,
      };
    case "close":
      return {
        title: t("cw_home_confirm_close_title", { name: ask.titleId }),
        body: t("cw_home_confirm_close_body"),
        confirm: t("cw_home_close_game"),
        danger: true,
      };
    case "power":
      return ask.action === "rest"
        ? {
            title: t("cw_home_confirm_rest_title"),
            body: t("cw_home_confirm_rest_body"),
            confirm: t("cw_home_rest"),
            danger: false,
          }
        : {
            title: t("cw_home_confirm_restart_title"),
            body: t("cw_home_confirm_restart_body"),
            confirm: t("cw_home_restart"),
            danger: true,
          };
  }
}

/* ---- view ---- */

export interface HomeViewProps {
  status: ConsoleStatus | null;
  /** null until the first answer. */
  volumes: Volume[] | null;
  volumesError: boolean;
  jobs: Job[];
  jobsLoaded: boolean;
  jobsError: boolean;
  ask: Ask | null;
  busy: boolean;
  /** The confirmed action failed in a way worth retrying (409 busy, 503): shown in the dialog. */
  askError?: string | null;
  message: Message | null;
  onAsk: (ask: Ask) => void;
  onConfirm: () => void;
  onDismiss: () => void;
  /** Browse USB, or null to hide it (no USB drive, or Files cannot open a path yet). */
  onBrowseUsb: (() => void) | null;
  /** ✕ on a storage card: Files at that drive's path, or null when Files cannot open a path. */
  onOpenDrive: ((path: string) => void) | null;
}

/** One drive. Focusable; ✕ (a click) opens Files there when `onOpen` is given. */
export function VolumeCard({ v, onOpen }: { v: Volume; onOpen: ((path: string) => void) | null }) {
  const used = v.total_bytes > 0 ? Math.max(0, Math.min(100, 100 - (v.free_bytes / v.total_bytes) * 100)) : 0;
  const Icon = isUsbStick(v) || isUsbExt(v) ? Usb : HardDrive;
  return (
    <li className="cw-volume-item">
      <div
        className="cw-focusable cw-volume"
        tabIndex={0}
        role={onOpen ? "button" : undefined}
        data-volume={v.path}
        onClick={onOpen ? () => onOpen(v.path) : undefined}
        onKeyDown={
          onOpen
            ? (e) => {
                // A real button's keys (the nav layer leaves a handled key alone: no double open).
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen(v.path);
                }
              }
            : undefined
        }
      >
        <div className="cw-volume-head">
          <Icon aria-hidden />
          <span className="cw-volume-name">{volumeLabel(v)}</span>
          {!v.writable ? <span className="cw-tag">{t("cw_home_vol_readonly")}</span> : null}
        </div>
        <div className="cw-dim cw-mono">{v.path}</div>
        <div className="cw-bar" aria-hidden>
          <div className={`cw-bar-fill${used >= 90 ? " is-warn" : ""}`} style={{ width: `${used}%` }} />
        </div>
        <div className="cw-volume-free">
          {t("cw_home_free_of", {
            free: formatBytes(v.free_bytes),
            total: formatBytes(v.total_bytes),
          })}
        </div>
      </div>
    </li>
  );
}

/** Home without state: everything comes in through props (tests render it directly). */
export function HomeView(p: HomeViewProps) {
  const running = p.status?.running ?? null;
  const tasks = visibleJobs(p.jobs);
  const drives = (p.volumes ?? []).filter(isDrive);
  const copy = p.ask ? askCopy(p.ask) : null;

  let tasksNote: string | null = null;
  if (p.jobsError && !tasks.length) tasksNote = t("cw_home_err_load_tasks");
  else if (!p.jobsLoaded) tasksNote = t("cw_home_loading");
  else if (!tasks.length) tasksNote = t("cw_home_no_tasks");

  let drivesNote: string | null = null;
  if (p.volumesError && !drives.length) drivesNote = t("cw_home_err_load_storage");
  else if (p.volumes == null) drivesNote = t("cw_home_loading");

  return (
    <div className="cw-home">
      <h1 className="cw-h1">{t("cw_nav_home")}</h1>
      {p.message ? (
        <div className={`cw-msg is-${p.message.tone}`} role={p.message.tone === "error" ? "alert" : "status"}>
          {p.message.text}
        </div>
      ) : null}

      <div className="cw-quick" role="group" aria-label={t("cw_home_quick")}>
        {p.onBrowseUsb ? (
          <button type="button" className="cw-focusable cw-button" data-action="browse-usb" onClick={p.onBrowseUsb}>
            <FolderOpen aria-hidden />
            <span>{t("cw_home_browse_usb")}</span>
          </button>
        ) : null}
        <button
          type="button"
          className="cw-focusable cw-button"
          data-action="rest"
          onClick={() => p.onAsk({ kind: "power", action: "rest" })}
        >
          <Moon aria-hidden />
          <span>{t("cw_home_rest")}</span>
        </button>
        <button
          type="button"
          className="cw-focusable cw-button"
          data-action="restart"
          onClick={() => p.onAsk({ kind: "power", action: "reboot" })}
        >
          <RotateCw aria-hidden />
          <span>{t("cw_home_restart")}</span>
        </button>
      </div>

      <section className="cw-card cw-game" aria-label={t("cw_home_now_running")}>
        <Gamepad2 className="cw-game-icon" aria-hidden />
        {running ? (
          <>
            <div className="cw-game-text">
              <div className="cw-dim">{t("cw_home_now_running")}</div>
              <div className="cw-game-title">{running.name ?? running.title_id}</div>
              {running.name ? <div className="cw-dim cw-mono">{running.title_id}</div> : null}
            </div>
            <button
              type="button"
              className="cw-focusable cw-button"
              data-action="close-game"
              onClick={() =>
                p.onAsk({
                  kind: "close",
                  appId: running.app_id,
                  titleId: running.name ?? running.title_id,
                })
              }
            >
              <X aria-hidden />
              <span>{t("cw_home_close_game")}</span>
            </button>
          </>
        ) : (
          <div className="cw-game-text cw-dim">{p.status ? t("cw_home_no_game") : t("cw_home_loading")}</div>
        )}
      </section>

      <section className="cw-home-section">
        <h2 className="cw-h2">{t("cw_home_tasks")}</h2>
        {p.jobsError && tasks.length ? <div className="cw-dim">{t("cw_home_err_load_tasks")}</div> : null}
        {tasksNote ? (
          <p className="cw-dim">{tasksNote}</p>
        ) : (
          <ul className="cw-tasks">
            {tasks.map((j) => (
              <TaskRow key={j.job} job={j} onCancel={(job) => p.onAsk({ kind: "cancel", job })} />
            ))}
          </ul>
        )}
      </section>

      <section className="cw-home-section">
        <h2 className="cw-h2">{t("cw_home_storage")}</h2>
        {drivesNote ? (
          <p className="cw-dim">{drivesNote}</p>
        ) : (
          <ul className="cw-volumes">
            {drives.map((v) => (
              <VolumeCard key={v.path} v={v} onOpen={p.onOpenDrive} />
            ))}
          </ul>
        )}
      </section>

      {p.ask && copy ? (
        <ConfirmDialog
          title={copy.title}
          body={copy.body}
          confirmLabel={copy.confirm}
          cancelLabel={copy.cancel}
          danger={copy.danger}
          busy={p.busy}
          error={p.askError}
          onConfirm={p.onConfirm}
          onCancel={p.onDismiss}
        />
      ) : null}
    </div>
  );
}

/* ---- the section ---- */

function useVolumes(tick: number): { volumes: Volume[] | null; error: boolean } {
  const [volumes, setVolumes] = useState<Volume[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      call<{ volumes?: unknown }>("/api/volumes").then(
        (r) => {
          if (!live) return;
          setVolumes(Array.isArray(r?.volumes) ? (r.volumes as Volume[]) : []);
          setError(false);
          timer = setTimeout(load, VOLUMES_POLL_MS);
        },
        (e: unknown) => {
          if (!live) return;
          setError(true);
          // The token is gone: every read would 401 until the page reloads.
          if (!(e instanceof ApiError && e.status === 401)) timer = setTimeout(load, VOLUMES_POLL_MS);
        },
      );
    };
    load();
    return () => {
      live = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [tick]);
  return { volumes, error };
}

/** The Home section: the running game, tasks, storage and quick actions. */
export function Home({ ctx }: { ctx: SectionContext }) {
  const { jobs, loaded, error: jobsError, cancel, refresh: refreshJobs } = useJobs();
  const [volumesTick, setVolumesTick] = useState(0);
  const { volumes, error: volumesError } = useVolumes(volumesTick);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const { refreshStatus, openSection, canOpen } = ctx;

  // Create (refresh): read the tasks and drives again; App's fallback re-reads the status.
  useEffect(
    () =>
      onNavAction((a) => {
        if (a !== "refresh") return false;
        refreshJobs();
        setVolumesTick((n) => n + 1);
        return false;
      }),
    [refreshJobs],
  );

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  const onConfirm = useCallback(() => {
    if (!ask || busy) return;
    setBusy(true);
    setAskError(null);
    runAsk(ask, { cancel }).then(
      (notice) => {
        setMessage(notice ? { tone: "info", text: notice } : null);
        if (ask.kind === "close") refreshStatus();
        setBusy(false);
        setAsk(null);
      },
      (e: unknown) => {
        const text = errorText(e);
        setBusy(false);
        if (text && keepsDialogOpen(e)) {
          // Busy or stopping: say so where the user is looking; ✕ tries again, ○ gives up.
          setAskError(text);
          return;
        }
        setMessage(text ? { tone: "error", text } : null);
        setAsk(null);
      },
    );
  }, [ask, busy, cancel, refreshStatus]);

  const onDismiss = useCallback(() => {
    if (busy) return;
    setAsk(null);
    setAskError(null);
  }, [busy]);

  const usb = volumes ? firstUsbVolume(volumes) : null;
  const onBrowseUsb = usb && canOpen("files") ? () => openSection("files", { path: usb.path }) : null;
  const onOpenDrive = canOpen("files") ? (path: string) => openSection("files", { path }) : null;

  return (
    <HomeView
      status={ctx.status}
      volumes={volumes}
      volumesError={volumesError}
      jobs={jobs}
      jobsLoaded={loaded}
      jobsError={jobsError != null}
      ask={ask}
      busy={busy}
      askError={askError}
      message={message}
      onAsk={(a) => {
        setMessage(null);
        setAskError(null);
        setAsk(a);
      }}
      onConfirm={onConfirm}
      onDismiss={onDismiss}
      onBrowseUsb={onBrowseUsb}
      onOpenDrive={onOpenDrive}
    />
  );
}
