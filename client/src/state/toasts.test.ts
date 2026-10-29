import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useToastStore } from "./toasts";

describe("toast expiry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.getState().dismissAll();
  });
  afterEach(() => {
    useToastStore.getState().dismissAll();
    vi.useRealTimers();
  });

  it("expires every non-sticky toast on schedule, shown or not", () => {
    const s = useToastStore.getState();
    // More than the Toaster shows at once; the oldest are never rendered.
    for (let i = 0; i < 6; i++) s.push({ message: `m${i}`, tone: "info", duration: 1000 });
    expect(useToastStore.getState().toasts).toHaveLength(6);
    vi.advanceTimersByTime(1000);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("keeps a sticky toast until dismissed, and does not hold others behind it", () => {
    const s = useToastStore.getState();
    const sticky = s.push({ message: "hot", tone: "critical" });
    for (let i = 0; i < 4; i++) s.push({ message: `m${i}`, tone: "success" });
    vi.advanceTimersByTime(60_000);
    expect(useToastStore.getState().toasts.map((t) => t.id)).toEqual([sticky]);
    useToastStore.getState().dismiss(sticky);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("a toast dismissed early does not fire its timer later", () => {
    const s = useToastStore.getState();
    const a = s.push({ message: "a", duration: 1000 });
    s.dismiss(a);
    expect(vi.getTimerCount()).toBe(0);
  });
});
