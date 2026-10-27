import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ profileInfo: vi.fn(), profileAvatarCurrent: vi.fn() }));
vi.mock("../../api/ps5", () => api);

import type { ProfileInfo } from "../../api/ps5";
import { clearGreetedUserCache, initials, pickGreetedUser } from "./consoleUser";

const info = (over: Partial<ProfileInfo>): ProfileInfo => ({
  ok: true,
  uid: 0,
  uid_hex: "",
  username: "",
  users: [
    { uid: 0x10000001, uid_hex: "10000001", username: "Alex" },
    { uid: 0x10000002, uid_hex: "10000002", username: "Sam" },
  ],
  slots: [],
  ...over,
});

afterEach(() => clearGreetedUserCache());

describe("pickGreetedUser", () => {
  it("greets the user at the console", () => {
    expect(pickGreetedUser(info({ uid: 0x10000002 }))).toEqual({ uid: 0x10000002, name: "Sam" });
  });

  it("falls back to the first named local user when the helper has no foreground session", () => {
    expect(pickGreetedUser(info({ uid: 0 }))).toEqual({ uid: 0x10000001, name: "Alex" });
    expect(pickGreetedUser(info({ uid: 0xffffffff }))).toEqual({ uid: 0x10000001, name: "Alex" });
  });

  it("uses the reported name for a foreground user missing from the list", () => {
    expect(pickGreetedUser(info({ uid: 0x10000009, username: "Guest" }))).toEqual({
      uid: 0x10000009,
      name: "Guest",
    });
  });

  it("greets nobody rather than someone else when the foreground user has no name", () => {
    expect(pickGreetedUser(info({ uid: 0x10000009 }))).toBeNull();
  });

  it("greets nobody on a console without named users", () => {
    expect(pickGreetedUser(info({ users: [] }))).toBeNull();
  });
});

describe("initials", () => {
  it("takes the first letters of two words", () => {
    expect(initials("Jane Doe")).toBe("JD");
    expect(initials("phantom_ptr")).toBe("PP");
  });

  it("takes one letter of a single word", () => {
    expect(initials("alex")).toBe("A");
  });

  it("keeps a non-Latin first character whole", () => {
    expect(initials("😀 smile")).toBe("😀S");
    expect(initials("游戏")).toBe("游");
  });
});
