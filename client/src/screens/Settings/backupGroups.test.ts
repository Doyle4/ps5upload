import { expect, it } from "vitest";
import { groupBackups, type BackupItem } from "./backupGroups";

const b = (device: string, at: number, sig = "daily|40|9000"): BackupItem<number> => ({ device, at, sig, item: at });

it("groups by device, newest device first, newest copy first", () => {
  const g = groupBackups([b("PC", 1, "a"), b("Browser", 5, "a"), b("PC", 3, "b")]);
  expect(g.map((x) => x.device)).toEqual(["Browser", "PC"]);
  expect(g[1].rows.map((r) => r.newest.at)).toEqual([3, 1]);
  expect(g[1].total).toBe(2);
});

it("folds back-to-back look-alike copies into one row that restores the newest", () => {
  const g = groupBackups([b("Browser", 1), b("Browser", 4), b("Browser", 2), b("Browser", 3, "manual|40|9000"), b("Browser", 6)]);
  expect(g).toHaveLength(1);
  expect(g[0].rows.map((r) => [r.newest.at, r.count, r.oldestAt])).toEqual([
    [6, 2, 4],
    [3, 1, 3],
    [2, 2, 1],
  ]);
  expect(g[0].total).toBe(5);
});

it("keeps an empty list empty", () => {
  expect(groupBackups([])).toEqual([]);
});

it("keeps every folded copy reachable, newest first, so each stays restorable", () => {
  const g = groupBackups([b("Browser", 1), b("Browser", 4), b("Browser", 2), b("Browser", 3, "manual|40|9000"), b("Browser", 6)]);
  expect(g[0].rows.map((r) => r.copies.map((c) => c.item))).toEqual([[6, 4], [3], [2, 1]]);
  for (const r of g[0].rows) {
    expect(r.copies[0]).toBe(r.newest);
    expect(r.copies).toHaveLength(r.count);
  }
});
