import type { FwSpoofStatusResponse } from "../../api/ps5";

/** What the firmware spoof check concluded, in the terms the Console card shows:
 *  - "spoofed": the payload flagged the reported version as altered.
 *  - "unknown": the kernel's firmware word couldn't be read, so nothing was checked
 *    (the payload then reports spoofed=false, which must not read as "genuine").
 *  - "clean":   the version was read and looks genuine. */
export type FwSpoofVerdict = "spoofed" | "unknown" | "clean";

export function fwSpoofVerdict(s: FwSpoofStatusResponse): FwSpoofVerdict {
  if (s.spoofed) return "spoofed";
  if (!s.system_sw_version || s.system_sw_version === "unknown") return "unknown";
  return "clean";
}

/** The version the way the PS5 shows it: "09.60.00" → "9.60", "13.60.01" → "13.60.01".
 *  Anything that isn't dotted numbers comes back unchanged. */
export function friendlyFw(v: string): string {
  const m = /^(\d{1,2})\.(\d{2})(?:\.(\d{2}))?$/.exec(v.trim());
  if (!m) return v;
  const base = `${Number(m[1])}.${m[2]}`;
  return m[3] && m[3] !== "00" ? `${base}.${m[3]}` : base;
}
