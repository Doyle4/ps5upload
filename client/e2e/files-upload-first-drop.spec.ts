import { expect, test, type Route } from "@playwright/test";

// Regression: the first pick of a session sat in "Queue · 1" behind a Resume button. The last
// session had left this console's (empty) queue saved, and a restart restored it paused.

const HOST = "192.168.0.5";
const PC_DIR = "/pc/games";
const PC_FILE = `${PC_DIR}/game.pkg`;

test("the first Add files pick of a session starts at once", async ({ page }) => {
  await page.addInitScript((host) => {
    window.localStorage.setItem("ps5upload.host", host);
    window.localStorage.setItem(
      "ps5upload.fsUploadQueue.v1",
      JSON.stringify({ [host]: { items: [], running: false, paused: true, error: null } }),
    );
  }, HOST);

  let started = 0;
  const json = (route: Route, body: unknown) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  await page.route(
    (u) => u.pathname.startsWith("/api/"),
    async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const p = url.pathname;
      if (p === "/api/version") return json(route, { caps: { rar: true }, version: "6.2.3" });
      if (p === "/api/ps5/status")
        return json(route, {
          instance_id: 1,
          prior_instance: "clean",
          ps5_kernel: "r229358/releases/13.60 Jul 17 2026 02:16:29",
          ucred_elevated: true,
          version: "6.2.3",
        });
      if (p === "/api/ps5/volumes") return json(route, { volumes: [] });
      if (p === "/api/ps5/list-dir")
        return json(route, {
          path: url.searchParams.get("path") ?? "/data",
          entries: [],
          truncated: false,
          total_scanned: 0,
          returned: 0,
        });
      if (p === "/api/local/storage-roots") return json(route, [PC_DIR]);
      if (p === "/api/local/list-dir")
        return json(route, [{ name: "game.pkg", path: PC_FILE, is_dir: false, size: 1_000_000 }]);
      if (p === "/api/local/path-kind") return json(route, { kind: "file" });
      if (p === "/api/transfer/file" && req.method() === "POST") {
        started += 1;
        return json(route, { job_id: "job-1" });
      }
      if (p === "/api/jobs/job-1")
        return json(route, { status: "running", bytes_sent: 250_000, total_bytes: 1_000_000 });
      if (p === "/api/jobs") return json(route, []);
      return json(route, {});
    },
  );

  await page.goto("/files", { waitUntil: "domcontentloaded" });
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "Add files" }).click({ timeout: 30_000 });
  await page.getByText("game.pkg").first().click();
  await page.getByRole("button", { name: "Add 1" }).click();

  await expect(page.getByTestId("fs-upload-progress")).toBeVisible({ timeout: 15_000 });
  expect(started).toBe(1);
  await expect(page.getByTestId("fs-upload-queue").getByRole("button", { name: "Resume" })).toHaveCount(0);
});
