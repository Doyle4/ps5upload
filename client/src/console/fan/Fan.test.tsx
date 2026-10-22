import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api";
import { SECTIONS } from "../sections";
import { t } from "../strings";
import { FanView, type FanViewProps } from "./Fan";
import {
  activeChoice,
  fanErrorText,
  isRestartNote,
  presetChoices,
  restoredText,
  stepChoice,
  type FanStatus,
} from "./model";

const status = (over: Partial<FanStatus> = {}): FanStatus => ({
  cpu_c: 52,
  soc_c: 48,
  duty_pct: 19,
  target_c: 91,
  stock_c: 91,
  pinned_c: 0,
  min_c: 45,
  max_c: 85,
  restores: 0,
  last_restore_s: null,
  guard: "off",
  filtered_c: 47.3,
  ...over,
});

const props = (over: Partial<FanViewProps> = {}): FanViewProps => ({
  status: status(),
  loadFailed: false,
  busy: false,
  error: null,
  note: null,
  onChoose: vi.fn(),
  ...over,
});

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  const out: ReactElement<Record<string, unknown>>[] = [];
  const walk = (n: ReactNode) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isValidElement(n)) return;
    const el = n as ReactElement<Record<string, unknown>>;
    out.push(el);
    if (typeof el.type === "function") walk((el.type as (p: unknown) => ReactNode)(el.props));
    else walk(el.props.children as ReactNode);
  };
  walk(node);
  return out;
}

const press = (p: FanViewProps, attr: string, value: string) => {
  const b = elements(FanView(p)).find((e) => e.type === "button" && String(e.props[attr]) === value);
  expect(b).toBeTruthy();
  (b?.props.onClick as () => void)();
};

describe("fan section", () => {
  it("is registered right after cheats", () => {
    const ids = SECTIONS.map((s) => s.id);
    expect(ids.indexOf("fan")).toBe(ids.indexOf("cheats") + 1);
    expect(SECTIONS.find((s) => s.id === "fan")?.labelKey).toBe("cw_fan_title");
  });

  it("shows the readings, what is held and the console's own value", () => {
    const html = renderToStaticMarkup(<FanView {...props()} />);
    expect(html).toContain("52 °C");
    expect(html).toContain("48 °C");
    expect(html).toContain("19 %");
    expect(html).toContain(t("cw_fan_holding", { c: 91 }));
    expect(html).toContain("Console default: 91 °C");
    expect(html).toContain(t("cw_fan_explain"));
  });

  it("offers the console's own setting and 85 down to 65, the active one pressed", () => {
    expect(presetChoices(status())).toEqual(["stock", 85, 80, 75, 70, 65]);
    // a board whose own target is 69: nothing warmer than that
    expect(presetChoices(status({ stock_c: 69 }))).toEqual(["stock", 65]);
    expect(activeChoice(status())).toBe("stock");
    expect(activeChoice(status({ pinned_c: 75 }))).toBe(75);
    const html = renderToStaticMarkup(<FanView {...props({ status: status({ pinned_c: 75, target_c: 75 }) })} />);
    expect(html).toMatch(/data-fan-choice="75" aria-pressed="true"/);
    expect(html).toMatch(/data-fan-choice="stock" aria-pressed="false"/);
  });

  it("sends a preset, the console's own setting and a one-degree step", () => {
    const p = props({ status: status({ pinned_c: 75, target_c: 75 }) });
    press(p, "data-fan-choice", "70");
    press(p, "data-fan-choice", "stock");
    press(p, "data-fan-step", "-1");
    press(p, "data-fan-step", "1");
    expect(vi.mocked(p.onChoose).mock.calls.map((c) => c[0])).toEqual([70, "stock", 74, 76]);
  });

  it("ignores presses while a set runs, or at the edge of the range", () => {
    const p = props({ busy: true });
    press(p, "data-fan-choice", "70");
    expect(p.onChoose).not.toHaveBeenCalled();
    const top = props({ status: status({ pinned_c: 85, target_c: 85 }) });
    press(top, "data-fan-step", "1");
    expect(top.onChoose).not.toHaveBeenCalled();
    expect(stepChoice(status(), -1)).toBe(85); // from the console's own 91
    expect(stepChoice(status(), 1)).toBeNull();
    expect(stepChoice(null, -1)).toBeNull();
  });

  it("says when it put the target back and when the guard gave up", () => {
    expect(restoredText(status())).toBeNull();
    expect(restoredText(status({ pinned_c: 75, restores: 2, last_restore_s: 12 }))).toBe(
      "Restored after a game reset it — 12 s ago",
    );
    expect(restoredText(status({ pinned_c: 75, restores: 1, last_restore_s: 300 }))).toBe(
      "Restored after a game reset it — 5 min ago",
    );
    const html = renderToStaticMarkup(
      <FanView {...props({ status: status({ pinned_c: 75, guard: "failing", restores: 1, last_restore_s: 4 }) })} />,
    );
    expect(html).toContain('data-fan="failing"');
    expect(html).toContain("could not keep your choice");
    expect(html).toContain("4 s ago");
  });

  it("shows a missing reading as a dash and a failed load as one line", () => {
    const html = renderToStaticMarkup(<FanView {...props({ status: status({ cpu_c: null, duty_pct: null }) })} />);
    expect(html).toContain("—");
    const failed = renderToStaticMarkup(<FanView {...props({ status: null, loadFailed: true })} />);
    expect(failed).toContain(t("cw_fan_err_load"));
  });

  it("explains the helper's refusals", () => {
    expect(fanErrorText(new ApiError(409, "fan_above_stock"))).toBe(t("cw_fan_err_above"));
    expect(fanErrorText(new ApiError(500, "icc_fan_not_applied"))).toBe(t("cw_fan_err_set"));
    expect(fanErrorText(new ApiError(401, "token"))).toBeNull();
    expect(fanErrorText(new ApiError(0, "offline"))).toBe(t("cw_home_err_offline"));
    expect(isRestartNote(new ApiError(409, "fan_restore_needs_restart"))).toBe(true);
  });
});
