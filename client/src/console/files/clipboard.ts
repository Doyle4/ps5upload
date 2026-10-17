/**
 * Files' clipboard and the paste conflict being asked about.
 *
 * Both live outside any component (like batch.ts): the clipboard stays while
 * folders change and while another section is open, for the whole page
 * session; a paste that meets a conflict while Files is closed waits until
 * Files is open again to ask. Nothing here is saved: a reload empties it.
 */
import { useEffect, useState } from "react";
import type { Conflict, Decision, PasteMode } from "./paste";

export interface ClipItem {
  /** Full path. */
  path: string;
  /** A folder (Keep both does not split an extension off a folder's name). */
  dir: boolean;
}

export interface Clip {
  mode: PasteMode;
  items: ClipItem[];
}

/** A tiny observable value with a React hook. */
function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      value = next;
      listeners.forEach((fn) => fn());
    },
    use(): T {
      const [v, setV] = useState(value);
      useEffect(() => {
        setV(value);
        const fn = () => setV(value);
        listeners.add(fn);
        return () => {
          listeners.delete(fn);
        };
      }, []);
      return v;
    },
  };
}

const clip = store<Clip | null>(null);

export function getClipboard(): Clip | null {
  return clip.get();
}

/** Copy or Cut: the clipboard now holds these items (whatever it held before is replaced). */
export function setClipboard(mode: PasteMode, items: ClipItem[]): void {
  clip.set(items.length ? { mode, items } : null);
}

export function clearClipboard(): void {
  clip.set(null);
}

/** Take these paths out (a cut item that has moved); empty → cleared. */
export function dropFromClipboard(paths: string[]): void {
  const c = clip.get();
  if (!c || !paths.length) return;
  const gone = new Set(paths);
  const left = c.items.filter((i) => !gone.has(i.path));
  if (left.length !== c.items.length) clip.set(left.length ? { ...c, items: left } : null);
}

export const useClipboard = (): Clip | null => clip.use();

/* ---- the conflict being asked ---- */

export interface PendingConflict {
  conflict: Conflict;
  answer: (d: Decision) => void;
}

const pending = store<PendingConflict | null>(null);

/** Ask the page about one conflict; resolves when the dialog is answered. */
export function askConflict(conflict: Conflict): Promise<Decision> {
  return new Promise((resolve) => {
    pending.set({
      conflict,
      answer: (d) => {
        pending.set(null);
        resolve(d);
      },
    });
  });
}

export function currentConflict(): PendingConflict | null {
  return pending.get();
}

export const useConflict = (): PendingConflict | null => pending.use();
