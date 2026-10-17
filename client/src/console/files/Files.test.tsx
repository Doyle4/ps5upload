import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../api")>();
  return { ...real, call: vi.fn() };
});

import { ApiError, call } from "../api";
import type { Volume } from "../home/Home";
import { t } from "../strings";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { ActionsSheet } from "./ActionsSheet";
import { DirList } from "./DirList";
import { filesErrorText, FilesView, upFrom, viewKind, type FilesViewProps } from "./Files";
import { IntoItselfError, renameEntry } from "./move";
import { TextPrompt } from "./TextPrompt";
import type { DirState, Entry } from "./useDir";

const mockCall = vi.mocked(call);

const CJK = "完蛋！我被美女包围了！";

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  const out: ReactElement<Record<string, unknown>>[] = [];
  const walk = (n: ReactNode) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isValidElement(n)) return;
    const el = n as ReactElement<Record<string, unknown>>;
    out.push(el);
    walk(el.props.children as ReactNode);
  };
  walk(node);
  return out;
}

const entry = (name: string, kind: Entry["kind"] = "file", size = 10): Entry => ({ name, kind, size, mtime: 0 });

const dir = (entries: Entry[], over: Partial<DirState> = {}): DirState => ({
  entries,
  more: false,
  loading: false,
  loaded: true,
  error: null,
  ...over,
});

const vol = (path: string, mount_from = "/dev/x"): Volume => ({
  path,
  mount_from,
  fs_type: "ufs",
  total_bytes: 1000,
  free_bytes: 400,
  writable: true,
});

function props(over: Partial<FilesViewProps> = {}): FilesViewProps {
  return {
    path: "/data/games",
    volumes: [vol("/data"), vol("/mnt/usb0", "/dev/da0s1")],
    volumesError: false,
    dir: dir([entry("a.txt"), entry("b"), entry("c")]),
    selecting: false,
    selected: [],
    ask: null,
    busy: null,
    message: null,
    tasks: [],
    onOpen: vi.fn(),
    onUp: vi.fn(),
    onEntry: vi.fn(),
    onLoadMore: vi.fn(),
    onToggleSelecting: vi.fn(),
    onToggleItem: vi.fn(),
    onAsk: vi.fn(),
    onDismiss: vi.fn(),
    onConfirmDelete: vi.fn(),
    onRename: vi.fn(),
    onMkdir: vi.fn(),
    onPicked: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  mockCall.mockReset();
  mockCall.mockResolvedValue({} as never);
});

describe("Files", () => {
  it("delete_confirm_names_item_and_count", () => {
    // Delete in the actions sheet only asks.
    const p = props({ ask: { kind: "sheet", names: ["a.txt", "b", "c"] } });
    const sheet = elements(FilesView(p)).find((e) => e.type === ActionsSheet);
    expect(sheet).toBeDefined();
    (sheet!.props.onChoose as (a: string) => void)("delete");
    expect(p.onAsk).toHaveBeenCalledWith({ kind: "delete", names: ["a.txt", "b", "c"] });
    expect(mockCall).not.toHaveBeenCalled();

    // Several: the count in the title, the first item named in the body.
    const many = props({ ask: { kind: "delete", names: ["a.txt", "b", "c"] } });
    const d = elements(FilesView(many)).find((e) => e.type === ConfirmDialog)!;
    expect(d.props.title).toBe(t("cw_files_del_many", { n: 3 }));
    expect(d.props.title).toContain("3");
    expect(d.props.body).toContain(t("cw_files_del_list_many", { name: "a.txt", more: 2 }));
    expect(d.props.body).toContain("a.txt");
    expect(d.props.danger).toBe(true);
    (d.props.onConfirm as () => void)();
    expect(many.onConfirmDelete).toHaveBeenCalledWith(["a.txt", "b", "c"]);

    // One: named in the title.
    const one = props({ ask: { kind: "delete", names: [CJK] } });
    const d1 = elements(FilesView(one)).find((e) => e.type === ConfirmDialog)!;
    expect(d1.props.title).toBe(t("cw_files_del_one", { name: CJK }));
    expect(d1.props.title).toContain(CJK);
  });

  it("unicode_names_render_and_round_trip", async () => {
    const p = props({ dir: dir([entry(CJK, "dir")]) });
    expect(renderToStaticMarkup(<FilesView {...p} />)).toContain(CJK);

    // The row carries the name unchanged; ⋯ asks for its sheet with that name.
    const list = DirList({
      entries: p.dir.entries,
      selecting: false,
      selected: [],
      onEntry: p.onEntry,
      onToggleItem: p.onToggleItem,
      onActions: (name) => p.onAsk({ kind: "sheet", names: [name] }),
    });
    const row = elements(list).find((e) => e.props["data-entry"] !== undefined)!;
    expect(row.props["data-entry"]).toBe(CJK);
    const html = renderToStaticMarkup(list);
    expect(html).toContain(CJK);

    // Rename's text box starts with the name; the new name goes back with the old one as-is.
    const r = props({ ask: { kind: "rename", name: CJK } });
    const prompt = elements(FilesView(r)).find((e) => e.type === TextPrompt)!;
    expect(prompt.props.initial).toBe(CJK);
    (prompt.props.onSubmit as (v: string) => void)(`${CJK} 2`);
    expect(r.onRename).toHaveBeenCalledWith(CJK, `${CJK} 2`);

    await renameEntry("/data/games", CJK, `${CJK} 2`);
    expect(mockCall).toHaveBeenCalledWith("/api/fs/rename", {
      from: `/data/games/${CJK}`,
      to: `/data/games/${CJK} 2`,
    });
    // And it survives JSON both ways (what call() sends).
    expect(JSON.parse(JSON.stringify(mockCall.mock.calls[0][1])).from).toBe(`/data/games/${CJK}`);
  });

  it("the drive list shows each drive with its free space", () => {
    const html = renderToStaticMarkup(<FilesView {...props({ path: null })} />);
    expect(html).toContain(t("cw_home_vol_internal"));
    expect(html).toContain(t("cw_home_vol_usb"));
    expect(html.split("data-drive=").length - 1).toBe(2);
  });

  it("○ goes up one folder, and from a drive's top to the drive list", () => {
    const vols = [vol("/data"), vol("/mnt/usb0")];
    expect(upFrom("/data/a/b", vols)).toBe("/data/a");
    expect(upFrom("/data", vols)).toBeNull();
    expect(upFrom("/mnt/usb0/x", vols)).toBe("/mnt/usb0");
    expect(upFrom("/mnt/usb0", vols)).toBeNull();
    expect(upFrom(null, vols)).toBeNull();
  });

  it("copy and move are off while a copy or move request runs", () => {
    const p = props({ ask: { kind: "sheet", names: ["a.txt"] }, busy: { op: "copy", done: 1, total: 3 } });
    const sheet = elements(FilesView(p)).find((e) => e.type === ActionsSheet)!;
    expect(sheet.props.busy).toBe(true);
    const html = renderToStaticMarkup(<FilesView {...p} />);
    expect(html).toContain(t("cw_files_starting", { done: 1, total: 3 }));
  });

  it("only images and text open in the viewer", () => {
    expect(viewKind("a.PNG")).toBe("image");
    expect(viewKind("a.jpg")).toBe("image");
    expect(viewKind("x.log")).toBe("text");
    expect(viewKind("x.xml")).toBe("text");
    expect(viewKind("eboot.bin")).toBeNull();
    expect(viewKind("noext")).toBeNull();
  });

  it("select mode: ✕ on a row toggles it instead of opening", () => {
    const onEntry = vi.fn();
    const onToggleItem = vi.fn();
    const list = DirList({
      entries: [entry("a.txt")],
      selecting: true,
      selected: ["a.txt"],
      onEntry,
      onToggleItem,
      onActions: () => {},
    });
    const main = elements(list).find((e) => e.props["data-entry-main"] !== undefined)!;
    expect(main.props["aria-pressed"]).toBe(true);
    (main.props.onClick as () => void)();
    expect(onToggleItem).toHaveBeenCalledWith("a.txt");
    expect(onEntry).not.toHaveBeenCalled();
  });

  it("errors name what went wrong", () => {
    expect(filesErrorText(new ApiError(403, "forbidden"))).toBe(t("cw_files_err_denied"));
    expect(filesErrorText(new ApiError(409, "exists"))).toBe(t("cw_files_err_exists"));
    expect(filesErrorText(new ApiError(401, "token"))).toBeNull();
    expect(filesErrorText(new IntoItselfError("/data/a"))).toBe(t("cw_files_err_into_itself"));
  });

  it("409_shows_exists_only_for_an_exist_code", () => {
    expect(filesErrorText(new ApiError(409, "the destination already exists"))).toBe(t("cw_files_err_exists"));
    expect(filesErrorText(new ApiError(409, "busy"))).toBe(t("cw_home_err_busy"));
    expect(filesErrorText(new ApiError(409, "job_in_progress"))).toBe(
      t("cw_home_err_failed", { code: "job_in_progress" }),
    );
  });
});
