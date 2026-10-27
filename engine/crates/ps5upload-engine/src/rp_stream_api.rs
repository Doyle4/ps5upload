//! Remote Play stream over HTTP (spike).
//!
//! `POST /api/ps5/rp/stream` opens a stream with a paired console (see
//! `ps5upload_core::rp_stream`, ported from chiaki-ng, AGPL-3.0) and answers
//! with a never-ending body of records: `[u32 BE length][u8 kind][payload]`,
//! kind 0 = codec header (SPS/PPS), 1 = one video access unit (Annex-B),
//! 2 = a JSON status line. Closing the response ends the stream.
//!
//! `GET /rp-player` is a minimal page that plays it with WebCodecs.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use axum::body::{Body, Bytes};
use axum::http::{header, StatusCode};
use axum::response::{Html, IntoResponse, Response};
use axum::Json;
use ps5upload_core::rp_stream::{run_stream, Codec, Progress, StreamConfig};

/// The console serves one Remote Play session at a time; so do we.
static BUSY: AtomicBool = AtomicBool::new(false);

#[derive(Debug, serde::Deserialize)]
pub struct StreamReq {
    host: String,
    regist_key: String,
    rp_key: String,
    #[serde(default)]
    width: Option<u32>,
    #[serde(default)]
    height: Option<u32>,
    #[serde(default)]
    fps: Option<u32>,
    #[serde(default)]
    bitrate_kbps: Option<u32>,
    #[serde(default)]
    codec: Option<String>,
    #[serde(default)]
    max_seconds: Option<u64>,
}

fn record(kind: u8, payload: &[u8]) -> Bytes {
    let mut v = Vec::with_capacity(5 + payload.len());
    v.extend_from_slice(&((payload.len() + 1) as u32).to_be_bytes());
    v.push(kind);
    v.extend_from_slice(payload);
    Bytes::from(v)
}

fn status(v: serde_json::Value) -> Bytes {
    record(2, v.to_string().as_bytes())
}

pub async fn stream(Json(req): Json<StreamReq>) -> Response {
    let creds =
        match ps5upload_core::rp_session::SessionCreds::from_hex(&req.regist_key, &req.rp_key) {
            Ok(c) => c,
            Err(e) => return (StatusCode::BAD_REQUEST, format!("{e:#}")).into_response(),
        };
    if BUSY.swap(true, Ordering::SeqCst) {
        return (StatusCode::CONFLICT, "a Remote Play stream is already open").into_response();
    }
    let mut cfg = StreamConfig::default();
    if let (Some(w), Some(h)) = (req.width, req.height) {
        cfg.width = w;
        cfg.height = h;
        cfg.bitrate_kbps = if h >= 1080 { 15000 } else { 10000 };
    }
    if let Some(f) = req.fps {
        cfg.fps = f;
    }
    if let Some(b) = req.bitrate_kbps {
        cfg.bitrate_kbps = b;
    }
    if req.codec.as_deref() == Some("h265") {
        cfg.codec = Codec::H265;
    }
    let max = Duration::from_secs(req.max_seconds.unwrap_or(1800));
    let host = req.host.clone();
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Bytes, std::io::Error>>(64);
    tokio::task::spawn_blocking(move || {
        let t0 = std::time::Instant::now();
        let ptx = tx.clone();
        let r = run_stream(
            &host,
            &creds,
            cfg,
            max,
            |p| {
                let ms = t0.elapsed().as_millis() as u64;
                let v = match p {
                    Progress::Nonce => serde_json::json!({"stage": "nonce", "ms": ms}),
                    Progress::SessionId => serde_json::json!({"stage": "session", "ms": ms}),
                    Progress::TakionConnected => serde_json::json!({"stage": "takion", "ms": ms}),
                    Progress::Bang => serde_json::json!({"stage": "bang", "ms": ms}),
                    Progress::StreamInfo(r) => {
                        serde_json::json!({"stage": "streaminfo", "ms": ms, "resolutions": r})
                    }
                    Progress::FirstFrame(n) => {
                        serde_json::json!({"stage": "first_frame", "ms": ms, "bytes": n})
                    }
                };
                let _ = ptx.blocking_send(Ok(status(v)));
            },
            move |au: &[u8], is_header: bool| {
                tx.blocking_send(Ok(record(if is_header { 0 } else { 1 }, au)))
                    .is_ok()
            },
        );
        let end = match r {
            Ok(rep) => serde_json::json!({
                "stage": "ended",
                "frames": rep.video.frames,
                "dropped": rep.video.frames_dropped,
                "bad_mac": rep.av_bad_mac,
                "reason": rep.disconnect_reason,
            }),
            Err(e) => serde_json::json!({"stage": "error", "error": format!("{e:#}")}),
        };
        crate::log_info!("rp_stream: {end}");
        let _ = ptx.blocking_send(Ok(status(end)));
        BUSY.store(false, Ordering::SeqCst);
    });
    Response::builder()
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from_stream(
            tokio_stream::wrappers::ReceiverStream::new(rx),
        ))
        .unwrap()
}

pub async fn player() -> impl IntoResponse {
    Html(include_str!("rp_player.html"))
}
