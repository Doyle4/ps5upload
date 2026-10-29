import { expect, test } from "@playwright/test";

// Dumping is ps5upload's own (8.10): pick an installed game and a drive, a plain copy unless
// decryption is asked for (with its warning), progress on the job row.

test("Dump games copies an installed game to a drive", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("ps5upload.host", "192.168.1.100"));
  const dumps: Array<Record<string, unknown>> = [];
  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      let body: unknown = {};
      if (path === "/api/version") body = { version: "8.10.0", caps: {} };
      if (path === "/api/ps5/apps/installed")
        body = { titles: [{ title_id: "PPSA01234", title_name: "Astro Bot", origin: "pkg" }] };
      if (path === "/api/ps5/volumes")
        body = { volumes: [{ path: "/mnt/usb0", fs_type: "exfatfs", total_bytes: 1e12, free_bytes: 5e11 }] };
      if (path === "/api/ps5/list-dir") body = { entries: [], truncated: false };
      if (path === "/api/ps5/fs/op-status")
        body = { op_id: 1, kind: "dump", from: "", to: "", total_bytes: 200, bytes_copied: 100, cancel_requested: false };
      if (path === "/api/ps5/dump") {
        dumps.push(route.request().postDataJSON() as Record<string, unknown>);
        await new Promise((r) => setTimeout(r, 1500));
        body = {
          ok: true,
          path: "/mnt/usb0/ps5upload-dumps/PPSA01234-app",
          files: 812,
          bytes: 200,
          decrypted: 0,
          decrypt_failed: 0,
          decrypt_skipped: "",
          dlc: [],
          fw: "13600000",
        };
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    },
  );
  await page.goto("/games?tab=dumps", { waitUntil: "domcontentloaded" });
  const form = page.getByTestId("dump-form");
  await expect(form).toBeVisible({ timeout: 30_000 });
  await form.getByLabel("Game", { exact: true }).selectOption("PPSA01234");
  await expect(form.getByLabel("Drive", { exact: true })).toHaveValue("/mnt/usb0");

  // Decrypting says what it risks; off again, it is a plain copy.
  const decrypt = form.getByRole("switch", { name: /Decrypt the game/ });
  await decrypt.click();
  await expect(form.getByText("Decrypting can freeze the console")).toBeVisible();
  await decrypt.click();
  await expect(form.getByText("Decrypting can freeze the console")).toHaveCount(0);

  await page.getByTestId("dump-start").click();
  const job = page.getByTestId("dump-job");
  await expect(job).toContainText("Astro Bot");
  await expect(job).toContainText("Done", { timeout: 15_000 });
  await expect(job).toContainText("812 files");
  expect(dumps).toHaveLength(1);
  expect(dumps[0]).toMatchObject({
    title_id: "PPSA01234",
    dest: "/mnt/usb0/ps5upload-dumps",
    decrypt: false,
    fself: false,
    dlc: true,
  });
});
