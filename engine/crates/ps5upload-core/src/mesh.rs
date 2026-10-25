//! The devices that use a console and what they share through it (8.0.0, `payload/src/mesh.c`):
//! the device list, presence, locks, events, settings and shared documents.
//!
//! Every call answers `Ok(None)` when the helper predates the mesh (`ERR_UNKNOWN_METHOD`): the app
//! then works as before 8.0.0. A refusal from the helper (`{"ok":false,"err":..}`) is an `Err`.

use anyhow::Result;
use serde_json::{json, Value};

use crate::console_files::is_unsupported;
use crate::mgmt::{self, m, Method};

fn call_json(addr: &str, method: Method, body: &Value) -> Result<Option<Value>> {
    match mgmt::call(addr, method, &serde_json::to_vec(body)?) {
        Ok(b) => Ok(Some(serde_json::from_slice(&b)?)),
        Err(e) if is_unsupported(&e) => Ok(None),
        Err(e) => Err(e),
    }
}

/// Who this engine is, told to the console once per connection.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Hello {
    pub name: String,
    /// `desktop`, `android`, `ios` or `docker`.
    pub kind: String,
    pub os: String,
    pub app: String,
}

pub fn hello(addr: &str, me: &Hello) -> Result<Option<Value>> {
    call_json(
        addr,
        m::MESH_HELLO,
        &json!({ "name": me.name, "kind": me.kind, "os": me.os, "app": me.app }),
    )
}

/// The whole picture, or `{"same":true}` when nothing changed since revision `since`. Events after
/// sequence number `ev` only.
pub fn state(addr: &str, since: u64, ev: u64) -> Result<Option<Value>> {
    call_json(addr, m::MESH_STATE, &json!({ "since": since, "ev": ev }))
}

/// What this engine is doing on the console now (a JSON array; empty when idle).
pub fn activity(addr: &str, items: &Value) -> Result<Option<Value>> {
    call_json(addr, m::MESH_ACTIVITY, &json!({ "items": items }))
}

/// `op` is `take` or `release`. A lock someone else holds answers `got: false` with who.
/// `owner` tells two windows of this device apart (each holds its own locks); "" for the engine.
pub fn lock(
    addr: &str,
    op: &str,
    name: &str,
    ttl_s: u64,
    force: bool,
    label: &str,
    owner: &str,
) -> Result<Option<Value>> {
    call_json(
        addr,
        m::MESH_LOCK,
        &json!({ "op": op, "name": name, "ttl": ttl_s, "force": force, "label": label, "owner": owner }),
    )
}

/// `op` is `rename` (with `name`), `remove`, `block` or `unblock`; `id` the device's key (hex).
pub fn device(addr: &str, op: &str, id: &str, name: Option<&str>) -> Result<Option<Value>> {
    let mut body = json!({ "op": op, "id": id });
    if let Some(n) = name {
        body["name"] = n.into();
    }
    call_json(addr, m::MESH_DEVICE, &body)
}

pub fn settings(
    addr: &str,
    require_approval: Option<bool>,
    prune_days: Option<u64>,
) -> Result<Option<Value>> {
    let mut body = json!({});
    if let Some(v) = require_approval {
        body["require_approval"] = v.into();
    }
    if let Some(v) = prune_days {
        body["prune_days"] = v.into();
    }
    call_json(addr, m::MESH_SETTINGS, &body)
}

/// `{rev, doc}`; `doc` is null for a document never written.
pub fn doc_get(addr: &str, name: &str) -> Result<Option<Value>> {
    call_json(addr, m::MESH_DOC_GET, &json!({ "name": name }))
}

/// Writes `doc` if the console still has revision `base`: `{saved:true, rev}`; otherwise
/// `{saved:false, rev, doc}` with what is there now, to merge into and try again.
pub fn doc_put(addr: &str, name: &str, base: u64, doc: &Value) -> Result<Option<Value>> {
    call_json(
        addr,
        m::MESH_DOC_PUT,
        &json!({ "name": name, "base": base, "doc": doc }),
    )
}

/// An event every device sees (`kind` e.g. `restart`), with this device's name in front of `text`.
pub fn announce(addr: &str, kind: &str, text: &str) -> Result<Option<Value>> {
    call_json(
        addr,
        m::MESH_ANNOUNCE,
        &json!({ "kind": kind, "text": text }),
    )
}

/// The helper refused because it has not met this engine on this connection yet.
pub fn needs_hello(e: &anyhow::Error) -> bool {
    e.to_string().contains("say_hello_first")
}
