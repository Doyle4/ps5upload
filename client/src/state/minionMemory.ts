// Which consoles this computer turned PS5Upload Minion off (or removed it) on. The console's own
// settings file is the truth; this only matters when that file is gone (its /data/ps5upload folder
// was wiped, or the helper never saved one): the helper then starts with the defaults, Minion on,
// and the next connection from here turns it off again instead of letting it come back.

import { minionSet } from "../api/consoleFiles";
import { hostOf } from "../lib/addr";
import { safeGetItem, safeSetItem } from "../lib/safeStorage";
import { log } from "./logs";

const KEY = "ps5upload.minionOff";

function read(): string[] {
  try {
    const v = JSON.parse(safeGetItem(KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Remember the choice made for `host` from this computer. */
export function rememberMinion(host: string, off: boolean): void {
  const h = hostOf(host);
  if (!h) return;
  const rest = read().filter((x) => x !== h);
  safeSetItem(KEY, JSON.stringify(off ? [...rest, h] : rest));
}

export function minionRememberedOff(host: string): boolean {
  return read().includes(hostOf(host));
}

/** What to do when the helper answers: turn Minion off again only when this computer turned it
 *  off, the console says it is on, and it has no settings file (so nobody chose "on" there). */
export function minionNeedsReapply(
  rememberedOff: boolean,
  state: { supported: boolean; enabled?: boolean; saved?: boolean },
): boolean {
  return rememberedOff && state.supported && state.enabled === true && state.saved === false;
}

/** Run once per helper connection (AppShell). */
export async function keepMinionOff(host: string): Promise<void> {
  if (!minionRememberedOff(host)) return;
  try {
    const s = await minionSet(host);
    if (!s.supported || !minionNeedsReapply(true, s)) return;
    await minionSet(host, { enabled: false });
    log.info("minion", `${hostOf(host)} lost its Minion settings; turned Minion off again as chosen here`);
  } catch (e) {
    log.warn("minion", `could not check Minion on ${hostOf(host)}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
