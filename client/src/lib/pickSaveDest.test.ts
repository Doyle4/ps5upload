import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockIsIOS, mockRoots, mockList, mockSave } = vi.hoisted(() => ({
  mockIsIOS: vi.fn(),
  mockRoots: vi.fn(),
  mockList: vi.fn(),
  mockSave: vi.fn(),
}));

vi.mock("./platform", () => ({ isIOS: () => mockIsIOS() }));
vi.mock("../api/localFs", () => ({
  localFs: { storageRoots: () => mockRoots(), listDir: (p: string) => mockList(p) },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: (o: unknown) => mockSave(o) }));

import { pickSaveDest } from "./pickSaveDest";

const DOCS = "/var/mobile/Containers/Data/Application/X/Documents";

describe("pickSaveDest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRoots.mockResolvedValue([DOCS]);
    mockList.mockResolvedValue([]);
  });

  it("uses the system save dialog off iPhone", async () => {
    mockIsIOS.mockReturnValue(false);
    mockSave.mockResolvedValue("/Users/me/x.zip");
    expect(await pickSaveDest({ defaultPath: "x.zip" })).toBe("/Users/me/x.zip");
    expect(mockSave).toHaveBeenCalledWith({ defaultPath: "x.zip" });
  });

  it("keeps a cancelled dialog as null", async () => {
    mockIsIOS.mockReturnValue(false);
    mockSave.mockResolvedValue(null);
    expect(await pickSaveDest({ defaultPath: "x.zip" })).toBeNull();
  });

  it("writes into the app's Documents folder on iPhone, with no dialog", async () => {
    mockIsIOS.mockReturnValue(true);
    expect(await pickSaveDest({ defaultPath: "ps5upload-logs.txt" })).toBe(`${DOCS}/ps5upload-logs.txt`);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("never replaces a file already there", async () => {
    mockIsIOS.mockReturnValue(true);
    mockList.mockResolvedValue([{ name: "save.zip" }, { name: "save (2).zip" }]);
    expect(await pickSaveDest({ defaultPath: "some/dir/save.zip" })).toBe(`${DOCS}/save (3).zip`);
  });

  it("names an export with no suggestion", async () => {
    mockIsIOS.mockReturnValue(true);
    expect(await pickSaveDest({})).toBe(`${DOCS}/ps5upload-export`);
  });
});
