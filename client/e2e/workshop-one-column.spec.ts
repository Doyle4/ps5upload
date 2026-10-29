// Workshop: one column at every width, games added only under ①, and ⑤ Queue hands made games
// to Upload & Install's queue (the screen's link goes there).
import { expect, test } from "@playwright/test";


for (const width of [1600, 390])
  test(`workshop one column at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1200 });
    await page.addInitScript(() => {
      if (!sessionStorage.getItem("seeded")) {
        sessionStorage.setItem("seeded", "1");
        localStorage.setItem(
          "ps5upload.convert_queue.v1",
          JSON.stringify([
            { id: "a", source: "/games/Astro", compression: "balanced", then: "stream", host: "10.0.0.2", status: "handed", build: { kind: "pkg" } },
            { id: "b", source: "/games/Bloodborne", compression: "balanced", then: "keep", host: null, status: "pending", build: { kind: "image", format: "exfat", compress: true } },
          ]),
        );
      }
    });
    await page.route((u) => u.pathname.startsWith("/api/"), (r) =>
      r.fulfill({ status: 503, contentType: "application/json", body: '{"error":"down"}' }),
    );
    await page.goto("/workshop");
    const main = page.getByRole("main");
    await expect(main.getByText("① Game")).toBeVisible({ timeout: 30_000 });
    // The shared add buttons are in ① and nowhere else.
    await expect(main.getByRole("button", { name: "Add games from a folder…" })).toHaveCount(1);
    await expect(main.getByRole("button", { name: /Choose file/ })).toHaveCount(1);
    await expect(main.getByText("Pick game folders…")).toHaveCount(0);
    // ⑤ Queue lists the seeded games, with the hand-off to Upload & Install.
    await expect(main.getByText("⑤ Queue")).toBeVisible();
    await expect(main.getByRole("button", { name: "Open Upload & Install" })).toBeVisible();
    // One column: ①, ②, ③, ④ and ⑤ share a left edge and a width.
    const boxes = [];
    for (const t of ["① Game", "② What to make", "③ Options", "④ Build & install", "⑤ Queue"]) {
      const card = main.getByText(t, { exact: true }).locator("xpath=ancestor::section[1]");
      boxes.push((await card.boundingBox())!);
    }
    for (const b of boxes) {
      expect(Math.abs(b.x - boxes[0].x)).toBeLessThan(2);
      expect(Math.abs(b.width - boxes[0].width)).toBeLessThan(2);
    }
    for (let i = 1; i < boxes.length; i++) expect(boxes[i].y).toBeGreaterThan(boxes[i - 1].y);
    // Fills the window: the cards are most of the viewport wide, and nothing scrolls sideways.
    expect(boxes[0].width).toBeGreaterThan(width > 1000 ? 1000 : 300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await main.getByRole("button", { name: "Open Upload & Install" }).click();
    await expect(page).toHaveURL(/\/send/);
  });
