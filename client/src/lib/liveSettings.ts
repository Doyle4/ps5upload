// Settings that change underneath the app (8.1.1): a sync writes a setting another device changed
// straight into storage, and the store that owns it re-reads it here, so the change shows at once
// with no "reload to apply". Without this the running app kept its old value in memory (and in
// settings.json, which the next start copied back into storage as if the user had changed it):
// the old value then synced out again and the two devices traded it back and forth.

type Reload = () => void;

const reloaders = new Map<string, Reload>();

/** `reload` re-reads `keys` from storage into its store (setState only, never a storage write).
 *  A key read fresh wherever it is used registers a no-op: storage already holds the new value. */
export function registerSettingReload(keys: readonly string[], reload: Reload): void {
  for (const k of keys) reloaders.set(k, reload);
}

/** Re-reads `keys` in their stores. Returns the keys no store claims (they need a reload). */
export function reloadSettings(keys: readonly string[]): string[] {
  const done = new Set<Reload>();
  const unclaimed: string[] = [];
  for (const k of keys) {
    const r = reloaders.get(k);
    if (!r) {
      unclaimed.push(k);
      continue;
    }
    if (done.has(r)) continue;
    done.add(r);
    try {
      r();
    } catch (e) {
      console.warn("[live-settings]", k, e instanceof Error ? e.message : e);
      unclaimed.push(k);
    }
  }
  return unclaimed;
}

/** Keys read fresh at each use (screens and helpers that call safeGetItem when they need it). */
export const NOOP_RELOAD: Reload = () => {};
