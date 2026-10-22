/** Read the entire selection before queueing anything: a selected update must not
 * start ahead of its base just because the file picker returned it first. */
export interface StreamSelectionItem {
  path: string;
  name: string;
  category?: string;
  contentId?: string;
  /** Bytes across the package's parts, when the header read said. */
  size?: number;
}
export async function planStreamSelection(
  paths: string[],
  metadata: (path: string) => Promise<{
    head?: { category?: string; content_id?: string };
    total_size?: number;
  }>,
): Promise<StreamSelectionItem[]> {
  const unique = [...new Set(paths)];
  const items: StreamSelectionItem[] = [];
  // Bound header reads, including remote-engine/server paths.
  for (let start = 0; start < unique.length; start += 4) {
    items.push(...await Promise.all(unique.slice(start, start + 4).map(async (path) => {
      const m = await metadata(path);
      return {
        path,
        name: path.split(/[\\/]/).pop() || path,
        category: m.head?.category,
        contentId: m.head?.content_id,
        size: m.total_size && m.total_size > 0 ? m.total_size : undefined,
      };
    })));
  }
  const tier = (category?: string) => category === "gp" ? 1 : category === "ac" ? 2 : 0;
  return items.sort((a, b) => tier(a.category) - tier(b.category));
}
