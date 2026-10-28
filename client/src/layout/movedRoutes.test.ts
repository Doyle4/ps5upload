import { describe, expect, it } from "vitest";

import { NAV_MOVED } from "./navItems";

/**
 * A screen folded into another keeps a redirect for bookmarks, but a redirect drops the state a
 * link hands over (`navigate("/convert", { state: { source } })` opened an empty Workshop in
 * 8.7.0). So nothing in the app may link to an old route itself.
 */
const SOURCES = import.meta.glob(["../**/*.ts", "../**/*.tsx", "!../**/*.test.ts", "!../**/*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("links to screens that moved", () => {
  it("point at the screen that holds them now", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(200);
    const old = Object.keys(NAV_MOVED);
    const offenders: string[] = [];
    for (const [file, src] of Object.entries(SOURCES)) {
      if (file.endsWith("/App.tsx") || file.endsWith("/navItems.ts") || file.includes("/api/")) continue;
      for (const route of old) {
        // a link: the route as a whole string, or followed by a query or hash
        const re = new RegExp(`["'\`]${route.replace(/[-/]/g, "\\$&")}(["'\`?#])`);
        if (re.test(src)) offenders.push(`${file}: ${route}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
