/**
 * Controller and keyboard navigation for the console page.
 *
 * Focus is always real DOM focus on real controls (<button>, <a>, inputs), so
 * the browser's own focus handling keeps working; this layer only adds:
 *   - spatial movement: a direction moves focus to the nearest focusable
 *     element that way (nextFocus), from arrow keys or the D-pad;
 *   - confirm: clicks the focused control;
 *   - the other actions (back, actions, select, prevSection, nextSection,
 *     filter) go to the handlers registered with onNavAction, newest first.
 *
 * Which keys and Gamepad buttons the PS5 browser really delivers has not been
 * measured yet (ruling R11), so the bindings are one table, InputMap, with a
 * `verified` flag per entry. The HintBar shows only verified entries, and every
 * action has an on-screen control as well, so nothing depends on a shortcut.
 */

export type Direction = "up" | "down" | "left" | "right";
export type NavAction =
  | Direction
  | "confirm"
  | "back"
  | "actions"
  | "select"
  | "prevSection"
  | "nextSection"
  | "filter";

export interface InputBinding {
  action: NavAction;
  /** The controller glyph the HintBar shows (gamepad entries). */
  glyph?: string;
  /** Measured on a real console. Only verified entries are advertised. */
  verified: boolean;
}

export interface InputMap {
  /** KeyboardEvent.key → binding. */
  keys: Record<string, InputBinding>;
  /** Gamepad API "standard" button index → binding. */
  buttons: Record<number, InputBinding>;
}

const k = (action: NavAction): InputBinding => ({ action, verified: false });
const b = (action: NavAction, glyph: string): InputBinding => ({ action, glyph, verified: false });

/** R11's default table. Every entry is unverified until the console capture. */
export const DEFAULT_INPUT_MAP: InputMap = {
  keys: {
    ArrowUp: k("up"),
    ArrowDown: k("down"),
    ArrowLeft: k("left"),
    ArrowRight: k("right"),
    Enter: k("confirm"),
    Escape: k("back"),
    Backspace: k("back"),
  },
  buttons: {
    0: b("confirm", "✕"),
    1: b("back", "○"),
    2: b("select", "□"),
    3: b("actions", "△"),
    4: b("prevSection", "L1"),
    5: b("nextSection", "R1"),
    7: b("filter", "R2"),
    12: b("up", "↑"),
    13: b("down", "↓"),
    14: b("left", "←"),
    15: b("right", "→"),
  },
};

/* ---- spatial focus ---------------------------------------------------- */

export interface FocusCandidate {
  el: HTMLElement;
  rect: DOMRect;
}

/** How far `r` lies beyond `from` in `dir` (negative: it does not). */
function primaryGap(from: DOMRect, r: DOMRect, dir: Direction): number {
  switch (dir) {
    case "down":
      return r.top - from.bottom;
    case "up":
      return from.top - r.bottom;
    case "right":
      return r.left - from.right;
    case "left":
      return from.left - r.right;
  }
}

/** Whether `r` is past `from` in `dir` at all: its centre beyond `from`'s and its
 *  leading edge not behind `from`'s leading edge (1 px of slack for rounding). */
function isBeyond(from: DOMRect, r: DOMRect, dir: Direction): boolean {
  const fcx = (from.left + from.right) / 2;
  const fcy = (from.top + from.bottom) / 2;
  const cx = (r.left + r.right) / 2;
  const cy = (r.top + r.bottom) / 2;
  switch (dir) {
    case "down":
      return cy > fcy && r.top >= from.top + 1;
    case "up":
      return cy < fcy && r.bottom <= from.bottom - 1;
    case "right":
      return cx > fcx && r.left >= from.left + 1;
    case "left":
      return cx < fcx && r.right <= from.right - 1;
  }
}

/** Cross-axis gap between the two (0 when their ranges overlap) and the overlap size. */
function crossAxis(from: DOMRect, r: DOMRect, dir: Direction): { gap: number; overlap: number } {
  const vertical = dir === "up" || dir === "down";
  const a0 = vertical ? from.left : from.top;
  const a1 = vertical ? from.right : from.bottom;
  const b0 = vertical ? r.left : r.top;
  const b1 = vertical ? r.right : r.bottom;
  const overlap = Math.min(a1, b1) - Math.max(a0, b0);
  return overlap > 0 ? { gap: 0, overlap } : { gap: -overlap, overlap: 0 };
}

/**
 * The element focus moves to from `from` in `dir`, or null at the edge.
 * Candidates that overlap `from` on the cross axis (in its "beam") always win;
 * among them the nearest along the direction. Without one, the nearest by
 * distance with the cross-axis offset weighted double.
 */
export function nextFocus(
  from: DOMRect,
  candidates: FocusCandidate[],
  dir: Direction,
): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  let bestInBeam = false;
  for (const c of candidates) {
    if (!isBeyond(from, c.rect, dir)) continue;
    const gap = Math.max(0, primaryGap(from, c.rect, dir));
    const cross = crossAxis(from, c.rect, dir);
    const inBeam = cross.overlap > 0;
    if (bestInBeam && !inBeam) continue;
    const score = inBeam ? gap - cross.overlap / 1e6 : Math.hypot(gap, 2 * cross.gap);
    if ((inBeam && !bestInBeam) || score < bestScore) {
      best = c.el;
      bestScore = score;
      bestInBeam = inBeam;
    }
  }
  return best;
}

/* ---- gamepad ---------------------------------------------------------- */

/** Held D-pad: the first repeat after this long, then one every REPEAT_MS. */
export const REPEAT_DELAY_MS = 400;
export const REPEAT_MS = 120;

const DIRECTIONS: ReadonlySet<NavAction> = new Set(["up", "down", "left", "right"]);

/**
 * A stateful reader: given which buttons are down now, the actions to fire.
 * Buttons fire on the press; directions also repeat while held.
 */
export function createPadReader(map: InputMap): (pressed: boolean[], now: number) => NavAction[] {
  const downSince = new Map<number, number>();
  const lastFire = new Map<number, number>();
  return (pressed, now) => {
    const out: NavAction[] = [];
    for (const key of Object.keys(map.buttons)) {
      const i = Number(key);
      const binding = map.buttons[i];
      if (!pressed[i]) {
        downSince.delete(i);
        continue;
      }
      const since = downSince.get(i);
      if (since === undefined) {
        downSince.set(i, now);
        lastFire.set(i, now);
        out.push(binding.action);
        continue;
      }
      if (!DIRECTIONS.has(binding.action)) continue;
      const last = lastFire.get(i) ?? since;
      const due = last === since ? since + REPEAT_DELAY_MS : last + REPEAT_MS;
      if (now >= due) {
        lastFire.set(i, now);
        out.push(binding.action);
      }
    }
    return out;
  };
}

/**
 * R12: the PS5 browser may report one D-pad press twice, as a Gamepad button
 * and as an Arrow keydown. An Arrow keydown within ECHO_MS after the gamepad
 * moved the same way is that echo and is dropped.
 */
export const ECHO_MS = 100;

export function createEchoGuard(windowMs: number = ECHO_MS) {
  const padAt: Partial<Record<Direction, number>> = {};
  return {
    /** The gamepad fired `dir` at `now`. */
    padFired(dir: Direction, now: number): void {
      padAt[dir] = now;
    },
    /** Whether an Arrow keydown for `dir` at `now` is a real press (not the echo). */
    keyAllowed(dir: Direction, now: number): boolean {
      const at = padAt[dir];
      return at === undefined || now - at >= windowMs;
    },
  };
}

function isDirection(a: NavAction): a is Direction {
  return a === "up" || a === "down" || a === "left" || a === "right";
}

/* ---- action handlers -------------------------------------------------- */

/** Return true when the action was handled (stops older handlers). */
export type NavHandler = (action: NavAction) => boolean | void;

/** Where a handler belongs: an element getter (a ref), read at dispatch time. */
export type NavScope = () => Element | null;

interface Registered {
  fn: NavHandler;
  scope?: NavScope;
}

const handlers: Registered[] = [];

/**
 * Register a handler for the non-movement actions; the newest runs first.
 *
 * Modals: while an element with [data-nav-modal] is open, only handlers whose
 * `scope` element is that (topmost) modal or inside it run; every other one is
 * skipped, so the page behind a dialog never reacts to ○, L1/R1 or △. A modal
 * (confirm dialog, actions sheet, path picker) registers its own handlers with
 * `scope` = a ref to its root. With no modal open every handler runs.
 *
 * `fallback`: run after every other handler, whenever it was registered. App's
 * ○ (content → rail → Home) is one, so a section's own ○ (Files: up one
 * folder) wins even though App re-registers after the section mounts.
 */
export function onNavAction(fn: NavHandler, scope?: NavScope, opts?: { fallback?: boolean }): () => void {
  const entry: Registered = { fn, scope };
  if (opts?.fallback) handlers.push(entry);
  else handlers.unshift(entry);
  return () => {
    const i = handlers.indexOf(entry);
    if (i >= 0) handlers.splice(i, 1);
  };
}

/** The topmost open [data-nav-modal] (the last in document order), or null. */
export function topModal(): HTMLElement | null {
  const modals = document.querySelectorAll<HTMLElement>("[data-nav-modal]");
  return modals.length ? modals[modals.length - 1] : null;
}

export const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Focusable, visible elements, inside the topmost [data-nav-modal] when one is open. */
function focusables(): FocusCandidate[] {
  const root: ParentNode = topModal() ?? document;
  const out: FocusCandidate[] = [];
  root.querySelectorAll<HTMLElement>(FOCUSABLE).forEach((el) => {
    if (el.closest("[inert], [aria-hidden='true']")) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    out.push({ el, rect });
  });
  return out;
}

/* ---- regions ----------------------------------------------------------- */

/*
 * The page is split into regions, [data-nav-region] (App: the rail and the
 * content). Up/Down never leave the focused element's region. Left/Right move
 * inside it while something lies straight that way; otherwise they enter the
 * neighbouring region that way, at its entry: its [data-nav-entry] (the rail's
 * active section), else the element last focused there if it is still shown,
 * else its first control. Open modals ignore regions (focus stays in the modal).
 */

const REGION = "[data-nav-region]";

/** Region element → the element last focused inside it. */
const lastInRegion = new WeakMap<Element, HTMLElement>();

function regionOf(el: Element | null): Element | null {
  return el && typeof el.closest === "function" ? el.closest(REGION) : null;
}

function remember(el: Element | null): void {
  const region = regionOf(el);
  if (region) lastInRegion.set(region, el as HTMLElement);
}

/** Where focus lands when it enters `region` from another one. */
function regionEntry(region: Element, all: FocusCandidate[]): HTMLElement | null {
  const inside = all.filter((c) => region.contains(c.el));
  if (!inside.length) return null;
  const marked = inside.find((c) => c.el.hasAttribute("data-nav-entry"));
  if (marked) return marked.el;
  const last = lastInRegion.get(region);
  const kept = last ? inside.find((c) => c.el === last) : undefined;
  return (kept ?? inside[0]).el;
}

/** Focus `el` and keep it on screen. */
export function focusElement(el: HTMLElement): void {
  if (typeof document !== "undefined") remember(document.activeElement);
  el.focus();
  remember(el);
  if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function inBeam(from: DOMRect, r: DOMRect, dir: Direction): boolean {
  return crossAxis(from, r, dir).overlap > 0;
}

/** The target of `dir` from `current` when it sits in `region` (no modal open). */
function regionMove(current: FocusCandidate, region: Element, all: FocusCandidate[], dir: Direction): HTMLElement | null {
  const others = all.filter((c) => c !== current);
  const same = others.filter((c) => region.contains(c.el));
  if (dir === "up" || dir === "down") return nextFocus(current.rect, same, dir);
  const aligned = same.filter((c) => isBeyond(current.rect, c.rect, dir) && inBeam(current.rect, c.rect, dir));
  if (aligned.length) return nextFocus(current.rect, aligned, dir);
  // Nothing straight that way here: the neighbouring region that way, if any.
  const regions: FocusCandidate[] = [];
  document.querySelectorAll<HTMLElement>(REGION).forEach((r) => {
    if (r === region || r.contains(region) || region.contains(r)) return;
    if (!all.some((c) => r.contains(c.el))) return;
    regions.push({ el: r, rect: r.getBoundingClientRect() });
  });
  const neighbour = nextFocus((region as HTMLElement).getBoundingClientRect(), regions, dir);
  if (neighbour) return regionEntry(neighbour, all);
  return nextFocus(current.rect, same, dir);
}

function move(dir: Direction): void {
  const all = focusables();
  if (!all.length) return;
  const active = document.activeElement as HTMLElement | null;
  const current = active ? all.find((c) => c.el === active) : undefined;
  if (!current) {
    const preferred = all.find((c) => c.el.hasAttribute("data-nav-default")) ?? all[0];
    focusElement(preferred.el);
    return;
  }
  const region = topModal() ? null : regionOf(current.el);
  const next = region
    ? regionMove(current, region, all, dir)
    : nextFocus(
        current.rect,
        all.filter((c) => c !== current),
        dir,
      );
  if (next) focusElement(next);
}

/** Run one action: movement and confirm here, the rest through the handlers. */
export function dispatchNav(action: NavAction): void {
  if (isDirection(action)) {
    move(action);
    return;
  }
  const modal = topModal();
  const active = document.activeElement as HTMLElement | null;
  if (action === "confirm") {
    // Focus left behind a modal (it opened over the page) never gets clicked:
    // the first press brings focus into the modal instead.
    if (modal && !(active && modal.contains(active))) {
      const first = focusables()[0];
      if (first) focusElement(first.el);
      return;
    }
    if (active && active !== document.body && typeof active.click === "function") active.click();
    return;
  }
  for (const h of handlers.slice()) {
    if (modal) {
      const scope = h.scope ? h.scope() : null;
      if (!scope || !modal.contains(scope)) continue;
    }
    if (h.fn(action)) return;
  }
}

/** Text fields keep the keys that edit text. */
function isTextField(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || (el as HTMLElement).isContentEditable) return true;
  if (tag !== "INPUT") return false;
  const type = (el as HTMLInputElement).type;
  return !["button", "checkbox", "radio", "submit", "reset", "range", "color", "file"].includes(type);
}

/**
 * Listen for the keys and gamepad buttons in `map` until the returned function
 * is called. Keyboard: keydown. Gamepad: polled once per animation frame.
 */
export function installNavigation(map: InputMap): () => void {
  const echo = createEchoGuard();
  const onKey = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const binding = map.keys[e.key];
    if (!binding) return;
    const typing = isTextField(e.target as Element | null);
    if (typing && (binding.action === "left" || binding.action === "right" || e.key === "Backspace" || binding.action === "confirm")) {
      return;
    }
    e.preventDefault();
    if (isDirection(binding.action) && !echo.keyAllowed(binding.action, performance.now())) return;
    dispatchNav(binding.action);
  };
  window.addEventListener("keydown", onKey);

  let frame = 0;
  let stopped = false;
  const readers = new Map<number, ReturnType<typeof createPadReader>>();
  const canPoll = typeof navigator !== "undefined" && typeof navigator.getGamepads === "function";
  const poll = () => {
    if (stopped) return;
    const pads = navigator.getGamepads();
    const now = performance.now();
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      if (!pad || pad.mapping !== "standard") continue;
      let read = readers.get(pad.index);
      if (!read) {
        read = createPadReader(map);
        readers.set(pad.index, read);
      }
      const pressed = pad.buttons.map((btn) => btn.pressed);
      for (const action of read(pressed, now)) {
        if (isDirection(action)) echo.padFired(action, now);
        dispatchNav(action);
      }
    }
    frame = requestAnimationFrame(poll);
  };
  if (canPoll) frame = requestAnimationFrame(poll);

  return () => {
    stopped = true;
    window.removeEventListener("keydown", onKey);
    if (frame) cancelAnimationFrame(frame);
  };
}

/** The bindings the HintBar may advertise: verified gamepad entries. */
export function verifiedButtons(map: InputMap): InputBinding[] {
  return Object.keys(map.buttons)
    .map((i) => map.buttons[Number(i)])
    .filter((x) => x.verified);
}
