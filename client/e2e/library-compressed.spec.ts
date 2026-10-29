import { expect, test, type Page } from "@playwright/test";

// Reported on 7.1.9: compressed images are absent despite being visible in Files.
// Exercise the browser/engine path and prevent an unsupported native writable mount.
// The PS5's drives are read by the Games grid now: a game file no game links to is listed
// under it, and a game's own files are on its page.

async function fakeEngine(
  page: Page,
  files: { name: string; kind: string; size: number }[],
  extra: (path: string) => unknown = () => undefined,
) {
  await page.addInitScript(() => localStorage.setItem("ps5upload.host", "192.0.2.8"));
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const fake = (): unknown => {
      if (path === "/api/version") return { version: "7.1.10", caps: {} };
      if (path === "/api/ps5/status") return { version: "7.1.10", command_count: 1, instance_id: 1, ucred_elevated: true };
      if (path === "/api/ps5/volumes") return { volumes: [{ path: "/data", fs_type: "nullfs", writable: true, is_placeholder: false }] };
      if (path === "/api/ps5/list-dir") {
        const dir = (url.searchParams.get("path") ?? "").replace(/\/+$/, "");
        return { entries: dir === "/data" ? files : [], truncated: false };
      }
      if (path === "/api/ps5/smp/status") return { running: false, installed: false, mounted_images: [], errors: [] };
      return extra(path);
    };
    const body = fake();
    // Anything not faked here is an engine that cannot answer.
    await route.fulfill({
      status: body === undefined ? 503 : 200,
      contentType: "application/json",
      body: JSON.stringify(body ?? { error: "down" }),
    });
  });
}

test("a compressed image no game links to is listed under the grid and directs editing through decompression", async ({ page }) => {
  await fakeEngine(page, [{ name: "game.FFPFSC", kind: "file", size: 123456 }]);
  await page.goto("/games", { waitUntil: "domcontentloaded" });
  const line = page.getByTestId("games-unlinked");
  await expect(line).toContainText("Game files on the PS5 that no game links to yet: 1", { timeout: 30_000 });
  await line.getByRole("button", { name: "Show them" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("game.FFPFSC", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Mount", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Edit files", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: "Open in Files" })).toHaveAttribute("href", "/files?path=%2Fdata");
});

test("an old link to the PS5's drives lands on the grid", async ({ page }) => {
  await fakeEngine(page, [{ name: "game.FFPFSC", kind: "file", size: 123456 }]);
  await page.goto("/games?tab=files", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/games$/, { timeout: 30_000 });
  await expect(page.getByTestId("games-unlinked")).toContainText("no game links to yet", { timeout: 30_000 });
});

test("an image a game is registered from shows on that game's page with its row actions", async ({ page }) => {
  const ID = "PPSA04321";
  await fakeEngine(page, [{ name: "astro.exfat", kind: "file", size: 4096 }], (path) => {
    if (path === "/api/ps5/apps/installed")
      return {
        titles: [
          { title_id: ID, title_name: "Astro Image", origin: "registered", image_backed: true, source: "/data/astro.exfat", system: false },
        ],
      };
    if (path === "/api/collection/settings") return { roots: [], refresh_secs: null, sweep_sidecars: false };
    if (path === "/api/collection/library") return { games: {} };
    if (path === "/api/collection/scan") return { running: false, phase: "idle", done: 0, total: 0 };
    if (path === `/api/games/${ID}`)
      return { title_id: ID, title: "Astro Image", platform: "PS5", cover: null, copies: [], consoles: [] };
    return undefined;
  });
  await page.goto(`/games/${ID}`, { waitUntil: "domcontentloaded" });
  // What the connected PS5 has installed, with its upkeep.
  const onPs5 = page.getByTestId("game-on-this-ps5");
  await expect(onPs5).toBeVisible({ timeout: 30_000 });
  await expect(onPs5).toContainText("Disk image");
  await expect(page.getByRole("button", { name: "Uninstall" })).toBeVisible();
  // Its image on the PS5's drives, as a row with the Mount action.
  const drives = page.getByTestId("game-ps5-drives");
  await expect(drives.getByText("/data/astro.exfat")).toBeVisible({ timeout: 30_000 });
  await expect(drives.getByRole("button", { name: "Mount", exact: true })).toBeEnabled();
  // Linked to a game, so not in the grid's list of unlinked files.
  await page.goto("/games", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: /Astro Image/ }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("games-unlinked")).not.toContainText("no game links to");
});
