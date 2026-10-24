// "Send to PS5": the items that reached the app from outside (Android's share menu, a
// desktop "Open with"), waiting for the user to send or dismiss them. lib/incomingShare.ts
// has the data and the rules; components/IncomingShareSheet shows the first item.

import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

import {
  parseShareQueue,
  pathItems,
  type CopyError,
  type IncomingItem,
  type ShareEvent,
} from "../lib/incomingShare";
import { isMobile } from "../lib/platform";
import { isTauriEnv } from "../lib/tauriEnv";

/** window.PS5UploadShare, added by the Android shell (ShareIntake.kt). */
interface ShareBridge {
  take(): string;
  copy(token: string, limitBytes: number): void;
  cancel(token: string): void;
}

export function shareBridge(): ShareBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { PS5UploadShare?: ShareBridge }).PS5UploadShare;
}

interface IncomingShareState {
  queue: IncomingItem[];
  /** The stream being copied into the app for the first item. */
  copying: string | null;
  copyError: CopyError | null;
  /** The first item became a copy after the user said yes: send it without asking again. */
  approved: boolean;
}

export const useIncomingShareStore = create<IncomingShareState>(() => ({
  queue: [],
  copying: null,
  copyError: null,
  approved: false,
}));

/** Applies what the shell or the desktop host reported. Exported for tests. */
export function applyShareEvents(events: ShareEvent[]): void {
  for (const ev of events) {
    const s = useIncomingShareStore.getState();
    if (ev.type === "item") {
      // The same thing twice (a double-click, a repeated share) is one item.
      const dup = s.queue.some((it) => JSON.stringify(it) === JSON.stringify(ev.item));
      if (!dup) useIncomingShareStore.setState({ queue: [...s.queue, ev.item] });
      continue;
    }
    const first = s.queue[0];
    if (!first || first.kind !== "stream" || first.token !== ev.token) continue;
    if (ev.type === "copied") {
      useIncomingShareStore.setState({
        queue: [
          { kind: "path", path: ev.path, name: ev.name, size: ev.size, copied: true },
          ...s.queue.slice(1),
        ],
        copying: null,
        copyError: null,
        approved: s.copying === ev.token,
      });
    } else {
      useIncomingShareStore.setState({
        copying: null,
        copyError: ev.code === "cancelled" ? null : ev.code,
      });
    }
  }
}

/** Done with the first item (sent or dismissed); a copy still running is stopped. */
export function dismissFirstShare(): void {
  const s = useIncomingShareStore.getState();
  if (s.copying) {
    try {
      shareBridge()?.cancel(s.copying);
    } catch {
      /* the copy finishes into the cache and is cleared after a day */
    }
  }
  useIncomingShareStore.setState({
    queue: s.queue.slice(1),
    copying: null,
    copyError: null,
    approved: false,
  });
}

/** Ask the Android shell to copy the first item (a stream) into the app. */
export function startShareCopy(token: string, limit: number): boolean {
  const bridge = shareBridge();
  if (!bridge) return false;
  try {
    bridge.copy(token, limit);
  } catch {
    useIncomingShareStore.setState({ copyError: "copy_failed" });
    return false;
  }
  useIncomingShareStore.setState({ copying: token, copyError: null });
  return true;
}

let installed = false;

/** Subscribe once, then take what arrived before the page was listening. Idempotent. */
export function installIncomingShare(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const bridge = shareBridge();
  if (bridge) {
    const drain = () => {
      try {
        applyShareEvents(parseShareQueue(bridge.take()));
      } catch {
        /* a bridge that throws has nothing for us */
      }
    };
    window.addEventListener("ps5upload-share", drain);
    drain();
    return;
  }
  if (!isTauriEnv() || isMobile()) return;
  const drain = () => {
    invoke<string[]>("opened_files_take")
      .then((paths) =>
        applyShareEvents(pathItems(paths).map((item) => ({ type: "item", item }) as ShareEvent)),
      )
      .catch(() => {
        /* an older shell without the command */
      });
  };
  void listen("ps5upload-open-files", drain)
    .catch(() => {
      /* best-effort subscription; the take below still runs */
    })
    .finally(drain);
}
