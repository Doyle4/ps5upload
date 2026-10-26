//! Settings backups (8.0.1): copies of an app's settings bundle (the same JSON as Settings › Export
//! bundle), kept by the engine in `<data dir>/settings-backups`. The app saves one a day and one
//! before a sync or a restore changes several settings at once; the newest KEEP stay. In Docker
//! the data dir is the container's volume, so the web UI's backups outlive the browser.
//!
//! * `GET  /api/settings-backup`          -> `{backups:[{id,at,reason,device,keys,bytes}]}` newest first
//! * `GET  /api/settings-backup/get?id=`  -> the bundle
//! * `POST /api/settings-backup` `{reason,device,bundle}` -> `{id}`
use std::path::PathBuf;

use anyhow::{anyhow, bail, Context, Result};
use axum::extract::Query;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::json_err;

const KEEP: usize = 14;
/// A bundle larger than this is refused (it would be something other than settings).
const MAX_BYTES: usize = 8 * 1024 * 1024;

fn dir() -> Option<PathBuf> {
    Some(crate::remote::store::data_dir()?.join("settings-backups"))
}

#[derive(Serialize)]
struct Entry {
    id: String,
    at: u64,
    reason: String,
    device: String,
    keys: usize,
    bytes: u64,
}

/// `<ms>-<reason>.json`; the reason is a short [a-z-] word.
fn valid_id(id: &str) -> bool {
    let Some(stem) = id.strip_suffix(".json") else {
        return false;
    };
    let mut parts = stem.splitn(2, '-');
    let at = parts.next().unwrap_or("");
    let reason = parts.next().unwrap_or("");
    !at.is_empty()
        && at.bytes().all(|b| b.is_ascii_digit())
        && reason.len() <= 24
        && reason.bytes().all(|b| b.is_ascii_lowercase() || b == b'-')
}

fn entries() -> Vec<(PathBuf, String)> {
    let Some(d) = dir() else { return Vec::new() };
    let mut v: Vec<(PathBuf, String)> = std::fs::read_dir(&d)
        .map(|rd| {
            rd.flatten()
                .filter_map(|e| {
                    let n = e.file_name().to_string_lossy().into_owned();
                    valid_id(&n).then(|| (e.path(), n))
                })
                .collect()
        })
        .unwrap_or_default();
    // Newest first: the ids start with the time.
    v.sort_by_key(|(_, n)| {
        std::cmp::Reverse(
            n.split('-')
                .next()
                .and_then(|t| t.parse::<u64>().ok())
                .unwrap_or(0),
        )
    });
    v
}

fn list_now() -> Result<Value> {
    let out: Vec<Entry> = entries()
        .into_iter()
        .filter_map(|(p, id)| {
            let bytes = std::fs::metadata(&p).ok()?.len();
            let v: Value = serde_json::from_slice(&std::fs::read(&p).ok()?).ok()?;
            let meta = v.get("meta");
            let s = |k: &str| {
                meta.and_then(|m| m.get(k))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string()
            };
            Some(Entry {
                at: meta
                    .and_then(|m| m.get("generated_at_ms"))
                    .and_then(Value::as_u64)
                    .unwrap_or(0),
                reason: s("reason"),
                device: s("device"),
                keys: v
                    .get("local_storage")
                    .and_then(Value::as_object)
                    .map_or(0, |m| m.len()),
                bytes,
                id,
            })
        })
        .collect();
    Ok(json!({ "backups": out }))
}

#[derive(Deserialize)]
pub struct SaveReq {
    reason: String,
    bundle: Value,
}

fn save_now(req: SaveReq) -> Result<Value> {
    if !req
        .bundle
        .get("local_storage")
        .is_some_and(Value::is_object)
    {
        bail!("that is not a settings bundle");
    }
    let reason: String = req
        .reason
        .chars()
        .filter(|c| c.is_ascii_lowercase() || *c == '-')
        .take(24)
        .collect();
    let body = serde_json::to_vec(&req.bundle)?;
    if body.len() > MAX_BYTES {
        bail!("the bundle is too large to be settings");
    }
    let d = dir().ok_or_else(|| anyhow!("no data directory"))?;
    std::fs::create_dir_all(&d).with_context(|| format!("make {}", d.display()))?;
    let at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |t| t.as_millis() as u64);
    // Two in the same millisecond: the later one takes the next free id, never overwrites.
    let reason = if reason.is_empty() {
        "manual".to_string()
    } else {
        reason
    };
    let mut at = at;
    let mut id = format!("{at}-{reason}.json");
    while d.join(&id).exists() {
        at += 1;
        id = format!("{at}-{reason}.json");
    }
    let tmp = d.join(format!("{id}.tmp"));
    std::fs::write(&tmp, &body)?;
    std::fs::rename(&tmp, d.join(&id))?;
    for (p, _) in entries().into_iter().skip(KEEP) {
        let _ = std::fs::remove_file(p);
    }
    Ok(json!({ "id": id }))
}

async fn answer(f: impl FnOnce() -> Result<Value> + Send + 'static) -> Response {
    match tokio::task::spawn_blocking(f)
        .await
        .map_err(anyhow::Error::from)
        .and_then(|r| r)
    {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err(e) => json_err(StatusCode::BAD_REQUEST, format!("{e:#}")).into_response(),
    }
}

pub async fn list() -> Response {
    answer(list_now).await
}

pub async fn save(Json(req): Json<SaveReq>) -> Response {
    answer(move || save_now(req)).await
}

#[derive(Deserialize)]
pub struct GetQuery {
    id: String,
}

pub async fn get(Query(q): Query<GetQuery>) -> Response {
    answer(move || {
        if !valid_id(&q.id) {
            bail!("no such backup");
        }
        let d = dir().ok_or_else(|| anyhow!("no data directory"))?;
        let bytes = std::fs::read(d.join(&q.id)).map_err(|_| anyhow!("no such backup"))?;
        Ok(serde_json::from_slice(&bytes)?)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_cannot_leave_the_folder() {
        assert!(valid_id("1729800000000-daily.json"));
        assert!(valid_id("1729800000000-before-sync.json"));
        for bad in [
            "../x.json",
            "1729-../../etc.json",
            "1729-daily",
            "-daily.json",
            "abc-daily.json",
            "1729-Daily.json",
            "1729-a/b.json",
        ] {
            assert!(!valid_id(bad), "{bad}");
        }
    }
}
