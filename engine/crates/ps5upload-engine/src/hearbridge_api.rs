//! `/api/ps5/hearbridge/*` — the console's HearBridge (Bluetooth headset audio, HTTP on
//! :8090..8095) as the app sees it: its status, its saved and scanned headsets, and the
//! few changes the app makes. Every call is a plain HTTP request to the console
//! (`ps5upload_core::hearbridge`); its token never leaves the engine.

use axum::{
    extract::{Query, State},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;

use ps5upload_core::hearbridge as hb;

#[derive(Deserialize)]
pub(crate) struct HostParams {
    #[serde(alias = "addr")]
    host: String,
}

fn bad(e: String) -> Response {
    crate::json_err(axum::http::StatusCode::BAD_GATEWAY, e).into_response()
}

fn host(h: &str) -> String {
    ps5upload_core::events::console_host(h.trim())
}

/// GET /api/ps5/hearbridge/status?host= — `{ok, present:true, port, status}`, or
/// `{ok, present:false, error}` when nothing answers on 8090..8095.
pub(crate) async fn status(
    State(_s): State<crate::AppState>,
    Query(q): Query<HostParams>,
) -> Response {
    let h = host(&q.host);
    match tokio::task::spawn_blocking(move || hb::status(&h)).await {
        Ok(Ok(f)) => Json(serde_json::json!({
            "ok": true,
            "present": true,
            "port": f.port,
            "status": f.status,
        }))
        .into_response(),
        Ok(Err(e)) => {
            Json(serde_json::json!({ "ok": true, "present": false, "error": e })).into_response()
        }
        Err(e) => bad(format!("{e}")),
    }
}

async fn list(q: HostParams, which: hb::DeviceList) -> Response {
    let h = host(&q.host);
    match tokio::task::spawn_blocking(move || hb::devices(&h, which)).await {
        Ok(Ok(v)) => {
            Json(serde_json::json!({ "ok": true, "devices": v["devices"] })).into_response()
        }
        Ok(Err(e)) => bad(e),
        Err(e) => bad(format!("{e}")),
    }
}

/// GET /api/ps5/hearbridge/saved?host= — the paired headsets `{ok, devices}`.
pub(crate) async fn saved(
    State(_s): State<crate::AppState>,
    Query(q): Query<HostParams>,
) -> Response {
    list(q, hb::DeviceList::Saved).await
}

/// GET /api/ps5/hearbridge/devices?host= — the last scan's results `{ok, devices}`.
pub(crate) async fn devices(
    State(_s): State<crate::AppState>,
    Query(q): Query<HostParams>,
) -> Response {
    list(q, hb::DeviceList::Scanned).await
}

#[derive(Deserialize)]
pub(crate) struct ActionReq {
    /// The console (`addr` here is the headset's Bluetooth address, see `ActionParams`).
    host: String,
    action: String,
    #[serde(flatten)]
    params: hb::ActionParams,
}

/// POST /api/ps5/hearbridge/action `{host, action, pct?|on?|index?|addr?|auto?|ms?}` —
/// one of volume, mute, reconnect, select, scan, night, latency, stop. Answers
/// `{ok, result}` with HearBridge's reply (its new status, token removed).
pub(crate) async fn action(
    State(_s): State<crate::AppState>,
    Json(req): Json<ActionReq>,
) -> Response {
    let a = match hb::Action::parse(&req.action, &req.params) {
        Ok(a) => a,
        Err(e) => return crate::json_err(axum::http::StatusCode::BAD_REQUEST, e).into_response(),
    };
    let h = host(&req.host);
    crate::log_info!("hearbridge {}: host={h}", req.action);
    match tokio::task::spawn_blocking(move || hb::act(&h, &a)).await {
        Ok(Ok(v)) => Json(serde_json::json!({ "ok": true, "result": v })).into_response(),
        Ok(Err(e)) => bad(e),
        Err(e) => bad(format!("{e}")),
    }
}
