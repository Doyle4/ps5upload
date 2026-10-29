import { expect, test } from "@playwright/test";

// Send to PS5 says what it does first (8.10): install a package, copy a game or files, or
// install from a link or a drive.

test("Send to PS5 opens with its three jobs", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("ps5upload.host", "192.168.1.100"));
  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      const body = path === "/api/version" ? { version: "8.10.0", caps: {} } : {};
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    },
  );
  await page.goto("/send", { waitUntil: "domcontentloaded" });
  const intro = page.getByTestId("send-intro");
  await expect(intro).toBeVisible({ timeout: 30_000 });
  await expect(intro.getByRole("heading", { name: "Install a package" })).toBeVisible();
  await expect(intro.getByRole("button", { name: "Choose a package…" })).toBeVisible();
  await expect(intro.getByRole("heading", { name: "Copy a game or files" })).toBeVisible();
  await expect(intro.getByRole("heading", { name: "Install from a link or a drive" })).toBeVisible();
  await expect(page.getByTestId("send-drop")).toContainText("Drop a package to install it");
  await page.screenshot({ path: process.env.SEND_SHOT ?? "/dev/null", fullPage: false }).catch(() => {});
});
