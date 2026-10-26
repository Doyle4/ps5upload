// Mesh Drive, a tab of Files (8.0.1): folders kept the same on every device that joins them, at
// home on the console. The tab lists the drives on this console: whether this device keeps each
// one and how it is doing, who else keeps it, and devices waiting to be let in. Making a drive and
// joining one are guided dialogs (DriveDialogs.tsx) where every folder is the user's choice and is
// checked before anything is made.

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Check, FolderSync, MonitorSmartphone, Pause, Play, Plus, RefreshCw, Trash2, UserPlus, X } from "lucide-react";

import { Badge, Button, Callout, OverflowMenu, PageHeader, type OverflowMenuItem } from "../../components";
import { useConfirm } from "../../components/ConfirmDialog";
import {
  driveApi,
  fetchDrives,
  type Drive,
  type DriveMember,
  type DrivesAnswer,
  type LocalDriveMember,
} from "../../api/meshDrive";
import { useConnectionStore } from "../../state/connection";
import { useTr, type Translator } from "../../state/lang";
import { useToastStore } from "../../state/toasts";
import { agoText } from "../Devices";
import { CreateDriveDialog, JoinDriveDialog } from "./DriveDialogs";

type Tone = "good" | "warn" | "bad" | "neutral" | "accent";

const TONE_TEXT: Record<Tone, string> = {
  good: "text-[var(--color-good)]",
  warn: "text-[var(--color-warn)]",
  bad: "text-[var(--color-bad)]",
  accent: "text-[var(--color-accent-bright)]",
  neutral: "text-[var(--color-muted)]",
};

type Loaded = Extract<DrivesAnswer, { supported: true }>;

function statusOf(tr: Translator, l: LocalDriveMember, now: number): { tone: Tone; short: string; long: string } {
  const s = l.status;
  const ago = s.last_ok ? agoText(tr, now - s.last_ok) : "";
  switch (s.state) {
    case "idle":
      return {
        tone: "good",
        short: tr("drive_badge_synced", undefined, "In sync"),
        long: tr("drive_synced", { count: s.files, ago }, `In sync · ${s.files} files · ${ago}`),
      };
    case "syncing":
      return { tone: "accent", short: tr("drive_syncing", undefined, "Syncing…"), long: "" };
    case "waiting":
      return {
        tone: "neutral",
        short: tr("drive_badge_waiting", undefined, "Waiting"),
        long: s.detail || tr("drive_waiting", undefined, "Another device is syncing it"),
      };
    case "pending":
      return {
        tone: "warn",
        short: tr("drive_badge_pending", undefined, "Asked to join"),
        long: tr("drive_pending", undefined, "Waiting for a device in this drive to let this one in"),
      };
    case "paused":
      return { tone: "neutral", short: tr("drive_paused", undefined, "Paused"), long: "" };
    case "offline":
      return { tone: "warn", short: tr("drive_offline", undefined, "Folder offline"), long: s.detail };
    case "confirm":
      return {
        tone: "warn",
        short: tr("drive_badge_confirm", undefined, "Needs you"),
        long: tr(
          "drive_confirm_text",
          { count: s.held_deletes },
          `${s.held_deletes} files would be deleted everywhere. Nothing was deleted yet.`,
        ),
      };
    case "error":
      return {
        tone: "bad",
        short: tr("drive_badge_error", undefined, "Problem"),
        long: s.detail || tr("drive_error", undefined, "The last sync failed"),
      };
    case "removed":
      return { tone: "neutral", short: tr("drive_removed", undefined, "No longer in this drive"), long: "" };
    default:
      return { tone: "neutral", short: tr("drive_starting", undefined, "Starting…"), long: "" };
  }
}

function MemberChip({ m, me, local, now }: { m: DriveMember; me: boolean; local?: LocalDriveMember; now: number }) {
  const tr = useTr();
  const st = local ? statusOf(tr, local, now) : null;
  return (
    <li
      className="flex min-w-0 items-center gap-2 rounded-full border border-[var(--color-border)] px-2.5 py-1 text-xs"
      title={m.path}
    >
      <MonitorSmartphone size={12} aria-hidden className="shrink-0 text-[var(--color-muted)]" />
      <span className="truncate">{m.device_name || tr("mesh_another_device", undefined, "Another device")}</span>
      {me && <span className="text-[var(--color-accent-bright)]">{tr("drive_you", undefined, "you")}</span>}
      {!m.approved && (
        <span className="text-[var(--color-warn)]">{tr("drive_asks_to_join", undefined, "Asks to join")}</span>
      )}
      {m.paused && <span className="text-[var(--color-muted)]">{tr("drive_paused", undefined, "Paused")}</span>}
      {st && !m.paused && m.approved && <span className={TONE_TEXT[st.tone]}>{st.short}</span>}
    </li>
  );
}

function DriveCard({
  d,
  data,
  host,
  now,
  run,
  onJoin,
}: {
  d: Drive;
  data: Loaded;
  host: string;
  now: number;
  run: (f: () => Promise<unknown>) => Promise<void>;
  onJoin: (d: Drive) => void;
}) {
  const tr = useTr();
  const { confirm, dialog } = useConfirm();
  const mine = data.local.find((l) => l.drive === d.id);
  const myMember = d.members.find((m) => m.id === mine?.member);
  const iAmIn = d.members.some((m) => m.device === data.me && m.approved) || d.by === data.me;
  const st = mine ? statusOf(tr, mine, now) : null;
  const devices = new Set(d.members.filter((m) => m.approved).map((m) => m.device)).size;

  const leave = async () => {
    if (!mine) return;
    const ok = await confirm({
      title: tr("drive_leave_title", undefined, "Stop keeping this drive on this device?"),
      message: tr(
        "drive_leave_body",
        { path: mine.path },
        `The files in ${mine.path} stay where they are; they just stop being kept in sync.`,
      ),
      confirmLabel: tr("drive_leave", undefined, "Leave"),
      destructive: true,
    });
    if (ok) await run(() => driveApi.leave(host, d.id, mine.member));
  };

  const remove = async () => {
    const ok = await confirm({
      title: tr("drive_delete_title", { name: d.name }, `Delete the drive ${d.name}?`),
      message: tr(
        "drive_delete_body",
        undefined,
        "Every device stops keeping it in sync. No files are deleted: each folder, and the one on the console, keeps what it has.",
      ),
      confirmLabel: tr("drive_delete", undefined, "Delete drive"),
      destructive: true,
    });
    if (ok) await run(() => driveApi.remove(host, d.id));
  };

  const reviewDeletes = async () => {
    if (!mine) return;
    const ok = await confirm({
      title: tr(
        "drive_confirm_title",
        { count: mine.status.held_deletes },
        `Delete ${mine.status.held_deletes} files everywhere?`,
      ),
      message: tr(
        "drive_confirm_body",
        undefined,
        "They were deleted in one place, so the drive would delete them on every device. Check that no folder was moved or a drive unplugged first. Deleted files stay in the drive's trash folder for 30 days.",
      ),
      confirmLabel: tr("drive_confirm_go", undefined, "Delete everywhere"),
      destructive: true,
    });
    if (ok) await run(() => driveApi.confirm(host, d.id, mine.member));
  };

  const menu: OverflowMenuItem[] = [
    ...(mine && myMember
      ? [
          {
            label: myMember.paused ? tr("drive_resume", undefined, "Resume") : tr("drive_pause", undefined, "Pause"),
            icon: myMember.paused ? <Play size={12} /> : <Pause size={12} />,
            onSelect: () => void run(() => driveApi.pause(host, d.id, mine.member, !myMember.paused)),
          },
          { label: tr("drive_leave", undefined, "Leave"), icon: <X size={12} />, onSelect: () => void leave() },
        ]
      : []),
    ...(iAmIn
      ? [
          {
            label: tr("drive_delete", undefined, "Delete drive"),
            icon: <Trash2 size={12} />,
            onSelect: () => void remove(),
            destructive: true,
          },
        ]
      : []),
  ];

  return (
    <article className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      {dialog}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <FolderSync size={22} className="mt-0.5 shrink-0 text-[var(--color-accent-bright)]" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-semibold">{d.name}</h3>
              {st ? (
                <Badge tone={st.tone} dot>
                  {st.short}
                </Badge>
              ) : (
                <Badge tone="neutral">{tr("drive_not_here", undefined, "Not on this device")}</Badge>
              )}
            </div>
            <p className="truncate text-xs text-[var(--color-muted)]" title={d.hub}>
              {tr("drive_home", { path: d.hub }, `Home on the console: ${d.hub}`)}
              {" · "}
              {tr("drive_device_count", { count: devices }, `Devices: ${devices}`)}
            </p>
            {mine && (
              <p className="truncate text-xs text-[var(--color-muted)]" title={mine.path}>
                {tr("drive_here_at", { path: mine.path }, `Here: ${mine.path}`)}
              </p>
            )}
            {st?.long && <p className={`mt-1 text-xs ${TONE_TEXT[st.tone]}`}>{st.long}</p>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {mine ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void run(() => driveApi.sync(host, d.id))}
              leftIcon={<RefreshCw size={14} />}
            >
              {tr("drive_sync_now", undefined, "Sync now")}
            </Button>
          ) : (
            <Button size="sm" variant="primary" onClick={() => onJoin(d)} leftIcon={<Plus size={14} />}>
              {tr("drive_keep_here", undefined, "Keep on this device…")}
            </Button>
          )}
          {menu.length > 0 && <OverflowMenu items={menu} ariaLabel={tr("more_actions", undefined, "More actions")} />}
        </div>
      </div>
      {mine?.status.state === "confirm" && (
        <div className="mt-3">
          <Button size="sm" variant="primary" onClick={() => void reviewDeletes()}>
            {tr("drive_confirm_review", undefined, "Review the deletes")}
          </Button>
        </div>
      )}
      {d.members.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {d.members.map((m) => (
            <MemberChip
              key={m.id}
              m={m}
              me={m.device === data.me}
              local={data.local.find((l) => l.member === m.id)}
              now={now}
            />
          ))}
        </ul>
      )}
    </article>
  );
}

/** Devices waiting to be let into a drive this device is in. */
function Requests({ data, host, run }: { data: Loaded; host: string; run: (f: () => Promise<unknown>) => Promise<void> }) {
  const tr = useTr();
  const waiting = data.drives.flatMap((d) => {
    const iAmIn = d.members.some((m) => m.device === data.me && m.approved) || d.by === data.me;
    return iAmIn ? d.members.filter((m) => !m.approved).map((m) => ({ d, m })) : [];
  });
  if (!waiting.length) return null;
  return (
    <div className="space-y-2 rounded-[var(--radius-card)] border border-[color-mix(in_srgb,var(--color-warn)_35%,transparent)] bg-[var(--color-warn-soft)] p-3">
      {waiting.map(({ d, m }) => (
        <div key={m.id} className="flex flex-wrap items-center gap-2 text-sm">
          <UserPlus size={16} className="shrink-0 text-[var(--color-warn)]" aria-hidden />
          <span className="min-w-0 flex-1">
            {tr(
              "drive_request",
              { device: m.device_name || "?", drive: d.name },
              `${m.device_name || "?"} wants to keep ${d.name} on that device.`,
            )}
          </span>
          <Button
            size="sm"
            variant="primary"
            leftIcon={<Check size={14} />}
            onClick={() => void run(() => driveApi.approve(host, d.id, m.id, true))}
          >
            {tr("drive_let_in", undefined, "Let in")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void run(() => driveApi.approve(host, d.id, m.id, false))}>
            {tr("drive_decline", undefined, "Decline")}
          </Button>
        </div>
      ))}
    </div>
  );
}

export default function MeshDriveTab({ tabs }: { tabs?: React.ReactNode }) {
  const tr = useTr();
  const navigate = useNavigate();
  const host = useConnectionStore((s) => s.host);
  const up = useConnectionStore((s) => s.payloadStatus === "up");
  const [data, setData] = useState<DrivesAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState<Drive | null>(null);

  const load = useCallback(async () => {
    if (!host || !up) return;
    try {
      setData(await fetchDrives(host));
      setNow(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [host, up]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 5_000);
    return () => window.clearInterval(id);
  }, [load]);

  const run = async (f: () => Promise<unknown>) => {
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    await load();
  };

  const header = (
    <>
      <PageHeader
        icon={FolderSync}
        title={tr("drive_title", undefined, "Mesh Drive")}
        description={tr(
          "drive_subtitle",
          undefined,
          "A folder kept the same on your computers, phones and Docker, with its home on this console. Add a file anywhere and it reaches every device in the drive.",
        )}
        right={
          data?.supported ? (
            <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => setCreating(true)}>
              {tr("drive_create", undefined, "New Mesh Drive")}
            </Button>
          ) : undefined
        }
      />
      {tabs}
    </>
  );

  if (!up || data?.supported === false) {
    const engineOld = data?.supported === false && data.engineOld;
    return (
      <div className="app-page">
        {header}
        <Callout
          tone="info"
          title={
            engineOld
              ? tr("mesh_old_engine", undefined, "This app's engine is older than 8.0.0")
              : !up
                ? tr("drive_need_console", undefined, "Connect to a console to use Mesh Drive")
                : tr("mesh_old_helper", undefined, "Update the helper to see devices")
          }
        >
          {engineOld ? (
            <p>
              {tr(
                "mesh_old_engine_body",
                undefined,
                "The engine this app talks to has no device list yet. Restart the app; if it uses an engine elsewhere (a Docker container), update that to 8.0.0.",
              )}
            </p>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => navigate("/connection")}>
              {tr("connect", undefined, "Connection")}
            </Button>
          )}
        </Callout>
      </div>
    );
  }

  return (
    <div className="app-page space-y-4">
      {header}
      {error && (
        <Callout tone="error" title={tr("mesh_failed", undefined, "That didn't work")}>
          {error}
        </Callout>
      )}
      {data?.supported && <Requests data={data} host={host} run={run} />}
      {data?.supported && data.drives.length === 0 && (
        <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border)] p-6 text-center">
          <FolderSync size={32} className="mx-auto mb-2 text-[var(--color-accent-bright)]" aria-hidden />
          <p className="font-medium">{tr("drive_empty_title", undefined, "No Mesh Drive on this console yet")}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-[var(--color-muted)]">
            {tr(
              "drive_empty_body",
              undefined,
              "Make one: give it a name, a home folder on this console, and a folder on this device. Your other devices then join it with a folder of their own.",
            )}
          </p>
          <Button className="mt-3" variant="primary" leftIcon={<Plus size={16} />} onClick={() => setCreating(true)}>
            {tr("drive_create", undefined, "New Mesh Drive")}
          </Button>
        </div>
      )}
      {data?.supported &&
        data.drives.map((d) => (
          <DriveCard key={d.id} d={d} data={data} host={host} now={now} run={run} onJoin={setJoining} />
        ))}
      {data?.supported && data.drives.length > 0 && (
        <details className="rounded-[var(--radius-card)] border border-[var(--color-border)] p-3 text-sm">
          <summary className="cursor-pointer font-medium">{tr("drive_how", undefined, "How it works")}</summary>
          <ul className="mt-2 list-disc space-y-1 ps-5 text-[var(--color-muted)]">
            <li>
              {tr(
                "drive_how_1",
                undefined,
                "Every device in the drive syncs with its home folder on the console every half minute while the console's helper runs. Docker keeps going with no app open.",
              )}
            </li>
            <li>
              {tr(
                "drive_how_2",
                undefined,
                'Changed in two places at once: both are kept, one renamed "(conflict from …)".',
              )}
            </li>
            <li>
              {tr(
                "drive_how_3",
                undefined,
                "Deleted files go to the drive's .ps5upload-trash folder for 30 days. Deleting many files at once waits for you to confirm.",
              )}
            </li>
            <li>
              {tr(
                "drive_how_4",
                undefined,
                "A folder missing its .ps5upload-mesh file (an unplugged drive) is treated as offline, never as deleted.",
              )}
            </li>
          </ul>
        </details>
      )}
      <CreateDriveDialog
        host={host}
        open={creating}
        onClose={() => setCreating(false)}
        onDone={() => {
          setCreating(false);
          void load();
        }}
      />
      <JoinDriveDialog
        host={host}
        drive={joining}
        open={!!joining}
        onClose={() => setJoining(null)}
        onDone={(approved) => {
          const name = joining?.name ?? "";
          setJoining(null);
          useToastStore.getState().push({
            tone: approved ? "success" : "info",
            message: approved
              ? tr("drive_joined", { name }, `${name} is now kept on this device.`)
              : tr("drive_join_asked", { name }, `Asked to join ${name}. A device already in it lets this one in.`),
          });
          void load();
        }}
      />
    </div>
  );
}
