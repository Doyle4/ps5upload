import { describe, expect, it } from "vitest";

import { Clock, cmpHlc, merge, pruneTombstones, sameMap, TOMBSTONE_TTL_MS, type LwwMap } from "./meshCrdt";

function rand(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function randomMap(r: () => number): LwwMap {
  const m: LwwMap = {};
  const n = Math.floor(r() * 6);
  for (let i = 0; i < n; i++) {
    const k = `k${Math.floor(r() * 4)}`;
    m[k] = {
      v: r() < 0.25 ? null : `v${Math.floor(r() * 10)}`,
      h: { t: Math.floor(r() * 5), c: Math.floor(r() * 3), d: `d${Math.floor(r() * 3)}` },
    };
  }
  return m;
}

describe("merge is a CRDT join", () => {
  it("is commutative, associative and idempotent (random maps)", () => {
    const r = rand(42);
    for (let i = 0; i < 500; i++) {
      const [a, b, c] = [randomMap(r), randomMap(r), randomMap(r)];
      // Registers with equal stamps but different values are not something one device makes
      // (a stamp names one change), so normalise those before checking.
      const fix = (m: LwwMap) => {
        for (const [k, reg] of Object.entries(m)) reg.v = `${k}:${reg.h.t}.${reg.h.c}.${reg.h.d}`;
        return m;
      };
      fix(a);
      fix(b);
      fix(c);
      expect(sameMap(merge(a, b), merge(b, a))).toBe(true);
      expect(sameMap(merge(merge(a, b), c), merge(a, merge(b, c)))).toBe(true);
      expect(sameMap(merge(a, a), a)).toBe(true);
    }
  });

  it("keeps the later change, removals included", () => {
    const add = { v: "Phat", h: { t: 10, c: 0, d: "mac" } };
    const del = { v: null, h: { t: 20, c: 0, d: "phone" } };
    expect(merge({ x: add }, { x: del }).x).toEqual(del);
    expect(merge({ x: del }, { x: add }).x).toEqual(del);
  });
});

describe("Clock", () => {
  it("never goes backwards and moves past what it sees", () => {
    let wall = 1000;
    const c = new Clock("me", undefined, () => wall);
    const a = c.now();
    const b = c.now(); // same millisecond
    expect(cmpHlc(b, a)).toBe(1);
    wall = 500; // the wall clock jumped back
    expect(cmpHlc(c.now(), b)).toBe(1);
    c.observe({ t: 5000, c: 3, d: "other" }); // another device runs ahead
    const after = c.now();
    expect(after.t).toBe(5000);
    expect(after.c).toBe(4);
  });

  it("orders a device's edits even when its clock is behind another's", () => {
    let wall = 100;
    const slow = new Clock("slow", undefined, () => wall);
    slow.observe({ t: 9999, c: 0, d: "fast" }); // it synced with a device far ahead
    const edit = slow.now();
    expect(cmpHlc(edit, { t: 9999, c: 0, d: "fast" })).toBe(1);
    wall = 101;
    expect(cmpHlc(slow.now(), edit)).toBe(1);
  });
});

describe("tombstones", () => {
  it("are kept for a year, then dropped", () => {
    const now = 2 * TOMBSTONE_TTL_MS;
    const m: LwwMap = {
      old: { v: null, h: { t: 1, c: 0, d: "a" } },
      recent: { v: null, h: { t: now - 1000, c: 0, d: "a" } },
      value: { v: "x", h: { t: 1, c: 0, d: "a" } },
    };
    expect(Object.keys(pruneTombstones(m, now)).sort()).toEqual(["recent", "value"]);
  });
});
