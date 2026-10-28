//! `/api/ps5/dumper/*` — EchoStretch's ps5-app-dumper as the app drives it
//! (`ps5upload_core::app_dumper`): whether it runs and where, trading the TV's code for its
//! token, and a fixed set of its calls forwarded with that token. Nothing is cached here but the
//! port it was found on and the token.

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;

use ps5upload_core::app_dumper as dumper;

fn host(h: &str) -> String {
    ps5upload_core::events::console_host(h.trim())
}

fn bad(status: StatusCode, e: impl Into<String>) -> Response {
    crate::json_err(status, e.into()).into_response()
}

fn json_body(body: &[u8]) -> serde_json::Value {
    serde_json::from_slice(body).unwrap_or(serde_json::Value::Null)
}

/// The 404 for a console where no dumper answers.
fn not_running() -> Response {
    bad(
        StatusCode::NOT_FOUND,
        "ps5-app-dumper is not running on this PS5. Send it from Payloads first.",
    )
}

/// A dumper reply as the app's reply: its JSON with its status; a 401 says the code is needed.
fn forward(ip: &str, status: u16, body: &[u8]) -> Response {
    if status == 401 {
        dumper::set_token(ip, None); // a new code on the console: the old token is no good
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": dumper::error_text(status, body), "locked": true })),
        )
            .into_response();
    }
    if (200..300).contains(&status) {
        return Json(json_body(body)).into_response();
    }
    let mut v = json_body(body);
    if !v.is_object() {
        v = serde_json::json!({});
    }
    v["error"] = serde_json::Value::String(dumper::error_text(status, body));
    (
        StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY),
        Json(v),
    )
        .into_response()
}

#[derive(Deserialize)]
pub(crate) struct HostParams {
    host: String,
}

/// GET /api/ps5/dumper?host= — `{present, port, version, unlocked, required, status}`:
/// `present:false` when no dumper answers; `status` is the dumper's own `/api/status` (job,
/// queue, busy).
pub(crate) async fn overview(
    State(_s): State<crate::AppState>,
    Query(q): Query<HostParams>,
) -> Response {
    let ip = host(&q.host);
    let r = tokio::task::spawn_blocking(move || {
        let Some(f) = dumper::find(&ip) else {
            return serde_json::json!({ "present": false });
        };
        let token = dumper::token(&ip);
        let access = dumper::call(
            &ip,
            f.port,
            "GET",
            &dumper::query("/api/whb/access", &[], token.as_deref()),
        )
        .ok()
        .filter(|(s, _)| *s == 200)
        .map(|(_, b)| json_body(&b))
        .unwrap_or(serde_json::Value::Null);
        let status = dumper::call(&ip, f.port, "GET", "/api/status")
            .ok()
            .filter(|(s, _)| *s == 200)
            .map(|(_, b)| json_body(&b))
            .unwrap_or(serde_json::Value::Null);
        serde_json::json!({
            "present": true,
            "port": f.port,
            "version": f.version,
            "required": access.get("required").and_then(|v| v.as_bool()).unwrap_or(true),
            "unlocked": access.get("unlocked").and_then(|v| v.as_bool()).unwrap_or(false),
            "status": status,
        })
    })
    .await;
    match r {
        Ok(v) => Json(v).into_response(),
        Err(e) => bad(StatusCode::BAD_GATEWAY, format!("{e}")),
    }
}

#[derive(Deserialize)]
pub(crate) struct GetParams {
    host: String,
    /// One of `app_dumper::GET_CALLS`, without the `/api` prefix: `status`, `devices`, …
    what: String,
}

/// GET /api/ps5/dumper/read?host=&what=devices|library|dumps|status — the dumper's reply as is
/// (`dumps` sees the console's own drive only with the token, which is sent).
pub(crate) async fn read(
    State(_s): State<crate::AppState>,
    Query(q): Query<GetParams>,
) -> Response {
    let ip = host(&q.host);
    let path = format!("/api/{}", q.what.trim_matches('/'));
    if !dumper::GET_CALLS.contains(&path.as_str()) {
        return bad(
            StatusCode::BAD_REQUEST,
            format!("{path} is not a dumper call the app reads"),
        );
    }
    let r = tokio::task::spawn_blocking(move || {
        let Some(f) = dumper::find(&ip) else {
            return not_running();
        };
        let token = dumper::token(&ip);
        match dumper::call(
            &ip,
            f.port,
            "GET",
            &dumper::query(&path, &[], token.as_deref()),
        ) {
            Ok((s, b)) => forward(&ip, s, &b),
            Err(e) => bad(StatusCode::BAD_GATEWAY, e),
        }
    })
    .await;
    match r {
        Ok(resp) => resp,
        Err(e) => bad(StatusCode::BAD_GATEWAY, format!("{e}")),
    }
}

#[derive(Deserialize)]
pub(crate) struct UnlockReq {
    host: String,
    code: String,
}

/// POST /api/ps5/dumper/unlock `{host, code}` — trades the six-digit code the TV shows for the
/// dumper's token, kept for this console. A wrong code is a 401 (the dumper slows guessing).
pub(crate) async fn unlock(
    State(_s): State<crate::AppState>,
    Json(req): Json<UnlockReq>,
) -> Response {
    let ip = host(&req.host);
    let code: String = req.code.chars().filter(|c| c.is_ascii_digit()).collect();
    if code.len() != 6 {
        return bad(StatusCode::BAD_REQUEST, "the code is six digits");
    }
    let r = tokio::task::spawn_blocking(move || {
        let Some(f) = dumper::find(&ip) else {
            return not_running();
        };
        let path = dumper::query("/api/whb/unlock", &[("code".into(), code)], None);
        match dumper::call(&ip, f.port, "POST", &path) {
            Ok((200, b)) => match dumper::parse_token(&b) {
                Some(t) => {
                    dumper::set_token(&ip, Some(&t));
                    Json(serde_json::json!({ "ok": true })).into_response()
                }
                None => bad(StatusCode::BAD_GATEWAY, "the dumper sent no token"),
            },
            Ok((s, b)) => bad(
                StatusCode::from_u16(s).unwrap_or(StatusCode::BAD_GATEWAY),
                dumper::error_text(s, &b),
            ),
            Err(e) => bad(StatusCode::BAD_GATEWAY, e),
        }
    })
    .await;
    match r {
        Ok(resp) => resp,
        Err(e) => bad(StatusCode::BAD_GATEWAY, format!("{e}")),
    }
}

/// POST /api/ps5/dumper/show-code `{host}` — puts the code on the TV again.
pub(crate) async fn show_code(
    State(_s): State<crate::AppState>,
    Json(req): Json<HostParams>,
) -> Response {
    let ip = host(&req.host);
    let r = tokio::task::spawn_blocking(move || {
        let Some(f) = dumper::find(&ip) else {
            return not_running();
        };
        match dumper::call(&ip, f.port, "POST", "/api/whb/access/show") {
            Ok((s, b)) => forward(&ip, s, &b),
            Err(e) => bad(StatusCode::BAD_GATEWAY, e),
        }
    })
    .await;
    match r {
        Ok(resp) => resp,
        Err(e) => bad(StatusCode::BAD_GATEWAY, format!("{e}")),
    }
}

#[derive(Deserialize)]
pub(crate) struct CallReq {
    host: String,
    /// One of `app_dumper::POST_CALLS`.
    path: String,
    #[serde(default)]
    params: std::collections::BTreeMap<String, String>,
}

/// POST /api/ps5/dumper/call `{host, path, params}` — one of the dumper's calls that change
/// something (dump, abort, launch, the queue, finished dumps), with this console's token.
pub(crate) async fn call(State(_s): State<crate::AppState>, Json(req): Json<CallReq>) -> Response {
    let ip = host(&req.host);
    if !dumper::POST_CALLS.contains(&req.path.as_str()) {
        return bad(
            StatusCode::BAD_REQUEST,
            format!("{} is not a dumper call the app makes", req.path),
        );
    }
    let params: Vec<(String, String)> = req.params.into_iter().collect();
    let path = req.path;
    crate::log_info!("dumper call: host={ip} path={path}");
    let r = tokio::task::spawn_blocking(move || {
        let Some(f) = dumper::find(&ip) else {
            return not_running();
        };
        let token = dumper::token(&ip);
        match dumper::call(
            &ip,
            f.port,
            "POST",
            &dumper::query(&path, &params, token.as_deref()),
        ) {
            Ok((s, b)) => forward(&ip, s, &b),
            Err(e) => bad(StatusCode::BAD_GATEWAY, e),
        }
    })
    .await;
    match r {
        Ok(resp) => resp,
        Err(e) => bad(StatusCode::BAD_GATEWAY, format!("{e}")),
    }
}
