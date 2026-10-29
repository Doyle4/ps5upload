import { expect, test } from "@playwright/test";

test("guides a disconnected user through primary navigation and recovery", async ({
  page,
}) => {
  // Each Playwright context starts with empty storage, so no console host is
  // selected and this journey cannot issue a PS5-targeted operation. Vite
  // serves any same-origin /api probe as inert app HTML in this test setup.
  await page.goto("/home", { waitUntil: "domcontentloaded" });

  // A fresh profile's sidebar lists every screen: nothing is hidden behind More
  // until the user hides it.
  const primary = page.getByRole("navigation", { name: "Primary" });
  await expect(primary.getByRole("link", { name: "Home" })).toBeVisible();
  for (const shown of ["Games", "Files", "Console", "Activity & Logs", "Upload & Install", "Workshop"]) {
    await expect(primary.getByRole("link", { name: shown, exact: true })).toBeVisible();
  }

  await expect(
    page.getByRole("heading", { name: "Connect a PS5 to get started" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Connect PS5" })).toBeVisible();
  await expect(page.getByText("Connect to your PS5 to see live telemetry.")).toBeVisible();
  // Anchored, because `hasText` is a case-insensitive substring match: the
  // blocker line under every disabled tile reads "The ps5upload engine is
  // offline.", so an unanchored filter can match other tiles — a strict-mode
  // violation whenever the engine probe happens to land as offline.
  await expect(
    page.locator('[aria-disabled="true"]').filter({ hasText: /^Upload & Install/ }),
  ).toBeVisible();

  // More lists every screen too (and is where hidden ones come back). Scoped to the
  // page body: the sidebar carries the same links.
  const body = page.getByRole("main");
  await page.getByRole("link", { name: "More" }).click();
  // Wait for More itself: Home also has a "Tasks" link, and Home stays in the page (hidden)
  // after the switch, so a click aimed at it would wait on a link that never shows again.
  await expect(page.getByRole("heading", { name: "More" })).toBeVisible();
  await body.getByRole("link", { name: "Activity & Logs", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Activity & Logs" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Tasks", selected: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Now", selected: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: /history/i })).toBeVisible();
  await expect(page.getByText("No activity yet")).toBeVisible();

  await page.getByRole("link", { name: "More" }).click();
  await expect(page.getByRole("heading", { name: "More" })).toBeVisible();
  await expect(body.getByRole("link", { name: "Upload & Install" })).toBeVisible();
  await expect(body.getByRole("link", { name: "Settings" })).toBeVisible();

  // Regression: Install Package used to draw its entire staging UI with no console
  // connected. It is part of Upload & Install now (/install-package lands there): with no
  // helper the page says why (Upload's banner) and the install parts stay out of it.
  // Upload & Install is lazily imported, and each Playwright run gets a cold vite server that
  // has to transform the chunk on first request — well over the 5s default expect timeout.
  await page.goto("/install-package", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Upload & Install" })).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(/\/send$/);
  await expect(page.getByText(/helper status unknown|helper isn't reachable|in rest mode/i)).toBeVisible();
  await expect(page.getByText("How installing works")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Already on the PS5" })).toHaveCount(0);
});
