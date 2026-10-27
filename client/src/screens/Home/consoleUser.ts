// The signed-in PS5 user Home greets by name, with their current avatar.
//
// One profile read (`profileInfo`: the foreground uid + every local user) and then one avatar read,
// both off the render path and cached per console, so Home paints at once and a second visit (or a
// console switch back) shows the user straight from the cache while it quietly re-reads.
import { useEffect, useState } from "react";
import { profileAvatarCurrent, profileInfo, type ProfileInfo } from "../../api/ps5";

export interface GreetedUser {
  uid: number;
  name: string;
  /** PNG data URL of the current avatar; null for a stock PSN avatar (none readable) or not read yet. */
  avatar: string | null;
}

/** The user to greet: the one at the console, else the first local user with a name.
 *  The foreground uid is 0 when the helper has no session (common), and -1 / 0xFFFFFFFF when
 *  nobody is signed in. A foreground user without a name greets nobody rather than someone else. */
export function pickGreetedUser(info: ProfileInfo): { uid: number; name: string } | null {
  const users = info.users ?? [];
  const fg = info.uid === 0 || info.uid === -1 || info.uid >>> 0 === 0xffffffff ? 0 : info.uid;
  if (fg) {
    const name = (users.find((u) => u.uid >>> 0 === fg >>> 0)?.username ?? info.username ?? "").trim();
    return name ? { uid: fg, name } : null;
  }
  const first = users.find((u) => u.username.trim());
  return first ? { uid: first.uid, name: first.username.trim() } : null;
}

/** One or two letters for the placeholder: the first letter of the first two words of the name
 *  ("Jane Doe" → "JD", "phantom_ptr" → "PP"), else its first letter. */
export function initials(name: string): string {
  const words = name.trim().split(/[\s_.-]+/).filter(Boolean);
  const first = (w: string) => Array.from(w)[0] ?? "";
  const letters = words.length >= 2 ? first(words[0]) + first(words[1]) : first(words[0] ?? "");
  return letters.toLocaleUpperCase();
}

/** How long a cached user counts as current before Home re-reads it in the background. */
const FRESH_MS = 5 * 60_000;

interface Entry {
  user: GreetedUser | null;
  at: number;
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<GreetedUser | null>>();

async function load(addr: string): Promise<GreetedUser | null> {
  const picked = pickGreetedUser(await profileInfo(addr));
  if (!picked) return null;
  // Best-effort: a missing avatar still greets by name, with initials.
  const avatar = await profileAvatarCurrent(picked.uid, addr).catch(() => null);
  return { ...picked, avatar };
}

function fetchUser(addr: string): Promise<GreetedUser | null> {
  let p = inflight.get(addr);
  if (!p) {
    p = load(addr)
      .then((user) => {
        cache.set(addr, { user, at: Date.now() });
        return user;
      })
      .finally(() => inflight.delete(addr));
    inflight.set(addr, p);
  }
  return p;
}

/** The greeted user for the console at `addr` (its mgmt address), or null while unknown, when
 *  nobody can be named, or when `addr` is empty (no console / helper down). A failed read keeps
 *  whatever was cached: the greeting is decoration, never an error. */
export function useGreetedUser(addr: string): GreetedUser | null {
  const [state, setState] = useState<{ addr: string; user: GreetedUser | null }>(() => ({
    addr,
    user: (addr && cache.get(addr)?.user) || null,
  }));
  // A console switch shows the new console's cached user (or nobody) in the same render.
  const user = state.addr === addr ? state.user : (addr && cache.get(addr)?.user) || null;

  useEffect(() => {
    if (!addr) return;
    const hit = cache.get(addr);
    if (hit && Date.now() - hit.at < FRESH_MS) {
      setState({ addr, user: hit.user });
      return;
    }
    let cancelled = false;
    fetchUser(addr)
      .then((u) => {
        if (!cancelled) setState({ addr, user: u });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [addr]);

  return addr ? user : null;
}

/** Test seam: forget every cached user. */
export function clearGreetedUserCache(): void {
  cache.clear();
  inflight.clear();
}
