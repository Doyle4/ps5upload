import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEchoGuard,
  DEFAULT_INPUT_MAP,
  dispatchNav,
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
    return this.descendants().filter((e) => e.tagName === "BUTTON"); // the FOCUSABLE selector
  }
  closest(): null {
    return null; // nothing is inert or aria-hidden in these fixtures
  }
  hasAttribute(a: string): boolean {
    return a in this.attrs;
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
