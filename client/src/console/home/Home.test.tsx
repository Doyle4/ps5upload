import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../api")>();
  return { ...real, call: vi.fn() };
});

import { ApiError, call } from "../api";
import { t } from "../strings";
import { ConfirmDialog, dialogNavHandler } from "../ui/ConfirmDialog";
import {
  errorText,
  firstUsbVolume,
  keepsDialogOpen,
  HomeView,
  runAsk,
  VolumeCard,
  type Ask,
  type HomeViewProps,
  type Volume,
} from "./Home";
import { TaskRow } from "./TaskRow";
import { cancelJob, type Job } from "./useJobs";

const mockCall = vi.mocked(call);

const job = (over: Partial<Job> = {}): Job => ({
  job: "0123456789abcdef0123456789abcdef",
  kind: "copy",
  state: "running",
  files_done: 1,
  files_total: 4,
  bytes_done: 100,
  bytes_total: 400,
  mine: true,
  ...over,
});

const vol = (path: string, mount_from: string, over: Partial<Volume> = {}): Volume => ({
  path,
  mount_from,
  fs_type: "ufs",
  total_bytes: 1000,
  free_bytes: 250,
  writable: true,
  ...over,
});

/** Every element in `node`'s tree (function components are not expanded). */
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  const out: ReactElement<Record<string, unknown>>[] = [];
  const walk = (n: ReactNode) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isValidElement(n)) return;
    const el = n as ReactElement<Record<string, unknown>>;
    out.push(el);
    walk(el.props.children as ReactNode);
  };
  walk(node);
  return out;
}

const byAction = (node: ReactNode, action: string) => {
  const el = elements(node).find((e) => e.props["data-action"] === action);
  if (!el) throw new Error(`no element with data-action=${action}`);
  return el;
};

function viewProps(over: Partial<HomeViewProps> = {}): HomeViewProps {
  return {
    status: null,
    volumes: [],
    volumesError: false,
    jobs: [],
    jobsLoaded: true,
    jobsError: false,
    ask: null,
    busy: false,
    message: null,
    onAsk: vi.fn(),
    onConfirm: vi.fn(),
    onDismiss: vi.fn(),
    onBrowseUsb: null,
    onOpenDrive: null,
    ...over,
  };
}

beforeEach(() => {
  mockCall.mockReset();
  mockCall.mockResolvedValue({});
});

describe("Home", () => {
  it("shows_pc_job_as_from_pc", () => {
    expect(t("cw_task_from_pc")).not.toBe("cw_task_from_pc");
    const pc = renderToStaticMarkup(<TaskRow job={job({ mine: false })} onCancel={() => {}} />);
    expect(pc).toContain(t("cw_task_from_pc"));
    expect(pc).not.toContain(t("cw_task_from_console"));
    const mine = renderToStaticMarkup(<TaskRow job={job({ mine: true })} onCancel={() => {}} />);
    expect(mine).toContain(t("cw_task_from_console"));
  });

  it("cancel_asks_confirm_then_calls_api", async () => {
    const running = job({ mine: false });
    // Cancel on the row only asks.
    const onCancel = vi.fn();
    (byAction(TaskRow({ job: running, onCancel }), "cancel").props.onClick as () => void)();
    expect(onCancel).toHaveBeenCalledWith(running);
    expect(mockCall).not.toHaveBeenCalled();

    // The ask opens the confirm dialog; focus starts on the safe choice.
    const ask: Ask = { kind: "cancel", job: running };
    const props = viewProps({ ask, jobs: [running] });
    const html = renderToStaticMarkup(<HomeView {...props} />);
    expect(html).toContain("data-nav-modal");
    expect(html).toContain(t("cw_home_confirm_cancel_title"));
    const dialog = elements(HomeView(props)).find((e) => e.type === ConfirmDialog);
    expect(dialog).toBeDefined();
    expect(mockCall).not.toHaveBeenCalled();

    // "Keep going" (or ○) closes it with no call.
    (dialog!.props.onCancel as () => void)();
    expect(props.onDismiss).toHaveBeenCalled();
    expect(mockCall).not.toHaveBeenCalled();

    // Confirm runs the ask: POST /api/jobs/cancel {job}.
    (dialog!.props.onConfirm as () => void)();
    expect(props.onConfirm).toHaveBeenCalled();
    await runAsk(ask, { cancel: cancelJob });
    expect(mockCall).toHaveBeenCalledWith("/api/jobs/cancel", {
      job: running.job,
    });
  });

  it("Tasks hides finished PC jobs, shows running PC jobs and finished console jobs", () => {
    const html = (jobs: Job[]) => renderToStaticMarkup(<HomeView {...viewProps({ jobs })} />);
    const n = (h: string) => h.split("cw-task is-").length - 1;
    expect(n(html([job({ state: "done", mine: false }), job({ state: "failed", mine: false })]))).toBe(0);
    expect(n(html([job({ state: "running", mine: false })]))).toBe(1);
    expect(n(html([job({ state: "done", mine: true }), job({ state: "failed", mine: true })]))).toBe(2);
  });

  it("a finished task has no Cancel", () => {
    expect(() => byAction(TaskRow({ job: job({ state: "done" }), onCancel: () => {} }), "cancel")).toThrow();
  });

  it("close game asks, then posts the app id", async () => {
    const props = viewProps({
      status: {
        version: null,
        firmware: null,
        model: null,
        temp_c: null,
        running: { title_id: "PPSA01234", app_id: 77, name: null },
      },
    });
    (byAction(HomeView(props), "close-game").props.onClick as () => void)();
    const ask: Ask = { kind: "close", appId: 77, titleId: "PPSA01234" };
    expect(props.onAsk).toHaveBeenCalledWith(ask);
    expect(mockCall).not.toHaveBeenCalled();
    await runAsk(ask, { cancel: cancelJob });
    expect(mockCall).toHaveBeenCalledWith("/api/app/close", { app_id: 77 });
  });

  it("rest mode and restart ask, then post the power action", async () => {
    const props = viewProps();
    (byAction(HomeView(props), "rest").props.onClick as () => void)();
    (byAction(HomeView(props), "restart").props.onClick as () => void)();
    expect(props.onAsk).toHaveBeenNthCalledWith(1, {
      kind: "power",
      action: "rest",
    });
    expect(props.onAsk).toHaveBeenNthCalledWith(2, {
      kind: "power",
      action: "reboot",
    });
    expect(mockCall).not.toHaveBeenCalled();
    await runAsk({ kind: "power", action: "rest" }, { cancel: cancelJob });
    expect(mockCall).toHaveBeenCalledWith("/api/power", { action: "rest" });
    await runAsk({ kind: "power", action: "reboot" }, { cancel: cancelJob });
    expect(mockCall).toHaveBeenCalledWith("/api/power", { action: "reboot" });
  });

  it("Browse USB shows only when there is somewhere to go", () => {
    expect(() => byAction(HomeView(viewProps()), "browse-usb")).toThrow();
    const go = vi.fn();
    (byAction(HomeView(viewProps({ onBrowseUsb: go })), "browse-usb").props.onClick as () => void)();
    expect(go).toHaveBeenCalled();
  });

  it("first USB volume: a /mnt/usbN stick or USB extended storage, never internal or M.2", () => {
    expect(firstUsbVolume([vol("/data", "/dev/ssd0.user"), vol("/mnt/ext0", "/dev/nvme0p1")])).toBeNull();
    expect(
      firstUsbVolume([vol("/data", "x"), vol("/mnt/ext1", "/dev/da0"), vol("/mnt/usb0", "/dev/da1s1")])?.path,
    ).toBe("/mnt/ext1");
    expect(firstUsbVolume([vol("/mnt/usb0", "/dev/da0s1")])?.path).toBe("/mnt/usb0");
  });

  it("one storage card per drive with free of total", () => {
    const html = renderToStaticMarkup(
      <HomeView
        {...viewProps({
          volumes: [vol("/data", "x"), vol("/mnt/usb0", "/dev/da0s1")],
        })}
      />,
    );
    expect(html).toContain(t("cw_home_vol_internal"));
    expect(html).toContain(t("cw_home_vol_usb"));
    expect(html.split("data-volume=").length - 1).toBe(2);
  });

  it("F3: ✕ on a storage card opens Files at that drive's path", () => {
    const open = vi.fn();
    const cards = elements(
      HomeView(viewProps({ volumes: [vol("/data", "x"), vol("/mnt/usb0", "/dev/da0s1")], onOpenDrive: open })),
    ).filter((e) => e.type === VolumeCard);
    expect(cards).toHaveLength(2);
    // ✕ clicks the focused card (nav.ts confirm): the card (a role=button inside the li) carries the onClick.
    const card = elements(VolumeCard(cards[1].props as Parameters<typeof VolumeCard>[0])).find(
      (e) => e.props["data-volume"] === "/mnt/usb0",
    )!;
    expect(card.props.role).toBe("button");
    expect(card.props.tabIndex).toBe(0);
    (card.props.onClick as () => void)();
    expect(open).toHaveBeenCalledWith("/mnt/usb0");
    // Enter and Space work like a button's (and are marked handled, so nav.ts does not click it again).
    for (const key of ["Enter", " "]) {
      const ev = { key, preventDefault: vi.fn() };
      (card.props.onKeyDown as (e: typeof ev) => void)(ev);
      expect(ev.preventDefault).toHaveBeenCalled();
    }
    expect(open).toHaveBeenCalledTimes(3);
    // Without Files to open, a card is only shown: no button role.
    const plain = elements(VolumeCard({ v: vol("/data", "x"), onOpen: null })).find((e) => e.props["data-volume"])!;
    expect(plain.props.role).toBeUndefined();
  });

  it("a 409 or 503 keeps the dialog open with the error inside it", () => {
    expect(keepsDialogOpen(new ApiError(409, "busy"))).toBe(true);
    expect(keepsDialogOpen(new ApiError(503, "stopping"))).toBe(true);
    expect(keepsDialogOpen(new ApiError(500, "io_error"))).toBe(false);
    expect(keepsDialogOpen(new ApiError(401, "token"))).toBe(false);
    const dialog = elements(
      HomeView(viewProps({ ask: { kind: "power", action: "rest" }, askError: t("cw_home_err_busy") })),
    ).find((e) => e.type === ConfirmDialog)!;
    expect(dialog.props.error).toBe(t("cw_home_err_busy"));
    const html = renderToStaticMarkup(
      <ConfirmDialog title="x" confirmLabel="y" error={t("cw_home_err_busy")} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(html).toContain(t("cw_home_err_busy"));
    expect(html).toContain('role="alert"');
  });

  it("errors become short translated messages", () => {
    expect(errorText(new ApiError(0, "offline"))).toBe(t("cw_home_err_offline"));
    expect(errorText(new ApiError(409, "busy"))).toBe(t("cw_home_err_busy"));
    expect(errorText(new ApiError(404, "unknown_job"))).toBe(t("cw_home_err_gone"));
    expect(errorText(new ApiError(500, "io_error"))).toBe(t("cw_home_err_failed", { code: "io_error" }));
    expect(errorText(new ApiError(401, "token"))).toBeNull(); // the reload banner says it
    expect(errorText(new Error("x"))).toBe(t("cw_home_err_failed", { code: "x" }));
  });

  it("the shown message renders as an alert", () => {
    const html = renderToStaticMarkup(<HomeView {...viewProps({ message: { tone: "error", text: "Nope" } })} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Nope");
  });
});

describe("ConfirmDialog", () => {
  it("is a nav modal whose safe choice is the default focus", () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog title="T" confirmLabel="Do it" onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(html).toContain("data-nav-modal");
    expect(html).toContain('role="alertdialog"');
    // The cancel button comes first and carries data-nav-default.
    const safe = html.indexOf("data-nav-default");
    expect(safe).toBeGreaterThan(-1);
    expect(safe).toBeLessThan(html.indexOf("Do it"));
    expect(html).toContain(t("cw_dialog_cancel"));
  });

  it("○ cancels; other actions are swallowed while it is open", () => {
    const onCancel = vi.fn();
    const handle = dialogNavHandler(onCancel);
    expect(handle("back")).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(handle("nextSection")).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
