import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEchoGuard,
  DEFAULT_INPUT_MAP,
  dispatchNav,
  focusElement,
  installNavigation,
  onNavAction,
} from "./nav";

/*
 * Vitest runs in node (no jsdom in the client): a minimal fake DOM with just
 * what nav.ts touches — querySelectorAll for [data-nav-modal] and focusables,
 * contains/closest, focus/click, getBoundingClientRect, activeElement.
 */
class FakeEl {
  parent: FakeEl | null = null;
  children: FakeEl[] = [];
  clicks = 0;
  constructor(
    readonly name: string,
    readonly attrs: Record<string, string> = {},
    readonly box = { left: 0, top: 0, width: 0, height: 0 },
    readonly tagName = "DIV",
  ) {}
  add(...kids: FakeEl[]): this {
    for (const k of kids) {
      k.parent = this;
      this.children.push(k);
    }
    return this;
  }
  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  contains(o: FakeEl | null): boolean {
    for (let n = o; n; n = n.parent) if (n === this) return true;
    return false;
  }
  descendants(): FakeEl[] {
    return this.children.flatMap((c) => [c, ...c.descendants()]);
  }
  querySelectorAll(sel: string): FakeEl[] {
    if (sel === "[data-nav-modal]") return this.descendants().filter((e) => "data-nav-modal" in e.attrs);
    if (sel === "[data-nav-region]") return this.descendants().filter((e) => "data-nav-region" in e.attrs);
    return this.descendants().filter((e) => e.tagName === "BUTTON"); // the FOCUSABLE selector
  }
  closest(sel: string): FakeEl | null {
    if (sel !== "[data-nav-region]") return null; // nothing is inert or aria-hidden in these fixtures
    if ("data-nav-region" in this.attrs) return this;
    return this.parent ? this.parent.closest(sel) : null;
  }
  hasAttribute(a: string): boolean {
    return a in this.attrs;
  }
  getAttribute(a: string): string | null {
    return a in this.attrs ? this.attrs[a] : null;
  }
  getBoundingClientRect(): DOMRect {
    const { left, top, width, height } = this.box;
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top } as DOMRect;
  }
  focus(): void {
    fakeDoc.activeElement = this;
  }
  click(): void {
    this.clicks++;
  }
}

const btn = (name: string, left: number, top: number) =>
  new FakeEl(name, {}, { left, top, width: 100, height: 40 }, "BUTTON");

const body = new FakeEl("body");
const fakeDoc = {
  body,
  activeElement: body as FakeEl,
  querySelectorAll: (sel: string) => body.querySelectorAll(sel),
};

let railHome: FakeEl;
let railFiles: FakeEl;
let modal: FakeEl;
let reload: FakeEl;
const offs: (() => void)[] = [];

beforeEach(() => {
  body.children = [];
  railHome = btn("rail-home", 0, 100);
  railFiles = btn("rail-files", 0, 160);
  reload = btn("reload", 600, 100);
  modal = new FakeEl("banner", { "data-nav-modal": "" }).add(reload);
  body.add(railHome, railFiles);
  (globalThis as any).document = fakeDoc;
  // The page's own handler, like App's: ○ / L1 / R1 move focus to the rail.
  offs.push(
    onNavAction((a) => {
      if (a === "back" || a === "prevSection" || a === "nextSection") {
        railFiles.focus();
        return true;
      }
      return false;
    }),
  );
});

afterEach(() => {
  while (offs.length) offs.pop()!();
  delete (globalThis as any).document;
  delete (globalThis as any).window;
  delete (globalThis as any).requestAnimationFrame;
  delete (globalThis as any).cancelAnimationFrame;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("handler order", () => {
  it("a fallback handler runs after handlers registered later than it", () => {
    const seen: string[] = [];
    // App registers its ○ as a fallback; a section (Files: ○ = up one folder)
    // registered before it still runs first.
    offs.push(onNavAction(() => {
      seen.push("section");
      return true;
    }));
    offs.push(onNavAction(() => {
      seen.push("app");
      return true;
    }, undefined, { fallback: true }));
    railHome.focus();
    dispatchNav("back");
    expect(seen).toEqual(["section"]);
  });
});

describe("modal scope", () => {
  it("back, prevSection and nextSection outside the modal do not run while it is open", () => {
    body.add(modal);
    reload.focus();
    for (const a of ["back", "prevSection", "nextSection"] as const) {
      dispatchNav(a);
      expect(fakeDoc.activeElement).toBe(reload);
    }
  });

  it("the page's handlers run again once the modal closes", () => {
    body.add(modal);
    modal.remove();
    railHome.focus();
    dispatchNav("back");
    expect(fakeDoc.activeElement).toBe(railFiles);
  });

  it("a handler scoped to the modal does receive the actions", () => {
    body.add(modal);
    reload.focus();
    const seen: string[] = [];
    offs.push(
      onNavAction(
        (a) => {
          seen.push(a);
          return true;
        },
        () => modal as unknown as Element,
      ),
    );
    dispatchNav("back");
    expect(seen).toEqual(["back"]);
    expect(fakeDoc.activeElement).toBe(reload);
  });

  it("confirm activates the modal's button", () => {
    body.add(modal);
    reload.focus();
    dispatchNav("confirm");
    expect(reload.clicks).toBe(1);
  });

  it("confirm with focus left behind the modal brings focus in, never clicks the page", () => {
    railFiles.focus();
    body.add(modal);
    dispatchNav("confirm");
    expect(railFiles.clicks).toBe(0);
    expect(fakeDoc.activeElement).toBe(reload);
    dispatchNav("confirm");
    expect(reload.clicks).toBe(1);
  });

  it("D-pad moves stay inside the modal", () => {
    body.add(modal);
    reload.focus();
    dispatchNav("left"); // the rail is to the left, behind the modal
    expect(fakeDoc.activeElement).toBe(reload);
    dispatchNav("down");
    expect(fakeDoc.activeElement).toBe(reload);
  });
});

/*
 * The page's two regions, like App: the rail (left) and the content (right).
 * Rail items stack down the left; the content's controls sit to the right.
 */
function regions() {
  const rail = new FakeEl("rail", { "data-nav-region": "rail" }, { left: 0, top: 60, width: 120, height: 600 });
  const content = new FakeEl("content", { "data-nav-region": "content" }, { left: 130, top: 60, width: 900, height: 600 });
  const home = btn("home", 0, 100);
  const files = new FakeEl("files", { "data-nav-entry": "" }, { left: 0, top: 160, width: 100, height: 40 }, "BUTTON");
  const settings = btn("settings", 0, 520);
  rail.add(home, files, settings);
  body.add(rail, content);
  return { rail, content, home, files, settings };
}

describe("rail and content regions", () => {
  it("F1: Left from the content enters the rail on the active section's item, not the nearest", () => {
    const r = regions();
    const low = btn("low", 140, 520); // level with Settings
    r.content.add(btn("top", 140, 100), low);
    low.focus();
    dispatchNav("left");
    expect(fakeDoc.activeElement).toBe(r.files);
  });

  it("F1: Left inside the content still moves within the content when something is that way", () => {
    const r = regions();
    const a = btn("a", 140, 300);
    const b = btn("b", 260, 300);
    r.content.add(a, b);
    b.focus();
    dispatchNav("left");
    expect(fakeDoc.activeElement).toBe(a);
  });

  it("F1: a wide card's Left goes to the rail, not up to a narrower control above it", () => {
    const r = regions();
    const quick = btn("quick", 140, 100);
    const card = new FakeEl("card", {}, { left: 140, top: 300, width: 400, height: 120 }, "BUTTON");
    r.content.add(quick, card);
    card.focus();
    dispatchNav("left");
    expect(fakeDoc.activeElement).toBe(r.files);
  });

  it("F2: Down on the last rail item stays put, never jumps into the content", () => {
    const r = regions();
    r.content.add(btn("card", 140, 600));
    r.settings.focus();
    dispatchNav("down");
    expect(fakeDoc.activeElement).toBe(r.settings);
    dispatchNav("up");
    expect(fakeDoc.activeElement).toBe(r.files);
  });

  it("F2: Down at the end of the content stays put, never jumps to a rail item", () => {
    const r = regions();
    const first = btn("first", 140, 100);
    const last = btn("last", 140, 300);
    r.content.add(first, last);
    last.focus();
    dispatchNav("down"); // Settings (rail, y=520) is below
    expect(fakeDoc.activeElement).toBe(last);
    dispatchNav("up");
    expect(fakeDoc.activeElement).toBe(first);
    dispatchNav("up"); // Home (rail, y=100) is level; nothing above in the content
    expect(fakeDoc.activeElement).toBe(first);
  });

  it("F2: Right from the rail enters the content on its first control, not the nearest", () => {
    const r = regions();
    const first = btn("first", 140, 100);
    const nearSettings = btn("near", 140, 520);
    r.content.add(first, nearSettings);
    r.settings.focus();
    dispatchNav("right");
    expect(fakeDoc.activeElement).toBe(first);
  });

  it("F2: Right from the rail returns to the control last focused in the content", () => {
    const r = regions();
    const first = btn("first", 140, 100);
    const second = btn("second", 140, 300);
    r.content.add(first, second);
    second.focus();
    dispatchNav("left");
    expect(fakeDoc.activeElement).toBe(r.files);
    dispatchNav("down");
    expect(fakeDoc.activeElement).toBe(r.settings);
    dispatchNav("right");
    expect(fakeDoc.activeElement).toBe(second);
  });

  it("F2: the remembered control is gone (section changed) → the content's first control", () => {
    const r = regions();
    const first = btn("first", 140, 100);
    const second = btn("second", 140, 300);
    r.content.add(first, second);
    second.focus();
    dispatchNav("left");
    second.remove();
    dispatchNav("right");
    expect(fakeDoc.activeElement).toBe(first);
  });

  it("○ to the rail (App's handler) also remembers where the content was", () => {
    const r = regions();
    const first = btn("first", 140, 100);
    const second = btn("second", 140, 300);
    r.content.add(first, second);
    second.focus();
    offs.push(
      onNavAction((a) => {
        if (a !== "back") return false;
        focusElement(r.files as unknown as HTMLElement);
        return true;
      }),
    );
    dispatchNav("back");
    expect(fakeDoc.activeElement).toBe(r.files);
    dispatchNav("right");
    expect(fakeDoc.activeElement).toBe(second);
  });

  it("a modal inside the content keeps the D-pad in the modal, regions aside", () => {
    const r = regions();
    const ok = btn("ok", 400, 300);
    r.content.add(btn("behind", 140, 300), new FakeEl("dialog", { "data-nav-modal": "" }).add(ok));
    ok.focus();
    dispatchNav("left");
    expect(fakeDoc.activeElement).toBe(ok);
  });
});

describe("R12 gamepad/keyboard echo", () => {
  it("drops an Arrow keydown within 100 ms after the gamepad moved the same way", () => {
    const g = createEchoGuard();
    expect(g.keyAllowed("down", 0)).toBe(true);
    g.padFired("down", 1000);
    expect(g.keyAllowed("down", 1050)).toBe(false);
    expect(g.keyAllowed("up", 1050)).toBe(true);
    expect(g.keyAllowed("down", 1100)).toBe(true);
  });

  it("installNavigation moves once when one D-pad press arrives as both", () => {
    let keydown: ((e: any) => void) | null = null;
    (globalThis as any).window = {
      addEventListener: (t: string, fn: (e: any) => void) => {
        if (t === "keydown") keydown = fn;
      },
      removeEventListener: () => {},
    };
    let frame: (() => void) | null = null;
    (globalThis as any).requestAnimationFrame = (cb: () => void) => {
      frame = cb;
      return 1;
    };
    (globalThis as any).cancelAnimationFrame = () => {};
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false }));
    vi.stubGlobal("navigator", { getGamepads: () => [{ index: 0, mapping: "standard", buttons }] });
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);

    const below = btn("below", 0, 220);
    body.add(below);
    railHome.focus();
    offs.push(installNavigation(DEFAULT_INPUT_MAP));

    buttons[13].pressed = true; // D-pad down
    frame!();
    expect(fakeDoc.activeElement).toBe(railFiles);
    now = 1030;
    const echo = { key: "ArrowDown", target: null, preventDefault: vi.fn() };
    keydown!(echo);
    expect(echo.preventDefault).toHaveBeenCalled();
    expect(fakeDoc.activeElement).toBe(railFiles);

    buttons[13].pressed = false;
    frame!();
    now = 1300;
    keydown!({ key: "ArrowDown", target: null, preventDefault: vi.fn() });
    expect(fakeDoc.activeElement).toBe(below);
  });
});
