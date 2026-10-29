import { useCallback, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Bell, RefreshCw, Settings2, Trash2, Tv } from "lucide-react";
import {
  PageHeader,
  Button,
  ErrorCard,
  ConnectionGate,
  EmptyState,
  Spinner,
  Tabs,
} from "../../components";
import { useTr } from "../../state/lang";
import { useConnectionStore } from "../../state/connection";
import { useNotificationsStore } from "../../state/notifications";
import { usePoll } from "../../lib/usePoll";
import { useStaleHostGuard } from "../../lib/staleHostGuard";
import { transferAddr, hostOf } from "../../lib/addr";
import { notifList, notifClear, type Notification as Ps5Message } from "../../api/ps5";
import { humanizePs5Error } from "../../lib/humanizeError";
import { isNotifRead, usePs5NotifRead } from "../../state/ps5NotifRead";
import { NotificationItem, ps5Level, useSeenWhileOpen } from "../../layout/notificationList";
import { NotificationSettingsPanel } from "./NotificationSettings";

/**
 * Notifications: one screen, three tabs.
 *
 *   This app   — what ps5upload told you (uploads done, installs failed,
 *                updates). The same list as the top-bar bell, which shows the
 *                newest few and links here.
 *   On the PS5 — the messages ps5upload put on the console's screen (Remote
 *                Play PIN, cheats), read back from its helper.
 *   Settings   — system notifications and how long the list is kept.
 *
 * Both lists follow one rule for read (layout/notificationList.tsx): the list
 * you look at is read, and what was new keeps its dot until you leave.
 */
export type NotifTab = "app" | "ps5" | "settings";

export function notifTabOf(v: string | null): NotifTab {
  return v === "ps5" || v === "settings" ? v : "app";
}

const POLL_MS = 5_000;

/** The messages the helper has put on the PS5's screen, polled while the
 *  screen is on show. */
function usePs5Messages() {
  const host = useConnectionStore((s) => s.host);
  const payloadStatus = useConnectionStore((s) => s.payloadStatus);
  const addr = host ? transferAddr(host) : "";
  const up = !!addr && payloadStatus === "up";
  const guard = useStaleHostGuard();

  const [items, setItems] = useState<Ps5Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const sinceSeqRef = useRef(0);
  const busyRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!up || busyRef.current) return;
    busyRef.current = true;
    setLoading(true);
    setError(null);
    const probe = guard.capture();
    try {
      const list = await notifList(sinceSeqRef.current, addr);
      if (probe.isStale()) return;
      if (list.notifications.length > 0) {
        setItems((prev) => [...list.notifications, ...prev]);
        sinceSeqRef.current = list.notifications.reduce(
          (m, n) => Math.max(m, n.seq),
          sinceSeqRef.current,
        );
      }
    } catch (e) {
      if (probe.isStale()) return;
      setError(humanizePs5Error(String(e)));
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  }, [up, addr, guard]);

  const clear = useCallback(async () => {
    if (!up) return;
    setClearing(true);
    setError(null);
    const probe = guard.capture();
    try {
      await notifClear(addr);
      if (probe.isStale()) return;
      // The payload keeps its sequence counter running rather than rewinding
      // it, so sinceSeqRef stays valid and the next poll returns only new ones.
      setItems([]);
    } catch (e) {
      if (probe.isStale()) return;
      setError(humanizePs5Error(String(e)));
    } finally {
      setClearing(false);
    }
  }, [up, addr, guard]);

  // Paused while hidden or while a transfer to this console runs.
  usePoll(refresh, POLL_MS, { host, enabled: up });

  // The payload has no read state, so it is kept here, per console.
  const readState = usePs5NotifRead((s) => (host ? s.byHost[hostOf(host)] : undefined));
  const markAllUpTo = usePs5NotifRead((s) => s.markAll);
  const unreadSeqs = items.filter((n) => !isNotifRead(readState, n.seq)).map((n) => n.seq);
  const maxSeq = items.reduce((m, n) => Math.max(m, n.seq), 0);
  const markAllRead = useCallback(() => {
    if (host) markAllUpTo(host, maxSeq);
  }, [host, maxSeq, markAllUpTo]);

  return { up, items, loading, error, clearing, refresh, clear, unreadSeqs, markAllRead };
}

export default function NotificationsScreen() {
  const tr = useTr();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = notifTabOf(searchParams.get("tab"));
  const show = (next: string) => {
    if (next === tab) return;
    const params = new URLSearchParams(searchParams);
    if (next === "app") params.delete("tab");
    else params.set("tab", next);
    setSearchParams(params, { replace: true });
  };

  const entries = useNotificationsStore((s) => s.entries);
  const markAllRead = useNotificationsStore((s) => s.markAllRead);
  const remove = useNotificationsStore((s) => s.remove);
  const clearApp = useNotificationsStore((s) => s.clear);
  const appUnread = entries.filter((e) => !e.read).map((e) => e.id);
  const appSeen = useSeenWhileOpen(tab === "app", appUnread, markAllRead);

  const ps5 = usePs5Messages();
  const ps5Seen = useSeenWhileOpen(tab === "ps5", ps5.unreadSeqs, ps5.markAllRead);

  const actions =
    tab === "app" ? (
      <Button
        variant="ghost"
        size="sm"
        leftIcon={<Trash2 size={14} />}
        onClick={clearApp}
        disabled={entries.length === 0}
      >
        {tr("notifications_clear", undefined, "Clear all")}
      </Button>
    ) : tab === "ps5" ? (
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<Trash2 size={14} />}
          onClick={() => void ps5.clear()}
          disabled={ps5.clearing || ps5.items.length === 0 || !ps5.up}
        >
          {ps5.clearing
            ? tr("ps5notif_clearing", undefined, "Clearing…")
            : tr("ps5notif_clear", undefined, "Clear all")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void ps5.refresh()}
          disabled={ps5.loading || !ps5.up}
          aria-label={tr("refresh", undefined, "Refresh")}
          title={tr("refresh", undefined, "Refresh")}
        >
          {ps5.loading ? <Spinner size={14} tone="inherit" /> : <RefreshCw size={14} />}
        </Button>
      </div>
    ) : undefined;

  const hint =
    tab === "app"
      ? tr(
          "notif_app_hint",
          undefined,
          "What ps5upload has told you: uploads and installs finishing or failing, updates. The bell at the top shows the newest. Looking at this list marks it read.",
        )
      : tab === "ps5"
        ? tr(
            "notif_ps5_hint",
            undefined,
            "Messages ps5upload has put on your PS5's screen (a Remote Play PIN, a cheat switched on), read back from its helper every 5 seconds. Not the PS5's own notification panel.",
          )
        : null;

  return (
    <div className="app-page space-y-4">
      <PageHeader
        icon={Bell}
        title={tr("notifications_screen", undefined, "Notifications")}
        right={actions}
      />

      <Tabs
        ariaLabel={tr("notifications_screen", undefined, "Notifications")}
        value={tab}
        onChange={show}
        tabs={[
          {
            id: "app",
            icon: Bell,
            label: tr("notif_tab_app", undefined, "This app"),
            badge: appUnread.length > 0 ? appUnread.length : undefined,
          },
          {
            id: "ps5",
            icon: Tv,
            label: tr("notif_tab_ps5", undefined, "On the PS5"),
            badge: ps5.unreadSeqs.length > 0 ? ps5.unreadSeqs.length : undefined,
          },
          {
            id: "settings",
            icon: Settings2,
            label: tr("settings", undefined, "Settings"),
          },
        ]}
      />

      <div role="tabpanel" className="space-y-3">
        {hint && <p className="text-sm text-[var(--color-muted)]">{hint}</p>}

        {tab === "app" &&
          (entries.length === 0 ? (
            <EmptyState
              icon={Bell}
              title={tr("notif_app_empty", undefined, "No notifications")}
              message={tr(
                "notifications_empty",
                undefined,
                "No notifications yet. Successful uploads, install errors, and update offers will appear here.",
              )}
            />
          ) : (
            <ul
              data-testid="notifications-app-list"
              className="surface-panel overflow-hidden !rounded-[var(--radius-card)]"
            >
              {entries.map((e) => (
                <NotificationItem
                  key={e.id}
                  level={e.level}
                  title={e.title}
                  body={e.body}
                  ts={e.ts}
                  isNew={appSeen.has(e.id)}
                  link={e.link}
                  onJump={(link) => navigate(link)}
                  onRemove={() => remove(e.id)}
                />
              ))}
            </ul>
          ))}

        {tab === "ps5" && (
          <ConnectionGate>
            {ps5.error && <ErrorCard title={ps5.error} onRetry={() => void ps5.refresh()} />}
            {ps5.items.length === 0 && !ps5.loading ? (
              <EmptyState
                icon={Tv}
                title={tr("ps5notif_empty", undefined, "Nothing shown yet")}
                message={tr(
                  "ps5notif_empty_hint_v2",
                  undefined,
                  "When ps5upload puts a message on your TV, such as a Remote Play PIN or a cheat being switched on, it is listed here so you can read it again. This is not the PS5's own notification panel; the console does not let us read that.",
                )}
              />
            ) : (
              <ul className="surface-panel overflow-hidden !rounded-[var(--radius-card)]">
                {ps5.items.map((n) => (
                  <NotificationItem
                    key={n.seq}
                    level={ps5Level(n.level)}
                    title={n.msg}
                    ts={n.ts * 1000}
                    isNew={ps5Seen.has(n.seq)}
                  />
                ))}
              </ul>
            )}
          </ConnectionGate>
        )}

        {tab === "settings" && (
          <section className="surface-panel space-y-3 !rounded-[var(--radius-card)] p-5">
            <NotificationSettingsPanel />
            <p className="border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-muted)]">
              {tr(
                "notif_settings_ps5_note",
                undefined,
                "The helper on the PS5 keeps its last 64 messages until you clear them or it restarts. They have no settings of their own.",
              )}
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
