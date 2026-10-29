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
  // The bar shows before the routed socket has handed the start message to the test.
  await expect.poll(() => starts.length).toBeGreaterThan(0);
  expect(starts[0]).toMatchObject({ host: "192.168.1.100", attach_only: false });

  // Stats on the picture are a toggle.
  const statsToggle = page.getByTestId("rp-toggle-stats");
  await expect(statsToggle).toHaveAttribute("aria-pressed", "false");
  await statsToggle.click();
  await expect(statsToggle).toHaveAttribute("aria-pressed", "true");

  // Volume is on the picture's bar, not only in Settings.
  await page.getByTestId("rp-volume").fill("40");
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("ps5upload.rp_prefs.v1") ?? "{}").volume))
    .toBe(0.4);

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

// Two consoles: the page follows the console selected in the app. The other console's stream
// keeps going and is offered there, and Start on this one stops it first.
test("Remote Play shows the selected console while another one streams", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("ps5upload.host", "192.168.1.100");
    const p = (id: string, name: string, host: string) => ({
      id,
      name,
      host,
      wake_regist_key: "00112233",
      wake_rp_key: "00112233445566778899aabbccddeeff",
    });
    window.localStorage.setItem(
      "ps5upload.roster.v1",
      JSON.stringify({
        active_id: "p1",
        profiles: [p("p1", "Living room", "192.168.1.100"), p("p2", "Bedroom", "192.168.1.101")],
      }),
    );
  });
  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      let body: unknown = {};
      if (path === "/api/version") body = { version: "8.11.0", caps: {} };
      if (path === "/api/ps5/rp/session") body = { host: null };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    },
  );
  const starts: Array<Record<string, unknown>> = [];
  let stops = 0;
  await page.routeWebSocket(/\/api\/ps5\/rp\/ws/, (ws) => {
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
  const visible = (id: string) => page.getByTestId(id).filter({ visible: true });
  await expect(visible("rp-toolbar")).toContainText("Living room");

  // Select the other console in the app: its own Start, with the running stream offered.
  await page.getByRole("button", { name: /Bedroom/ }).first().click();
  await expect(page.getByText("Remote Play is streaming Living room")).toBeVisible();
  // Each console keeps its own (hidden) copy of the screen: only the shown one counts.
  await expect(visible("rp-toolbar")).toHaveCount(0);
  const start = visible("rp-start");
  await expect(start).toContainText("Stop the other stream and start");

  await start.click();
  await expect.poll(() => starts.length, { timeout: 15_000 }).toBe(2);
  expect(stops).toBe(1);
  expect(starts[1]).toMatchObject({ host: "192.168.1.101" });
  await expect(visible("rp-toolbar")).toContainText("Bedroom");
});

// Picture in picture: the stream's canvas moves into a small window of its own and back. The
// browser's Document Picture-in-Picture is stood in for by a plain popup (same kind of window:
// same origin, scriptable), which headless Chromium can open without a real PiP window.
test("Remote Play moves into picture in picture and back", async ({ page }) => {
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
    Object.defineProperty(window, "documentPictureInPicture", {
      configurable: true,
      value: {
        requestWindow: async (o: { width: number; height: number }) => {
          const w = window.open("", "_blank", `width=${o.width},height=${o.height}`);
          if (!w) throw new Error("popup blocked");
          return w;
        },
      },
    });
  });
  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      let body: unknown = {};
      if (path === "/api/version") body = { version: "8.11.0", caps: {} };
      if (path === "/api/ps5/rp/session") body = { host: null };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    },
  );
  let stops = 0;
  await page.routeWebSocket(/\/api\/ps5\/rp\/ws/, (ws) => {
    ws.onMessage((m) => {
      const msg = JSON.parse(String(m)) as Record<string, unknown>;
      if ("host" in msg) ws.send(JSON.stringify({ stage: "first_frame" }));
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
  const stage = page.getByTestId("rp-stage").filter({ visible: true });
  await expect(stage.getByTestId("rp-canvas")).toHaveCount(1);

  // Into picture in picture: the canvas leaves the page for the small window.
  const popupP = page.waitForEvent("popup");
  await page.getByTestId("rp-pip").click();
  const popup = await popupP;
  await expect(popup.getByTestId("rp-pip-player")).toBeVisible();
  await expect(popup.getByTestId("rp-canvas")).toHaveCount(1);
  await expect(popup).toHaveTitle("Living room · Remote Play");
  await expect(stage.getByTestId("rp-pip-on")).toBeVisible();
  await expect(stage.getByTestId("rp-canvas")).toHaveCount(0);
  await expect(page.getByTestId("rp-pip")).toHaveAttribute("aria-pressed", "true");

  // Back to the app: the window closes and the picture is here again, still playing.
  await popup.getByTestId("rp-pip-player").hover();
  await popup.getByTestId("rp-pip-back").click();
  await expect(stage.getByTestId("rp-canvas")).toHaveCount(1);
  await expect(stage.getByTestId("rp-pip-on")).toHaveCount(0);
  await expect.poll(() => popup.isClosed()).toBe(true);

  // Closed from outside (its own close button): the picture comes back the same way.
  const popup2P = page.waitForEvent("popup");
  await page.getByTestId("rp-pip").click();
  const popup2 = await popup2P;
  await expect(popup2.getByTestId("rp-canvas")).toHaveCount(1);
  await popup2.close();
  await expect(stage.getByTestId("rp-canvas")).toHaveCount(1);
  await expect(stage.getByTestId("rp-pip-on")).toHaveCount(0);

  // Stop in the small window ends the stream and closes it.
  const popup3P = page.waitForEvent("popup");
  await page.getByTestId("rp-pip").click();
  const popup3 = await popup3P;
  await popup3.getByTestId("rp-pip-player").hover();
  await popup3.getByTestId("rp-pip-stop").click();
  await expect.poll(() => stops).toBe(1);
  await expect.poll(() => popup3.isClosed()).toBe(true);
  await expect(page.getByTestId("rp-start").filter({ visible: true })).toBeVisible();
});
