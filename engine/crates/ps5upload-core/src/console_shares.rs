//! The console's saved network shares (#498): the same list the console page (PS5Upload Minion)
//! uses in Files and in its game Library, kept on the console (`payload/src/smb_shares.c`,
//! `/data/ps5upload/smb/shares.jsonl`, passwords encrypted with a per-console key). The PC adds,
//! edits and removes them here; the helper signs in to a share before it saves it, through its
//! SMB daemon, exactly as the page's own "Add a share" does.
//!
//! Every call returns the helper's JSON. A share never carries its password back
//! (`has_password`). A refusal is an error whose token is the helper's (`smb_auth`,
//! `smb_unreachable`, `smb_no_share`, `not_found`, `shares_full`, `bad_host`, `bad_share`,
//! `bad_path`, `unknown_share`, `busy`, `smb_daemon_unavailable`, `smb_loader_unavailable`, ...);
//! an older helper answers `ERR_UNKNOWN_METHOD` ([`crate::console_files::is_unsupported`]).

use std::time::Duration;

use anyhow::{Context, Result};
use serde_json::Value;

use crate::mgmt::{self, m};

/// A save signs in to the server first: the helper waits up to 12 s for its SMB daemon (which
/// may have to be started), so allow for that and a slow link.
const SAVE_TIMEOUT: Duration = Duration::from_secs(45);

fn call_json(
    addr: &str,
    method: mgmt::Method,
    body: &Value,
    timeout: Option<Duration>,
) -> Result<Value> {
    let bytes = mgmt::call_with(
        addr,
        method,
        method.label,
        &serde_json::to_vec(body)?,
        timeout,
    )?;
    serde_json::from_slice(&bytes).with_context(|| format!("{} reply", method.label))
}

/// `{"ok":true,"shares":[{id,name,host,port,share,user,domain,start_path,has_password,path}],"max"}`.
pub fn list(addr: &str) -> Result<Value> {
    call_json(addr, m::SMB_SHARES_LIST, &serde_json::json!({}), None)
}

/// The fields the helper reads for a save: `id` (absent: a new share), `name`, `server` (an
/// address as typed: "nas", "192.168.1.10:445", "smb://nas/Share/folder"), `share`, `user`,
/// `password` (absent with an `id`: the saved one is kept), `domain`, `start_path`.
pub fn save_body(req: &Value) -> Value {
    let mut out = serde_json::Map::new();
    for key in [
        "id",
        "name",
        "server",
        "share",
        "user",
        "password",
        "domain",
        "start_path",
    ] {
        if let Some(v) = req.get(key).filter(|v| v.is_string()) {
            out.insert(key.to_string(), v.clone());
        }
    }
    Value::Object(out)
}

/// `{"ok":true,"share":{..},"dialect"}` once the console signed in and saved it.
pub fn save(addr: &str, req: &Value) -> Result<Value> {
    call_json(
        addr,
        m::SMB_SHARES_SAVE,
        &save_body(req),
        Some(SAVE_TIMEOUT),
    )
}

/// `{"ok":true}`.
pub fn remove(addr: &str, id: &str) -> Result<Value> {
    call_json(
        addr,
        m::SMB_SHARES_REMOVE,
        &serde_json::json!({ "id": id }),
        None,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn methods_are_the_schema_numbers() {
        assert_eq!(m::SMB_SHARES_LIST.id, 170);
        assert_eq!(m::SMB_SHARES_SAVE.id, 171);
        assert_eq!(m::SMB_SHARES_REMOVE.id, 172);
    }

    #[test]
    fn a_save_sends_only_the_share_fields() {
        let body = save_body(&serde_json::json!({
            "addr": "192.168.1.5",
            "id": "3fa2c1d0",
            "name": "NAS",
            "server": "nas",
            "share": "Games",
            "user": "amy",
            "domain": "",
            "start_path": "PS5",
            "port": 445,
        }));
        assert_eq!(
            body,
            serde_json::json!({
                "id": "3fa2c1d0", "name": "NAS", "server": "nas", "share": "Games",
                "user": "amy", "domain": "", "start_path": "PS5",
            })
        );
        // no password: the helper keeps the saved one
        assert!(body.get("password").is_none());
        let with = save_body(&serde_json::json!({ "server": "nas", "password": "pw" }));
        assert_eq!(with["password"], "pw");
    }
}
