import { describe, expect, it, vi } from "vitest";

import type { InstalledTitle, LibraryEntry, Volume } from "../api/ps5";
import { gatherSpacePlan, planVolumes, type GatherDeps } from "./spacePlanGather";

const GB = 1024 ** 3;

const vol = (path: string, free: number, over: Partial<Volume> = {}): Volume => ({
  path,
  fs_type: "ufs",
  total_bytes: 1000 * GB,
  free_bytes: free,
  allocatable_bytes: free,
  likely_fits_bytes: path === "/data" || path === "/user" ? free * 0.8 : free,
  writable: true,
  ...over,
});

const game = (name: string, path: string, over: Partial<LibraryEntry> = {}): LibraryEntry => ({
  kind: "game",
  name,
  path,
  volume: path.split("/").slice(0, path.startsWith("/mnt/") ? 3 : 2).join("/"),
  scope: "homebrew",
  size: 0,
  ...over,
});

const title = (titleId: string, over: Partial<InstalledTitle> = {}): InstalledTitle => ({
  titleId,
  titleName: titleId,
  origin: "pkg",
  imageBacked: false,
  source: "",
  system: false,
  ...over,
});

describe("planVolumes", () => {
  it("keeps real drives and sets image mounts apart", () => {
    const { drives, imageMounts } = planVolumes([
      vol("/data", 10),
      vol("/mnt/usb0", 10),
      vol("/mnt/ps5upload/G", 10, { source_image: "/data/G.exfat" }),
      vol("/mnt/shadowmnt/G_0123abcd", 10, { writable: false }),
      vol("/mnt/ext1", 10, { is_placeholder: true }),
      vol("/mnt/ext0", 10, { writable: false }),
    ]);
    expect(drives.map((v) => v.path)).toEqual(["/data", "/mnt/usb0"]);
    expect(imageMounts).toEqual(["/mnt/ps5upload/G", "/mnt/shadowmnt/G_0123abcd"]);
  });
});

describe("gatherSpacePlan", () => {
  it("reads the console's own room, sizes only folders that could move, and locates only games with a copy", async () => {
    const deps: GatherDeps = {
      volumes: async () => [vol("/user", 50 * GB), vol("/data", 50 * GB), vol("/mnt/usb0", 300 * GB)],
      library: async () => [
        game("Free", "/data/homebrew/Free"),
        game("Registered", "/data/homebrew/Reg"),
        game("OnUsb", "/mnt/usb0/homebrew/U"),
        game("Huge", "/data/homebrew/Huge"),
      ],
      installed: async () => [
        title("PPSA1"),
        title("PPSA2"),
        title("PPSA3", { origin: "registered", source: "/data/homebrew/Reg" }),
      ],
      inventory: vi.fn(async (id: string) => [
        { kind: "base" as const, path: `/user/app/${id}/app.pkg`, size: 70 * GB, fingerprint: "", contentId: "" },
        { kind: "patch" as const, path: `/user/patch/${id}/patch.pkg`, size: 9 * GB, fingerprint: "", contentId: "" },
      ]),
      folderBytes: vi.fn(async (p: string) => (p.endsWith("Huge") ? null : 40 * GB)),
    };
    const g = await gatherSpacePlan(
      {
        target: "/data",
        leftovers: [],
        collectionIds: new Set(["PPSA1"]),
        running: new Set(),
        lastPlayed: () => null,
      },
      deps,
    );
    expect(g.roomBytes).toBe(40 * GB);
    // /user and /data are the drive being cleared; only the USB drive takes moves.
    expect(g.destRoom).toEqual({ "/mnt/usb0": 300 * GB });
    expect(deps.inventory).toHaveBeenCalledTimes(1);
    expect(deps.inventory).toHaveBeenCalledWith("PPSA1");
    expect((deps.folderBytes as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]).sort()).toEqual([
      "/data/homebrew/Free",
      "/data/homebrew/Huge",
    ]);
    expect(g.unmeasured).toBe(1);
    expect(g.candidates.map((c) => [c.id, c.bytes])).toEqual([
      ["move:/data/homebrew/Free", 40 * GB],
      ["move:/data/homebrew/Huge", 0],
      ["uninstall:PPSA1", 70 * GB],
    ]);
  });
});
