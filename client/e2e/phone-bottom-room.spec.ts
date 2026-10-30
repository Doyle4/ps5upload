import { expect, test } from "@playwright/test";

// On a phone the tab bar floats over the bottom of the screen, so every screen keeps room under
// its content: scrolled to the end, nothing is left behind the bar. The tabbed screens (Payloads,
// Tasks, Help) were one screen tall and their content ran past that, past the room too.
// Long: taller than the screen once loaded (their content arrives after the heading).
const LONG = ["/faq", "/faq?tab=whats-new", "/more", "/settings"];
for (const path of [...LONG, "/payloads", "/activity"]) {
  test(`phone: ${path} scrolls clear of the tab bar`, async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 900 });
    await page.goto(path, { waitUntil: "domcontentloaded" });
    const root = page.locator("[data-scroll-root]:visible");
    await expect(root).toHaveCount(1, { timeout: 30_000 });
    await page.getByRole("main").getByRole("heading").first().waitFor();
    const gap = () =>
      root.evaluate((el, long) => {
        if (long && el.scrollHeight <= el.clientHeight) return -1; // not loaded yet
        el.scrollTop = el.scrollHeight;
        const nav = document.querySelector("[data-bottom-nav]")!.getBoundingClientRect();
        let bottom = 0;
        for (const e of Array.from(el.querySelectorAll("*"))) {
          const b = e.getBoundingClientRect();
          if (b.width > 0 && b.height > 0) bottom = Math.max(bottom, b.bottom);
        }
        return nav.top - bottom;
      }, LONG.includes(path));
    await expect.poll(gap, { timeout: 10_000 }).toBeGreaterThanOrEqual(0);
  });
}

// A log viewer still fills the screen and scrolls inside itself.
test("phone: a log viewer keeps the screen's height", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 900 });
  await page.goto("/activity?tab=logs", { waitUntil: "domcontentloaded" });
  const root = page.locator("[data-scroll-root]:visible");
  await expect(root).toHaveCount(1, { timeout: 30_000 });
  await expect
    .poll(() => root.evaluate((el) => el.querySelector(".app-page")?.className ?? ""))
    .toContain("h-full");
});
