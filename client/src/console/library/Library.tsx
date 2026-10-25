import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Copy, Download, Gamepad2, HousePlus, RefreshCw, Search, Square, X } from "lucide-react";
import { formatBytes } from "../../lib/format";
import { ApiError, call } from "../api";
import { errorText, isDrive, volumeLabel, type Message, type Volume } from "../home/Home";
import { installMessage, installPhaseText, installStoppable, kindText } from "../files/pkg";
import { watchOp } from "../files/opJob";
import { listShares, smbCallErrorText, watchSmbJob, type SmbJob } from "../files/smb";
import { loadImage, useLazyImage } from "../games/covers";
import { onNavAction } from "../nav";
import { t } from "../strings";
import { Modal } from "../ui/Modal";
import {
  CONSOLE_SOURCE,
  LIB_DIR,
  STAGE_DIR,
  copyDest,
  displayName,
  entriesOf,
  filterEntries,
  readScan,
  stagePath,
  startScan,
  type Entry,
  type LibScan,
  type LibSource,
} from "./model";

/** A running scan, copy or install: what the page shows, and whether Stop can end it. */
interface Task {
  key: string;
  text: string;
  /** False once the console's installer has the package (or for a one-call task): no Stop. */
  stoppable: boolean;
}

const loadIcon = (icon: string) => loadImage(`lib:${icon}`, [`${LIB_DIR}/icons/${icon}`]);
const noIcon = () => Promise.resolve(null);

function Cover({ e, big }: { e: Entry; big?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const url = useLazyImage(e.icon, ref, e.icon ? loadIcon : noIcon);
  return (
    <span ref={ref} className={`cw-gcover${big ? " is-big" : ""}`} aria-hidden>
      {url ? <img src={url} alt="" /> : <Gamepad2 />}
    </span>
  );
}

const kindLabel = (e: Entry) =>
  e.kind === "pkg" ? kindText(e.type) : e.kind === "folder" ? t("cw_lib_kind_folder") : t("cw_lib_kind_image");

/** A failed call or job as one line. */
const failText = (e: unknown) => smbCallErrorText(e) ?? errorText(e) ?? "";

export interface LibraryViewProps {
  sources: LibSource[];
  scans: ReadonlyMap<string, LibScan | null>;
  loaded: boolean;
  query: string;
  task: Task | null;
  message: Message | null;
  open: Entry | null;
  drives: Volume[];
  /** The folder a copy just put on the console, for Register. */
  copied: { key: string; path: string } | null;
  onQuery: (q: string) => void;
  onScan: () => void;
  onStop: () => void;
  onOpen: (e: Entry | null) => void;
  onInstall: (e: Entry) => void;
  onCopy: (e: Entry, drive: string) => void;
  onRegister: (path: string, name: string) => void;
}

function Sheet({ e, p }: { e: Entry; p: LibraryViewProps }) {
  const busy = p.task !== null;
  const onShare = e.source !== CONSOLE_SOURCE;
  const rows: [string, string][] = [
    [t("cw_games_info_title_id"), e.title_id || "—"],
    [t("cw_games_info_version"), e.version || "—"],
    [t("cw_lib_info_kind"), kindLabel(e)],
    [t("cw_games_info_size"), e.size ? formatBytes(e.size) : "—"],
  ];
  if (e.fw) rows.push([t("cw_lib_info_fw"), e.fw]);
  rows.push([t("cw_lib_info_source"), e.sourceName], [t("cw_lib_info_path"), e.path]);
  const registerPath = !onShare && e.kind === "folder" ? e.path : p.copied?.key === e.key ? p.copied.path : null;
  return (
    <Modal label={displayName(e)} className="cw-sheet cw-game-sheet" onBack={() => p.onOpen(null)}>
      <div className="cw-game-sheet-head">
        <Cover e={e} big />
        <div className="cw-game-text">
          <h2 className="cw-sheet-title">{displayName(e)}</h2>
          <span className="cw-gcard-tags">
            <span className="cw-tag">{kindLabel(e)}</span>
            {e.fake ? <span className="cw-tag">{t("cw_lib_fake")}</span> : null}
          </span>
        </div>
      </div>
      <div className="cw-game-sheet-body">
        <div>
          <dl className="cw-info">
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt className="cw-dim">{k}</dt>
                <dd className="cw-mono">{v}</dd>
              </div>
            ))}
          </dl>
          {p.task ? <p className="cw-dim" role="status">{p.task.text}</p> : null}
        </div>
        <div className="cw-sheet-items">
          {e.kind === "pkg" ? (
            <button type="button" className="cw-focusable cw-sheet-item" data-nav-default="" disabled={busy} onClick={() => p.onInstall(e)}>
              <Download aria-hidden />
              <span>{t("cw_lib_install")}</span>
            </button>
          ) : null}
          {onShare && e.kind !== "pkg"
            ? p.drives.map((d, i) => (
                <button
                  key={d.path}
                  type="button"
                  className="cw-focusable cw-sheet-item"
                  data-nav-default={i === 0 ? "" : undefined}
                  disabled={busy}
                  onClick={() => p.onCopy(e, d.path)}
                >
                  <Copy aria-hidden />
                  <span>{t("cw_lib_copy_to", { drive: `${volumeLabel(d)} (${formatBytes(d.free_bytes)})` })}</span>
                </button>
              ))
            : null}
          {registerPath ? (
            <button type="button" className="cw-focusable cw-sheet-item" disabled={busy} onClick={() => p.onRegister(registerPath, displayName(e))}>
              <HousePlus aria-hidden />
              <span>{t("cw_lib_register")}</span>
            </button>
          ) : null}
          {p.task?.stoppable ? (
            <button type="button" className="cw-focusable cw-sheet-item is-danger" onClick={p.onStop}>
              <Square aria-hidden />
              <span>{t("cw_lib_stop")}</span>
            </button>
          ) : null}
        </div>
      </div>
      <div className="cw-dialog-buttons">
        <button type="button" className="cw-focusable cw-button" onClick={() => p.onOpen(null)}>
          <X aria-hidden />
          <span>{t("cw_files_close")}</span>
        </button>
      </div>
    </Modal>
  );
}

/** The Library without state: everything comes in through props (tests render it directly). */
export function LibraryView(p: LibraryViewProps) {
  const all = useMemo(() => entriesOf(p.sources, p.scans), [p.sources, p.scans]);
  const shown = useMemo(() => filterEntries(all, p.query), [all, p.query]);
  const notes: string[] = [];
  for (const s of p.sources) {
    const scan = p.scans.get(s.id);
    if (scan && !scan.complete) notes.push(t("cw_lib_partial", { name: s.name }));
  }
  const never = p.loaded && p.sources.every((s) => !p.scans.get(s.id));
  let body;
  if (!p.loaded) body = <p className="cw-dim">{t("cw_games_loading")}</p>;
  else if (never) body = <p className="cw-dim">{t("cw_lib_never")}</p>;
  else if (!shown.length)
    body = <p className="cw-dim">{p.query.trim() ? t("cw_games_no_match", { query: p.query.trim() }) : t("cw_lib_none")}</p>;
  else
    body = (
      <ul className="cw-games" aria-label={t("cw_lib_title")}>
        {shown.map((e) => (
          <li key={e.key} className="cw-gcard-item">
            <button type="button" className="cw-focusable cw-gcard" data-lib-key={e.key} onClick={() => p.onOpen(e)}>
              <Cover e={e} />
              <span className="cw-gcard-name">{displayName(e)}</span>
              <span className="cw-gcard-tags">
                <span className="cw-tag">{kindLabel(e)}</span>
                <span className="cw-tag">{e.sourceName}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  return (
    <div className="cw-games-section">
      <h1 className="cw-h1">
        {t("cw_lib_title")}
        {p.loaded ? <span className="cw-tag">{all.length}</span> : null}
      </h1>
      <div className="cw-toolbar">
        <label className="cw-games-search">
          <Search aria-hidden />
          <input
            className="cw-focusable cw-input"
            type="text"
            value={p.query}
            placeholder={t("cw_games_search")}
            aria-label={t("cw_games_search")}
            autoComplete="off"
            spellCheck={false}
            onChange={(ev) => p.onQuery(ev.target.value)}
          />
        </label>
        {p.task?.stoppable && !p.open ? (
          <button type="button" className="cw-focusable cw-button" data-action="lib-stop" onClick={p.onStop}>
            <Square aria-hidden />
            <span>{t("cw_lib_stop")}</span>
          </button>
        ) : (
          <button type="button" className="cw-focusable cw-button" data-action="lib-scan" disabled={!!p.task} onClick={p.onScan}>
            <RefreshCw aria-hidden />
            <span>{t("cw_lib_scan")}</span>
          </button>
        )}
      </div>
      <p className="cw-dim">{p.sources.length > 1 ? t("cw_lib_sources", { n: p.sources.length - 1 }) : t("cw_lib_no_shares")}</p>
      {p.task && !p.open ? <p className="cw-dim" role="status">{p.task.text}</p> : null}
      {notes.map((n) => (
        <p key={n} className="cw-dim">
          {n}
        </p>
      ))}
      {p.message ? (
        <div className={`cw-msg ${p.message.tone === "error" ? "is-error" : "is-info"}`} role={p.message.tone === "error" ? "alert" : "status"}>
          {p.message.text}
        </div>
      ) : null}
      {body}
      {p.open ? <Sheet e={p.open} p={p} /> : null}
    </div>
  );
}

/* ---- state ---- */

const pct = (done: number, total: number) => (total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 0);

const consoleSource = (): LibSource => ({ id: CONSOLE_SOURCE, name: t("cw_lib_this_console") });

/**
 * The section's state lives outside the component: a scan, copy or install
 * started here goes on in the helper when the section is left (like an install
 * once the console has it), and the section shows it again, with its outcome,
 * when it opens next. Stop asks the helper to cancel the running job.
 */
interface LibState {
  sources: LibSource[];
  scans: Map<string, LibScan | null>;
  loaded: boolean;
  task: Task | null;
  message: Message | null;
  copied: { key: string; path: string } | null;
}

const lib: LibState = { sources: [], scans: new Map(), loaded: false, task: null, message: null, copied: null };
const listeners = new Set<() => void>();
let stopAsked = false;

function patch(p: Partial<LibState>): void {
  Object.assign(lib, p);
  for (const fn of Array.from(listeners)) fn();
}

const stopped = () => stopAsked;

/** The saved shares, then each source's cached scan; a cache that cannot be read is said so. */
async function load(): Promise<void> {
  let list: LibSource[] = [consoleSource()];
  try {
    list = list.concat((await listShares()).map((s) => ({ id: s.id, name: s.name })));
  } catch {
    // No shares readable: this console only.
  }
  const next = new Map<string, LibScan | null>();
  const failed: string[] = [];
  for (const s of list) {
    try {
      next.set(s.id, await readScan(s.id));
    } catch (e) {
      next.set(s.id, lib.scans.get(s.id) ?? null);
      failed.push(t("cw_lib_read_failed", { name: s.name, why: failText(e) || (e instanceof ApiError ? e.code : String(e)) }));
    }
  }
  patch({ sources: list, scans: next, loaded: true, ...(failed.length ? { message: { tone: "error", text: failed.join(" · ") } } : {}) });
}

async function scanAll(): Promise<void> {
  if (lib.task) return;
  stopAsked = false;
  // busy before the first await, so a second press cannot start a second run
  patch({ message: null, task: { key: "scan", text: t("cw_lib_scanning", { name: consoleSource().name, n: 0 }), stoppable: true } });
  const failed: string[] = [];
  let list = lib.sources;
  try {
    // the shares as they are now (one may have been added in Files or from the PC since)
    list = [consoleSource(), ...(await listShares()).map((s) => ({ id: s.id, name: s.name }))];
    patch({ sources: list });
  } catch {
    // keep the list we have
  }
  for (const s of list) {
    if (stopped()) break;
    patch({ task: { key: "scan", text: t("cw_lib_scanning", { name: s.name, n: 0 }), stoppable: true } });
    try {
      const job = await startScan(s.id);
      const end = await watchSmbJob(job, {
        stopped,
        onStatus: (st: SmbJob) => patch({ task: { key: "scan", text: t("cw_lib_scanning", { name: s.name, n: st.files_total }), stoppable: true } }),
      });
      if (end.end === "failed") failed.push(`${s.name}: ${failText(new ApiError(502, end.status.error ?? "io_error"))}`);
      else if (end.end === "gone") failed.push(`${s.name}: ${failText(new ApiError(502, "smb_job_lost"))}`);
      const scan = await readScan(s.id);
      patch({ scans: new Map(lib.scans).set(s.id, scan) });
    } catch (e) {
      failed.push(`${s.name}: ${failText(e)}`);
    }
  }
  patch({ task: null, ...(failed.length ? { message: { tone: "error", text: t("cw_lib_scan_failed", { list: failed.join(" · ") }) } } : {}) });
}

/** Copies `src` (on a share) to `dest`; true when it finished. */
async function copyIn(src: string, dest: string, name: string): Promise<boolean> {
  const { job } = await call<{ job: string }>("/api/smb/copy", { src, dest });
  const end = await watchSmbJob(job, {
    stopped,
    onStatus: (st) =>
      patch({
        task: { key: "copy", text: t("cw_lib_copying", { name, pct: pct(st.bytes_done, st.bytes_total), size: formatBytes(st.bytes_total) }), stoppable: true },
      }),
  });
  if (end.end === "done") return true;
  if (end.end === "cancelled") throw new ApiError(409, "cancelled");
  if (end.end === "gone") throw new ApiError(502, "smb_job_lost");
  throw new ApiError(502, end.status.error ?? "io_error");
}

async function install(e: Entry): Promise<void> {
  if (lib.task) return;
  stopAsked = false;
  const name = displayName(e);
  patch({ message: null, task: { key: "install", text: t("cw_pkg_phase_starting"), stoppable: true } });
  let path = e.at;
  let staged = false;
  try {
    if (e.source !== CONSOLE_SOURCE) {
      await call("/api/fs/mkdir", { path: STAGE_DIR });
      path = stagePath();
      staged = true;
      await copyIn(e.at, path, name);
    }
    patch({ task: { key: "install", text: t("cw_pkg_phase_starting"), stoppable: true } });
    let job: string;
    try {
      const r = await call<{ job: string }>("/api/pkg/install", staged ? { path, remove_after: true } : { path });
      job = r.job;
    } catch (err) {
      // refused before it started: the copy is ours to remove
      if (staged) await call("/api/fs/delete", { path }).catch(() => undefined);
      throw err;
    }
    // Stop counts only while the package is being copied: once the console's installer has it, it cannot be stopped.
    let phase: string | null = null;
    const end = await watchOp(job, {
      stopped: () => stopped() && installStoppable(phase),
      onStatus: (s) => {
        phase = s.message;
        patch({
          task: {
            key: "install",
            text: `${installPhaseText(s.message) ?? t("cw_pkg_phase_starting")} · ${pct(s.bytes_done, s.bytes_total)}%`,
            stoppable: installStoppable(s.message),
          },
        });
      },
    });
    const line = installMessage(end, name, errorText);
    patch({ task: null, message: line ?? lib.message });
  } catch (err) {
    if (err instanceof ApiError && err.code === "cancelled") patch({ task: null, message: { tone: "info", text: t("cw_pkg_stopped") } });
    else patch({ task: null, message: installMessage({ end: "error", error: err }, name, failText) ?? lib.message });
  }
}

async function copy(e: Entry, drive: string): Promise<void> {
  if (lib.task) return;
  stopAsked = false;
  const name = displayName(e);
  patch({ message: null, task: { key: "copy", text: t("cw_lib_copying", { name, pct: 0, size: formatBytes(e.size) }), stoppable: true } });
  const dest = copyDest(drive, e);
  try {
    await call("/api/fs/mkdir", { path: dest.slice(0, dest.lastIndexOf("/")) });
    await copyIn(e.at, dest, name);
    patch({
      task: null,
      ...(e.kind === "folder" ? { copied: { key: e.key, path: dest } } : {}),
      message: { tone: "info", text: t(e.kind === "folder" ? "cw_lib_copied_folder" : "cw_lib_copied", { path: dest }) },
    });
  } catch (err) {
    let message: Message;
    if (err instanceof ApiError && err.code === "cancelled") message = { tone: "info", text: t("cw_lib_copy_stopped") };
    else if (err instanceof ApiError && err.code === "exists") message = { tone: "error", text: t("cw_lib_err_exists", { path: dest }) };
    else message = { tone: "error", text: failText(err) };
    patch({ task: null, message });
  }
}

async function register(path: string, name: string): Promise<void> {
  if (lib.task) return;
  patch({ task: { key: "register", text: t("cw_lib_registering", { name }), stoppable: false } });
  try {
    await call("/api/apps/register", { path });
    patch({ task: null, message: { tone: "info", text: t("cw_lib_registered", { name }) } });
  } catch (err) {
    patch({ task: null, message: { tone: "error", text: failText(err) || (err instanceof ApiError ? err.code : String(err)) } });
  }
}

/** The Library section: games on the saved shares and this console's drives, installed or copied from the controller. */
export function Library({ scan = false }: { scan?: boolean } = {}) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Entry | null>(null);
  const [drives, setDrives] = useState<Volume[]>([]);
  const live = useRef(true);
  const root = useRef<HTMLDivElement>(null);

  // Opened to scan (a USB drive just connected): start one, unless one is running already.
  useEffect(() => {
    if (scan && !lib.task) void scanAll();
  }, [scan]);

  useEffect(() => {
    live.current = true;
    listeners.add(bump);
    // A scan running keeps the store current itself; otherwise read the cache again (a share may have been added).
    if (lib.task?.key !== "scan") void load();
    return () => {
      live.current = false;
      listeners.delete(bump);
    };
  }, []);

  useEffect(
    () =>
      onNavAction(
        (a) => {
          if (a === "refresh" && lib.task?.key !== "scan") void load();
          return false;
        },
        () => root.current,
      ),
    [],
  );

  const openEntry = useCallback((e: Entry | null) => {
    setOpen(e);
    if (e && e.source !== CONSOLE_SOURCE && e.kind !== "pkg")
      void call<{ volumes?: unknown }>("/api/volumes").then(
        (r) => live.current && setDrives((Array.isArray(r.volumes) ? (r.volumes as Volume[]) : []).filter((v) => isDrive(v) && v.writable)),
        () => setDrives([]),
      );
  }, []);

  return (
    <div ref={root}>
      <LibraryView
        sources={lib.sources}
        scans={lib.scans}
        loaded={lib.loaded}
        query={query}
        task={lib.task}
        message={lib.message}
        open={open}
        drives={drives}
        copied={lib.copied}
        onQuery={setQuery}
        onScan={() => void scanAll()}
        onStop={() => {
          stopAsked = true;
        }}
        onOpen={openEntry}
        onInstall={(e) => void install(e)}
        onCopy={(e, d) => void copy(e, d)}
        onRegister={(path, name) => void register(path, name)}
      />
    </div>
  );
}
