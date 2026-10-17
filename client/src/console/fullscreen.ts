/**
 * Full screen for the console page: the PS5 browser's own bars take part of a
 * 1540×700 viewport, so the page asks for full screen on the first user
 * activation (a click or a key: browsers only grant it inside one) while the
 * Settings switch is on (the default). The standard API first, then WebKit's
 * prefixed one. Where neither exists, or the browser disables it, nothing is
 * asked, Settings hides the switch and the layout simply scales to the viewport.
 */

/** The parts of `document` this module uses (tests pass a stand-in). */
export interface FullscreenDoc {
  documentElement: Element & {
    requestFullscreen?: () => Promise<void>;
    webkitRequestFullscreen?: () => void;
  };
  fullscreenEnabled?: boolean;
  webkitFullscreenEnabled?: boolean;
  fullscreenElement?: Element | null;
  webkitFullscreenElement?: Element | null;
  exitFullscreen?: () => Promise<void>;
  webkitExitFullscreen?: () => void;
}

interface Listener {
  addEventListener(type: string, fn: () => void, capture?: boolean): void;
  removeEventListener(type: string, fn: () => void, capture?: boolean): void;
}

const STORAGE_KEY = "ps5upload.console.fullscreen";
/** Activations that may carry the request. */
const ACTIVATIONS = ["click", "keydown"];

function currentDoc(): FullscreenDoc {
  return document as unknown as FullscreenDoc;
}

/** Which API the browser has: the standard one, WebKit's prefixed one, or none. */
export function fullscreenApi(doc: FullscreenDoc = currentDoc()): "standard" | "webkit" | null {
  const el = doc.documentElement;
  if (el && typeof el.requestFullscreen === "function") return "standard";
  if (el && typeof el.webkitRequestFullscreen === "function") return "webkit";
  return null;
}

/** Whether the page can go full screen at all (an API, and the browser does not disable it). */
export function fullscreenSupported(doc: FullscreenDoc = currentDoc()): boolean {
  const api = fullscreenApi(doc);
  if (api === "standard") return doc.fullscreenEnabled !== false;
  if (api === "webkit") return doc.webkitFullscreenEnabled !== false;
  return false;
}

export function isFullscreen(doc: FullscreenDoc = currentDoc()): boolean {
  return !!(doc.fullscreenElement || doc.webkitFullscreenElement);
}

/** Ask for full screen; resolves true when the browser accepted (or did not say no). */
export function enterFullscreen(doc: FullscreenDoc = currentDoc()): Promise<boolean> {
  if (!fullscreenSupported(doc)) return Promise.resolve(false);
  try {
    if (fullscreenApi(doc) === "standard") {
      return Promise.resolve(doc.documentElement.requestFullscreen!()).then(
        () => true,
        () => false,
      );
    }
    doc.documentElement.webkitRequestFullscreen!(); // returns nothing; a refusal is an event
    return Promise.resolve(true);
  } catch {
    return Promise.resolve(false);
  }
}

export function exitFullscreen(doc: FullscreenDoc = currentDoc()): void {
  try {
    if (doc.fullscreenElement && typeof doc.exitFullscreen === "function") {
      doc.exitFullscreen().catch(() => {});
    } else if (doc.webkitFullscreenElement && typeof doc.webkitExitFullscreen === "function") {
      doc.webkitExitFullscreen();
    }
  } catch {
    // already left
  }
}

/** The Settings switch: on unless the viewer turned it off (also when storage fails). */
export function fullscreenPref(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

/**
 * Flip the switch. Called from the switch's own click, a user activation, so
 * turning it on goes full screen at once; turning it off leaves full screen.
 */
export function setFullscreenPref(on: boolean, doc: FullscreenDoc = currentDoc()): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    // remembered for this page only
  }
  if (on) void enterFullscreen(doc);
  else exitFullscreen(doc);
}

/** The touchpad button: in or out of full screen (from a key, so inside a user activation). */
export function toggleFullscreen(doc: FullscreenDoc = currentDoc()): void {
  if (isFullscreen(doc)) exitFullscreen(doc);
  else void enterFullscreen(doc);
}

/**
 * Go full screen on the first user activation when the switch is on. A refused
 * request is tried again on the next activation (at most MAX_TRIES); once full
 * screen was entered, or the page is already full screen, the listeners go.
 * Leaving full screen later (the browser's own way) is respected: no re-entry.
 */
const MAX_TRIES = 3;

export function installFullscreen(win: Listener = window, doc: FullscreenDoc = currentDoc()): () => void {
  let tries = 0;
  let pending = false;
  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    for (const t of ACTIVATIONS) win.removeEventListener(t, onActivation, true);
  };
  function onActivation() {
    if (removed || pending) return;
    if (!fullscreenPref() || !fullscreenSupported(doc) || isFullscreen(doc)) {
      if (isFullscreen(doc) || !fullscreenSupported(doc)) remove();
      return;
    }
    tries++;
    pending = true;
    void enterFullscreen(doc).then((ok) => {
      pending = false;
      if (ok || tries >= MAX_TRIES) remove();
    });
  }
  for (const t of ACTIVATIONS) win.addEventListener(t, onActivation, true);
  return remove;
}
