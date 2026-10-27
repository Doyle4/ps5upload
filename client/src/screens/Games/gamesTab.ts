export type GamesTab = "ready" | "all" | "files";

/** The view a `?tab=` value names; anything unknown (or none) is On this PS5. */
export function gamesTabOf(param: string | null): GamesTab {
  return param === "files" || param === "all" ? param : "ready";
}
