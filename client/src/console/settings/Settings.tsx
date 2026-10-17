import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, call, isOffline } from "../api";
import { LANGUAGE_NAMES } from "../languages";
import { chooseLanguage, LANGUAGES, storedLanguage, t } from "../strings";
import { ConfirmDialog } from "../ui/ConfirmDialog";

/** /api/settings (payload/src/webui_api.c send_settings). */
export interface WebSettings {
  lan: boolean;
  tile: boolean;
  /** The helper is still adding or removing the tile (Sony calls take seconds). */
  tile_busy?: boolean;
  /** The last add/remove failed: the tile is not as `tile` says. */
  tile_failed?: boolean;
  version: string;
}

/** How often, and how long at most, Settings re-reads after a tile switch. */
export const TILE_POLL_MS = 1000;
export const TILE_WAIT_MS = 60_000;

/**
 * After a tile switch: re-read /api/settings until the helper has applied it
 * (tile_busy false) or `maxMs` passed. Resolves to the last answer read.
 */
export async function waitTileApplied(
  first: WebSettings,
  read: () => Promise<WebSettings>,
  sleep: (ms: number) => Promise<void>,
  maxMs = TILE_WAIT_MS,
  stepMs = TILE_POLL_MS,
): Promise<WebSettings> {
  let last: WebSettings = first;
  // (an older helper sends no tile_busy: nothing to wait for)
  for (let waited = 0; last.tile_busy === true && waited < maxMs; waited += stepMs) {
    await sleep(stepMs);
    try {
      last = await read();
    } catch {
      // keep the last answer; try again
    }
  }
  return last;
}

/** Turning LAN access on asks first (it opens the page to the network); turning it off just does it. */
export function lanToggleStep(currentlyOn: boolean): "confirm" | "apply" {
  return currentlyOn ? "apply" : "confirm";
}

/** A failed call as one short translated line; null for a 401 (the reload banner says it). */
export function settingsErrorText(err: unknown): string | null {
  if (err instanceof ApiError && err.status === 401) return null;
  if (isOffline(err)) return t("cw_home_err_offline");
  return t("cw_settings_err_save");
}

export interface SettingsViewProps {
  /** null until the first answer. */
  settings: WebSettings | null;
  loadFailed: boolean;
  /** "" = system default. */
  language: string;
  askLan: boolean;
  busy: boolean;
  error: string | null;
  onToggleLan: () => void;
  onConfirmLan: () => void;
  onDismissLan: () => void;
  onToggleTile: () => void;
  onLanguage: (code: string) => void;
}

function Switch({
  action,
  label,
  on,
  disabled,
  onClick,
  note,
}: {
  action: string;
  label: string;
  on: boolean;
  disabled: boolean;
  onClick: () => void;
  note?: string;
}) {
  return (
    <div className="cw-setting">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={disabled}
        className="cw-focusable cw-button"
        data-action={action}
        onClick={onClick}
      >
        <span>{label}</span>
        <span className={`cw-tag${on ? " is-on" : ""}`}>{t(on ? "cw_settings_on" : "cw_settings_off")}</span>
      </button>
      {note ? <p className="cw-dim cw-setting-note">{note}</p> : null}
    </div>
  );
}

/** Settings without state: everything comes in through props (tests render it directly). */
export function SettingsView(p: SettingsViewProps) {
  const s = p.settings;
  return (
    <div className="cw-settings">
      <h1 className="cw-h1">{t("cw_nav_settings")}</h1>
      {p.error ? (
        <div className="cw-msg is-error" role="alert">
          {p.error}
        </div>
      ) : null}

      <section className="cw-home-section">
        <h2 className="cw-h2">{t("cw_settings_network")}</h2>
        {s ? (
          <>
            <Switch
              action="lan"
              label={t("cw_settings_lan")}
              on={s.lan}
              disabled={p.busy}
              onClick={p.onToggleLan}
              note={t(s.lan ? "cw_settings_lan_off_note" : "cw_settings_lan_warning")}
            />
            <Switch
              action="tile"
              label={t("cw_settings_tile")}
              on={s.tile}
              disabled={p.busy}
              onClick={p.onToggleTile}
            />
          </>
        ) : (
          <p className="cw-dim">{t(p.loadFailed ? "cw_settings_err_load" : "cw_home_loading")}</p>
        )}
      </section>

      <section className="cw-home-section">
        <h2 className="cw-h2">{t("cw_settings_language")}</h2>
        <div className="cw-quick" role="group" aria-label={t("cw_settings_language")}>
          {[""].concat(LANGUAGES).map((code) => (
            <button
              key={code || "system"}
              type="button"
              className="cw-focusable cw-button"
              data-lang={code || "system"}
              aria-pressed={p.language === code}
              onClick={() => p.onLanguage(code)}
            >
              <span>{code ? (LANGUAGE_NAMES[code] ?? code) : t("cw_settings_language_system")}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="cw-home-section">
        <h2 className="cw-h2">{t("cw_settings_about")}</h2>
        <p className="cw-dim">
          {t("cw_settings_app_name")}
          {s ? ` · ${t("cw_settings_version", { version: s.version })}` : ""}
        </p>
      </section>

      {p.askLan ? (
        <ConfirmDialog
          title={t("cw_settings_lan_confirm_title")}
          body={t("cw_settings_lan_warning")}
          confirmLabel={t("cw_settings_lan_allow")}
          busy={p.busy}
          onConfirm={p.onConfirmLan}
          onCancel={p.onDismissLan}
        />
      ) : null}
    </div>
  );
}

/** The Settings section: network access, the home-screen tile, language, About. */
export function Settings() {
  const [settings, setSettings] = useState<WebSettings | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [askLan, setAskLan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguageState] = useState(storedLanguage);

  useEffect(() => {
    let live = true;
    call<WebSettings>("/api/settings").then(
      (r) => {
        if (live) setSettings(r);
      },
      () => {
        if (live) setLoadFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const live = useRef(true);
  useEffect(() => {
    // Set true here too: StrictMode runs the cleanup and then the effect again.
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const save = useCallback((change: Partial<Pick<WebSettings, "lan" | "tile">>) => {
    setBusy(true);
    setError(null);
    call<WebSettings>("/api/settings/set", change)
      .then(
        async (s) => {
          setSettings(s);
          if (change.tile === undefined) return;
          // The tile is added or removed after the reply: wait for the real result (the switch stays
          // disabled meanwhile) and say so when it did not work.
          const done = await waitTileApplied(
            s,
            () => call<WebSettings>("/api/settings"),
            (ms) => new Promise((res) => setTimeout(res, ms)),
          );
          if (!live.current) return;
          setSettings(done);
          if (done.tile_failed) setError(t(done.tile ? "cw_settings_err_tile_add" : "cw_settings_err_tile_remove"));
        },
        (e: unknown) => setError(settingsErrorText(e)),
      )
      .finally(() => {
        if (!live.current) return;
        setBusy(false);
        setAskLan(false);
      });
  }, []);

  return (
    <SettingsView
      settings={settings}
      loadFailed={loadFailed}
      language={language}
      askLan={askLan}
      busy={busy}
      error={error}
      onToggleLan={() => {
        if (!settings || busy) return;
        if (lanToggleStep(settings.lan) === "confirm") setAskLan(true);
        else save({ lan: false });
      }}
      onConfirmLan={() => {
        if (!busy) save({ lan: true });
      }}
      onDismissLan={() => {
        if (!busy) setAskLan(false);
      }}
      onToggleTile={() => {
        if (settings && !busy) save({ tile: !settings.tile });
      }}
      onLanguage={(code) => {
        chooseLanguage(code);
        setLanguageState(code);
      }}
    />
  );
}
