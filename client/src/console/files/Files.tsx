import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, FolderPlus, RotateCw, Square } from "lucide-react";
import { formatBytes } from "../../lib/format";
import { ApiError, call } from "../api";
import { errorText, type Message, type Volume } from "../home/Home";
import { useJobs, type Job } from "../home/useJobs";
import { jobPercent } from "../home/TaskRow";
import { useBackLevel } from "../backHistory";
import { onNavAction, topModal } from "../nav";
import type { SectionContext } from "../sections";
import { t } from "../strings";
import { ActionsButton } from "../ui/ActionsButton";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { anchorOf, focusLost, restoreFocus, type FocusAnchor } from "../ui/restoreFocus";
import { SelectToggle } from "../ui/SelectToggle";
import { ActionsSheet, type SheetAction } from "./ActionsSheet";
import { DirList, viewKind } from "./DirList";
import { DriveList } from "./DriveList";
import { InfoDialog } from "./InfoDialog";
import {
  copyItems,
  deleteItems,
  joinPath,
  moveItems,
  baseName,
  renameEntry,
  upFrom,
  volumeOf,
  IntoItselfError,
  type BatchOptions,
  type BatchResult,
} from "./move";
import { currentBatch, startBatch, stopBatch, useBatch, waitJob, type BatchProgress } from "./batch";
import { PathPicker } from "./PathPicker";
import { TextPrompt } from "./TextPrompt";
import { useDir, type DirState, type Entry } from "./useDir";
import { Viewer } from "./Viewer";

export { upFrom, viewKind };

/** An action's result line clears itself after this long. */
const MESSAGE_MS = 8_000;

/** The modal Files has open, if any. Names are entries of the folder shown. */
export type FilesAsk =
  | { kind: "sheet"; names: string[] }
  | { kind: "delete"; names: string[] }
  | { kind: "rename"; name: string }
  | { kind: "mkdir" }
  | { kind: "pick"; op: "copy" | "move"; names: string[] }
  | { kind: "info"; name: string }
  | { kind: "view"; name: string; type: "image" | "text" };

/** The copy/move/delete batch running now (one item at a time, see batch.ts). */
export type Busy = BatchProgress;

/** The line a finished batch leaves: what failed, what a stop left out, else "Done." */
export function batchMessage(r: BatchResult): Message | null {
  if (r.failed.length) {
    const why = filesErrorText(r.failed[0].error);
    return why ? { tone: "error", text: t("cw_files_some_failed", { n: r.failed.length, reason: why }) } : null;
  }
  if (r.jobFailed.length) return { tone: "error", text: t("cw_files_batch_failed", { n: r.jobFailed.length }) };
  if (r.skipped.length) return { tone: "info", text: t("cw_files_batch_stopped", { n: r.skipped.length }) };
  return { tone: "info", text: t("cw_files_done") };
}

/** A failed call as a short line; null for a 401 (the reload banner says it). */
export function filesErrorText(err: unknown): string | null {
  if (err instanceof ApiError) {
    if (err.status === 403) return t("cw_files_err_denied");
    if (err.status === 404) return t("cw_files_err_missing");
    // 409 is "exists" or "busy" (and cross_mount, handled by moveItems): only an
    // "exist…" code says the name is taken.
    if (err.status === 409 && /exist/i.test(err.code)) return t("cw_files_err_exists");
  }
  if (err instanceof IntoItselfError) return t("cw_files_err_into_itself");
  return errorText(err);
}

export interface FilesViewProps {
  /** The folder shown; null = the drive list. */
  path: string | null;
  volumes: Volume[] | null;
  volumesError: boolean;
  dir: DirState;
  selecting: boolean;
  selected: string[];
  ask: FilesAsk | null;
  busy: Busy | null;
  message: Message | null;
  /** Running jobs this page started (copies, moves, deletes). */
  tasks: Job[];
  /** Stop the running batch before its next item. */
  onStopBatch?: () => void;
  onOpen: (path: string | null) => void;
  onUp: () => void;
  onEntry: (e: Entry) => void;
  onLoadMore: () => void;
  onRetry?: () => void;
  onToggleSelecting: () => void;
  onToggleItem: (name: string) => void;
  onAsk: (ask: FilesAsk) => void;
  onDismiss: () => void;
  onConfirmDelete: (names: string[]) => void;
  onRename: (name: string, newName: string) => void;
  onMkdir: (name: string) => void;
  onPicked: (op: "copy" | "move", names: string[], destDir: string) => void;
}

/** "Copying 3 of 40" (item `at` is being sent or is running), or "Stopping…". */
export function busyText(b: Busy | null): string | null {
  if (!b) return null;
  if (b.stopping) return t("cw_files_batch_stopping");
  const at = Math.max(1, b.at);
  if (b.op === "copy") return t("cw_files_batch_copy", { at, total: b.total });
  if (b.op === "move") return t("cw_files_batch_move", { at, total: b.total });
  return t("cw_files_batch_delete", { at, total: b.total });
}

/** What the sheet offers for `names` (one entry, or the selection). */
function sheetActions(names: string[], entries: Entry[]): SheetAction[] {
  if (names.length !== 1) return ["copy", "move", "delete"];
  const e = entries.find((x) => x.name === names[0]);
  const out: SheetAction[] = [];
  if (e && e.kind !== "dir" && viewKind(e.name)) out.push("view");
  out.push("copy", "move", "rename", "mkdir", "info", "delete");
  return out;
}

function namesTitle(names: string[]): string {
  return names.length === 1 ? names[0] : t("cw_files_items", { n: names.length });
}

/** The modal for `p.ask` (a plain call, not a component: tests read its props). */
function askView(p: FilesViewProps) {
  const a = p.ask;
  if (!a || p.path == null) return null;
  const path = p.path;
  switch (a.kind) {
    case "sheet":
      return (
        <ActionsSheet
          title={namesTitle(a.names)}
          actions={sheetActions(a.names, p.dir.entries)}
          busy={p.busy != null}
          note={busyText(p.busy)}
          onClose={p.onDismiss}
          onChoose={(act) => {
            const name = a.names[0];
            switch (act) {
              case "view": {
                const type = viewKind(name);
                if (type) p.onAsk({ kind: "view", name, type });
                return;
              }
              case "copy":
              case "move":
                return p.onAsk({ kind: "pick", op: act, names: a.names });
              case "rename":
                return p.onAsk({ kind: "rename", name });
              case "mkdir":
                return p.onAsk({ kind: "mkdir" });
              case "info":
                return p.onAsk({ kind: "info", name });
              case "delete":
                return p.onAsk({ kind: "delete", names: a.names });
            }
          }}
        />
      );
    case "delete": {
      const one = a.names.length === 1;
      const body = one
        ? t("cw_files_del_body")
        : `${t("cw_files_del_list_many", { name: a.names[0], more: a.names.length - 1 })} ${t("cw_files_del_body")}`;
      return (
        <ConfirmDialog
          title={one ? t("cw_files_del_one", { name: a.names[0] }) : t("cw_files_del_many", { n: a.names.length })}
          body={busyText(p.busy) ?? body}
          confirmLabel={t("cw_files_delete")}
          danger
          busy={p.busy != null}
          onConfirm={() => p.onConfirmDelete(a.names)}
          onCancel={p.onDismiss}
        />
      );
    }
    case "rename":
      return (
        <TextPrompt
          title={t("cw_files_rename")}
          initial={a.name}
          onSubmit={(v) => p.onRename(a.name, v)}
          onCancel={p.onDismiss}
        />
      );
    case "mkdir":
      return (
        <TextPrompt title={t("cw_files_new_folder")} initial="" onSubmit={p.onMkdir} onCancel={p.onDismiss} />
      );
    case "pick":
      return (
        <PathPicker
          title={t(a.op === "copy" ? "cw_files_copy_to" : "cw_files_move_to")}
          subtitle={namesTitle(a.names)}
          volumes={p.volumes ?? []}
          start={path}
          onPick={(d) => p.onPicked(a.op, a.names, d)}
          onCancel={p.onDismiss}
        />
      );
    case "info":
      return <InfoDialog dir={path} name={a.name} path={joinPath(path, a.name)} onClose={p.onDismiss} />;
    case "view":
      return (
        <Viewer
          path={joinPath(path, a.name)}
          name={a.name}
          kind={a.type}
          size={p.dir.entries.find((e) => e.name === a.name)?.size}
          onClose={p.onDismiss}
        />
      );
  }
}

function TasksLine({ tasks }: { tasks: Job[] }) {
  if (!tasks.length) return null;
  const pcts = tasks.map(jobPercent).filter((x): x is number => x != null);
  const pct = pcts.length ? Math.floor(pcts.reduce((s, x) => s + x, 0) / pcts.length) : null;
  return (
    <div className="cw-msg" role="status">
      {t("cw_files_tasks", { n: tasks.length })}
      {pct != null ? ` · ${t("cw_home_percent", { n: pct })}` : ""}
      <div className="cw-bar" aria-hidden>
        <div className={`cw-bar-fill${pct == null ? " is-unknown" : ""}`} style={{ width: `${pct ?? 100}%` }} />
      </div>
    </div>
  );
}

/** Files without state: everything comes in through props (tests call it directly). */
export function FilesView(p: FilesViewProps) {
  const vol = p.path != null && p.volumes ? volumeOf(p.path, p.volumes) : null;
  const status = busyText(p.busy);
  return (
    <div className="cw-files-screen">
      <h1 className="cw-h1">{t("cw_nav_files")}</h1>
      {p.message ? (
        <div className={`cw-msg is-${p.message.tone}`} role={p.message.tone === "error" ? "alert" : "status"}>
          {p.message.text}
        </div>
      ) : null}
      {status ? (
        <div className="cw-msg" role="status">
          {status}
          {p.onStopBatch && p.busy && !p.busy.stopping && p.busy.total > 1 ? (
            <button
              type="button"
              className="cw-focusable cw-button cw-msg-action"
              data-action="stop-batch"
              onClick={p.onStopBatch}
            >
              <Square aria-hidden />
              <span>{t("cw_files_batch_stop")}</span>
            </button>
          ) : null}
        </div>
      ) : null}
      <TasksLine tasks={p.tasks} />

      {p.path == null ? (
        <DriveList volumes={p.volumes} error={p.volumesError} onOpen={p.onOpen} />
      ) : (
        <>
          <div className="cw-toolbar">
            <button type="button" className="cw-focusable cw-button" data-action="up" onClick={p.onUp}>
              <ArrowUp aria-hidden />
              <span>{t("cw_files_up")}</span>
            </button>
            <div className="cw-toolbar-path">
              <div className="cw-path cw-mono">{p.path}</div>
              {vol ? <div className="cw-dim">{t("cw_files_free", { free: formatBytes(vol.free_bytes) })}</div> : null}
            </div>
            <button
              type="button"
              className="cw-focusable cw-button"
              data-action="mkdir"
              onClick={() => p.onAsk({ kind: "mkdir" })}
            >
              <FolderPlus aria-hidden />
              <span>{t("cw_files_new_folder")}</span>
            </button>
            <SelectToggle on={p.selecting} onToggle={p.onToggleSelecting} />
            {p.selecting && p.selected.length ? (
              <>
                <span className="cw-tag">{t("cw_files_selected", { n: p.selected.length })}</span>
                <ActionsButton onPress={() => p.onAsk({ kind: "sheet", names: p.selected })} />
              </>
            ) : null}
          </div>

          {p.dir.error && !p.dir.loading ? (
            <div className="cw-msg is-error" role="alert">
              {filesErrorText(p.dir.error) ?? t("cw_files_err_load")}
              {p.onRetry ? (
                <button type="button" className="cw-focusable cw-button cw-msg-action" onClick={p.onRetry}>
                  <RotateCw aria-hidden />
                  <span>{t("cw_files_retry")}</span>
                </button>
              ) : null}
            </div>
          ) : null}
          {!p.dir.loaded && !p.dir.error ? <p className="cw-dim">{t("cw_home_loading")}</p> : null}
          {p.dir.loaded && !p.dir.entries.length && !p.dir.more ? (
            <p className="cw-dim">{t("cw_files_empty")}</p>
          ) : null}
          <DirList
            entries={p.dir.entries}
            selecting={p.selecting}
            selected={p.selected}
            onEntry={p.onEntry}
            onToggleItem={p.onToggleItem}
            onActions={(name) => p.onAsk({ kind: "sheet", names: [name] })}
            label={p.path}
          />
          {p.dir.more ? (
            // Reaching it with the D-pad reads the next page: big folders load as you scroll.
            <button
              type="button"
              className="cw-focusable cw-button cw-more"
              data-action="more"
              onFocus={p.onLoadMore}
              onClick={p.onLoadMore}
            >
              <span>{p.dir.loading ? t("cw_home_loading") : t("cw_files_more")}</span>
            </button>
          ) : null}
        </>
      )}
      {askView(p)}
    </div>
  );
}

/* ---- the section ---- */

function useVolumes(path: string | null): { volumes: Volume[] | null; error: boolean } {
  const [volumes, setVolumes] = useState<Volume[] | null>(null);
  const [error, setError] = useState(false);
  const atDrives = path == null;
  // Read on open and each time the drive list shows again (free space moves).
  useEffect(() => {
    let live = true;
    call<{ volumes?: unknown }>("/api/volumes").then(
      (r) => {
        if (!live) return;
        setVolumes(Array.isArray(r?.volumes) ? (r.volumes as Volume[]) : []);
        setError(false);
      },
      () => {
        if (live) setError(true);
      },
    );
    return () => {
      live = false;
    };
  }, [atDrives]);
  return { volumes, error };
}

/** The element under `root` whose `attr` is exactly `value` (compared as-is: no CSS escaping of names). */
function byAttr(root: Element, attr: string, value: string): HTMLElement | null {
  const all = root.querySelectorAll<HTMLElement>(`[${attr}]`);
  for (let i = 0; i < all.length; i++) if (all[i].getAttribute(attr) === value) return all[i];
  return null;
}

/** The Files section: drives → folders, with the actions sheet, select, copy/move, viewer. */
export function Files({ ctx }: { ctx: SectionContext }) {
  const wanted = ctx.params?.path ?? null;
  const [path, setPath] = useState<string | null>(wanted);
  const { volumes, error: volumesError } = useVolumes(path);
  const dir = useDir(path);
  const { jobs } = useJobs();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [ask, setAsk] = useState<FilesAsk | null>(null);
  const busy = useBatch();
  const [message, setMessage] = useState<Message | null>(null);
  const root = useRef<HTMLDivElement>(null);
  /** False once Files unmounts: a batch that ends later reports to no one (it ran to the end anyway). */
  const mounted = useRef(true);
  /** Where focus was last in the list (to put it back when that row goes). */
  const lastAnchor = useRef<FocusAnchor | null>(null);
  /** After the next load, focus this row ("" = the first one), then forget it. */
  const focusName = useRef<string | null>(null);
  /** "Show more" had focus when it read the next page: the row count before it. */
  const afterMore = useRef<number | null>(null);
  const { refresh } = dir;
  // Inside a folder, the browser's Back (○) goes up one level.
  useBackLevel(path != null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  const go = useCallback((next: string | null, focus: string | null = "") => {
    focusName.current = focus;
    lastAnchor.current = null;
    setSelecting(false);
    setSelected([]);
    setPath(next);
  }, []);

  // Home's Browse USB (or any openSection) opens a path: like any folder change,
  // the selection is cleared and focus goes to its first row.
  useEffect(() => {
    if (wanted != null) go(wanted);
  }, [wanted, go]);

  const goUp = useCallback(() => {
    if (path == null) return;
    const up = upFrom(path, volumes ?? []);
    // Focus the folder we came out of (or its drive in the drive list).
    go(up, up == null ? (volumeOf(path, volumes ?? [])?.path ?? "") : baseName(path));
  }, [path, volumes, go]);

  // Focus after a level change, and never lose it when the focused row goes away.
  useEffect(() => {
    const el = root.current;
    if (!el || topModal()) return;
    if (focusName.current != null) {
      if (path != null && !dir.loaded && !dir.error) return; // wait for the first page
      const name = focusName.current;
      focusName.current = null;
      const target =
        (path == null
          ? byAttr(el, "data-drive", name)
          : name
            ? (byAttr(el, "data-entry", name)?.querySelector<HTMLElement>("[data-entry-main]") ?? null)
            : null) ??
        el.querySelector<HTMLElement>("[data-entry-main]") ??
        el.querySelector<HTMLElement>("[data-drive]") ??
        el.querySelector<HTMLElement>('[data-action="up"]');
      if (target) restoreFocus(anchorOf(target));
      return;
    }
    if (afterMore.current != null && !dir.loading) {
      // The page came in under the focused "Show more": carry on down from where
      // the list ended, so holding ↓ keeps scrolling through a big folder.
      const at = afterMore.current;
      afterMore.current = null;
      const rows = el.querySelectorAll<HTMLElement>("[data-entry-main]");
      // ("Show more" itself is gone after the last page: focus was dropped with it.)
      if (rows.length && (focusLost() || document.activeElement?.closest('[data-action="more"]'))) {
        restoreFocus(anchorOf(rows[Math.min(at, rows.length - 1)]));
        return;
      }
    }
    if (lastAnchor.current && focusLost()) restoreFocus(lastAnchor.current);
  }, [path, dir.entries, dir.loaded, dir.loading, dir.error, volumes]);

  const { loadMore } = dir;
  const onLoadMore = useCallback(() => {
    if (document.activeElement?.closest('[data-action="more"]')) afterMore.current = dir.entries.length;
    loadMore();
  }, [loadMore, dir.entries.length]);

  // Each item of a batch ends before the next starts: show the folder as it is now.
  const batchAt = busy?.at ?? 0;
  useEffect(() => {
    if (batchAt > 1) refresh();
  }, [batchAt, refresh]);
  // The page's own jobs still running (a batch's current item, or one a stopped batch left running).
  const tasks = jobs.filter((j) => j.state === "running" && j.mine);

  const report = useCallback(
    (r: BatchResult) => {
      setMessage(batchMessage(r));
      refresh();
    },
    [refresh],
  );

  const onEntry = useCallback(
    (e: Entry) => {
      if (path == null) return;
      if (e.kind === "dir") return go(joinPath(path, e.name));
      const type = viewKind(e.name);
      setAsk(type ? { kind: "view", name: e.name, type } : { kind: "sheet", names: [e.name] });
    },
    [path, go],
  );

  const runBatch = useCallback(
    (op: Busy["op"], names: string[], work: (items: string[], opts: BatchOptions) => Promise<BatchResult>) => {
      if (path == null || currentBatch()) return;
      const items = names.map((n) => joinPath(path, n));
      // The dialog closes at once: the batch runs on (one item at a time) with its progress and Stop
      // in the status line, here and when Files is opened again.
      setAsk(null);
      setMessage(null);
      setSelecting(false);
      setSelected([]);
      const run = startBatch(op, items.length, (ctl) =>
        work(items, { onProgress: ctl.onProgress, stopped: ctl.stopped, waitJob: (id) => waitJob(id, ctl.stopped) }),
      );
      run?.then(
        (r) => {
          if (mounted.current) report(r);
        },
        () => undefined,
      );
    },
    [path, report],
  );

  const onConfirmDelete = useCallback(
    (names: string[]) => runBatch("delete", names, (items, opts) => deleteItems(items, opts)),
    [runBatch],
  );

  const onPicked = useCallback(
    (op: "copy" | "move", names: string[], destDir: string) => {
      setAsk(null);
      runBatch(op, names, (items, opts) => (op === "copy" ? copyItems : moveItems)(items, destDir, opts));
    },
    [runBatch],
  );

  const onRename = useCallback(
    (name: string, newName: string) => {
      setAsk(null);
      if (path == null || newName === name) return;
      renameEntry(path, name, newName).then(
        () => {
          focusName.current = newName;
          refresh();
        },
        (e: unknown) => {
          const text = filesErrorText(e);
          if (text) setMessage({ tone: "error", text });
        },
      );
    },
    [path, refresh],
  );

  const onMkdir = useCallback(
    (name: string) => {
      setAsk(null);
      if (path == null) return;
      call("/api/fs/mkdir", { path: joinPath(path, name) }).then(
        () => {
          focusName.current = name;
          refresh();
        },
        (e: unknown) => {
          const text = filesErrorText(e);
          if (text) setMessage({ tone: "error", text });
        },
      );
    },
    [path, refresh],
  );

  const onToggleItem = useCallback((name: string) => {
    setSelected((s) => (s.includes(name) ? s.filter((x) => x !== name) : s.concat(name)));
  }, []);

  const onToggleSelecting = useCallback(() => {
    setSelecting((on) => !on);
    setSelected([]);
  }, []);

  // ○ up one level, △ actions for the focused row (or the selection), □ select.
  useEffect(
    () =>
      onNavAction((a) => {
        const el = root.current;
        const active = document.activeElement;
        if (!el || !active || !el.contains(active)) return false;
        const row = active.closest("[data-entry]");
        const name = row ? row.getAttribute("data-entry") : null;
        if (a === "back") {
          if (path == null) return false; // the drive list: App takes focus to the rail
          goUp();
          return true;
        }
        if (a === "actions" && path != null) {
          if (selecting && selected.length) setAsk({ kind: "sheet", names: selected });
          else if (name != null) setAsk({ kind: "sheet", names: [name] });
          return true;
        }
        if (a === "select" && path != null) {
          if (!selecting) {
            setSelecting(true);
            setSelected(name != null ? [name] : []);
          } else if (name != null) onToggleItem(name);
          else onToggleSelecting();
          return true;
        }
        return false;
      }),
    [path, selecting, selected, goUp, onToggleItem, onToggleSelecting],
  );

  const onDismiss = useCallback(() => {
    setAsk(null);
  }, []);

  return (
    <div
      ref={root}
      onFocus={(e) => {
        const target = e.target as Element;
        if (!target.closest("[data-nav-modal]")) lastAnchor.current = anchorOf(target);
      }}
    >
      <FilesView
        path={path}
        volumes={volumes}
        volumesError={volumesError}
        dir={dir}
        selecting={selecting}
        selected={selected}
        ask={ask}
        busy={busy}
        message={message}
        tasks={tasks}
        onStopBatch={stopBatch}
        onOpen={(p) => go(p)}
        onUp={goUp}
        onEntry={onEntry}
        onLoadMore={onLoadMore}
        onRetry={refresh}
        onToggleSelecting={onToggleSelecting}
        onToggleItem={onToggleItem}
        onAsk={(a) => {
          setMessage(null);
          setAsk(a);
        }}
        onDismiss={onDismiss}
        onConfirmDelete={onConfirmDelete}
        onRename={onRename}
        onMkdir={onMkdir}
        onPicked={onPicked}
      />
    </div>
  );
}
