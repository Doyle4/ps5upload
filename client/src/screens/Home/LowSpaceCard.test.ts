import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { lowDrive } from "./LowSpaceCard";

const GB = 1024 ** 3;
const vol = (path: string, free: number, total: number, extra: Record<string, unknown> = {}) =>
  ({ path, fs_type: "ufs", free_bytes: free * GB, total_bytes: total * GB, writable: true, is_placeholder: false, ...extra }) as never;

describe("lowDrive", () => {
  it("names the fullest drive that is low", () => {
    expect(lowDrive([vol("/data", 300, 800), vol("/mnt/ext0", 30, 1000), vol("/mnt/usb0", 5, 64)])).toMatchObject({ path: "/mnt/ext0" });
  });
  it("says nothing when every drive has room, or for read-only and placeholder drives", () => {
    expect(lowDrive([vol("/data", 300, 800)])).toBeNull();
    expect(lowDrive([vol("/mnt/x", 1, 100, { writable: false }), vol("/mnt/y", 1, 100, { is_placeholder: true })])).toBeNull();
  });
});
