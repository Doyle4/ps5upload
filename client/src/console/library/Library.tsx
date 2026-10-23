import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, Gamepad2, HousePlus, RefreshCw, Search, Square, X } from "lucide-react";
import { formatBytes } from "../../lib/format";
import { ApiError, call } from "../api";
import { errorText, isDrive, volumeLabel, type Message, type Volume } from "../home/Home";
import { installMessage, installPhaseText, kindText } from "../files/pkg";
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

/** A running scan, copy or install: what the page shows, and how to stop it. */
interface Task {
  key: string;
  text: string;
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
          {busy ? (
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
        {p.task && !p.open ? (
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

/** The Library section: games on the saved shares and this console's drives, installed or copied from the controller. */
export function Library() {
  const [sources, setSources] = useState<LibSource[]>([{ id: CONSOLE_SOURCE, name: t("cw_lib_this_console") }]);
  const [scans, setScans] = useState<Map<string, LibScan | null>>(() => new Map());
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [task, setTask] = useState<Task | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [open, setOpen] = useState<Entry | null>(null);
  const [drives, setDrives] = useState<Volume[]>([]);
  const [copied, setCopied] = useState<{ key: string; path: string } | null>(null);
  const stop = useRef(false);
  const live = useRef(true);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      stop.current = true;
    };
  }, []);

  const load = useCallback(async () => {
    let list: LibSource[] = [{ id: CONSOLE_SOURCE, name: t("cw_lib_this_console") }];
    try {
      list = list.concat((await listShares()).map((s) => ({ id: s.id, name: s.name })));
    } catch {
      // No shares readable: this console only.
    }
    const next = new Map<string, LibScan | null>();
    for (const s of list) {
      try {
        next.set(s.id, await readScan(s.id));
      } catch {
        next.set(s.id, null);
      }
    }
    if (!live.current) return;
    setSources(list);
    setScans(next);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () =>
      onNavAction(
        (a) => {
          if (a === "refresh") void load();
          return false;
        },
        () => root.current,
      ),
    [load],
  );

  const stopped = useCallback(() => stop.current || !live.current, []);

  const scanAll = useCallback(async () => {
    if (task) return;
    stop.current = false;
    setMessage(null);
    const failed: string[] = [];
    let list = sources;
    try {
      // the shares as they are now (one may have been added in Files or from the PC since)
      list = [{ id: CONSOLE_SOURCE, name: t("cw_lib_this_console") }, ...(await listShares()).map((s) => ({ id: s.id, name: s.name }))];
      if (live.current) setSources(list);
    } catch {
      // keep the list we have
    }
    for (const s of list) {
      if (stopped()) break;
      setTask({ key: "scan", text: t("cw_lib_scanning", { name: s.name, n: 0 }) });
      try {
        const job = await startScan(s.id);
        const end = await watchSmbJob(job, {
          stopped,
          onStatus: (st: SmbJob) => live.current && setTask({ key: "scan", text: t("cw_lib_scanning", { name: s.name, n: st.files_total }) }),
        });
        if (end.end === "failed") failed.push(`${s.name}: ${failText(new ApiError(502, end.status.error ?? "io_error"))}`);
        const scan = await readScan(s.id);
        if (live.current) setScans((m) => new Map(m).set(s.id, scan));
      } catch (e) {
        failed.push(`${s.name}: ${failText(e)}`);
      }
    }
    if (!live.current) return;
    setTask(null);
    if (failed.length) setMessage({ tone: "error", text: t("cw_lib_scan_failed", { list: failed.join(" · ") }) });
  }, [sources, task, stopped]);

  const openEntry = useCallback((e: Entry | null) => {
    setOpen(e);
    if (e && e.source !== CONSOLE_SOURCE && e.kind !== "pkg")
      void call<{ volumes?: unknown }>("/api/volumes").then(
        (r) => live.current && setDrives((Array.isArray(r.volumes) ? (r.volumes as Volume[]) : []).filter((v) => isDrive(v) && v.writable)),
        () => setDrives([]),
      );
  }, []);

  /** Copies `src` (on a share) to `dest`; true when it finished. */
  const copyIn = useCallback(async (src: string, dest: string, name: string): Promise<boolean> => {
    const { job } = await call<{ job: string }>("/api/smb/copy", { src, dest });
    const end = await watchSmbJob(job, {
      stopped,
      onStatus: (st) =>
        live.current &&
        setTask({ key: "copy", text: t("cw_lib_copying", { name, pct: pct(st.bytes_done, st.bytes_total), size: formatBytes(st.bytes_total) }) }),
    });
    if (end.end === "done") return true;
    if (end.end === "cancelled") throw new ApiError(409, "cancelled");
    if (end.end === "gone") throw new ApiError(502, "smb_job_lost");
    throw new ApiError(502, end.status.error ?? "io_error");
  }, [stopped]);

  const onInstall = useCallback(
    async (e: Entry) => {
      if (task) return;
      stop.current = false;
      setMessage(null);
      const name = displayName(e);
      let path = e.at;
      let staged = false;
      try {
        if (e.source !== CONSOLE_SOURCE) {
          await call("/api/fs/mkdir", { path: STAGE_DIR });
          path = stagePath();
          staged = true;
          await copyIn(e.at, path, name);
        }
        setTask({ key: "install", text: t("cw_pkg_phase_starting") });
        let job: string;
        try {
          const r = await call<{ job: string }>("/api/pkg/install", staged ? { path, remove_after: true } : { path });
          job = r.job;
        } catch (err) {
          // refused before it started: the copy is ours to remove
          if (staged) await call("/api/fs/delete", { path }).catch(() => undefined);
          throw err;
        }
        const end = await watchOp(job, {
          onStatus: (s) =>
            live.current &&
            setTask({ key: "install", text: `${installPhaseText(s.message) ?? t("cw_pkg_phase_starting")} · ${pct(s.bytes_done, s.bytes_total)}%` }),
        });
        const line = installMessage(end, name, errorText);
        if (line && live.current) setMessage(line);
      } catch (err) {
        if (!live.current) return;
        if (err instanceof ApiError && err.code === "cancelled") setMessage({ tone: "info", text: t("cw_pkg_stopped") });
        else {
          const line = installMessage({ end: "error", error: err }, name, failText);
          if (line) setMessage(line);
        }
      } finally {
        if (live.current) setTask(null);
      }
    },
    [task, copyIn],
  );

  const onCopy = useCallback(
    async (e: Entry, drive: string) => {
      if (task) return;
      stop.current = false;
      setMessage(null);
      const dest = copyDest(drive, e);
      try {
        await call("/api/fs/mkdir", { path: dest.slice(0, dest.lastIndexOf("/")) });
        await copyIn(e.at, dest, displayName(e));
        if (!live.current) return;
        if (e.kind === "folder") setCopied({ key: e.key, path: dest });
        setMessage({ tone: "info", text: t(e.kind === "folder" ? "cw_lib_copied_folder" : "cw_lib_copied", { path: dest }) });
      } catch (err) {
        if (!live.current) return;
        if (err instanceof ApiError && err.code === "cancelled") setMessage({ tone: "info", text: t("cw_lib_copy_stopped") });
        else if (err instanceof ApiError && err.code === "exists") setMessage({ tone: "error", text: t("cw_lib_err_exists", { path: dest }) });
        else setMessage({ tone: "error", text: failText(err) });
      } finally {
        if (live.current) setTask(null);
      }
    },
    [task, copyIn],
  );

  const onRegister = useCallback(
    async (path: string, name: string) => {
      if (task) return;
      setTask({ key: "register", text: t("cw_lib_registering", { name }) });
      try {
        await call("/api/apps/register", { path });
        if (live.current) setMessage({ tone: "info", text: t("cw_lib_registered", { name }) });
      } catch (err) {
        if (live.current) setMessage({ tone: "error", text: failText(err) || (err instanceof ApiError ? err.code : String(err)) });
      } finally {
        if (live.current) setTask(null);
      }
    },
    [task],
  );

  return (
    <div ref={root}>
      <LibraryView
        sources={sources}
        scans={scans}
        loaded={loaded}
        query={query}
        task={task}
        message={message}
        open={open}
        drives={drives}
        copied={copied}
        onQuery={setQuery}
        onScan={() => void scanAll()}
        onStop={() => {
          stop.current = true;
        }}
        onOpen={openEntry}
        onInstall={(e) => void onInstall(e)}
        onCopy={(e, d) => void onCopy(e, d)}
        onRegister={(path, name) => void onRegister(path, name)}
      />
    </div>
  );
}
