/**
 * Pinned folders, recent folders and the last folder shown: kept on the
 * console (the helper's files-prefs.json, payload/src/files_prefs.c), so the
 * PC app can show the same lists. Every change answers the whole new prefs.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, call } from "../api";

export interface FilesPrefs {
  favorites: string[];
  recent: string[];
  last: string | null;
}

export const EMPTY_PREFS: FilesPrefs = { favorites: [], recent: [], last: null };

export type PrefsOp = "pin" | "unpin" | "visit";

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.startsWith("/")) : [];

/** The helper's answer as prefs (anything unexpected reads as empty). */
export function toPrefs(raw: unknown): FilesPrefs {
  if (!raw || typeof raw !== "object") return EMPTY_PREFS;
  const r = raw as Record<string, unknown>;
  return {
    favorites: strings(r.favorites),
    recent: strings(r.recent),
    last: typeof r.last === "string" && r.last.startsWith("/") ? r.last : null,
  };
}

export async function loadPrefs(): Promise<FilesPrefs> {
  return toPrefs(await call<unknown>("/api/files/prefs"));
}

export async function changePrefs(op: PrefsOp, path: string): Promise<FilesPrefs> {
  return toPrefs(await call<unknown>("/api/files/prefs/set", { op, path }));
}

/** A path as the helper stores it: '//' collapsed, no trailing '/' (except "/"). */
export function cleanPath(p: string): string {
  const c = p.replace(/\/{2,}/g, "/");
  return c.length > 1 ? c.replace(/\/$/, "") : c;
}

export function isPinned(prefs: FilesPrefs | null, path: string | null): boolean {
  return !!prefs && path != null && prefs.favorites.includes(cleanPath(path));
}

export interface PrefsState {
  /** null until the first answer (or when the helper has no prefs routes: then it stays null). */
  prefs: FilesPrefs | null;
  /** The first read has finished (answered or failed). */
  settled: boolean;
  pin: (path: string) => Promise<void>;
  unpin: (path: string) => Promise<void>;
  visit: (path: string) => void;
}

/**
 * The prefs for Files. pin/unpin reject with the helper's error (the caller
 * says so); a visit is fire-and-forget (a missed one only loses a recent entry).
 * A helper without the routes (404) leaves prefs null: Files then simply shows
 * no Pinned / Recent lists.
 */
export function usePrefs(): PrefsState {
  const [prefs, setPrefs] = useState<FilesPrefs | null>(null);
  const [settled, setSettled] = useState(false);
  const live = useRef(true);
  /** False once the helper said it has no prefs routes. */
  const supported = useRef(true);

  useEffect(() => {
    live.current = true;
    loadPrefs().then(
      (p) => {
        if (!live.current) return;
        setPrefs(p);
        setSettled(true);
      },
      (e: unknown) => {
        if (e instanceof ApiError && e.status === 404) supported.current = false;
        if (live.current) setSettled(true);
      },
    );
    return () => {
      live.current = false;
    };
  }, []);

  const apply = useCallback(async (op: PrefsOp, path: string) => {
    const p = await changePrefs(op, path);
    if (live.current) setPrefs(p);
  }, []);

  const pin = useCallback((path: string) => apply("pin", path), [apply]);
  const unpin = useCallback((path: string) => apply("unpin", path), [apply]);
  const visit = useCallback(
    (path: string) => {
      if (!supported.current) return;
      apply("visit", path).catch(() => undefined);
    },
    [apply],
  );
  return { prefs, settled, pin, unpin, visit };
}
