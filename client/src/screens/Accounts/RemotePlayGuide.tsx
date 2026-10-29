import { useState } from "react";
import { useNavigate } from "react-router";
import { Check, ChevronDown, ChevronRight, CircleDot, X } from "lucide-react";

import type { RemotePlayReadiness } from "../../api/ps5";
import { Button, ErrorCard } from "../../components";
import type { useTr } from "../../state/lang";
import { useRosterStore } from "../../state/roster";
import { useConnectionStore } from "../../state/connection";

type Tr = ReturnType<typeof useTr>;

/** A step is checked by the app (ok / todo), or only the console can show it (manual). */
type StepState = "ok" | "todo" | "manual";

interface Step {
  key: string;
  state: StepState;
  title: string;
  body: string;
  detail?: string;
  fixLabel?: string;
  fix?: () => void;
}

/** Firmware magic to a human version: both bytes are BCD (9.60 is 0x0960). */
function fwOf(magic: number): string {
  const bcd = (b: number) => (b >> 4) * 10 + (b & 0x0f);
  const minor = bcd((magic >> 16) & 0xff);
  return `${bcd((magic >> 24) & 0xff)}.${minor < 10 ? "0" : ""}${minor}`;
}

/**
 * Remote Play from nothing to playing, in the order it is done. Each step the app can read shows
 * whether it is done and, where the app can do it, the button that does it; the steps only the
 * console can show (its rest-mode menu) say exactly where to go. Then what to do when it still
 * does not work.
 */
export function RemotePlayGuide({
  readiness,
  onEnable,
  onShowAccounts,
  onShowSignIn,
  busy,
  tr,
}: {
  readiness: RemotePlayReadiness | null;
  onEnable: (scope: "service" | "user") => void;
  onShowAccounts: () => void;
  onShowSignIn: () => void;
  busy: boolean;
  tr: Tr;
}) {
  const navigate = useNavigate();
  const host = useConnectionStore((s) => s.host);
  const profile = useRosterStore((s) => s.profiles.find((p) => p.host === host?.trim()) ?? null);
  const paired = !!(profile?.wake_regist_key && profile?.wake_rp_key);

  if (readiness && readiness.registry_err !== 0) {
    return (
      <ErrorCard
        title={tr(
          "remotePlay_registry_unreadable",
          undefined,
          "Couldn't read this console's settings, so Remote Play status is unknown. Send the helper again and retry.",
        )}
      />
    );
  }

  const known = !!readiness;
  const st = (ok: boolean | undefined): StepState => (!known ? "manual" : ok ? "ok" : "todo");
  const signedIn = readiness ? readiness.account_uid > 0 : undefined;
  const activated = readiness ? readiness.account_id_raw !== 0 && readiness.account_type === "np" : undefined;
  const serviceOn = readiness ? readiness.service_enabled !== 0 : undefined;
  const userOn = readiness && readiness.has_per_user !== 0 ? readiness.user_enabled !== 0 : undefined;

  const steps: Step[] = [
    {
      key: "user",
      state: st(signedIn),
      title: tr("rpg_user_title", undefined, "Sign in to a user on the PS5"),
      body: tr(
        "rpg_user_body",
        undefined,
        "On the console, pick the user you will play as. Nobody has to stay on screen, but the user must be signed in. Use a user without a login passcode: a passcode stops the automatic sign-in when the console wakes.",
      ),
      detail:
        readiness && readiness.user_slot > 0
          ? tr("remotePlay_slot", { slot: readiness.user_slot }, `Slot ${readiness.user_slot}`)
          : undefined,
    },
    {
      key: "account",
      state: st(activated),
      title: tr("rpg_account_title", undefined, "Give that user an account ID"),
      body: tr(
        "rpg_account_body",
        undefined,
        "Remote Play pairs with an account ID. A user linked to PlayStation Network already has one; an offline user needs one set in Users above (any ID works; write it down, saves made afterwards are tied to it).",
      ),
      fix: onShowAccounts,
      fixLabel: tr("remotePlay_show_accounts", undefined, "Show accounts"),
    },
    {
      key: "signin",
      state: known ? (serviceOn ? "ok" : "todo") : "manual",
      title: tr("rpg_signin_title", undefined, "Sign the account in to PlayStation Network (offline)"),
      body: tr(
        "rpg_signin_body",
        undefined,
        "The PS5 only lets a signed-in account use Remote Play. If the console's own Remote Play setting is greyed out, run the offline sign-in below (nothing is sent to Sony), then restart the PS5. It can be undone.",
      ),
      fix: onShowSignIn,
      fixLabel: tr("rpg_signin_fix", undefined, "Go to sign-in"),
    },
    {
      key: "service",
      state: st(serviceOn && (userOn ?? true)),
      title: tr("rpg_service_title", undefined, "Turn Remote Play on"),
      body: tr(
        "rpg_service_body",
        undefined,
        "Settings › System › Remote Play › Enable Remote Play. The app can switch it on for you, and on firmware 10.00 and later also allow it for this user.",
      ),
      detail: readiness?.fw_magic ? tr("remotePlay_fw", { fw: fwOf(readiness.fw_magic) }, `firmware ${fwOf(readiness.fw_magic)}`) : undefined,
      fix: known && !serviceOn ? () => onEnable("service") : known && userOn === false ? () => onEnable("user") : undefined,
      fixLabel: known && !serviceOn ? tr("remotePlay_turn_on", undefined, "Turn on") : tr("remotePlay_allow_user", undefined, "Allow"),
    },
    {
      key: "rest",
      state: "manual",
      title: tr("rpg_rest_title", undefined, "Let the PS5 be woken from rest mode"),
      body: tr(
        "rpg_rest_body",
        undefined,
        "Settings › System › Power Saving › Features Available in Rest Mode: turn on Stay Connected to the Internet and Enable Turning On PS5 from Network. Without them, a console in rest mode cannot be woken and its network sleeps after a few seconds. Only the console can show these.",
      ),
    },
    {
      key: "pair",
      state: paired ? "ok" : "todo",
      title: tr("rpg_pair_title", undefined, "Pair this app with the console"),
      body: tr(
        "rpg_pair_body",
        undefined,
        "Connection › Wake & sign in › Set up. One click registers this app with the PS5 (like pairing the PS Remote Play app) and keeps its keys on this computer. Streaming, waking and signing in all use them; do it again after resetting the console or changing the user.",
      ),
      fix: () => navigate("/connection"),
      fixLabel: tr("rp_open_connection", undefined, "Open Connection"),
    },
    {
      key: "play",
      state: paired ? "ok" : "manual",
      title: tr("rpg_play_title", undefined, "Play"),
      body: tr(
        "rpg_play_body",
        undefined,
        "Open Remote Play and press Start: the app wakes the console if it is resting, signs in, and streams. Play with a controller connected to this computer, the keyboard, or touch. To use Sony's PS Remote Play app or chiaki-ng instead, request a PIN below and enter it there.",
      ),
      fix: () => navigate("/play"),
      fixLabel: tr("rpg_play_fix", undefined, "Open Remote Play"),
    },
  ];

  const done = steps.filter((s) => s.state === "ok").length;
  const checkable = steps.filter((s) => s.state !== "manual").length;

  return (
    <div className="surface-panel p-5" data-testid="rp-guide">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{tr("rpg_title", undefined, "Set up Remote Play")}</span>
        <span className="text-xs text-[var(--color-muted)]">
          {tr("rpg_progress", { done, n: checkable }, `${done} of ${checkable} checked steps done`)}
        </span>
      </div>
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={s.key} className="flex items-start gap-3 text-sm" data-step={s.key} data-state={s.state}>
            <span
              className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                s.state === "ok"
                  ? "bg-[color-mix(in_srgb,var(--color-good)_18%,transparent)] text-[var(--color-good)]"
                  : s.state === "todo"
                    ? "bg-[color-mix(in_srgb,var(--color-warn)_18%,transparent)] text-[var(--color-warn)]"
                    : "bg-[var(--color-surface-3)] text-[var(--color-muted)]"
              }`}
              aria-hidden
            >
              {s.state === "ok" ? <Check size={13} /> : s.state === "todo" ? <X size={13} /> : i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className={s.state === "todo" ? "font-medium" : ""}>{s.title}</span>
              {s.detail && <span className="ms-2 text-xs text-[var(--color-muted)]">{s.detail}</span>}
              {s.state === "manual" && (
                <span className="ms-2 inline-flex items-center gap-1 text-xs text-[var(--color-muted)]">
                  <CircleDot size={10} />
                  {tr("rpg_on_console", undefined, "check on the console")}
                </span>
              )}
              {s.state !== "ok" && <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-[var(--color-muted)]">{s.body}</p>}
            </span>
            {s.state !== "ok" && s.fix && (
              <Button size="sm" variant="secondary" onClick={s.fix} disabled={busy}>
                {s.fixLabel}
              </Button>
            )}
          </li>
        ))}
      </ol>
      <Troubleshooting tr={tr} />
    </div>
  );
}

function Troubleshooting({ tr }: { tr: Tr }) {
  const [open, setOpen] = useState(false);
  const items: [string, string, string, string][] = [
    [
      "rpg_t_start_q",
      "Start is greyed out on the Remote Play screen.",
      "rpg_t_start_a",
      "This app is not paired with that console yet: do step 6 (Connection › Wake & sign in › Set up).",
    ],
    [
      "rpg_t_pair_q",
      "Setting up pairing says there is no signed-in user with an activated account.",
      "rpg_t_pair_a",
      "Steps 1 and 2: sign in to a user on the PS5 and give it an account ID, then try again.",
    ],
    [
      "rpg_t_grey_q",
      "The PS5's own Remote Play setting is greyed out.",
      "rpg_t_grey_a",
      "The account is not signed in to PlayStation Network. Run the offline sign-in (step 3) and restart the PS5.",
    ],
    [
      "rpg_t_wake_q",
      "The console does not wake, or wakes but stays on the user screen.",
      "rpg_t_wake_a",
      "Check step 5 on the console. A user with a login passcode stops the automatic sign-in. If the console was reset or the user changed, set up pairing again (step 6).",
    ],
    [
      "rpg_t_black_q",
      "The picture stays black, stutters, or the sound crackles.",
      "rpg_t_black_a",
      "Use a wired connection or 5 GHz Wi-Fi for the PS5 and this computer, and try 720p or 30 fps in Remote Play's settings. A firewall on this computer must allow the app on the local network (Remote Play uses TCP and UDP ports 9295–9304). In a browser, use a current Chrome, Edge or Safari: the picture needs WebCodecs.",
    ],
    [
      "rpg_t_busy_q",
      "It says the PS5 is still finishing the last session, or another console is streaming.",
      "rpg_t_busy_a",
      "One console streams at a time and the PS5 needs up to 30 seconds after a session ends. Stop the other stream, wait a moment, then press Start again.",
    ],
    [
      "rpg_t_restrict_q",
      "After the offline sign-in, games ask to disable console restrictions.",
      "rpg_t_restrict_a",
      "Use Undo sign-in on this page and restart, or lift the restriction in Settings › Family and Parental Controls › PS5 Console Restrictions (passcode 0000 unless you changed it).",
    ],
  ];
  return (
    <div className="mt-4 border-t border-[var(--color-border)] pt-3">
      <button
        type="button"
        className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-muted)] hover:text-[var(--color-text)]"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} className="rtl:rotate-180" />}
        {tr("rpg_trouble", undefined, "If it still does not work")}
      </button>
      {open && (
        <dl className="mt-2 space-y-2">
          {items.map(([qk, q, ak, a]) => (
            <div key={qk} className="text-xs">
              <dt className="font-medium">{tr(qk, undefined, q)}</dt>
              <dd className="mt-0.5 max-w-3xl leading-relaxed text-[var(--color-muted)]">{tr(ak, undefined, a)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
