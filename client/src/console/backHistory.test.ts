import { describe, expect, it, vi } from "vitest";
import { BACK_ECHO_MS, createBackHistory, type HistoryEnv } from "./backHistory";

/** A browser history in memory: entries, popstate, a clock and a deferred queue. */
function fakeEnv(startsOnGuard = false) {
  const entries: string[] = startsOnGuard ? ["page", "guard"] : ["page"];
  let pop: (() => void) | null = null;
  let clock = 0;
  const queue: (() => void)[] = [];
  const env: HistoryEnv = {
    push: vi.fn(() => {
      entries.push("guard");
    }),
    back: vi.fn(() => {
      // history.back() is async: the popstate comes later.
      queue.push(() => {
        entries.pop();
        pop?.();
      });
    }),
    onPop: (fn) => {
      pop = fn;
      return () => {
        pop = null;
      };
    },
    now: () => clock,
    defer: (fn) => {
      queue.push(fn);
    },
    startsOnGuard: () => startsOnGuard,
  };
  return {
    env,
    entries,
    /** Run everything queued (React commits, async pops) until nothing is left. */
    flush() {
      while (queue.length) queue.shift()!();
    },
    /** The browser's own Back (the PS5's ○): leaves the page when only "page" is left. */
    browserBack(): "left" | "stayed" {
      if (entries.length === 1) return "left";
      entries.pop();
      pop?.();
      return "stayed";
    },
    tick(ms: number) {
      clock += ms;
    },
  };
}

/** The page: a stack of levels (Files folder, modal...), the back action closes the top one. */
function page(f: ReturnType<typeof fakeEnv>) {
  const open: (() => void)[] = [];
  const runBack = vi.fn(() => {
    open.pop()?.();
  });
  const h = createBackHistory(f.env, runBack);
  return {
    h,
    runBack,
    open() {
      open.push(h.addLevel());
      f.flush();
    },
    /** Closed with an on-screen button, not Back. */
    closeByButton() {
      open.pop()?.();
      f.flush();
    },
    depth: () => open.length,
  };
}

describe("back history", () => {
  it("one guard while the page has somewhere to go back to, however deep", () => {
    const f = fakeEnv();
    const p = page(f);
    expect(f.entries).toEqual(["page"]);
    p.open(); // a folder
    p.open(); // a sheet over it
    p.open(); // a dialog from the sheet
    expect(f.entries).toEqual(["page", "guard"]);
    expect(f.env.push).toHaveBeenCalledTimes(1);
  });

  it("○_steps_back_inside_the_page_and_leaves_only_from_the_first_screen", () => {
    const f = fakeEnv();
    const p = page(f);
    p.open();
    p.open();
    f.tick(1000);
    expect(f.browserBack()).toBe("stayed");
    f.flush();
    expect(p.runBack).toHaveBeenCalledTimes(1);
    expect(p.depth()).toBe(1);
    expect(f.entries).toEqual(["page", "guard"]); // put back: still somewhere to go
    f.tick(1000);
    expect(f.browserBack()).toBe("stayed");
    f.flush();
    expect(p.depth()).toBe(0);
    expect(f.entries).toEqual(["page"]); // the first screen: no guard
    expect(f.browserBack()).toBe("left");
    expect(p.runBack).toHaveBeenCalledTimes(2);
  });

  it("a level closed by a button removes the guard, and that pop runs nothing", () => {
    const f = fakeEnv();
    const p = page(f);
    p.open();
    p.closeByButton();
    expect(f.entries).toEqual(["page"]);
    expect(f.env.back).toHaveBeenCalledTimes(1);
    expect(p.runBack).not.toHaveBeenCalled();
    // Closing one of two keeps the guard.
    p.open();
    p.open();
    p.closeByButton();
    expect(f.entries).toEqual(["page", "guard"]);
  });

  it("Escape/Backspace take the same path: history.back() when the guard is up", () => {
    const f = fakeEnv();
    const p = page(f);
    p.open();
    f.tick(1000);
    p.h.requestBack();
    expect(f.env.back).toHaveBeenCalledTimes(1);
    expect(p.runBack).not.toHaveBeenCalled(); // not yet: the popstate runs it
    f.flush();
    expect(p.runBack).toHaveBeenCalledTimes(1);
    expect(f.entries).toEqual(["page"]);
    // No guard (first screen): the back action runs at once, nothing is popped.
    p.h.requestBack();
    expect(p.runBack).toHaveBeenCalledTimes(2);
    expect(f.env.back).toHaveBeenCalledTimes(1);
    expect(f.entries).toEqual(["page"]);
  });

  it("one press reported twice (key and browser Back) steps back once", () => {
    const f = fakeEnv();
    const p = page(f);
    p.open();
    p.open();
    f.tick(1000);
    f.browserBack();
    f.tick(BACK_ECHO_MS - 1);
    f.env.push(); // the browser had more history: a second pop arrives at once
    f.browserBack();
    f.flush();
    expect(p.runBack).toHaveBeenCalledTimes(1);
    expect(p.depth()).toBe(1);
    expect(f.entries[f.entries.length - 1]).toBe("guard");
  });

  it("a reload with the guard on top drops it", () => {
    const f = fakeEnv(true);
    const p = page(f);
    f.flush();
    expect(f.entries).toEqual(["page"]);
    expect(p.runBack).not.toHaveBeenCalled();
  });
});
