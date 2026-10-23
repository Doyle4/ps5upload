import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SECTIONS } from "../sections";
import { t } from "../strings";
import { LibraryView, type LibraryViewProps } from "./Library";
import { copyDest, displayName, entriesOf, filterEntries, parseScan, stagePath, STAGE_DIR, type LibScan } from "./model";

const SCAN_JSON = JSON.stringify({
  source: "3fa2c1d0",
  scanned: 1761200000,
  complete: true,
  stopped: null,
  entries: 40,
  items: [
    { kind: "pkg", path: "PS5/Astro.pkg", name: "Astro.pkg", title: "Astro Bot", title_id: "PPSA01650", content_id: "UP9000-PPSA01650_00-ASTRO", version: "01.000.016", category: "gd", type: "game", platform: "ps5", fw: "7.50", fake: true, size: 1024, icon: "3fa2c1d0-abc-0.png" },
    { kind: "folder", path: "PS4/CUSA07842", name: "CUSA07842", title: "Jak X", title_id: "CUSA07842", content_id: "", version: "01.02", category: "gd", type: "game", platform: "ps4", fw: "", fake: false, size: 0, icon: "" },
    { kind: "image", path: "img/PPSA09999 Venus.exfat", name: "PPSA09999 Venus.exfat", title: "", title_id: "PPSA09999", content_id: "", version: "", category: "", type: "game", platform: "ps5", fw: "", fake: false, size: 5, icon: "../../etc/x.png" },
    { kind: "nope", path: "x" },
    { kind: "pkg", path: "" },
  ],
});

describe("library model", () => {
  it("reads a cached scan field by field and drops what is not an item", () => {
    const s = parseScan(SCAN_JSON) as LibScan;
    expect(s.complete).toBe(true);
    expect(s.items.map((i) => i.kind)).toEqual(["pkg", "folder", "image"]);
    expect(s.items[0].fake).toBe(true);
    // a cover name is only ever a plain file in the icons folder
    expect(s.items[2].icon).toBe("");
    expect(parseScan("not json")).toBeNull();
    expect(parseScan("{}")).toBeNull();
  });

  it("names, joins and filters entries across sources", () => {
    const s = parseScan(SCAN_JSON) as LibScan;
    const list = entriesOf(
      [
        { id: "console", name: "This PS5" },
        { id: "3fa2c1d0", name: "NAS" },
      ],
      new Map([
        ["console", { scanned: 1, complete: true, stopped: null, items: [{ ...s.items[1], path: "/data/homebrew/Jak" }] }],
        ["3fa2c1d0", s],
      ]),
    );
    expect(list.map(displayName)).toEqual(["Astro Bot", "Jak X", "Jak X", "PPSA09999 Venus"]);
    expect(list.find((e) => e.source === "console")?.at).toBe("/data/homebrew/Jak");
    expect(list.find((e) => e.kind === "pkg")?.at).toBe("smb://3fa2c1d0/PS5/Astro.pkg");
    expect(filterEntries(list, "venus").length).toBe(1);
    expect(filterEntries(list, "cusa07842").length).toBe(2);
    expect(filterEntries(list, "  ").length).toBe(4);
  });

  it("copies into the drive's homebrew folder and stages packages in the helper's staging folder", () => {
    expect(copyDest("/mnt/usb0", { name: "CUSA07842", path: "PS4/CUSA07842" })).toBe("/mnt/usb0/homebrew/CUSA07842");
    expect(copyDest("/data", { name: "PPSA09999 Venus.exfat", path: "img/PPSA09999 Venus.exfat" })).toBe("/data/homebrew/PPSA09999 Venus.exfat");
    expect(stagePath(36 ** 3)).toBe(`${STAGE_DIR}/library-1000.pkg`);
    expect(STAGE_DIR).toBe("/user/data/ps5upload/pkg_temp");
  });
});

const base = (over: Partial<LibraryViewProps> = {}): LibraryViewProps => ({
  sources: [
    { id: "console", name: "This PS5" },
    { id: "3fa2c1d0", name: "NAS" },
  ],
  scans: new Map([["3fa2c1d0", parseScan(SCAN_JSON)]]),
  loaded: true,
  query: "",
  task: null,
  message: null,
  open: null,
  drives: [],
  copied: null,
  onQuery: vi.fn(),
  onScan: vi.fn(),
  onStop: vi.fn(),
  onOpen: vi.fn(),
  onInstall: vi.fn(),
  onCopy: vi.fn(),
  onRegister: vi.fn(),
  ...over,
});
const html = (over: Partial<LibraryViewProps> = {}) => renderToStaticMarkup(<LibraryView {...base(over)} />);

describe("Library section", () => {
  it("is in the rail right after Games", () => {
    const ids = SECTIONS.map((s) => s.id);
    expect(ids.indexOf("library")).toBe(ids.indexOf("games") + 1);
    expect(SECTIONS.find((s) => s.id === "library")?.labelKey).toBe("cw_lib_title");
  });

  it("shows the cached games with their kind and source", () => {
    const h = html();
    expect(h).toContain("Astro Bot");
    expect(h).toContain("PPSA09999 Venus");
    expect(h).toContain(t("cw_lib_kind_folder"));
    expect(h).toContain("NAS");
  });

  it("says when nothing was scanned, and when a scan stopped at its limit", () => {
    expect(html({ scans: new Map() })).toContain(t("cw_lib_never"));
    const partial = { ...(parseScan(SCAN_JSON) as LibScan), complete: false, stopped: "items" };
    expect(html({ scans: new Map([["3fa2c1d0", partial]]) })).toContain(t("cw_lib_partial", { name: "NAS" }));
  });

  it("offers Install for a package, Copy per drive for a folder on a share, and Register once it is copied", () => {
    const s = parseScan(SCAN_JSON) as LibScan;
    const entries = entriesOf(base().sources, new Map([["3fa2c1d0", s]]));
    const pkg = entries.find((e) => e.kind === "pkg")!;
    const folder = entries.find((e) => e.kind === "folder")!;
    expect(html({ open: pkg })).toContain(t("cw_lib_install"));
    const drive = { path: "/mnt/usb0", mount_from: "/dev/da0s1", fs_type: "exfatfs", total_bytes: 100, free_bytes: 50, writable: true };
    const h = html({ open: folder, drives: [drive] });
    expect(h).not.toContain(t("cw_lib_install"));
    expect(h).toContain(t("cw_lib_copy_to", { drive: "" }).trim().split(" ")[0]);
    expect(h).not.toContain(t("cw_lib_register"));
    expect(html({ open: folder, drives: [drive], copied: { key: folder.key, path: "/mnt/usb0/homebrew/CUSA07842" } })).toContain(
      t("cw_lib_register"),
    );
  });
});
