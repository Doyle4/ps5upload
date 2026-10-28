import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { CleanupItem, CleanupScan } from "../../api/cleanup";
import { ApiError } from "../api";
import { SECTIONS } from "../sections";
import { t } from "../strings";
import { cleanupErrorText, CleanupView, confirmBody, focusedItemId, type CleanupViewProps } from "./Cleanup";
import { systemViewOf } from "../system/SystemSection";

const item = (over: Partial<CleanupItem> & Pick<CleanupItem, "id" | "cat">): CleanupItem => ({
  path: `/data/pkg/x${over.id}.pkg`,
  drive: "internal",
  state: "installed_same",
  bytes: 1e9,
  alloc_bytes: 1e9,
  files: 1,
  is_dir: false,
  mtime: 0,
  default: false,
  action: "delete",
  ...over,
});

const scan = (items: CleanupItem[], over: Partial<CleanupScan> = {}): CleanupScan => ({
  ok: true,
  scan_id: 7,
  state: "done",
  phase: "done",
  age_ms: 0,
  appdb: true,
  can_remove_updates: true,
  install_running: false,
  found: items.length,
  truncated: false,
  reserve_bytes: 92e9,
  free_bytes: 150e9,
  total_bytes: 673e9,
  items,
  ...over,
});

const items = [
  item({ id: 1, cat: "A", action: "sony", state: "update_installed", title_id: "PPSA01650", name: "YouTube", path: "/user/patch/PPSA01650" }),
  item({ id: 2, cat: "C", default: true, name: "Jak X" }),
  item({ id: 3, cat: "G", action: "none", state: "duplicate", path: "/data/homebrew/PPSA03671-app", is_dir: true }),
];

const view = (over: Partial<CleanupViewProps> = {}) =>
  renderToStaticMarkup(
    <CleanupView
      scan={scan(items)}
      scanning={false}
      applying={null}
      summary={null}
      selected={new Set([2])}
      message={null}
      onToggle={() => {}}
      onRescan={() => {}}
      onStop={() => {}}
      onRemove={() => {}}
      onShow={() => {}}
      {...over}
    />,
  );

describe("console Clean up", () => {
  it("is System's third view, labelled with its own string", () => {
    expect(SECTIONS.find((x) => x.id === "system")?.acceptsParams).toBe(true);
    expect(systemViewOf({ view: "cleanup" })).toBe("cleanup");
    expect(t("cw_cleanup_title")).toBe("Clean Up");
  });

  it("lists the groups, ticks the selected item and totals it in the bar", () => {
    const html = view();
    expect(html).toContain(t("cw_cleanup_cat_a"));
    expect(html).toContain(t("cw_cleanup_cat_c"));
    expect(html).toContain(t("cw_cleanup_cat_g"));
    expect(html).toMatch(/role="checkbox" aria-checked="true"[^>]*data-cleanup-id="2"/);
    expect(html).toMatch(/role="checkbox" aria-checked="false"[^>]*data-cleanup-id="1"/);
    // "worth a look" is never a check box
    expect(html).not.toMatch(/role="checkbox"[^>]*data-cleanup-id="3"/);
    expect(html).toContain("Selected 1:");
    expect(html).toContain("85.7 GiB");
  });

  it("disables Remove with nothing selected and while busy", () => {
    expect(view({ selected: new Set() })).toMatch(/aria-disabled="true"[^>]*data-action="cleanup-remove"|data-action="cleanup-remove"[^>]*aria-disabled="true"/);
    expect(view({ scanning: true, scan: scan([], { state: "running", phase: "packages" }) })).toContain(
      t("cw_cleanup_phase_packages"),
    );
  });

  it("warns about the downgrade only when an installed game's update is picked", () => {
    expect(confirmBody(items, new Set([2]))).not.toContain(t("cw_cleanup_downgrade_title"));
    const body = confirmBody(items, new Set([1, 2]));
    expect(body).toContain(t("cw_cleanup_downgrade_body"));
    expect(body).toContain(t("cw_cleanup_confirm_body"));
  });

  it("says why a refusal happened", () => {
    expect(cleanupErrorText(new ApiError(409, "install_running"))).toBe(t("cw_cleanup_err_install_running"));
    expect(cleanupErrorText(new ApiError(404, "not_found"))).toBe(t("cw_cleanup_err_unsupported"));
    expect(cleanupErrorText(new ApiError(0, "offline"))).toBe(t("cw_home_err_offline"));
  });

  it("finds the focused item for △", () => {
    const root = { contains: () => true } as unknown as Element;
    const el = { closest: () => ({ getAttribute: () => "3" }) } as unknown as Element;
    expect(focusedItemId(root, el)).toBe(3);
    expect(focusedItemId(null, el)).toBeNull();
  });
});
