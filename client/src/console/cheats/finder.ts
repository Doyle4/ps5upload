/**
 * Find cheats: the running game's cheat files in the community repos (read by the PS5 browser,
 * repos.ts), its installed version from the helper (/api/cheats/version), and a download that
 * fetches the file in the browser and hands it to the helper (/api/cheats/store), which puts it
 * where the cheat engine looks. Kept out of React so tests drive it directly.
 */
import { ApiError, call, callRaw, isOffline } from "../api";
import { t } from "../strings";
import {
  downloadCheat,
  entriesFor,
  rankEntries,
  RepoError,
  repoIndex,
  storeFormat,
  type CheatEntry,
  type FetchLike,
  type RepoIndex,
} from "./repos";

export type FinderMessage = { tone: "error" | "info"; text: string };

export type FinderState =
  | { kind: "closed" }
  | { kind: "loading"; title: string }
  | { kind: "offline"; title: string }
  | {
      kind: "list";
      title: string;
      /** The installed version, or null when the helper could not say (every version is listed). */
      version: string | null;
      /** Best first (rankEntries). */
      entries: CheatEntry[];
      /** Some repos could not be read. */
      partial: boolean;
      /** The file being downloaded, or null. */
      busy: string | null;
      /** Files downloaded while the finder was open. */
      done: string[];
      message: FinderMessage | null;
    };

export const FINDER_CLOSED: FinderState = { kind: "closed" };

export interface FinderDeps {
  index?: () => Promise<RepoIndex>;
  fetch?: FetchLike;
}

export interface Finder {
  /** Look for `titleId`'s cheats (the repos are read once per page session). */
  open(titleId: string): Promise<void>;
  close(): void;
  /** Download `entry` and store it on the console; ignored while another one runs. */
  download(entry: CheatEntry): Promise<void>;
  get(): FinderState;
}

/** The game's installed version from the helper; null when it does not know (or cannot be asked). */
export async function readVersion(titleId: string): Promise<string | null> {
  try {
    const r = await call<{ version?: unknown }>("/api/cheats/version", { title_id: titleId });
    return r && typeof r.version === "string" && r.version ? r.version : null;
  } catch {
    return null;
  }
}

/** A failed download or store as one line; null for a 401 (the reload banner says it). */
export function downloadErrorText(err: unknown, name: string): string | null {
  if (err instanceof RepoError) {
    if (err.network) return t("cw_cheats_find_offline");
    if (err.message === "too_large") return t("cw_cheats_find_too_large", { name });
    return t("cw_cheats_find_err_download", { name, code: err.message });
  }
  if (err instanceof ApiError) {
    if (err.status === 401) return null;
    if (isOffline(err)) return t("cw_home_err_offline");
    if (err.code === "too_large") return t("cw_cheats_find_too_large", { name });
    return t("cw_cheats_find_err_store", { name, code: err.code });
  }
  return t("cw_cheats_find_err_download", { name, code: err instanceof Error ? err.message : String(err) });
}

/** The helper route that stores `entry` (its name passed as is: only [A-Za-z0-9._-] are listed). */
export function storeRoute(entry: CheatEntry): string {
  return `/api/cheats/store?format=${storeFormat(entry.filename)}&name=${encodeURIComponent(entry.filename)}`;
}

/**
 * The finder's state machine. `onStored` runs after a file is on the console (the section reads
 * the game's cheats again and closes the finder).
 */
export function createFinder(
  onChange: (s: FinderState) => void,
  onStored: (entry: CheatEntry, title: string) => void,
  deps: FinderDeps = {},
): Finder {
  let s: FinderState = FINDER_CLOSED;
  /** Every open gets a number: an older one's answer never lands on a newer finder. */
  let seq = 0;
  const set = (next: FinderState) => {
    s = next;
    onChange(s);
  };
  const index = deps.index ?? (() => repoIndex(deps.fetch));

  return {
    async open(titleId) {
      const mine = ++seq;
      set({ kind: "loading", title: titleId });
      let idx: RepoIndex;
      let version: string | null;
      try {
        [idx, version] = await Promise.all([index(), readVersion(titleId)]);
      } catch {
        if (mine === seq) set({ kind: "offline", title: titleId });
        return;
      }
      if (mine !== seq) return;
      if (idx.offline) {
        set({ kind: "offline", title: titleId });
        return;
      }
      set({
        kind: "list",
        title: titleId,
        version,
        entries: rankEntries(entriesFor(idx, titleId), version),
        partial: idx.failed.length > 0,
        busy: null,
        done: [],
        message: null,
      });
    },
    close() {
      seq++;
      set(FINDER_CLOSED);
    },
    async download(entry) {
      if (s.kind !== "list" || s.busy !== null) return;
      const mine = seq;
      const title = s.title;
      set({ ...s, busy: entry.filename, message: null });
      const still = () => mine === seq && s.kind === "list";
      try {
        const bytes = await downloadCheat(entry, deps.fetch);
        await callRaw<unknown>(storeRoute(entry), new Blob([bytes], { type: "application/octet-stream" }));
      } catch (e) {
        if (still() && s.kind === "list") {
          const text = downloadErrorText(e, entry.filename);
          set({ ...s, busy: null, message: text ? { tone: "error", text } : null });
        }
        return;
      }
      if (still() && s.kind === "list") {
        set({
          ...s,
          busy: null,
          done: s.done.includes(entry.filename) ? s.done : [...s.done, entry.filename],
          message: { tone: "info", text: t("cw_cheats_find_saved", { name: entry.filename }) },
        });
      }
      onStored(entry, title);
    },
    get: () => s,
  };
}
