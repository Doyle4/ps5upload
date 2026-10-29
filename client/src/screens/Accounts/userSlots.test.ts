import { describe, expect, it } from "vitest";

import type { ProfileSlot, ProfileUser } from "../../api/ps5";
import { userSlots } from "./index";

const user = (uid: number, username: string): ProfileUser => ({ uid, uid_hex: `0x${uid.toString(16)}`, username });
const slot = (n: number, name: string): ProfileSlot => ({
  slot: n,
  name,
  type: "np",
  flags: 0,
  id: "0x1",
  activated: true,
  offline_activated: false,
});

describe("userSlots", () => {
  it("pairs each user with the slot carrying their name", () => {
    const m = userSlots([user(1, "alice"), user(2, "bob")], [slot(1, "bob"), slot(2, "alice")]);
    expect(m.get(1)?.slot).toBe(2);
    expect(m.get(2)?.slot).toBe(1);
  });

  it("pairs a lone user with the lone named slot", () => {
    const m = userSlots([user(1, "")], [slot(1, "alice"), slot(2, "")]);
    expect(m.get(1)?.slot).toBe(1);
  });

  it("leaves a user without a matching slot unpaired", () => {
    const m = userSlots([user(1, "alice"), user(2, "bob")], [slot(1, "carol")]);
    expect(m.size).toBe(0);
  });
});
