// What the desktop sidebar leaves out.
//
// The sidebar lists every screen, in its sections; people hide what they don't use, rather
// than having to discover and star what they do (the old Favorites model left a new user
// with Home and About, and everything else behind More). Section headers collapse too.
//
// Pinning puts a copy of a screen in a Pinned group at the top (pin order, at most
// MAX_PINNED shown); a pinned screen shows there even when hidden from its section.
// Callers pass `shown`, the pins the group shows now (pinnedNavItems): a pin kept for a
// screen this build hides (beta off) takes no place and is stepped over when moving.
//
// Persisted per machine in localStorage via safeStorage, and mirrored to
// ~/.ps5upload/settings.json by userConfig, like the collapsed-rail flag.

import { create } from "zustand";

import { cleanPinned, isPinnableNav, MAX_PINNED } from "../layout/navItems";
import { safeGetItem, safeSetItem } from "../lib/safeStorage";

const HIDDEN_KEY = "ps5upload.desktop-sidebar.hidden.v1";
const CLOSED_KEY = "ps5upload.desktop-sidebar.closed-sections.v1";
const PINNED_KEY = "ps5upload.desktop-sidebar.pinned.v1";

/** A stored list of strings, or empty: the value is hand-editable and outlives builds. */
function loadList(key: string): string[] {
  const raw = safeGetItem(key);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

const strings = (v: readonly unknown[]) => v.filter((x): x is string => typeof x === "string");

function flip(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

interface NavSidebarState {
  /** Route paths left out of the sidebar. */
  hidden: string[];
  /** Section keys whose items are folded away. */
  closedSections: string[];
  /** Route paths in the Pinned group, in pin order. */
  pinned: string[];
  toggleHidden: (to: string) => void;
  toggleSection: (key: string) => void;
  /** Pin at the end, or unpin. A no-op for a screen that can't be pinned, or when the shown
   *  pins (`shown`, else all) already fill MAX_PINNED. */
  togglePinned: (to: string, shown?: readonly string[]) => void;
  /** Move a pinned screen by `delta` places among the shown pins (More's Move up/down). */
  movePinned: (to: string, delta: number, shown?: readonly string[]) => void;
  /** Move a pinned screen to `index` (the sidebar's drag). */
  movePinnedTo: (to: string, index: number) => void;
  /** Replace the lists — hydrating from the settings-file mirror. `pinned` left out (a file
   *  from before pinning) keeps the current pins. */
  setAll: (
    hidden: readonly unknown[],
    closedSections: readonly unknown[],
    pinned?: readonly unknown[],
  ) => void;
}

function moved(list: string[], to: string, index: number): string[] {
  const from = list.indexOf(to);
  if (from === -1) return list;
  const target = Math.max(0, Math.min(list.length - 1, index));
  if (target === from) return list;
  const next = list.filter((x) => x !== to);
  next.splice(target, 0, to);
  return next;
}

export const useNavSidebarStore = create<NavSidebarState>((set) => ({
  hidden: loadList(HIDDEN_KEY),
  closedSections: loadList(CLOSED_KEY),
  pinned: cleanPinned(loadList(PINNED_KEY)),
  toggleHidden: (to) =>
    set((s) => {
      const hidden = flip(s.hidden, to);
      safeSetItem(HIDDEN_KEY, JSON.stringify(hidden));
      return { hidden };
    }),
  toggleSection: (key) =>
    set((s) => {
      const closedSections = flip(s.closedSections, key);
      safeSetItem(CLOSED_KEY, JSON.stringify(closedSections));
      return { closedSections };
    }),
  togglePinned: (to, shown) =>
    set((s) => {
      const count = (shown ?? s.pinned).length;
      if (!s.pinned.includes(to) && (!isPinnableNav(to) || count >= MAX_PINNED)) return s;
      const pinned = flip(s.pinned, to);
      safeSetItem(PINNED_KEY, JSON.stringify(pinned));
      return { pinned };
    }),
  movePinned: (to, delta, shown) =>
    set((s) => {
      // Step over pins that aren't shown: land next to the shown neighbour, so every press
      // visibly moves the row.
      const order = shown ? s.pinned.filter((x) => shown.includes(x)) : s.pinned;
      const at = order.indexOf(to);
      const neighbour = at === -1 ? undefined : order[at + delta];
      if (neighbour === undefined) return s;
      const pinned = moved(s.pinned, to, s.pinned.indexOf(neighbour));
      if (pinned === s.pinned) return s;
      safeSetItem(PINNED_KEY, JSON.stringify(pinned));
      return { pinned };
    }),
  movePinnedTo: (to, index) =>
    set((s) => {
      const pinned = moved(s.pinned, to, index);
      if (pinned === s.pinned) return s;
      safeSetItem(PINNED_KEY, JSON.stringify(pinned));
      return { pinned };
    }),
  setAll: (hiddenIn, closedIn, pinnedIn) => {
    const hidden = strings(hiddenIn);
    const closedSections = strings(closedIn);
    safeSetItem(HIDDEN_KEY, JSON.stringify(hidden));
    safeSetItem(CLOSED_KEY, JSON.stringify(closedSections));
    if (pinnedIn === undefined) {
      set({ hidden, closedSections });
      return;
    }
    const pinned = cleanPinned(pinnedIn);
    safeSetItem(PINNED_KEY, JSON.stringify(pinned));
    set({ hidden, closedSections, pinned });
  },
}));
