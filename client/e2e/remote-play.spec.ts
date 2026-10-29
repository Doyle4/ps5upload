import { expect, test, type WebSocketRoute } from "@playwright/test";

// Remote Play belongs to the app, not to its screen (8.10): leaving the screen keeps the
// stream, a dropped socket rejoins, and only Stop ends it, with no "connection dropped".

test("Remote Play survives leaving the screen and a dropped socket", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("ps5upload.host", "192.168.1.100");
    window.localStorage.setItem(
      "ps5upload.roster.v1",
      JSON.stringify({
        active_id: "p1",
        profiles: [
          {
            id: "p1",
            name: "Living room",
            host: "192.168.1.100",
            wake_regist_key: "00112233",
            wake_rp_key: "00112233445566778899aabbccddeeff",
          },
        ],
      }),
    );
  });
  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      let body: unknown = {};
      if (path === "/api/version") body = { version: "8.10.0", caps: {} };
      if (path === "/api/ps5/rp/session") body = { host: null };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    },
  );
  const starts: Array<Record<string, unknown>> = [];
  let stops = 0;
  let socket: WebSocketRoute | null = null;
  await page.routeWebSocket(/\/api\/ps5\/rp\/ws/, (ws) => {
    socket = ws;
    ws.onMessage((m) => {
      const msg = JSON.parse(String(m)) as Record<string, unknown>;
      if ("host" in msg) {
        starts.push(msg);
        ws.send(JSON.stringify({ stage: "first_frame" }));
      }
      if (msg.stop) {
        stops++;
        ws.send(JSON.stringify({ stage: "ended" }));
        void ws.close({ code: 1000, reason: "ended" });
      }
    });
  });

  await page.goto("/play", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Remote Play" })).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("rp-start").click();
  const toolbar = page.getByTestId("rp-toolbar");
  await expect(toolbar).toContainText("Living room");
  expect(starts[0]).toMatchObject({ host: "192.168.1.100", attach_only: false });

  // Stats on the picture are a toggle.
  const statsToggle = page.getByTestId("rp-toggle-stats");
  await expect(statsToggle).toHaveAttribute("aria-pressed", "false");
  await statsToggle.click();
  await expect(statsToggle).toHaveAttribute("aria-pressed", "true");

  // Another screen: the stream keeps going, and a bar leads back.
  await page.evaluate(() => {
    window.history.pushState({}, "", "/games");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  const banner = page.getByTestId("rp-banner");
  await expect(banner).toContainText("Living room");
  await banner.getByRole("button", { name: "Return to it" }).click();
  await expect(toolbar).toBeVisible();
  expect(stops).toBe(0);

  // The engine socket drops: the page rejoins the running session on its own.
  await socket!.close({ code: 1006 });
  await expect.poll(() => starts.length, { timeout: 15_000 }).toBe(2);
  expect(starts[1]).toMatchObject({ attach_only: true });
  await expect(page.getByText("The connection to the engine dropped.")).toHaveCount(0);

  // Stop ends it cleanly: no error.
  await toolbar.hover();
  await page.getByTestId("rp-stop").click();
  await expect.poll(() => stops).toBe(1);
  await expect(page.getByTestId("rp-start")).toBeVisible();
  await expect(page.locator("[role=alert]").filter({ hasText: /engine/ })).toHaveCount(0);
});
