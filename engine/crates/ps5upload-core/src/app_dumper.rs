//! EchoStretch's ps5-app-dumper (GPLv3, <https://github.com/EchoStretch/ps5-app-dumper>) as the
//! app drives it: a payload that dumps the running game from the console's pfsmnt to a drive,
//! decrypting it on the way, with a web API of its own. The app does not carry its code; it
//! finds the running dumper, trades the code the TV shows for the dumper's token once, and
//! forwards a fixed set of the dumper's calls with that token.
//!
//! The API (webhb 0.4, dumper 2.10): reading is open to the network; every POST but
//! `/api/whb/unlock` and `/api/whb/access/show` needs `token=` unless it comes from the console
//! itself. All parameters go in the query string.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use crate::payload_manager::{encode_query, http_request};

/// The first port the dumper tries (8080 is the homebrew launcher's), and how far it walks up
/// when one is taken (webhb's `web_port` + nine).
pub const FIRST_PORT: u16 = 8081;
pub const LAST_PORT: u16 = 8090;

const PROBE_CONNECT: Duration = Duration::from_millis(600);
const PROBE_IO: Duration = Duration::from_secs(3);
const CALL_CONNECT: Duration = Duration::from_secs(3);
const CALL_IO: Duration = Duration::from_secs(30);

/// The dumper's calls that change something, which the app may forward. Reading calls are
/// forwarded through [`get`]; nothing else on the dumper is reachable through the engine.
pub const POST_CALLS: &[&str] = &[
    "/api/dump",
    "/api/abort",
    "/api/launch",
    "/api/queue/start",
    "/api/queue/skip",
    "/api/queue/clear",
    "/api/dumps/delete",
    "/api/dumps/remove",
    "/api/dumps/rename",
    "/api/dumps/fself",
    "/api/dumps/unfself",
];

/// The dumper's reading calls the app uses.
pub const GET_CALLS: &[&str] = &["/api/status", "/api/devices", "/api/library", "/api/dumps"];

/// What answers on a port: the dumper's version, when it is the dumper.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Found {
    pub port: u16,
    pub version: String,
}

/// `/api/whb/self` is webhb's: `{"version":"2.10","file":"ps5-app-dumper_v2.10.elf",...}`. Only
/// a payload whose file is a ps5-app-dumper ELF counts (other webhb payloads answer too).
pub fn parse_self(body: &[u8]) -> Option<String> {
    let v: serde_json::Value = serde_json::from_slice(body).ok()?;
    let file = v.get("file")?.as_str()?.to_ascii_lowercase();
    if !file.starts_with("ps5-app-dumper") {
        return None;
    }
    Some(
        v.get("version")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
    )
}

fn ports() -> &'static Mutex<HashMap<String, u16>> {
    static P: std::sync::OnceLock<Mutex<HashMap<String, u16>>> = std::sync::OnceLock::new();
    P.get_or_init(|| Mutex::new(HashMap::new()))
}

fn probe(ip: &str, port: u16) -> Option<String> {
    let addr = crate::payload_lifecycle::join_host_port(ip, port);
    match http_request(&addr, "GET", "/api/whb/self", PROBE_CONNECT, PROBE_IO) {
        Ok((200, body)) => parse_self(&body),
        _ => None,
    }
}

/// The running dumper on the console at `ip`: the port it was found on last time first, then
/// every port it may have settled on. None when no dumper answers.
pub fn find(ip: &str) -> Option<Found> {
    let cached = ports().lock().ok().and_then(|m| m.get(ip).copied());
    let order = cached
        .into_iter()
        .chain((FIRST_PORT..=LAST_PORT).filter(move |p| Some(*p) != cached));
    for port in order {
        if let Some(version) = probe(ip, port) {
            if let Ok(mut m) = ports().lock() {
                m.insert(ip.to_string(), port);
            }
            return Some(Found { port, version });
        }
    }
    if let Ok(mut m) = ports().lock() {
        m.remove(ip);
    }
    None
}

/// `path?k=v&...` with every value escaped. `token` is added when given.
pub fn query(path: &str, params: &[(String, String)], token: Option<&str>) -> String {
    let mut parts: Vec<String> = params
        .iter()
        .filter(|(k, _)| k != "token")
        .map(|(k, v)| format!("{}={}", encode_query(k), encode_query(v)))
        .collect();
    if let Some(t) = token.filter(|t| !t.is_empty()) {
        parts.push(format!("token={}", encode_query(t)));
    }
    if parts.is_empty() {
        path.to_string()
    } else {
        format!("{path}?{}", parts.join("&"))
    }
}

/// One call on the dumper at `ip:port`; status and body.
pub fn call(
    ip: &str,
    port: u16,
    method: &str,
    path_and_query: &str,
) -> Result<(u16, Vec<u8>), String> {
    let addr = crate::payload_lifecycle::join_host_port(ip, port);
    http_request(&addr, method, path_and_query, CALL_CONNECT, CALL_IO)
}

// ── The token, per console ────────────────────────────────────────────────────

fn store_path() -> Option<std::path::PathBuf> {
    if cfg!(test) {
        return None; // tests never touch the person's data folder
    }
    let data = std::env::var("PS5UPLOAD_DATA_DIR")
        .ok()
        .filter(|v| !v.trim().is_empty());
    let home = std::env::var("HOME")
        .ok()
        .or_else(|| std::env::var("USERPROFILE").ok())
        .filter(|v| !v.trim().is_empty());
    data.map(std::path::PathBuf::from)
        .or_else(|| home.map(|h| std::path::PathBuf::from(h).join(".ps5upload")))
        .map(|d| d.join("app_dumper_tokens.json"))
}

fn tokens_in_memory() -> &'static Mutex<HashMap<String, String>> {
    static T: std::sync::OnceLock<Mutex<HashMap<String, String>>> = std::sync::OnceLock::new();
    T.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The token the dumper on `ip` gave this app, if it has given one.
pub fn token(ip: &str) -> Option<String> {
    if let Some(t) = tokens_in_memory()
        .lock()
        .ok()
        .and_then(|m| m.get(ip).cloned())
    {
        return Some(t);
    }
    let all: HashMap<String, String> =
        serde_json::from_slice(&std::fs::read(store_path()?).ok()?).ok()?;
    let t = all.get(ip).cloned()?;
    if let Ok(mut m) = tokens_in_memory().lock() {
        m.insert(ip.to_string(), t.clone());
    }
    Some(t)
}

/// Keeps (or with None forgets) the dumper's token for `ip`.
pub fn set_token(ip: &str, t: Option<&str>) {
    if let Ok(mut m) = tokens_in_memory().lock() {
        match t {
            Some(t) => m.insert(ip.to_string(), t.to_string()),
            None => m.remove(ip),
        };
    }
    let Some(p) = store_path() else { return };
    let mut all: HashMap<String, String> = std::fs::read(&p)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    match t {
        Some(t) => all.insert(ip.to_string(), t.to_string()),
        None => all.remove(ip),
    };
    if let Some(dir) = p.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(b) = serde_json::to_vec(&all) {
        let tmp = p.with_extension("json.tmp");
        if std::fs::write(&tmp, b).is_ok() {
            let _ = std::fs::rename(&tmp, &p);
        }
    }
}

/// `{"token":"…"}` from `/api/whb/unlock`.
pub fn parse_token(body: &[u8]) -> Option<String> {
    let v: serde_json::Value = serde_json::from_slice(body).ok()?;
    let t = v.get("token")?.as_str()?;
    (t.len() == 32 && t.bytes().all(|b| b.is_ascii_hexdigit())).then(|| t.to_string())
}

/// The error text of a dumper reply (`{"error":"…"}`), or the body as text.
pub fn error_text(status: u16, body: &[u8]) -> String {
    serde_json::from_slice::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(str::to_string))
        .unwrap_or_else(|| {
            let t = String::from_utf8_lossy(body).trim().to_string();
            if t.is_empty() {
                format!("HTTP {status}")
            } else {
                t
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_dumper_counts_as_the_dumper() {
        assert_eq!(
            parse_self(br#"{"version":"2.10","file":"ps5-app-dumper_v2.10.elf","canStore":true}"#),
            Some("2.10".into())
        );
        assert_eq!(
            parse_self(br#"{"version":"1.0","file":"some-other-webhb-app.elf"}"#),
            None
        );
        assert_eq!(parse_self(b"<html>"), None);
    }

    #[test]
    fn a_call_carries_every_parameter_escaped_and_the_token_once() {
        let p = vec![
            ("app".to_string(), "PPSA01325-app0".to_string()),
            ("target".to_string(), "/mnt/usb0".to_string()),
            ("token".to_string(), "ignored".to_string()),
        ];
        assert_eq!(
            query("/api/dump", &p, Some("0123456789abcdef0123456789abcdef")),
            "/api/dump?app=PPSA01325-app0&target=%2Fmnt%2Fusb0&token=0123456789abcdef0123456789abcdef"
        );
        assert_eq!(query("/api/status", &[], None), "/api/status");
    }

    #[test]
    fn a_token_is_32_hex_digits() {
        assert_eq!(
            parse_token(br#"{"token":"0123456789abcdef0123456789abcdef"}"#).as_deref(),
            Some("0123456789abcdef0123456789abcdef")
        );
        assert_eq!(parse_token(br#"{"token":"short"}"#), None);
        assert_eq!(parse_token(br#"{"error":"wrong code"}"#), None);
    }

    #[test]
    fn errors_read_as_the_dumper_wrote_them() {
        assert_eq!(
            error_text(409, br#"{"error":"a queue is running"}"#),
            "a queue is running"
        );
        assert_eq!(error_text(500, b""), "HTTP 500");
    }

    #[test]
    fn only_listed_calls_change_anything() {
        assert!(POST_CALLS.contains(&"/api/dump"));
        assert!(!POST_CALLS.contains(&"/api/whb/quit"));
        assert!(!POST_CALLS.contains(&"/api/dumps/move"));
    }

    #[test]
    fn a_token_kept_in_memory_is_found_again_and_forgotten() {
        set_token("10.9.8.7", Some("0123456789abcdef0123456789abcdef"));
        assert_eq!(
            token("10.9.8.7").as_deref(),
            Some("0123456789abcdef0123456789abcdef")
        );
        set_token("10.9.8.7", None);
        assert_eq!(token("10.9.8.7"), None);
    }
}
