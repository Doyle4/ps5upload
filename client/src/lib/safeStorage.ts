/**
 * Safe localStorage wrappers. `localStorage.setItem` throws in several
 * common scenarios:
 *
 *  - Safari Private Mode: quota is 0, every setItem throws QuotaExceededError.
 *  - Storage quota exceeded: large JSON caches (pkg library, activity history,
 *    notifications) can exhaust the ~5 MB origin budget.
 *  - Disabled by browser settings / enterprise policy (rare but seen in
 *    locked-down WebView2 / WebKit deployments).
 *
 * The app uses localStorage purely as a best-effort persistence layer —
 * every value has a built-in default or can be reconstructed from the
 * engine. So a failed write should never crash the UI; it should silently
 * degrade (the next read returns the default / stale value).
 *
 * These wrappers absorb the throw and log to console.warn for debugging.
 */

/** Told the key of every write and removal (lib/sharedPrefs sends the shared ones). */
const writeListeners = new Set<(key: string) => void>();

export function onStorageWrite(fn: (key: string) => void): () => void {
  writeListeners.add(fn);
  return () => writeListeners.delete(fn);
}

function wrote(key: string): void {
  for (const fn of writeListeners) {
    try {
      fn(key);
    } catch (e) {
      console.warn(`storage write listener failed for key "${key}":`, e);
    }
  }
}

export function safeSetItem(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch (e) {
    console.warn(`localStorage.setItem failed for key "${key}":`, e);
    return;
  }
  wrote(key);
}

export function safeGetItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch (e) {
    console.warn(`localStorage.getItem failed for key "${key}":`, e);
    return null;
  }
}

export function safeRemoveItem(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch (e) {
    console.warn(`localStorage.removeItem failed for key "${key}":`, e);
    return;
  }
  wrote(key);
}
