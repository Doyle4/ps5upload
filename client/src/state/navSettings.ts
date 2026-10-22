// The sidebar's lists as settings.json mirrors them (`nav.hidden`, `nav.closed_sections`,
// `nav.pinned`).

export interface NavSettings {
  hidden?: unknown;
  closed_sections?: unknown;
  /** Pinned screens, in pin order. */
  pinned?: unknown;
  /** Written by builds before hiding existed; no longer read. */
  favorites?: unknown;
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** The lists to hydrate from, or null when the file predates them (nothing to apply). */
export function navListsFromSettings(
  nav: NavSettings | undefined,
): { hidden: string[]; closedSections: string[]; pinned?: string[] } | null {
  if (
    !nav ||
    (!Array.isArray(nav.hidden) && !Array.isArray(nav.closed_sections) && !Array.isArray(nav.pinned))
  ) {
    return null;
  }
  const lists = { hidden: strings(nav.hidden), closedSections: strings(nav.closed_sections) };
  // Absent (a file from before pinning) is not "nothing pinned": leave the pins alone.
  // Unknown screens are dropped by the store.
  return Array.isArray(nav.pinned) ? { ...lists, pinned: strings(nav.pinned) } : lists;
}
