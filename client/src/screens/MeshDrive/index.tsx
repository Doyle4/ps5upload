// Mesh Drive (8.0.0): a folder kept the same on every device that joins it, with its home in a
// folder on the console. Each device picks its own folder; its engine keeps that folder and the
// console's the same, so a file added anywhere reaches everyone. Joining needs a device that is
// already in to let the new one in.

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Check, FolderOpen, FolderSync, Pause, Play, Plus, RefreshCw, Trash2, X } from "lucide-react";

import { Badge, Button, Callout, Card, Input, PageHeader } from "../../components";
import { useConfirm } from "../../components/ConfirmDialog";
import {
  consolePathOf,
  driveApi,
  fetchDrives,
  type Drive,
  type DriveMember,
  type DrivesAnswer,
  type LocalDriveMember,
} from "../../api/meshDrive";
import { pickPath } from "../../lib/pickPath";
import { useConnectionStore } from "../../state/connection";
import { useTr, type Translator } from "../../state/lang";
import { agoText } from "../Devices";

function statusText(tr: Translator, l: LocalDriveMember, now: number): { tone: "good" | "warn" | "bad" | "neutral" | "accent"; text: string } {
  const s = l.status;
  switch (s.state) {
    case "idle":
      return {
        tone: "good",
        text: tr(
          "drive_synced",
          { count: s.files, ago: s.last_ok ? agoText(tr, now - s.last_ok) : "" },
          `In sync · ${s.files} files · ${s.last_ok ? agoText(tr, now - s.last_ok) : ""}`,
        ),
      };
    case "syncing":
      return { tone: "accent", text: tr("drive_syncing", undefined, "Syncing…") };
    case "waiting":
      return { tone: "neutral", text: s.detail || tr("drive_waiting", undefined, "Another device is syncing it") };
    case "pending":
      return { tone: "warn", text: tr("drive_pending", undefined, "Waiting for a device in this drive to let this one in") };
    case "paused":
      return { tone: "neutral", text: tr("drive_paused", undefined, "Paused") };
    case "offline":
      return { tone: "warn", text: s.detail || tr("drive_offline", undefined, "Folder offline") };
    case "confirm":
      return {
        tone: "warn",
        text: tr(
          "drive_confirm_text",
          { count: s.held_deletes },
          `${s.held_deletes} files would be deleted everywhere. Nothing was deleted yet.`,
        ),
      };
    case "error":
      return { tone: "bad", text: s.detail || tr("drive_error", undefined, "The last sync failed") };
    case "removed":
      return { tone: "neutral", text: tr("drive_removed", undefined, "No longer in this drive") };
    default:
      return { tone: "neutral", text: tr("drive_starting", undefined, "Starting…") };
  }
}

const TONE_CLASS = {
  good: "text-[var(--color-good)]",
  warn: "text-[var(--color-warn)]",
  bad: "text-[var(--color-bad)]",
  accent: "text-[var(--color-accent-bright)]",
  neutral: "text-[var(--color-muted)]",
} as const;

function MemberRow({
  m,
  local,
  isMe,
  canApprove,
  now,
  onApprove,
  onDecline,
}: {
  m: DriveMember;
  local: LocalDriveMember | undefined;
  isMe: boolean;
  canApprove: boolean;
  now: number;
  onApprove: () => void;
  onDecline: () => void;
}) {
  const tr = useTr();
  const st = local ? statusText(tr, local, now) : null;
  return (
    <li className="flex flex-col gap-1 rounded-[var(--radius-card)] border border-[var(--color-border)] px-3 py-2 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{m.device_name || tr("mesh_another_device", undefined, "Another device")}</span>
          {isMe && <Badge tone="accent">{tr("mesh_this_device", undefined, "This device")}</Badge>}
          {!m.approved && <Badge tone="warn">{tr("drive_asks_to_join", undefined, "Asks to join")}</Badge>}
          {m.paused && <Badge tone="neutral">{tr("drive_paused", undefined, "Paused")}</Badge>}
        </div>
        <p className="truncate text-xs text-[var(--color-muted)]" title={m.path}>
          {m.path}
        </p>
        {st && <p className={`text-xs ${TONE_CLASS[st.tone]}`}>{st.text}</p>}
      </div>
      {!m.approved && canApprove && (
        <div className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="primary" onClick={onApprove}>
            <Check size={14} />
            {tr("drive_let_in", undefined, "Let in")}
          </Button>
          <Button size="sm" variant="ghost" onClick={onDecline}>
            <X size={14} />
            {tr("drive_decline", undefined, "Decline")}
          </Button>
        </div>
      )}
    </li>
  );
}

function DriveCard({
  d,
  data,
  host,
  now,
  run,
}: {
  d: Drive;
  data: Extract<DrivesAnswer, { supported: true }>;
  host: string;
  now: number;
  run: (f: () => Promise<unknown>) => Promise<void>;
}) {
  const tr = useTr();
  const { confirm, dialog } = useConfirm();
  const [joinPath, setJoinPath] = useState(data.suggest ? `${data.suggest}/${d.name}` : "");
  const mine = data.local.find((l) => l.drive === d.id);
  const myMember = d.members.find((m) => m.id === mine?.member);
  const iAmIn = d.members.some((m) => m.device === data.me && m.approved) || d.by === data.me;

  const browse = async () => {
    const p = await pickPath({ mode: "folder", title: tr("drive_pick_folder", undefined, "Choose a folder for this drive") });
    if (p) setJoinPath(p);
  };

  return (
    <Card
      title={d.name}
      icon={FolderSync}
      right={
        <span className="text-xs text-[var(--color-muted)]" title={d.hub}>
          {tr("drive_home", { path: d.hub }, `Home on the console: ${d.hub}`)}
        </span>
      }
    >
      {dialog}
      <div className="space-y-3">
        <ul className="space-y-1.5">
          {d.members.map((m) => (
            <MemberRow
              key={m.id}
              m={m}
              local={data.local.find((l) => l.member === m.id)}
              isMe={m.device === data.me}
              canApprove={iAmIn}
              now={now}
              onApprove={() => void run(() => driveApi.approve(host, d.id, m.id, true))}
              onDecline={() => void run(() => driveApi.approve(host, d.id, m.id, false))}
            />
          ))}
          {d.members.length === 0 && (
            <li className="text-sm text-[var(--color-muted)]">
              {tr("drive_no_members", undefined, "No device keeps a copy yet.")}
            </li>
          )}
        </ul>

        {mine && myMember ? (
          <div className="flex flex-wrap gap-2">
            {mine.status.state === "confirm" && (
              <Button
                size="sm"
                variant="primary"
                onClick={async () => {
                  const ok = await confirm({
                    title: tr("drive_confirm_title", { count: mine.status.held_deletes }, `Delete ${mine.status.held_deletes} files everywhere?`),
                    message: tr(
                      "drive_confirm_body",
                      undefined,
                      "They were deleted in one place, so the drive would delete them on every device. Check that no folder was moved or a drive unplugged first. Deleted files stay in the drive's trash folder for 30 days.",
                    ),
                    confirmLabel: tr("drive_confirm_go", undefined, "Delete everywhere"),
                    destructive: true,
                  });
                  if (ok) await run(() => driveApi.confirm(host, d.id, mine.member));
                }}
              >
                {tr("drive_confirm_review", undefined, "Review the deletes")}
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => void run(() => driveApi.sync(host, d.id))}>
              <RefreshCw size={14} />
              {tr("drive_sync_now", undefined, "Sync now")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void run(() => driveApi.pause(host, d.id, mine.member, !myMember.paused))}
            >
              {myMember.paused ? <Play size={14} /> : <Pause size={14} />}
              {myMember.paused ? tr("drive_resume", undefined, "Resume") : tr("drive_pause", undefined, "Pause")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
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
              }}
            >
              {tr("drive_leave", undefined, "Leave")}
            </Button>
          </div>
        ) : (
          <div className="space-y-2 rounded-[var(--radius-card)] bg-[var(--color-surface)] p-3">
            <p className="text-sm">
              {tr("drive_join_lead", undefined, "Keep a copy of this drive on this device:")}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="min-w-0 flex-1">
                <Input value={joinPath} onChange={(e) => setJoinPath(e.target.value)} placeholder="/path/to/folder" />
              </div>
              <Button variant="ghost" onClick={() => void browse()}>
                <FolderOpen size={16} />
                {tr("browse", undefined, "Browse…")}
              </Button>
              <Button
                variant="primary"
                disabled={!joinPath.trim()}
                onClick={() => void run(() => driveApi.join(host, d.id, joinPath.trim()))}
              >
                {tr("drive_join", undefined, "Join")}
              </Button>
            </div>
            <p className="text-xs text-[var(--color-muted)]">
              {tr(
                "drive_join_hint",
                undefined,
                "A device already in the drive lets this one in from its own Mesh Drive screen. Files already in the folder are added to the drive.",
              )}
            </p>
          </div>
        )}

        {iAmIn && (
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
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
              }}
            >
              <Trash2 size={14} />
              {tr("drive_delete", undefined, "Delete drive")}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function CreateCard({ host, data, run }: { host: string; data: Extract<DrivesAnswer, { supported: true }>; run: (f: () => Promise<unknown>) => Promise<void> }) {
  const tr = useTr();
  const [name, setName] = useState("Mesh Drive");
  const [hub, setHub] = useState("/data/PS5Upload Mesh Drive");
  const [path, setPath] = useState(data.suggest ?? "");
  return (
    <Card title={tr("drive_create", undefined, "New Mesh Drive")} icon={Plus}>
      <div className="space-y-3">
        <Input label={tr("drive_name", undefined, "Name")} value={name} onChange={(e) => setName(e.target.value)} />
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Input
              label={tr("drive_hub_label", undefined, "Its home: a folder on this console")}
              value={hub}
              onChange={(e) => setHub(e.target.value)}
            />
          </div>
          <Button
            variant="ghost"
            onClick={async () => {
              const p = await pickPath({ mode: "folder", source: { console: host } });
              if (p) setHub(consolePathOf(p));
            }}
          >
            <FolderOpen size={16} />
            {tr("browse", undefined, "Browse…")}
          </Button>
        </div>
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Input
              label={tr("drive_local_label", undefined, "This device's copy (optional)")}
              value={path}
              onChange={(e) => setPath(e.target.value)}
            />
          </div>
          <Button
            variant="ghost"
            onClick={async () => {
              const p = await pickPath({ mode: "folder" });
              if (p) setPath(p);
            }}
          >
            <FolderOpen size={16} />
            {tr("browse", undefined, "Browse…")}
          </Button>
        </div>
        <div className="flex justify-end">
          <Button
            variant="primary"
            disabled={!name.trim() || !hub.trim().startsWith("/")}
            onClick={() => void run(() => driveApi.create(host, name.trim(), hub.trim(), path.trim() || null))}
          >
            <Plus size={16} />
            {tr("drive_create_go", undefined, "Create")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function MeshDriveScreen() {
  const tr = useTr();
  const navigate = useNavigate();
  const host = useConnectionStore((s) => s.host);
  const up = useConnectionStore((s) => s.payloadStatus === "up");
  const [data, setData] = useState<DrivesAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

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
    <PageHeader
      icon={FolderSync}
      title={tr("drive_title", undefined, "Mesh Drive")}
      description={tr(
        "drive_subtitle",
        undefined,
        "A folder kept the same on your computers, phones and Docker, with its home on this console. Add a file anywhere and it reaches every device in the drive.",
      )}
      right={
        <Button variant="ghost" onClick={() => void load()}>
          <RefreshCw size={16} />
          {tr("refresh", undefined, "Refresh")}
        </Button>
      }
    />
  );

  if (!up || data?.supported === false) {
    return (
      <div className="app-page">
        {header}
        <Callout
          tone="info"
          title={
            !up
              ? tr("drive_need_console", undefined, "Connect to a console to use Mesh Drive")
              : tr("mesh_old_helper", undefined, "Update the helper to see devices")
          }
        >
          <Button size="sm" variant="secondary" onClick={() => navigate("/connection")}>
            {tr("connect", undefined, "Connection")}
          </Button>
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
      {data?.supported && (
        <>
          {data.drives.map((d) => (
            <DriveCard key={d.id} d={d} data={data} host={host} now={now} run={run} />
          ))}
          <CreateCard host={host} data={data} run={run} />
          <Card title={tr("drive_how", undefined, "How it works")}>
            <ul className="list-disc space-y-1 ps-5 text-sm text-[var(--color-muted)]">
              <li>{tr("drive_how_1", undefined, "Every device in the drive syncs with its home folder on the console every half minute while the console's helper runs. Docker keeps going with no app open.")}</li>
              <li>{tr("drive_how_2", undefined, "Changed in two places at once: both are kept, one renamed \"(conflict from …)\".")}</li>
              <li>{tr("drive_how_3", undefined, "Deleted files go to the drive's .ps5upload-trash folder for 30 days. Deleting many files at once waits for you to confirm.")}</li>
              <li>{tr("drive_how_4", undefined, "A folder missing its .ps5upload-mesh file (an unplugged drive) is treated as offline, never as deleted.")}</li>
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
