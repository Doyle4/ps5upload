import { describe, expect, it } from "vitest";

import { backupHosts, clampKeep, legacySettings } from "./autoSaveBackup";
import { stampLabel } from "../screens/GameHub/SaveBackupsList";

describe("automatic save backup (engine-run)", () => {
  it("hands over an older version's settings only when a folder was set", () => {
    expect(legacySettings(JSON.stringify({ enabled: true, dir: "/Users/me/saves", keep: 99 }))).toEqual({
      enabled: true,
      dir: "/Users/me/saves",
      keep: 50,
    });
    expect(legacySettings(JSON.stringify({ enabled: true, dir: " " }))).toBeNull();
    expect(legacySettings(null)).toBeNull();
    expect(legacySettings("not json")).toBeNull();
  });

  it("gives the engine every console once, by bare address", () => {
    expect(backupHosts([{ host: "192.168.1.9" }, { host: "192.168.1.9:9021" }, { host: "10.0.0.2" }, { host: "" }])).toEqual([
      "10.0.0.2",
      "192.168.1.9",
    ]);
  });

  it("keeps the version count between 1 and 50", () => {
    expect(clampKeep(0)).toBe(1);
    expect(clampKeep(80)).toBe(50);
    expect(clampKeep("x")).toBe(5);
  });

  it("labels a backup's time in UTC", () => {
    expect(stampLabel("2026-10-24_101530")).toBe("2026-10-24 10:15 UTC");
    expect(stampLabel("odd")).toBe("odd");
  });
});
