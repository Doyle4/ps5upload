import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseLanguage, getLanguage, storedLanguage, t } from "../strings";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { lanToggleStep, SettingsView, type SettingsViewProps } from "./Settings";

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

const base = (over: Partial<SettingsViewProps> = {}): SettingsViewProps => ({
  settings: { lan: false, tile: true, version: "7.1.0" },
  loadFailed: false,
  language: "",
  askLan: false,
  busy: false,
  error: null,
  onToggleLan: vi.fn(),
  onConfirmLan: vi.fn(),
  onDismissLan: vi.fn(),
  onToggleTile: vi.fn(),
  onLanguage: vi.fn(),
  ...over,
});

afterEach(() => {
  vi.unstubAllGlobals();
  chooseLanguage("");
});

describe("settings", () => {
  it("lan_toggle_requires_confirm", () => {
    expect(lanToggleStep(false)).toBe("confirm");
    expect(lanToggleStep(true)).toBe("apply");

    // Asking shows the warning in a confirm dialog; confirming is a separate action.
    const props = base({ askLan: true });
    const dialog = elements(SettingsView(props)).find((e) => e.type === ConfirmDialog);
    expect(dialog).toBeTruthy();
    expect(dialog?.props.body).toBe(t("cw_settings_lan_warning"));
    expect(t("cw_settings_lan_warning")).toBe("Anyone on your network can then use this page and manage your files.");
    expect(props.onConfirmLan).not.toHaveBeenCalled();
    (dialog?.props.onConfirm as () => void)();
    expect(props.onConfirmLan).toHaveBeenCalledTimes(1);

    // No dialog until asked; the toggle only reports the press.
    const idle = base();
    expect(elements(SettingsView(idle)).some((e) => e.type === ConfirmDialog)).toBe(false);
    const lan = elements(SettingsView(idle)).find((e) => e.props.action === "lan");
    (lan?.props.onClick as () => void)();
    expect(idle.onToggleLan).toHaveBeenCalledTimes(1);
  });

  it("language_choice_persists_and_survives_storage_errors", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    chooseLanguage("de");
    expect(getLanguage()).toBe("de");
    expect(storedLanguage()).toBe("de");
    expect(t("cw_nav_settings")).not.toBe("Settings");
    chooseLanguage("");
    expect(storedLanguage()).toBe("");

    // Blocked storage: the choice still applies, nothing throws.
    const boom = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("localStorage", { getItem: boom, setItem: boom, removeItem: boom });
    expect(() => chooseLanguage("fr")).not.toThrow();
    expect(getLanguage()).toBe("fr");
    expect(storedLanguage()).toBe("");
  });
});
