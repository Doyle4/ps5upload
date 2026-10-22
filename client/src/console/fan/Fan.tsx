import { useCallback, useEffect, useRef, useState } from "react";
import { call } from "../api";
import { onNavAction } from "../nav";
import { t } from "../strings";
import { pollWhileVisible } from "../ui/visiblePoll";
import {
  activeChoice,
  degrees,
  FAN_POLL_MS,
  fanErrorText,
  isRestartNote,
  presetChoices,
  restoredText,
  stepChoice,
  type FanChoice,
  type FanStatus,
} from "./model";

export interface FanViewProps {
  /** null until the first answer. */
  status: FanStatus | null;
  loadFailed: boolean;
  /** A set is on its way: the choices ignore presses meanwhile. */
  busy: boolean;
  /** A failed set, one line. */
  error: string | null;
  /** "ours is dropped; the console's own comes back by itself" after Console default. */
  note: string | null;
  onChoose: (choice: FanChoice) => void;
}

function Reading({ label, value }: { label: string; value: string }) {
  return (
    <div className="cw-fan-reading">
      <div className="cw-dim">{label}</div>
      <div className="cw-fan-value">{value}</div>
    </div>
  );
}

/**
 * The Fan section without state (tests render it directly): the readings, the
 * preset row (Console default · 85 · 80 · 75 · 70 · 65), −1 / +1 °C, one line
 * of explanation, and the guard's status. Every choice is a big button: the
 * D-pad moves between them and ✕ chooses. While a set runs they are
 * aria-disabled, not disabled, so the focus ring stays where it was.
 */
export function FanView(p: FanViewProps) {
  const s = p.status;
  const active = s ? activeChoice(s) : null;
  const lower = stepChoice(s, -1);
  const raise = stepChoice(s, 1);
  const restored = s ? restoredText(s) : null;
  const choose = (c: FanChoice | null) => {
    if (c !== null && !p.busy && s) p.onChoose(c);
  };

  return (
    <div className="cw-fan">
      <h1 className="cw-h1">{t("cw_fan_title")}</h1>
      {p.error ? (
        <div className="cw-msg is-error" role="alert">
          {p.error}
        </div>
      ) : null}
      {p.note ? (
        <div className="cw-msg is-info" role="status">
          {p.note}
        </div>
      ) : null}
      {s?.guard === "failing" ? (
        <div className="cw-msg is-error" role="alert" data-fan="failing">
          {t("cw_fan_failing")}
        </div>
      ) : null}

      {s ? (
        <section className="cw-card cw-fan-readings" aria-live="polite">
          <Reading label={t("cw_fan_cpu")} value={degrees(s.cpu_c)} />
          <Reading label={t("cw_fan_soc")} value={degrees(s.soc_c)} />
          <Reading label={t("cw_fan_duty")} value={s.duty_pct == null ? "—" : `${s.duty_pct} %`} />
          <div className="cw-fan-target">
            {s.target_c != null ? <div>{t("cw_fan_holding", { c: s.target_c })}</div> : null}
            {s.stock_c != null ? <div className="cw-dim">{t("cw_fan_default_is", { c: s.stock_c })}</div> : null}
          </div>
        </section>
      ) : p.loadFailed ? (
        <div className="cw-msg is-error" role="alert">
          {t("cw_fan_err_load")}
        </div>
      ) : (
        <p className="cw-dim">{t("cw_home_loading")}</p>
      )}

      <section className="cw-home-section">
        <h2 className="cw-h2">{t("cw_fan_choose")}</h2>
        <div className="cw-quick" role="group" aria-label={t("cw_fan_choose")}>
          {presetChoices(s).map((c) => (
            <button
              key={c}
              type="button"
              className="cw-focusable cw-button cw-fan-choice"
              data-fan-choice={c}
              aria-pressed={active === c}
              aria-disabled={p.busy || !s || undefined}
              onClick={() => choose(c)}
            >
              <span>{c === "stock" ? t("cw_fan_console_default") : `${c} °C`}</span>
            </button>
          ))}
        </div>
        <div className="cw-quick" role="group">
          <button
            type="button"
            className="cw-focusable cw-button cw-fan-choice"
            data-fan-step="-1"
            aria-label={t("cw_fan_lower")}
            aria-disabled={p.busy || lower === null || undefined}
            onClick={() => choose(lower)}
          >
            <span>−1 °C</span>
          </button>
          <button
            type="button"
            className="cw-focusable cw-button cw-fan-choice"
            data-fan-step="1"
            aria-label={t("cw_fan_raise")}
            aria-disabled={p.busy || raise === null || undefined}
            onClick={() => choose(raise)}
          >
            <span>+1 °C</span>
          </button>
        </div>
        <p className="cw-dim">{t("cw_fan_explain")}</p>
        {restored ? (
          <p className="cw-dim" data-fan="restored">
            {restored}
          </p>
        ) : null}
      </section>
    </div>
  );
}

/** The Fan section: reads /api/fan every FAN_POLL_MS while visible; a choice goes to /api/fan/set. */
export function Fan() {
  const [status, setStatus] = useState<FanStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const live = useRef(true);
  const reading = useRef(false);
  const busyRef = useRef(false);

  useEffect(() => {
    // Set true here too: StrictMode runs the cleanup and then the effect again.
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const read = useCallback(() => {
    // One read at a time, and none while a set is on its way (its answer is the fresh status).
    if (reading.current || busyRef.current) return;
    reading.current = true;
    call<FanStatus>("/api/fan")
      .then(
        (r) => {
          if (!live.current || !r) return;
          setStatus(r);
          setLoadFailed(false);
        },
        () => {
          if (live.current) setLoadFailed(true);
        },
      )
      .finally(() => {
        reading.current = false;
      });
  }, []);

  useEffect(() => pollWhileVisible(read, FAN_POLL_MS), [read]);
  useEffect(
    () =>
      onNavAction((a) => {
        if (a === "refresh") read();
        return false;
      }),
    [read],
  );

  const choose = useCallback((choice: FanChoice) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNote(null);
    call<FanStatus>("/api/fan/set", choice === "stock" ? { stock: true } : { target_c: choice })
      .then(
        (r) => {
          if (live.current && r) setStatus(r);
        },
        (e: unknown) => {
          if (!live.current) return;
          if (isRestartNote(e)) setNote(t("cw_fan_restart_note"));
          else setError(fanErrorText(e));
        },
      )
      .finally(() => {
        busyRef.current = false;
        if (!live.current) return;
        setBusy(false);
        read();
      });
  }, [read]);

  return <FanView status={status} loadFailed={loadFailed} busy={busy} error={error} note={note} onChoose={choose} />;
}
