/**
 * The PS5 browser's ○ is its own Back button: it never reaches the page as a
 * key (measured on 13.60: only a keyup Escape as the page was left). So every
 * in-page "back" step — a modal or sheet open, a folder entered in Files, a
 * section other than Home — is backed by browser history: while the page has
 * anywhere to go back to, one history entry (the guard) sits on top of the
 * page's own entry. ○ pops it, `popstate` runs the page's back action (close
 * the top modal, else up a folder, else rail, else Home), and the guard is put
 * back while there is still somewhere to go. On the first screen (Home, no
 * modal) there is no guard, so ○ leaves the page as the browser intends.
 *
 * One guard instead of one entry per step: the page also closes modals and
 * leaves folders with on-screen buttons, and a per-step stack would drift
 * from the page's real state; a single guard is right whatever the depth.
 * A level closed by a button with nothing left behind removes the guard
 * (history.back()), and that pop is ignored.
 *
 * Escape, Backspace and a gamepad ○ call requestBack(): history.back() when
 * the guard is up (so they take exactly the path ○ takes), else the back
 * action directly.
 */
import { useEffect } from "react";

/** A second pop this soon after a back action is the same press reported twice: ignored. */
export const BACK_ECHO_MS = 150;

export interface HistoryEnv {
  /** history.pushState(guard) */
  push(): void;
  /** history.back() */
  back(): void;
  /** Listen for popstate; returns the unsubscribe function. */
  onPop(fn: () => void): () => void;
  now(): number;
  /** Run `fn` soon (after the current React commit). */
  defer(fn: () => void): void;
  /** The page loaded with the guard on top (a reload while it was up). */
  startsOnGuard(): boolean;
}

export interface BackHistory {
  /** One more place to go back from; call the returned function when it closes. */
  addLevel(): () => void;
  /** Escape / Backspace / gamepad ○: the same path as the browser's Back. */
  requestBack(): void;
  /** The guard entry is on top (tests). */
  hasGuard(): boolean;
  dispose(): void;
}

export function createBackHistory(env: HistoryEnv, runBack: () => void): BackHistory {
  let levels = 0;
  let guard = env.startsOnGuard();
  let ignorePops = 0;
  let lastBackAt = -Infinity;
  let scheduled = false;

  const sync = () => {
    scheduled = false;
    if (levels > 0 && !guard) {
      env.push();
      guard = true;
    } else if (levels === 0 && guard) {
      guard = false;
      ignorePops++;
      env.back();
    }
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    env.defer(sync);
  };

  const off = env.onPop(() => {
    guard = false; // the guard entry was just consumed
    if (ignorePops > 0) {
      ignorePops--;
      schedule();
      return;
    }
    const now = env.now();
    if (now - lastBackAt < BACK_ECHO_MS) {
      schedule();
      return;
    }
    lastBackAt = now;
    runBack();
    schedule();
  });
  if (guard) schedule();

  return {
    addLevel() {
      levels++;
      schedule();
      let closed = false;
      return () => {
        if (closed) return;
        closed = true;
        levels--;
        schedule();
      };
    },
    requestBack() {
      if (guard && ignorePops === 0) {
        env.back();
        return;
      }
      lastBackAt = env.now();
      runBack();
      schedule();
    },
    hasGuard: () => guard,
    dispose: off,
  };
}

/* ---- the page's instance ---- */

const GUARD = "cwBack";
let instance: BackHistory | null = null;

/** Install on the real window (main.tsx). `runBack` is the page's back action. */
export function installBackHistory(runBack: () => void): BackHistory {
  instance?.dispose();
  instance = createBackHistory(
    {
      push: () => window.history.pushState({ [GUARD]: 1 }, ""),
      back: () => window.history.back(),
      onPop: (fn) => {
        window.addEventListener("popstate", fn);
        return () => window.removeEventListener("popstate", fn);
      },
      now: () => performance.now(),
      defer: (fn) => {
        setTimeout(fn, 0);
      },
      startsOnGuard: () => {
        const st: unknown = window.history.state;
        return !!st && typeof st === "object" && (st as Record<string, unknown>)[GUARD] === 1;
      },
    },
    runBack,
  );
  return instance;
}

/** Escape / Backspace / gamepad ○ (nav.ts): history.back() when installed, else `fallback`. */
export function requestBack(fallback: () => void): void {
  if (instance) instance.requestBack();
  else fallback();
}

/** While `on`, this component is a place the browser's Back returns from. No-op until installed. */
export function useBackLevel(on: boolean): void {
  useEffect(() => {
    if (!on || !instance) return;
    return instance.addLevel();
  }, [on]);
}
