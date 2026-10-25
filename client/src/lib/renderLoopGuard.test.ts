import { describe, expect, it, vi } from "vitest";
import { create } from "zustand";

import { guardSet, isRenderLoopError } from "./renderLoopGuard";

describe("guardSet", () => {
  it("keeps the write and reports a render loop thrown by a listener", () => {
    const onLoop = vi.fn();
    const store = create<{ n: number; bump: () => void }>((rawSet) => {
      const set = guardSet(rawSet, onLoop);
      return { n: 0, bump: () => set((s) => ({ n: s.n + 1 })) };
    });
    store.subscribe(() => {
      throw new Error("Minified React error #185; visit https://react.dev/errors/185");
    });
    expect(() => store.getState().bump()).not.toThrow();
    expect(store.getState().n).toBe(1);
    expect(onLoop).toHaveBeenCalledTimes(1);
  });

  it("lets any other listener error through", () => {
    const store = create<{ n: number; bump: () => void }>((rawSet) => {
      const set = guardSet(rawSet, () => {});
      return { n: 0, bump: () => set({ n: 1 }) };
    });
    store.subscribe(() => {
      throw new Error("something else");
    });
    expect(() => store.getState().bump()).toThrow("something else");
  });

  it("knows the error in both forms", () => {
    expect(isRenderLoopError(new Error("Maximum update depth exceeded. This can happen…"))).toBe(true);
    expect(isRenderLoopError("Minified React error #185")).toBe(true);
    expect(isRenderLoopError(new Error("Minified React error #310"))).toBe(false);
  });
});
