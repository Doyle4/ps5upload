//! Mesh Drive (8.0.0): a folder kept the same across devices, with its home (the hub) in a folder on
//! a console. Each device that joins picks a folder of its own; its engine keeps that folder and the
//! hub the same, one pass every half minute while the console's helper answers. Every device syncs
//! with the hub, so a file added anywhere reaches everyone.
//!
//! Where things live:
//! * the console's "drives" document (mesh doc): every drive, its hub folder and its members, and
//!   who asked to join (a device joins when a member lets it in);
//! * this engine's `mesh-drive/config.json`: which of those members are folders on this device;
//! * `mesh-drive/<drive>-<member>.json`: what this folder and the hub last agreed on (the base the
//!   planner compares against, `mesh_drive_plan`).
//!
//! Safety: a folder without its marker file is offline, never "everything deleted"; deletes go to a
//! trash folder for 30 days; a pass that would delete many files waits for a person to confirm; two
//! engines never sync the same drive at once (the console's `drive:<id>` lock).
//!
//! Routes (each answers `supported:false` against a helper from before 8.0.0):
//! * `GET  /api/drive?addr=`                                   -> drives, this device's folders
//! * `POST /api/drive/create`  `{addr,name,hub,path?}`
//! * `POST /api/drive/join`    `{addr,drive,path}`
//! * `POST /api/drive/approve` `{addr,drive,member,approve}`
//! * `POST /api/drive/leave`   `{addr,drive,member}`
//! * `POST /api/drive/delete`  `{addr,drive}`                   (the drive goes; files stay)
//! * `POST /api/drive/pause`   `{addr,drive,member,paused}`
//! * `POST /api/drive/sync`    `{addr,drive}`                   (a pass now)
//! * `POST /api/drive/confirm` `{addr,drive,member}`            (let a held-back mass delete run)
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, bail, Context, Result};
use axum::extract::Query;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use ps5upload_core::fs_ops::{self, ListDirOptions};
use ps5upload_core::mesh;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::json_err;
use crate::mesh_drive_plan::{
    conflict_name, date_parts, ignored, plan, too_many_deletes, Base, BaseEntry, Listing, Meta, Op,
    MARKER, TMP, TRASH,
};

/// One pass per member this often.
pub const EVERY: Duration = Duration::from_secs(30);
/// A drive holds at most this many files (a pass lists both sides in full).
const MAX_FILES: usize = 50_000;
/// A file changed this recently may still be being written: it waits for the next pass.
const SETTLE_SECS: i64 = 10;
/// The drive lock lasts this long, and a running pass renews it this often.
const LOCK_TTL_S: u64 = 600;
const LOCK_RENEW: Duration = Duration::from_secs(120);
/// Trash is emptied after this long.
const TRASH_DAYS: i64 = 30;

// ---- the console's document ----

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct DriveDoc {
    #[serde(default)]
    pub drives: Vec<Drive>,
    /// What a newer version keeps here: carried through untouched.
    #[serde(flatten)]
    pub other: serde_json::Map<String, Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Drive {
    pub id: String,
    pub name: String,
    /// The hub: a folder on this console.
    pub hub: String,
    #[serde(default)]
    pub created: u64,
    /// The device that made it (key hex).
    #[serde(default)]
    pub by: String,
    #[serde(default)]
    pub members: Vec<Member>,
    #[serde(flatten)]
    pub other: serde_json::Map<String, Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Member {
    pub id: String,
    /// The device whose engine syncs this folder (key hex).
    pub device: String,
    #[serde(default)]
    pub device_name: String,
    /// The folder on that device.
    pub path: String,
    /// False while it waits for a member to let it in.
    #[serde(default)]
    pub approved: bool,
    #[serde(default)]
    pub paused: bool,
    #[serde(default)]
    pub joined: u64,
    #[serde(flatten)]
    pub other: serde_json::Map<String, Value>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

fn new_id() -> String {
    let b: [u8; 8] = ava1::keys::random_bytes().unwrap_or_else(|_| now_ms().to_le_bytes());
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// `{rev, doc}` from the console; None for a helper without documents.
fn doc_read(addr: &str) -> Result<Option<(u64, DriveDoc)>> {
    let Some(v) = crate::mesh_api::call(addr, || mesh::doc_get(addr, "drives"))? else {
        return Ok(None);
    };
    let rev = v.get("rev").and_then(Value::as_u64).unwrap_or(0);
    // A list this version cannot read is never taken as empty: writing it back would drop every
    // drive in it.
    let doc = match v.get("doc") {
        Some(d) if d.is_object() => serde_json::from_value(d.clone())
            .map_err(|e| anyhow!("the console's drive list cannot be read by this version: {e}"))?,
        _ => DriveDoc::default(),
    };
    Ok(Some((rev, doc)))
}

/// Read, change, write against the revision read; again when another device wrote in between.
fn doc_update<T>(addr: &str, mut f: impl FnMut(&mut DriveDoc) -> Result<T>) -> Result<Option<T>> {
    for _ in 0..6 {
        let Some((rev, mut doc)) = doc_read(addr)? else {
            return Ok(None);
        };
        let out = f(&mut doc)?;
        let body = serde_json::to_value(&doc)?;
        let Some(r) = crate::mesh_api::call(addr, || mesh::doc_put(addr, "drives", rev, &body))?
        else {
            return Ok(None);
        };
        if r.get("saved").and_then(Value::as_bool) == Some(true) {
            return Ok(Some(out));
        }
    }
    bail!("the drive list kept changing on the console; try again")
}

// ---- this engine's members ----

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
struct LocalConfig {
    #[serde(default)]
    members: Vec<LocalMember>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
struct LocalMember {
    /// The console address the drive lives on.
    console: String,
    drive: String,
    member: String,
    path: String,
    /// The drive's name when this folder joined it (for messages; the console has the current one).
    #[serde(default)]
    name: String,
}

fn state_dir() -> Option<PathBuf> {
    Some(crate::remote::store::data_dir()?.join("mesh-drive"))
}

fn config_lock() -> &'static Mutex<()> {
    static L: OnceLock<Mutex<()>> = OnceLock::new();
    L.get_or_init(|| Mutex::new(()))
}

fn load_config() -> LocalConfig {
    let Some(p) = state_dir().map(|d| d.join("config.json")) else {
        return LocalConfig::default();
    };
    std::fs::read(&p)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn save_config(c: &LocalConfig) -> Result<()> {
    let dir = state_dir().ok_or_else(|| anyhow!("no data directory"))?;
    std::fs::create_dir_all(&dir)?;
    write_atomic(&dir.join("config.json"), &serde_json::to_vec_pretty(c)?)
}

fn edit_config(f: impl FnOnce(&mut LocalConfig)) -> Result<()> {
    let _g = config_lock().lock().unwrap_or_else(|e| e.into_inner());
    let mut c = load_config();
    f(&mut c);
    save_config(&c)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

fn base_path(drive: &str, member: &str) -> Option<PathBuf> {
    Some(state_dir()?.join(format!("{drive}-{member}.json")))
}

fn load_base(drive: &str, member: &str) -> Base {
    base_path(drive, member)
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn save_base(drive: &str, member: &str, base: &Base) -> Result<()> {
    let p = base_path(drive, member).ok_or_else(|| anyhow!("no data directory"))?;
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d)?;
    }
    write_atomic(&p, &serde_json::to_vec(base)?)
}

// ---- status ----

#[derive(Clone, Debug, Default, Serialize)]
pub struct Status {
    /// idle, syncing, waiting (another device is syncing), offline, paused, pending (not let in
    /// yet), confirm (a mass delete waits), error, removed.
    pub state: String,
    pub detail: String,
    pub last_ok: u64,
    pub files: usize,
    pub uploaded: usize,
    pub downloaded: usize,
    pub deleted: usize,
    pub conflicts: usize,
    /// Deletes held back for confirmation.
    pub held_deletes: usize,
}

fn statuses() -> &'static Mutex<HashMap<String, Status>> {
    static S: OnceLock<Mutex<HashMap<String, Status>>> = OnceLock::new();
    S.get_or_init(Default::default)
}

fn set_status(member: &str, f: impl FnOnce(&mut Status)) {
    let mut m = statuses().lock().unwrap_or_else(|e| e.into_inner());
    f(m.entry(member.to_string()).or_default());
}

fn confirmed() -> &'static Mutex<std::collections::HashSet<String>> {
    static C: OnceLock<Mutex<std::collections::HashSet<String>>> = OnceLock::new();
    C.get_or_init(Default::default)
}

// ---- scanning ----

fn walk_local(root: &Path) -> Result<Listing> {
    let mut out = Listing::new();
    let mut stack = vec![(root.to_path_buf(), String::new())];
    while let Some((dir, rel)) = stack.pop() {
        for e in std::fs::read_dir(&dir).with_context(|| format!("read {}", dir.display()))? {
            let e = e?;
            let name = e.file_name().to_string_lossy().into_owned();
            if ignored(&name) {
                continue;
            }
            let ft = e.file_type()?;
            let child = if rel.is_empty() {
                name.clone()
            } else {
                format!("{rel}/{name}")
            };
            if ft.is_dir() {
                stack.push((e.path(), child));
            } else if ft.is_file() {
                let md = e.metadata()?;
                let mtime = md
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map_or(0, |d| d.as_secs() as i64);
                out.insert(
                    child,
                    Meta {
                        size: md.len(),
                        mtime,
                    },
                );
                if out.len() > MAX_FILES {
                    bail!("more than {MAX_FILES} files: too many for a Mesh Drive");
                }
            }
        }
    }
    Ok(out)
}

fn join_hub(hub: &str, rel: &str) -> String {
    format!("{}/{rel}", hub.trim_end_matches('/'))
}

fn walk_hub(addr: &str, hub: &str) -> Result<Listing> {
    let mut out = Listing::new();
    let mut stack = vec![String::new()];
    while let Some(rel) = stack.pop() {
        let dir = if rel.is_empty() {
            hub.trim_end_matches('/').to_string()
        } else {
            join_hub(hub, &rel)
        };
        let mut offset = 0u64;
        loop {
            let l = fs_ops::list_dir(addr, &dir, ListDirOptions { offset, limit: 256 })?;
            let n = l.entries.len() as u64;
            for e in l.entries {
                if ignored(&e.name) || e.name == "." || e.name == ".." {
                    continue;
                }
                let child = if rel.is_empty() {
                    e.name.clone()
                } else {
                    format!("{rel}/{}", e.name)
                };
                match e.kind.as_str() {
                    "dir" => stack.push(child),
                    "file" => {
                        out.insert(
                            child,
                            Meta {
                                size: e.size,
                                mtime: e.mtime,
                            },
                        );
                        if out.len() > MAX_FILES {
                            bail!("more than {MAX_FILES} files: too many for a Mesh Drive");
                        }
                    }
                    _ => {}
                }
            }
            if n < 256 && !l.truncated {
                break;
            }
            if n == 0 {
                break;
            }
            offset += n;
        }
    }
    Ok(out)
}

fn local_stat(p: &Path) -> Option<Meta> {
    let md = std::fs::metadata(p).ok()?;
    let mtime = md
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_secs() as i64);
    Some(Meta {
        size: md.len(),
        mtime,
    })
}

fn hub_stat(addr: &str, path: &str) -> Option<Meta> {
    let s = fs_ops::fs_stat(addr, path).ok()?;
    (s.kind == "file").then_some(Meta {
        size: s.size,
        mtime: s.mtime as i64,
    })
}

fn local_path(root: &Path, rel: &str) -> PathBuf {
    rel.split('/').fold(root.to_path_buf(), |p, c| p.join(c))
}

/// No path that leaves the folder, whatever a listing said.
fn safe_rel(rel: &str) -> bool {
    !rel.is_empty()
        && !rel.starts_with('/')
        && rel
            .split('/')
            .all(|c| !c.is_empty() && c != "." && c != ".." && !c.contains('\\'))
}

// ---- one pass ----

struct Pass<'a> {
    addr: &'a str,
    drive: &'a Drive,
    member: &'a LocalMember,
    root: PathBuf,
    device_name: String,
    /// The drive's lock, renewed while a long pass runs so no other engine starts on it.
    lock_name: String,
    lock_label: String,
}

impl Pass<'_> {
    fn upload(&self, rel: &str) -> Result<()> {
        let src = local_path(&self.root, rel);
        let dest = join_hub(&self.drive.hub, rel);
        if let Some(parent) = dest.rsplit_once('/').map(|(d, _)| d) {
            fs_ops::fs_mkdir(self.addr, parent)?;
        }
        let cfg = crate::make_transfer_config(self.addr);
        let job: [u8; 16] = ava1::keys::random_bytes()?;
        ps5upload_ava1::upload::upload_file(&cfg, job, &dest, &src)
            .map_err(|e| anyhow!("upload {rel}: {e:#}"))?;
        Ok(())
    }

    fn download(&self, rel: &str) -> Result<()> {
        let src = join_hub(&self.drive.hub, rel);
        let target = local_path(&self.root, rel);
        let tmp_dir = self.root.join(TMP).join(new_id());
        std::fs::create_dir_all(&tmp_dir)?;
        let job: [u8; 16] = ava1::keys::random_bytes()?;
        let r = ps5upload_ava1::download::to_local(
            self.addr,
            &src,
            ps5upload_core::download::DownloadKind::File,
            &tmp_dir,
            false,
            job,
            &ps5upload_ava1::download::Counters::default(),
            None,
        );
        let name = rel.rsplit('/').next().unwrap_or(rel);
        let got = tmp_dir.join(name);
        let res = r
            .map_err(|e| anyhow!("download {rel}: {e:#}"))
            .and_then(|_| {
                if let Some(parent) = target.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::rename(&got, &target).with_context(|| format!("place {rel}"))
            });
        let _ = std::fs::remove_dir_all(&tmp_dir);
        // Only goes when nothing else is downloading into it.
        let _ = std::fs::remove_dir(self.root.join(TMP));
        res
    }

    /// Whether this folder's file and the hub's hold the same bytes (BLAKE3 on both sides).
    fn same_bytes(&self, rel: &str) -> Result<bool> {
        let mut h = blake3::Hasher::new();
        let mut f = std::fs::File::open(local_path(&self.root, rel))?;
        std::io::copy(&mut f, &mut h)?;
        let local = h.finalize().to_hex().to_string();
        let hub = fs_ops::fs_hash(self.addr, &join_hub(&self.drive.hub, rel))?;
        Ok(hub.hash.eq_ignore_ascii_case(&local))
    }

    fn trash_local(&self, rel: &str, today: &str) -> Result<()> {
        let from = local_path(&self.root, rel);
        let to = local_path(&self.root.join(TRASH).join(today), rel);
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::rename(&from, &to).with_context(|| format!("move {rel} to the trash"))
    }

    fn trash_hub(&self, rel: &str, today: &str) -> Result<()> {
        let from = join_hub(&self.drive.hub, rel);
        let to = join_hub(&join_hub(&join_hub(&self.drive.hub, TRASH), today), rel);
        if let Some(parent) = to.rsplit_once('/').map(|(d, _)| d) {
            fs_ops::fs_mkdir(self.addr, parent)?;
        }
        fs_ops::fs_move(self.addr, &from, &to)
    }

    fn run(&self) -> Result<()> {
        let member_id = &self.member.member;
        // Markers: both sides must be there.
        if !self.root.join(MARKER).is_file() {
            set_status(member_id, |s| {
                s.state = "offline".into();
                s.detail = format!(
                    "{} is missing its {MARKER} file (unplugged or moved?)",
                    self.root.display()
                );
            });
            return Ok(());
        }
        if hub_stat(self.addr, &join_hub(&self.drive.hub, MARKER)).is_none() {
            set_status(member_id, |s| {
                s.state = "offline".into();
                s.detail = format!(
                    "the drive's folder on the console ({}) is missing its {MARKER} file",
                    self.drive.hub
                );
            });
            return Ok(());
        }
        set_status(member_id, |s| {
            s.state = "syncing".into();
            s.detail.clear();
        });
        let mut member = walk_local(&self.root)?;
        let hub = walk_hub(self.addr, &self.drive.hub)?;
        let mut base = load_base(&self.drive.id, member_id);
        let now = now_ms() as i64 / 1000;
        // Still being written: leave it for the next pass (and do not take its absence as a delete).
        let settling: Vec<String> = member
            .iter()
            .filter(|(_, m)| now - m.mtime < SETTLE_SECS)
            .map(|(p, _)| p.clone())
            .collect();
        let mut ops = plan(&member, &hub, &base);
        ops.retain(|o| safe_rel(o.path()) && !settling.iter().any(|p| p == o.path()));
        let mut held = 0;
        if too_many_deletes(&ops, base.len())
            && !confirmed()
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(member_id)
        {
            held = ops.iter().filter(|o| o.is_delete()).count();
            ops.retain(|o| !o.is_delete());
        }
        let (today, stamp) = date_parts(now);
        let (mut up, mut down, mut del, mut conf) = (0, 0, 0, 0);
        let mut first_error: Option<String> = None;
        let mut renewed = std::time::Instant::now();
        for op in &ops {
            if renewed.elapsed() >= LOCK_RENEW {
                renewed = std::time::Instant::now();
                let _ = crate::mesh_api::call(self.addr, || {
                    mesh::lock(
                        self.addr,
                        "take",
                        &self.lock_name,
                        LOCK_TTL_S,
                        false,
                        &self.lock_label,
                        "",
                    )
                });
            }
            let rel = op.path().to_string();
            let r: Result<()> = (|| {
                match op {
                    Op::Upload(_) => {
                        self.upload(&rel)?;
                        up += 1;
                        let m = local_stat(&local_path(&self.root, &rel));
                        let h = hub_stat(self.addr, &join_hub(&self.drive.hub, &rel));
                        if let (Some(m), Some(h)) = (m, h) {
                            base.insert(rel.clone(), BaseEntry { m, h });
                        }
                    }
                    Op::Download(_) => {
                        self.download(&rel)?;
                        down += 1;
                        if let (Some(m), Some(h)) =
                            (local_stat(&local_path(&self.root, &rel)), hub.get(&rel))
                        {
                            base.insert(rel.clone(), BaseEntry { m, h: *h });
                        }
                    }
                    Op::Conflict(_) => {
                        // Ours keeps a new name (it reaches everyone next pass); theirs comes here.
                        let renamed = conflict_name(&rel, &self.device_name, &stamp);
                        let from = local_path(&self.root, &rel);
                        std::fs::rename(&from, local_path(&self.root, &renamed))?;
                        member.remove(&rel);
                        self.download(&rel)?;
                        conf += 1;
                        if let (Some(m), Some(h)) = (local_stat(&from), hub.get(&rel)) {
                            base.insert(rel.clone(), BaseEntry { m, h: *h });
                        }
                    }
                    Op::DeleteMember(_) => {
                        self.trash_local(&rel, &today)?;
                        del += 1;
                        base.remove(&rel);
                    }
                    Op::DeleteHub(_) => {
                        self.trash_hub(&rel, &today)?;
                        del += 1;
                        base.remove(&rel);
                    }
                    Op::Compare(_) => {
                        if self.same_bytes(&rel)? {
                            if let (Some(m), Some(h)) = (member.get(&rel), hub.get(&rel)) {
                                base.insert(rel.clone(), BaseEntry { m: *m, h: *h });
                            }
                        } else {
                            let renamed = conflict_name(&rel, &self.device_name, &stamp);
                            let from = local_path(&self.root, &rel);
                            std::fs::rename(&from, local_path(&self.root, &renamed))?;
                            member.remove(&rel);
                            self.download(&rel)?;
                            conf += 1;
                            if let (Some(m), Some(h)) = (local_stat(&from), hub.get(&rel)) {
                                base.insert(rel.clone(), BaseEntry { m, h: *h });
                            }
                        }
                    }
                    Op::Forget(_) => {
                        base.remove(&rel);
                    }
                }
                Ok(())
            })();
            if let Err(e) = r {
                crate::log_warn!("mesh drive {}: {e:#}", self.drive.name);
                first_error.get_or_insert_with(|| format!("{e:#}"));
            }
            // Progress survives an interrupted pass.
            if up + down + del + conf > 0 && (up + down + del + conf) % 20 == 0 {
                let _ = save_base(&self.drive.id, member_id, &base);
            }
        }
        save_base(&self.drive.id, member_id, &base)?;
        let files = base.len();
        set_status(member_id, |s| {
            s.files = files;
            s.uploaded = up;
            s.downloaded = down;
            s.deleted = del;
            s.conflicts = conf;
            s.held_deletes = held;
            if let Some(e) = &first_error {
                s.state = "error".into();
                s.detail = e.clone();
            } else if held > 0 {
                s.state = "confirm".into();
                s.detail = format!("{held} files would be deleted everywhere");
            } else {
                s.state = "idle".into();
                s.detail.clear();
                s.last_ok = now_ms();
            }
        });
        self.empty_trash(now);
        Ok(())
    }

    /// Trash folders are named by day; the ones older than TRASH_DAYS go. Best effort.
    fn empty_trash(&self, now: i64) {
        let cutoff = date_parts(now - TRASH_DAYS * 86_400).0;
        if let Ok(rd) = std::fs::read_dir(self.root.join(TRASH)) {
            for e in rd.flatten() {
                let n = e.file_name().to_string_lossy().into_owned();
                if n.len() == 10 && n < cutoff {
                    let _ = std::fs::remove_dir_all(e.path());
                }
            }
        }
        let hub_trash = join_hub(&self.drive.hub, TRASH);
        if let Ok(l) = fs_ops::list_dir(self.addr, &hub_trash, ListDirOptions::default()) {
            for e in l.entries {
                if e.kind == "dir" && e.name.len() == 10 && e.name < cutoff {
                    let _ = fs_ops::fs_delete(self.addr, &join_hub(&hub_trash, &e.name));
                }
            }
        }
    }
}

fn sync_member(lm: &LocalMember, me: &str) -> Result<()> {
    let addr = lm.console.as_str();
    let Some((_, doc)) = doc_read(addr)? else {
        set_status(&lm.member, |s| {
            s.state = "offline".into();
            s.detail = "the console's helper is older than 8.0.0".into();
        });
        return Ok(());
    };
    let Some(drive) = doc.drives.iter().find(|d| d.id == lm.drive) else {
        set_status(&lm.member, |s| s.state = "removed".into());
        return Ok(());
    };
    let Some(member) = drive
        .members
        .iter()
        .find(|m| m.id == lm.member && m.device == me)
    else {
        set_status(&lm.member, |s| s.state = "removed".into());
        return Ok(());
    };
    if !member.approved {
        set_status(&lm.member, |s| s.state = "pending".into());
        return Ok(());
    }
    if member.paused {
        set_status(&lm.member, |s| s.state = "paused".into());
        return Ok(());
    }
    // One engine at a time per drive.
    let lock_name = format!("drive:{}", drive.id);
    let label = format!("Syncing Mesh Drive {}", drive.name);
    let took = crate::mesh_api::call(addr, || {
        mesh::lock(addr, "take", &lock_name, LOCK_TTL_S, false, &label, "")
    })?;
    if took
        .as_ref()
        .and_then(|v| v.get("got"))
        .and_then(Value::as_bool)
        != Some(true)
    {
        set_status(&lm.member, |s| {
            s.state = "waiting".into();
            s.detail = took
                .as_ref()
                .and_then(|v| v.get("by_name"))
                .and_then(Value::as_str)
                .map(|n| format!("{n} is syncing it"))
                .unwrap_or_default();
        });
        return Ok(());
    }
    let pass = Pass {
        addr,
        drive,
        member: lm,
        root: PathBuf::from(&lm.path),
        device_name: crate::mesh_api::device_name(),
        lock_name: lock_name.clone(),
        lock_label: label.clone(),
    };
    let r = pass.run();
    let _ = crate::mesh_api::call(addr, || {
        mesh::lock(addr, "release", &lock_name, 0, false, "", "")
    });
    if let Err(e) = &r {
        set_status(&lm.member, |s| {
            s.state = "error".into();
            s.detail = format!("{e:#}");
        });
    }
    r
}

static RUNNING: AtomicBool = AtomicBool::new(false);

/// One round over every folder of this device. Never two at once.
pub fn tick() {
    if RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    let me = crate::mesh_api::id_hex().unwrap_or_default();
    for lm in load_config().members {
        if let Err(e) = sync_member(&lm, &me) {
            crate::log_warn!("mesh drive {}: {e:#}", lm.drive);
        }
    }
    RUNNING.store(false, Ordering::SeqCst);
}

pub fn spawn() {
    crate::ava1_api::spawn_periodic(EVERY, tick);
}

fn kick() {
    std::thread::spawn(tick);
}

// ---- setting up ----

/// The folder this device keeps for a drive: made, and marked as the drive's.
fn prepare_local(path: &str) -> Result<()> {
    let p = Path::new(path);
    if !p.is_absolute() {
        bail!("choose a full folder path");
    }
    std::fs::create_dir_all(p).with_context(|| format!("make {path}"))?;
    let marker = p.join(MARKER);
    if !marker.exists() {
        std::fs::write(
            &marker,
            b"PS5Upload Mesh Drive. This folder is kept the same on your devices.\n",
        )
        .with_context(|| format!("write {}", marker.display()))?;
    }
    Ok(())
}

fn prepare_hub(addr: &str, hub: &str) -> Result<()> {
    if !hub.starts_with('/') || hub.split('/').any(|c| c == "..") {
        bail!("the console folder must be a full path");
    }
    fs_ops::fs_mkdir(addr, hub)?;
    ps5upload_core::diagnostics::fs_write_bytes(
        addr,
        &join_hub(hub, MARKER),
        b"PS5Upload Mesh Drive home folder.\n",
        false,
    )?;
    Ok(())
}

/// Where this device's copy goes unless the user picks another folder.
fn suggested_folder() -> Option<String> {
    const NAME: &str = "PS5Upload Mesh Drive";
    let p = match crate::mesh_api::kind() {
        "android" => PathBuf::from("/storage/emulated/0").join(NAME),
        "docker" => PathBuf::from("/data/mesh-drive"),
        "ios" => crate::remote::store::data_dir()?.join(NAME),
        _ => std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(PathBuf::from)?
            .join(NAME),
    };
    Some(p.to_string_lossy().into_owned())
}

// ---- checking a folder before it is used ----

/// What a folder choice would mean, for the app to show before anything is made.
#[derive(Clone, Debug, Default, Serialize, PartialEq)]
pub struct FolderCheck {
    pub path: String,
    /// It can be used as chosen.
    pub ok: bool,
    pub exists: bool,
    /// It does not exist yet and will be made.
    pub will_create: bool,
    /// Files already in it (they join the drive), counted up to COUNT_LIMIT.
    pub files: usize,
    pub more: bool,
    /// It already holds a Mesh Drive marker (a drive's folder before, or this drive's).
    pub marker: bool,
    /// Why it cannot be used: bad_name, not_absolute, no_parent, not_folder, exists (a new
    /// folder's name is taken), taken (another drive's folder), inside / holds (inside, or holding,
    /// another drive's folder), app_data, not_writable, unreadable.
    pub problem: Option<String>,
    /// The other drive's name, or the system's words.
    pub detail: Option<String>,
}

const COUNT_LIMIT: usize = 10_000;

/// A folder name the user typed: something every filesystem here takes.
fn valid_name(name: &str) -> bool {
    let n = name.trim();
    !n.is_empty()
        && n == name
        && n.len() <= 200
        && n != "."
        && n != ".."
        && !n.chars().any(|c| {
            c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
        })
}

fn inside(a: &str, b: &str) -> bool {
    let (a, b) = (a.trim_end_matches('/'), b.trim_end_matches('/'));
    a == b || a.starts_with(&format!("{b}/"))
}

fn fail_check(path: &str, problem: &str, detail: Option<String>) -> FolderCheck {
    FolderCheck {
        path: path.to_string(),
        problem: Some(problem.to_string()),
        detail,
        ..Default::default()
    }
}

/// Files under a console folder, counted up to COUNT_LIMIT (markers and trash not counted).
fn count_hub(addr: &str, root: &str) -> Result<(usize, bool)> {
    let mut n = 0usize;
    let mut stack = vec![root.trim_end_matches('/').to_string()];
    while let Some(dir) = stack.pop() {
        let mut offset = 0u64;
        loop {
            let l = fs_ops::list_dir(addr, &dir, ListDirOptions { offset, limit: 256 })?;
            let got = l.entries.len() as u64;
            for e in l.entries {
                if ignored(&e.name) || e.name == "." || e.name == ".." {
                    continue;
                }
                match e.kind.as_str() {
                    "dir" => stack.push(format!("{dir}/{}", e.name)),
                    "file" => n += 1,
                    _ => {}
                }
                if n >= COUNT_LIMIT {
                    return Ok((n, true));
                }
            }
            if got == 0 || (got < 256 && !l.truncated) {
                break;
            }
            offset += got;
        }
    }
    Ok((n, false))
}

fn count_local(root: &Path) -> (usize, bool) {
    let mut n = 0usize;
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&dir) else {
            continue;
        };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if ignored(&name) {
                continue;
            }
            match e.file_type() {
                Ok(t) if t.is_dir() => stack.push(e.path()),
                Ok(t) if t.is_file() => n += 1,
                _ => {}
            }
            if n >= COUNT_LIMIT {
                return (n, true);
            }
        }
    }
    (n, false)
}

/// The drive's home on the console. `new_name`: a folder to make under `path` (then `path` is its
/// parent); otherwise `path` itself is the folder. `drive`: the drive it is checked for (its own
/// folder is not "taken").
pub fn check_hub(
    addr: &str,
    doc: &DriveDoc,
    path: &str,
    new_name: Option<&str>,
    drive: Option<&str>,
) -> FolderCheck {
    let parent = path.trim().trim_end_matches('/');
    if !parent.starts_with('/') || parent.split('/').any(|c| c == "..") {
        return fail_check(path, "not_absolute", None);
    }
    let target = match new_name {
        Some(n) if !valid_name(n) => return fail_check(path, "bad_name", None),
        Some(n) => format!("{}/{n}", if parent.is_empty() { "" } else { parent }),
        None => parent.to_string(),
    };
    for d in doc.drives.iter().filter(|d| Some(d.id.as_str()) != drive) {
        let problem = if inside(&target, &d.hub) && inside(&d.hub, &target) {
            "taken"
        } else if inside(&target, &d.hub) {
            "inside"
        } else if inside(&d.hub, &target) {
            "holds"
        } else {
            continue;
        };
        return fail_check(&target, problem, Some(d.name.clone()));
    }
    if new_name.is_some() {
        match fs_ops::fs_stat(addr, parent) {
            Ok(st) if st.kind == "dir" => {}
            Ok(_) => return fail_check(&target, "not_folder", None),
            Err(e) if fs_ops::is_not_found(&format!("{e:#}")) => {
                return fail_check(&target, "no_parent", None)
            }
            Err(e) => return fail_check(&target, "unreadable", Some(format!("{e:#}"))),
        }
    }
    match fs_ops::fs_stat(addr, &target) {
        Ok(st) if st.kind == "dir" => {
            if new_name.is_some() {
                // Taken: the app offers to use the folder that is there instead.
                let mut c = fail_check(&target, "exists", None);
                c.exists = true;
                return c;
            }
            let (files, more) = match count_hub(addr, &target) {
                Ok(c) => c,
                Err(e) => return fail_check(&target, "unreadable", Some(format!("{e:#}"))),
            };
            FolderCheck {
                path: target.clone(),
                ok: true,
                exists: true,
                files,
                more,
                marker: fs_ops::fs_stat(addr, &join_hub(&target, MARKER)).is_ok(),
                ..Default::default()
            }
        }
        Ok(_) => fail_check(&target, "not_folder", None),
        Err(e) if fs_ops::is_not_found(&format!("{e:#}")) => {
            if new_name.is_none() {
                return fail_check(&target, "no_parent", None);
            }
            FolderCheck {
                path: target,
                ok: true,
                will_create: true,
                ..Default::default()
            }
        }
        Err(e) => fail_check(&target, "unreadable", Some(format!("{e:#}"))),
    }
}

/// This device's folder for a drive. `drive`: the drive it is for (its own entry here is not an
/// overlap).
pub fn check_local(path: &str, drive: Option<&str>) -> FolderCheck {
    let p = Path::new(path.trim());
    let shown = p.to_string_lossy().into_owned();
    if !p.is_absolute() {
        return fail_check(&shown, "not_absolute", None);
    }
    if let Some(data) = crate::remote::store::data_dir() {
        let (a, b) = (p.to_string_lossy(), data.to_string_lossy());
        if inside(&a, &b) || inside(&b, &a) {
            return fail_check(&shown, "app_data", None);
        }
    }
    for m in load_config()
        .members
        .iter()
        .filter(|m| Some(m.drive.as_str()) != drive)
    {
        let (a, b) = (shown.as_str(), m.path.as_str());
        let problem = if inside(a, b) && inside(b, a) {
            "taken"
        } else if inside(a, b) {
            "inside"
        } else if inside(b, a) {
            "holds"
        } else {
            continue;
        };
        let other = if m.name.is_empty() {
            m.drive.clone()
        } else {
            m.name.clone()
        };
        return fail_check(&shown, problem, Some(other));
    }
    match std::fs::metadata(p) {
        Ok(md) if md.is_dir() => {
            // Writable: a probe file in, then out.
            let probe = p.join(".ps5upload-check");
            if let Err(e) = std::fs::write(&probe, b"") {
                return fail_check(&shown, "not_writable", Some(e.to_string()));
            }
            let _ = std::fs::remove_file(&probe);
            let (files, more) = count_local(p);
            FolderCheck {
                path: shown,
                ok: true,
                exists: true,
                files,
                more,
                marker: p.join(MARKER).is_file(),
                ..Default::default()
            }
        }
        Ok(_) => fail_check(&shown, "not_folder", None),
        Err(_) => match p.parent() {
            Some(parent) if parent.is_dir() => FolderCheck {
                path: shown,
                ok: true,
                will_create: true,
                ..Default::default()
            },
            _ => fail_check(&shown, "no_parent", None),
        },
    }
}

fn refuse_unless_ok(c: &FolderCheck, what: &str) -> Result<()> {
    if c.ok {
        return Ok(());
    }
    let why = match c.problem.as_deref() {
        Some("bad_name") => "that name cannot be a folder name".to_string(),
        Some("not_absolute") => "choose a full folder path".to_string(),
        Some("no_parent") => "the folder it would go in does not exist".to_string(),
        Some("not_folder") => "that is a file, not a folder".to_string(),
        Some("exists") => "a folder with that name is already there".to_string(),
        Some("taken") => format!(
            "it is already the folder of {}",
            c.detail.clone().unwrap_or_default()
        ),
        Some("inside") => format!(
            "it is inside the folder of {}",
            c.detail.clone().unwrap_or_default()
        ),
        Some("holds") => format!(
            "it holds the folder of {}",
            c.detail.clone().unwrap_or_default()
        ),
        Some("app_data") => "it is the app's own data folder".to_string(),
        Some("not_writable") => format!(
            "it cannot be written ({})",
            c.detail.clone().unwrap_or_default()
        ),
        _ => c
            .detail
            .clone()
            .unwrap_or_else(|| "it cannot be read".into()),
    };
    bail!("{what} {}: {why}", c.path)
}

fn me_or_err() -> Result<String> {
    crate::mesh_api::id_hex().ok_or_else(|| anyhow!("this engine has no identity"))
}

fn add_local(addr: &str, drive: &str, member: &str, path: &str, name: &str) -> Result<()> {
    edit_config(|c| {
        // The same folder joined again: its old entry (and what it agreed on) goes.
        for old in c
            .members
            .iter()
            .filter(|m| m.drive == drive && m.path == path && m.member != member)
        {
            if let Some(p) = base_path(drive, &old.member) {
                let _ = std::fs::remove_file(p);
            }
        }
        c.members
            .retain(|m| !(m.drive == drive && (m.member == member || m.path == path)));
        c.members.push(LocalMember {
            console: addr.to_string(),
            drive: drive.to_string(),
            member: member.to_string(),
            path: path.to_string(),
            name: name.to_string(),
        });
    })
}

fn remove_local(drive: &str, member: Option<&str>) -> Result<()> {
    edit_config(|c| {
        c.members
            .retain(|m| !(m.drive == drive && member.is_none_or(|id| m.member == id)));
    })?;
    if let Some(p) = member.and_then(|m| base_path(drive, m)) {
        let _ = std::fs::remove_file(p);
    }
    Ok(())
}

// ---- routes ----

fn unsupported() -> Value {
    json!({ "supported": false })
}

async fn answer(f: impl FnOnce() -> Result<Value> + Send + 'static) -> Response {
    match tokio::task::spawn_blocking(f)
        .await
        .map_err(anyhow::Error::from)
        .and_then(|r| r)
    {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err(e) => json_err(StatusCode::BAD_GATEWAY, format!("{e:#}")).into_response(),
    }
}

fn addr_of(addr: Option<String>) -> Result<String> {
    crate::required_console_addr(addr).ok_or_else(|| anyhow!("addr is required: say which console"))
}

#[derive(Deserialize)]
pub struct ListQuery {
    addr: Option<String>,
}

pub async fn list(Query(q): Query<ListQuery>) -> Response {
    answer(move || {
        let addr = addr_of(q.addr)?;
        let Some((_, doc)) = doc_read(&addr)? else {
            return Ok(unsupported());
        };
        let mine: Vec<Value> = load_config()
            .members
            .into_iter()
            .filter(|m| m.console == addr)
            .map(|m| {
                let st = statuses()
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .get(&m.member)
                    .cloned()
                    .unwrap_or_default();
                json!({ "drive": m.drive, "member": m.member, "path": m.path, "status": st })
            })
            .collect();
        Ok(json!({
            "supported": true,
            "me": crate::mesh_api::id_hex(),
            "kind": crate::mesh_api::kind(),
            "suggest": suggested_folder(),
            "drives": doc.drives,
            "local": mine,
        }))
    })
    .await
}

#[derive(Deserialize)]
pub struct CreateReq {
    addr: Option<String>,
    name: String,
    /// The home folder on the console, or (with `hub_name`) the folder to make it in.
    hub: String,
    /// Make a new folder of this name inside `hub`.
    hub_name: Option<String>,
    /// This device's folder: required, the user chooses it.
    path: String,
}

pub async fn create(Json(req): Json<CreateReq>) -> Response {
    answer(move || {
        let addr = addr_of(req.addr)?;
        let me = me_or_err()?;
        let name: String = req.name.trim().chars().take(60).collect();
        if name.is_empty() {
            bail!("give the drive a name");
        }
        // Checked before anything is made: a refusal leaves no folder behind.
        let Some((_, current)) = doc_read(&addr)? else {
            return Ok(unsupported());
        };
        let hub_check = check_hub(&addr, &current, &req.hub, req.hub_name.as_deref(), None);
        refuse_unless_ok(&hub_check, "The console folder")?;
        let local_check = check_local(&req.path, None);
        refuse_unless_ok(&local_check, "This device's folder")?;
        let hub = hub_check.path.clone();
        let local = Some(local_check.path.clone());
        prepare_hub(&addr, &hub)?;
        if let Some(p) = &local {
            prepare_local(p)?;
        }
        let id = new_id();
        let member_id = new_id();
        let r = doc_update(&addr, |doc| {
            // One drive's folder inside another's would sync the inner drive's files twice.
            let inside = |a: &str, b: &str| {
                a == b || a.starts_with(&format!("{}/", b.trim_end_matches('/')))
            };
            if let Some(d) = doc
                .drives
                .iter()
                .find(|d| inside(&hub, &d.hub) || inside(&d.hub, &hub))
            {
                bail!(
                    "{hub} is inside, or holds, the folder of the Mesh Drive {}",
                    d.name
                );
            }
            doc.drives.push(Drive {
                id: id.clone(),
                name: name.clone(),
                hub: hub.clone(),
                created: now_ms(),
                by: me.clone(),
                other: Default::default(),
                members: local
                    .iter()
                    .map(|p| Member {
                        id: member_id.clone(),
                        device: me.clone(),
                        device_name: crate::mesh_api::device_name(),
                        path: p.clone(),
                        approved: true,
                        paused: false,
                        joined: now_ms(),
                        other: Default::default(),
                    })
                    .collect(),
            });
            Ok(())
        })?;
        if r.is_none() {
            return Ok(unsupported());
        }
        if let Some(p) = &local {
            add_local(&addr, &id, &member_id, p, &name)?;
            kick();
        }
        Ok(json!({ "supported": true, "ok": true, "drive": id }))
    })
    .await
}

#[derive(Deserialize)]
pub struct CheckReq {
    addr: Option<String>,
    /// The console folder (or the folder a new one goes in, with `hub_name`).
    hub: Option<String>,
    hub_name: Option<String>,
    /// This device's folder.
    path: Option<String>,
    /// Checked for this drive (joining it): its own folders are not "taken".
    drive: Option<String>,
}

pub async fn check(Json(req): Json<CheckReq>) -> Response {
    answer(move || {
        let hub = match &req.hub {
            Some(h) => {
                let addr = addr_of(req.addr.clone())?;
                let Some((_, doc)) = doc_read(&addr)? else {
                    return Ok(unsupported());
                };
                Some(check_hub(
                    &addr,
                    &doc,
                    h,
                    req.hub_name.as_deref(),
                    req.drive.as_deref(),
                ))
            }
            None => None,
        };
        let local = req
            .path
            .as_deref()
            .map(|p| check_local(p, req.drive.as_deref()));
        Ok(json!({ "supported": true, "hub": hub, "local": local }))
    })
    .await
}

#[derive(Deserialize)]
pub struct JoinReq {
    addr: Option<String>,
    drive: String,
    path: String,
}

pub async fn join(Json(req): Json<JoinReq>) -> Response {
    answer(move || {
        let addr = addr_of(req.addr)?;
        let me = me_or_err()?;
        let check = check_local(&req.path, Some(&req.drive));
        refuse_unless_ok(&check, "This device's folder")?;
        let path = check.path.clone();
        prepare_local(&path)?;
        let member_id = new_id();
        let approved = doc_update(&addr, |doc| {
            let d = doc
                .drives
                .iter_mut()
                .find(|d| d.id == req.drive)
                .ok_or_else(|| anyhow!("that drive is gone"))?;
            // This device joining again with the same folder replaces its old entry, and keeps its
            // place: a device already let in stays in.
            let was_in = d
                .members
                .iter()
                .any(|m| m.device == me && m.path == path && m.approved);
            d.members.retain(|m| !(m.device == me && m.path == path));
            // A drive nobody syncs yet (made from the console side only) lets the first device in.
            let approved = was_in || !d.members.iter().any(|m| m.approved);
            d.members.push(Member {
                id: member_id.clone(),
                device: me.clone(),
                device_name: crate::mesh_api::device_name(),
                path: path.clone(),
                approved,
                paused: false,
                joined: now_ms(),
                other: Default::default(),
            });
            Ok((approved, d.name.clone()))
        })?;
        let Some((approved, drive_name)) = approved else {
            return Ok(unsupported());
        };
        add_local(&addr, &req.drive, &member_id, &path, &drive_name)?;
        kick();
        Ok(json!({ "supported": true, "ok": true, "member": member_id, "approved": approved }))
    })
    .await
}

#[derive(Deserialize)]
pub struct MemberReq {
    addr: Option<String>,
    drive: String,
    member: Option<String>,
    approve: Option<bool>,
    paused: Option<bool>,
}

pub async fn approve(Json(req): Json<MemberReq>) -> Response {
    answer(move || {
        let addr = addr_of(req.addr)?;
        let me = me_or_err()?;
        let member = req.member.clone().ok_or_else(|| anyhow!("which member?"))?;
        let approve = req.approve.unwrap_or(true);
        let r = doc_update(&addr, |doc| {
            let d = doc
                .drives
                .iter_mut()
                .find(|d| d.id == req.drive)
                .ok_or_else(|| anyhow!("that drive is gone"))?;
            // Only a device already in can let another in.
            if !d.members.iter().any(|m| m.device == me && m.approved) && d.by != me {
                bail!("only a device that is in this drive can let others in");
            }
            if approve {
                if let Some(m) = d.members.iter_mut().find(|m| m.id == member) {
                    m.approved = true;
                }
            } else {
                d.members.retain(|m| m.id != member);
            }
            Ok(())
        })?;
        if r.is_none() {
            return Ok(unsupported());
        }
        Ok(json!({ "supported": true, "ok": true }))
    })
    .await
}

pub async fn leave(Json(req): Json<MemberReq>) -> Response {
    answer(move || {
        let addr = addr_of(req.addr)?;
        let member = req.member.clone().ok_or_else(|| anyhow!("which member?"))?;
        let r = doc_update(&addr, |doc| {
            if let Some(d) = doc.drives.iter_mut().find(|d| d.id == req.drive) {
                d.members.retain(|m| m.id != member);
            }
            Ok(())
        })?;
        remove_local(&req.drive, Some(&member))?;
        if r.is_none() {
            return Ok(unsupported());
        }
        Ok(json!({ "supported": true, "ok": true }))
    })
    .await
}

pub async fn delete(Json(req): Json<MemberReq>) -> Response {
    answer(move || {
        let addr = addr_of(req.addr)?;
        let r = doc_update(&addr, |doc| {
            doc.drives.retain(|d| d.id != req.drive);
            Ok(())
        })?;
        remove_local(&req.drive, None)?;
        if r.is_none() {
            return Ok(unsupported());
        }
        Ok(json!({ "supported": true, "ok": true }))
    })
    .await
}

pub async fn pause(Json(req): Json<MemberReq>) -> Response {
    answer(move || {
        let addr = addr_of(req.addr)?;
        let member = req.member.clone().ok_or_else(|| anyhow!("which member?"))?;
        let paused = req.paused.unwrap_or(true);
        let r = doc_update(&addr, |doc| {
            if let Some(m) = doc
                .drives
                .iter_mut()
                .find(|d| d.id == req.drive)
                .and_then(|d| d.members.iter_mut().find(|m| m.id == member))
            {
                m.paused = paused;
            }
            Ok(())
        })?;
        if r.is_none() {
            return Ok(unsupported());
        }
        kick();
        Ok(json!({ "supported": true, "ok": true }))
    })
    .await
}

pub async fn sync_now(Json(_req): Json<MemberReq>) -> Response {
    kick();
    Json(json!({ "supported": true, "ok": true })).into_response()
}

pub async fn confirm(Json(req): Json<MemberReq>) -> Response {
    if let Some(m) = req.member {
        confirmed()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(m);
    }
    kick();
    Json(json!({ "supported": true, "ok": true })).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_names_and_nesting() {
        for ok in ["Shared", "PS5 saves", "a.b", "Ünïcode 日本"] {
            assert!(valid_name(ok), "{ok}");
        }
        for bad in [
            "",
            " lead",
            "trail ",
            ".",
            "..",
            "a/b",
            "a\\b",
            "c:d",
            "x?y",
            "tab\there",
        ] {
            assert!(!valid_name(bad), "{bad:?}");
        }
        assert!(inside("/data/A/B", "/data/A"));
        assert!(inside("/data/A", "/data/A/"));
        assert!(!inside("/data/AB", "/data/A"));
    }

    #[test]
    fn a_local_folder_is_checked_before_use() {
        let root = std::env::temp_dir().join(format!("mesh-check-{}", new_id()));
        std::fs::create_dir_all(root.join("has")).unwrap();
        std::fs::write(root.join("has").join("one.txt"), b"1").unwrap();
        std::fs::write(root.join("file.txt"), b"x").unwrap();
        let s = |p: &Path| p.to_string_lossy().into_owned();

        let c = check_local(&s(&root.join("has")), None);
        assert!(c.ok && c.exists && !c.will_create && c.files == 1, "{c:?}");
        let c = check_local(&s(&root.join("new")), None);
        assert!(c.ok && c.will_create, "{c:?}");
        let c = check_local(&s(&root.join("missing").join("deeper")), None);
        assert_eq!(c.problem.as_deref(), Some("no_parent"));
        let c = check_local(&s(&root.join("file.txt")), None);
        assert_eq!(c.problem.as_deref(), Some("not_folder"));
        assert_eq!(
            check_local("relative/path", None).problem.as_deref(),
            Some("not_absolute")
        );
        assert!(refuse_unless_ok(&check_local("relative", None), "x").is_err());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn paths_from_a_listing_never_leave_the_folder() {
        assert!(safe_rel("a/b.txt"));
        for bad in ["", "/etc/passwd", "a/../../x", "./a", "a//b", "a\\..\\b"] {
            assert!(!safe_rel(bad), "{bad}");
        }
    }

    #[test]
    fn a_local_walk_skips_markers_trash_and_clutter() {
        let dir = std::env::temp_dir().join(format!("mesh-walk-{}", new_id()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::create_dir_all(dir.join(TRASH).join("2026-01-01")).unwrap();
        std::fs::write(dir.join(MARKER), b"x").unwrap();
        std::fs::write(dir.join("a.txt"), b"hello").unwrap();
        std::fs::write(dir.join("sub").join("b.bin"), b"12").unwrap();
        std::fs::write(dir.join(".DS_Store"), b"x").unwrap();
        std::fs::write(dir.join(TRASH).join("2026-01-01").join("old"), b"x").unwrap();
        let l = walk_local(&dir).unwrap();
        assert_eq!(
            l.keys().cloned().collect::<Vec<_>>(),
            vec!["a.txt", "sub/b.bin"]
        );
        assert_eq!(l["a.txt"].size, 5);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_drive_document_reads_with_missing_fields() {
        let d: DriveDoc = serde_json::from_value(json!({
            "drives": [{ "id": "d1", "name": "Shared", "hub": "/data/Mesh",
                         "members": [{ "id": "m1", "device": "aa", "path": "/x" }] }]
        }))
        .unwrap();
        assert!(!d.drives[0].members[0].approved);
        assert_eq!(
            serde_json::from_value::<DriveDoc>(json!({})).unwrap(),
            DriveDoc::default()
        );
    }
}
