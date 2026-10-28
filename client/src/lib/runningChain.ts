// Which of the setup wizard's pre-helper payloads (kstuff, ShadowMount+) are
// already running on a console, read from its process list.
//
// The wizard used to send kstuff every time it ran. A console whose own
// autoloader had already loaded it ended up with two copies, and every
// "Run again" (including the retry after a slow helper boot) added another —
// one bug report showed eight. Skipping what is already there is what stops it.

export type ChainPayload = "kstuff" | "shadowmount";

/** The chain payloads present in `processes`. Matches on the thread and
 *  command names, case-insensitively: every kstuff build we have seen
 *  (kstuff.elf, kstuff-lite, Kstuff-NG), shadowmountplus.elf, and HyperHEN's
 *  built-in ShadowMount+ engine, which names itself hyperhen_mount.elf (its
 *  third_party/shadowmountplus/src/main.c PAYLOAD_NAME; its docs call the embedded
 *  build hyperhen_automount.elf, so that counts too). HyperHEN's own process
 *  (HyperHEN.elf) is not enough: on FW 13.40/13.42 it runs without automount. */
export function runningChainPayloads(
  processes: ReadonlyArray<{ name: string; comm?: string }>,
): Set<ChainPayload> {
  const found = new Set<ChainPayload>();
  for (const p of processes) {
    const names = `${p.name} ${p.comm ?? ""}`.toLowerCase();
    if (names.includes("kstuff")) found.add("kstuff");
    if (
      names.includes("shadowmount") ||
      names.includes("hyperhen_mount") ||
      names.includes("hyperhen_automount")
    )
      found.add("shadowmount");
  }
  return found;
}
