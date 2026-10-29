import { expect, test } from "@playwright/test";

// Send to PS5's Upload puts the item in the console's queue and starts it (8.10): its
// progress shows on its queue row, not in a one-shot card of its own.

test("Upload sends through the queue", async ({ page }) => {
  const calls: string[] = [];
  await page.addInitScript(() => window.localStorage.setItem("ps5upload.host", "192.168.1.100"));
  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      calls.push(`${route.request().method()} ${path}`);
      let body: unknown = {};
      if (path === "/api/version") body = { version: "8.10.0", caps: {} };
      if (path === "/api/ps5/status") body = { ok: true, version: "8.10.0" };
      if (path === "/api/files/upload")
        body = { upload_id: "u1", path: "/tmp/u1/notes.txt", size: 5, filename: "notes.txt" };
      if (path === "/api/ps5/volumes")
        body = { volumes: [{ path: "/data", writable: true, is_placeholder: false, free_bytes: 1e12, total_bytes: 2e12 }] };
      if (path.startsWith("/api/transfer/")) body = { job_id: "job-1" };
      if (path.startsWith("/api/jobs/"))
        body = { job_id: "job-1", status: "running", bytes_sent: 2, total_bytes: 5, files_sent: 0, total_files: 1 };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    },
  );
  await page.goto("/send", { waitUntil: "domcontentloaded" });
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "From this device…", exact: true }).click();
  await (await chooser).setFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  const upload = page.getByRole("button", { name: "Upload", exact: true });
  await expect(upload).toBeEnabled({ timeout: 30_000 });
  await upload.click();
  // The destination check asks first (Settings → Upload can turn this off).
  await page.getByRole("button", { name: /Start upload/ }).click();
  // One transfer, started by the queue, and the item is a queue row.
  await expect.poll(() => calls.filter((c) => c.startsWith("POST /api/transfer/")).length, { timeout: 30_000 }).toBe(1);
  await expect(page.getByTestId("queue-row").filter({ hasText: "notes.txt" }).first()).toBeVisible();
});
