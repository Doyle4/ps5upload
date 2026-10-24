// The cheat collection's index, fetched once per session and shared: the Cheats screen lists
// it, and the Collection marks the games it has cheats for.
//
// ~11k lines across the repos, served from the engine's cache in well under a second, and it
// changes about as often as somebody publishes a cheat, so fetching it once is enough.

import { useEffect, useState } from "react";

import { cheatsReposSearch, type CheatRepoEntry } from "../api/ps5";

let entries: CheatRepoEntry[] | null = null;
let pending: Promise<CheatRepoEntry[]> | null = null;

/** The index, from the session's copy once there is one. Rejects when it can't be fetched
 *  (offline, a repo down); the next call tries again. */
export function loadCheatIndex(): Promise<CheatRepoEntry[]> {
  if (entries) return Promise.resolve(entries);
  pending ??= cheatsReposSearch("")
    .then((r) => {
      entries = r.entries ?? [];
      return entries;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** The index already fetched this session, or null. */
export function cachedCheatIndex(): CheatRepoEntry[] | null {
  return entries;
}

/** Title IDs (upper case) the index has cheats for. */
export function cheatTitleIds(list: CheatRepoEntry[]): Set<string> {
  const out = new Set<string>();
  for (const e of list) if (e.title_id) out.add(e.title_id.toUpperCase());
  return out;
}

/** The title IDs with cheats, once the index is in; null before, or when it can't be read. */
export function useCheatTitleIds(enabled = true): Set<string> | null {
  const [ids, setIds] = useState<Set<string> | null>(() =>
    entries ? cheatTitleIds(entries) : null,
  );
  useEffect(() => {
    if (!enabled || ids) return;
    let live = true;
    loadCheatIndex()
      .then((list) => live && setIds(cheatTitleIds(list)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [enabled, ids]);
  return ids;
}
