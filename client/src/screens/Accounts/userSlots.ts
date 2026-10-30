import type { ProfileSlot, ProfileUser } from "../../api/ps5";

/** Each user's account slot: the slot carrying the user's name (how the console's account and the
 *  sign-in tools find it), or, with one user and one named slot, that slot. */
export function userSlots(users: ProfileUser[], slots: ProfileSlot[]): Map<number, ProfileSlot> {
  const out = new Map<number, ProfileSlot>();
  for (const u of users) {
    const name = u.username.trim();
    const s = name ? slots.find((x) => x.name.trim() === name) : undefined;
    if (s) out.set(u.uid, s);
  }
  const named = slots.filter((s) => s.name.trim());
  if (users.length === 1 && out.size === 0 && named.length === 1) out.set(users[0].uid, named[0]);
  return out;
}
