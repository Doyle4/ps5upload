import { useCallback, useEffect, useMemo, useState } from "react";
import { call, isOffline, onTokenExpired } from "./api";
import { focusElement, onNavAction, type InputMap } from "./nav";
import { SECTIONS, type SectionContext, type SectionParams } from "./sections";
import { HintBar } from "./shell/HintBar";
import { Rail } from "./shell/Rail";
import { ReloadBanner } from "./shell/ReloadBanner";
import { TopBar, type ConsoleStatus } from "./shell/TopBar";
import { t } from "./strings";

/** The console chip refreshes this often (the temperature moves). */
const STATUS_POLL_MS = 10_000;

function railButton(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-rail-id="${id}"]`);
}

/** The page: top bar, rail of sections, the active section, hint bar, reload banner. */
export function App({ inputMap }: { inputMap: InputMap }) {
  const [active, setActive] = useState(SECTIONS[0].id);
  const [expired, setExpired] = useState(false);
  const [status, setStatus] = useState<ConsoleStatus | null>(null);
  const [offline, setOffline] = useState(false);
  /** Bumped to read /api/status again at once. */
  const [statusTick, setStatusTick] = useState(0);
  /** What the active section was opened with (Home's Browse USB → Files at a path). */
  const [params, setParams] = useState<SectionParams | null>(null);

  /** Switch section; params go only to a section opened through openSection. */
  const show = useCallback((id: string, p: SectionParams | null = null) => {
    setActive(id);
    setParams(p);
  }, []);

  useEffect(() => onTokenExpired(() => setExpired(true)), []);

  // The console chip. Stops once the token is gone: every call would 401.
  useEffect(() => {
    if (expired) return;
    let live = true;
    const load = () => {
      call<ConsoleStatus>("/api/status").then(
        (s) => {
          if (!live) return;
          setStatus(s);
          setOffline(false);
        },
        (e: unknown) => {
          if (live && isOffline(e)) setOffline(true);
        },
      );
    };
    load();
    const timer = window.setInterval(load, STATUS_POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [expired, statusTick]);

  // Start with focus on the rail, so the D-pad works at once.
  useEffect(() => {
    const el = railButton(SECTIONS[0].id);
    if (el) focusElement(el);
  }, []);

  // L1/R1 step through the sections; ○ goes from the content to the rail, then to Home.
  useEffect(
    () =>
      onNavAction((action) => {
        const i = SECTIONS.findIndex((s) => s.id === active);
        if (action === "prevSection" || action === "nextSection") {
          const step = action === "nextSection" ? 1 : SECTIONS.length - 1;
          const next = SECTIONS[(i + step) % SECTIONS.length].id;
          show(next);
          const el = railButton(next);
          if (el) focusElement(el);
          return true;
        }
        if (action === "back") {
          const inRail = !!document.activeElement?.closest(".cw-rail");
          if (!inRail) {
            const el = railButton(active);
            if (el) focusElement(el);
          } else if (active !== SECTIONS[0].id) {
            show(SECTIONS[0].id);
            const el = railButton(SECTIONS[0].id);
            if (el) focusElement(el);
          }
          return true;
        }
        return false;
      }),
    [active, show],
  );

  const ctx = useMemo<SectionContext>(
    () => ({
      status,
      refreshStatus: () => setStatusTick((n) => n + 1),
      openSection: (id, p) => {
        if (!SECTIONS.some((s) => s.id === id)) return;
        show(id, p ?? null);
        const el = railButton(id);
        if (el) focusElement(el);
      },
      canOpen: (id) => SECTIONS.some((s) => s.id === id && s.acceptsParams),
      params,
    }),
    [status, params, show],
  );

  const section = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];
  const chipFallback = offline || expired ? t("cw_status_offline") : status ? null : t("cw_status_connecting");

  return (
    <div className="cw-app">
      <TopBar status={status} chipFallback={chipFallback} />
      <div className="cw-body" aria-hidden={expired ? true : undefined}>
        <Rail sections={SECTIONS} active={active} onSelect={(id) => show(id)} />
        <main className="cw-content">{section.render(ctx)}</main>
      </div>
      <HintBar map={inputMap} />
      {expired ? <ReloadBanner /> : null}
    </div>
  );
}
