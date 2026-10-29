import { expect, test } from "@playwright/test";

// #534: on a phone, Games could only add a folder on the phone itself; a NAS folder was offered
// only in Folders, which needed a folder already. "Add a folder" now has a ▾ listing saved servers.
test("a phone adds a folder on a saved NAS to Games from the empty grid", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let roots: string[] = [];
  const saved: string[][] = [];
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    let body: unknown = {};
    if (path === "/api/version") body = { version: "9.1.0", caps: {} };
    if (path === "/api/collection/settings") {
      if (req.method() === "PUT") {
        roots = (JSON.parse(req.postData() ?? "{}") as { roots: string[] }).roots;
        saved.push(roots);
      }
      body = { roots, refresh_secs: null, sweep_sidecars: false, refresh_choices: [3600] };
    }
    if (path === "/api/collection/library")
      body = { games: {}, summary: { total_games: 0, total_locations: 0, total_size_bytes: 0, duplicates_count: 0, reclaimable_bytes: 0 } };
    if (path === "/api/collection/scan") body = { running: false, done: 0, found: 0 };
    if (path === "/api/remote/connections")
      body = {
        connections: [
          { id: "nas1", name: "Home NAS", protocol: "smb", host: "10.0.0.5", port: 445, share: "games", user: "", start_path: "/", host_key: null, has_secret: false },
        ],
      };
    if (path === "/api/remote/list") {
      const p = (JSON.parse(req.postData() ?? "{}") as { path: string }).path;
      body = {
        entries: p.endsWith("/PS5") ? [] : [{ name: "PS5", is_dir: true, size: 0, mtime: null }],
        next_cursor: null,
      };
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/games", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Add the folder that holds your games" })).toBeVisible();

  await page.getByRole("button", { name: "Browse a server" }).first().click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: /Home NAS/ })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /Add a connection/ })).toBeVisible();
  await menu.getByRole("menuitem", { name: /Home NAS/ }).click();

  const picker = page.getByRole("dialog");
  await picker.getByText("PS5", { exact: true }).click();
  await picker.getByRole("button", { name: "Use this folder" }).click();
  await expect.poll(() => saved.at(-1)).toEqual(["remote://nas1/PS5"]);

  // Nothing on the page is wider than the phone.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("Folders offers a NAS folder and a way to save a new server", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path === "/api/version") body = { version: "9.1.0", caps: {} };
    if (path === "/api/collection/settings") body = { roots: [], refresh_secs: null, sweep_sidecars: false, refresh_choices: [3600] };
    if (path === "/api/collection/library")
      body = { games: {}, summary: { total_games: 0, total_locations: 0, total_size_bytes: 0, duplicates_count: 0, reclaimable_bytes: 0 } };
    if (path === "/api/collection/scan") body = { running: false, done: 0, found: 0 };
    if (path === "/api/remote/connections") body = { connections: [] };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/games", { waitUntil: "domcontentloaded" });
  const fromNas = page.getByRole("button", { name: "From a NAS or server" });
  // The end of Games scrolls clear of the phone's bottom bar (the page was h-full, so what
  // overflowed it got no bottom padding and stayed under the bar).
  await fromNas.evaluate((e) => e.scrollIntoView({ block: "end" }));
  await fromNas.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/Games on a NAS\?/)).toBeVisible();
  await dialog.getByRole("button", { name: /Add a connection/ }).click();
  await expect(page).toHaveURL(/\/shared-folders\?add=1|\/connections|\/shared-folders/);
});
