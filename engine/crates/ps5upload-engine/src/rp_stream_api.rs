//! Remote Play over a WebSocket (spike).
//!
//! `GET /api/ps5/rp/ws` upgrades to a WebSocket carrying one stream with a
//! paired console (see `ps5upload_core::rp_stream`, ported from chiaki-ng,
//! AGPL-3.0):
//!
//! * client → engine, text JSON: first `{"host", "regist_key", "rp_key",
//!   "width"?, "height"?, "fps"?, "bitrate_kbps"?, "codec"?}` to start, then
//!   `{"pad": {"buttons", "l2", "r2", "lx", "ly", "rx", "ry"}}` whenever the
//!   pad changes, or `{"stop": true}`.
//! * engine → client, binary `[u8 kind][payload]`: 0 = video codec header
//!   (Annex-B parameter sets), 1 = video access unit, 3 = audio header,
//!   4 = audio frame (Opus). Text JSON = status (`{"stage": …}`).
//!
//! Closing the socket ends the stream. `GET /rp-player` is a test page.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::body::Bytes;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::{Html, IntoResponse, Response};
use ps5upload_core::rp_stream::{
    run_stream, Codec, ControllerState, Progress, StreamConfig, StreamSink,
};
use tokio::sync::mpsc;

/// The console serves one Remote Play session at a time; so do we.
static BUSY: AtomicBool = AtomicBool::new(false);

#[derive(Debug, serde::Deserialize)]
struct StartReq {
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
}

#[derive(Debug, serde::Deserialize)]
struct ClientMsg {
    #[serde(default)]
    pad: Option<ControllerState>,
    #[serde(default)]
    stop: bool,
}

/// Shared between the socket task and the stream thread.
#[derive(Default)]
struct Shared {
    pad: Mutex<Option<ControllerState>>,
    stop: AtomicBool,
}

struct WsSink {
    out: mpsc::Sender<Message>,
    shared: Arc<Shared>,
    t0: Instant,
    dropped: u64,
}

impl WsSink {
    fn send_bin(&mut self, kind: u8, payload: &[u8]) -> bool {
        let mut v = Vec::with_capacity(1 + payload.len());
        v.push(kind);
        v.extend_from_slice(payload);
        match self.out.try_send(Message::Binary(Bytes::from(v))) {
            Ok(()) => true,
            // A slow page: drop rather than stall the network loop.
            Err(mpsc::error::TrySendError::Full(_)) => {
                self.dropped += 1;
                true
            }
            Err(mpsc::error::TrySendError::Closed(_)) => false,
        }
    }
    fn status(&self, v: serde_json::Value) {
        let _ = self.out.blocking_send(Message::Text(v.to_string().into()));
    }
}

impl StreamSink for WsSink {
    fn progress(&mut self, p: Progress) {
        let ms = self.t0.elapsed().as_millis() as u64;
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
        self.status(v);
    }
    fn video(&mut self, au: &[u8], header: bool) -> bool {
        // Headers must not be dropped: the decoder cannot start without them.
        if header {
            let mut v = vec![0u8];
            v.extend_from_slice(au);
            return self
                .out
                .blocking_send(Message::Binary(Bytes::from(v)))
                .is_ok();
        }
        self.send_bin(1, au)
    }
    fn audio(&mut self, frame: &[u8], header: bool) -> bool {
        if header {
            let mut v = vec![3u8];
            v.extend_from_slice(frame);
            return self
                .out
                .blocking_send(Message::Binary(Bytes::from(v)))
                .is_ok();
        }
        self.send_bin(4, frame)
    }
    fn input(&mut self) -> Option<ControllerState> {
        self.shared.pad.lock().ok()?.take()
    }
    fn stopped(&mut self) -> bool {
        self.shared.stop.load(Ordering::Relaxed) || self.out.is_closed()
    }
}

pub async fn ws(upgrade: WebSocketUpgrade) -> Response {
    upgrade.on_upgrade(session)
}

async fn session(mut socket: WebSocket) {
    // The first message says where and how.
    let start: StartReq = match socket.recv().await {
        Some(Ok(Message::Text(t))) => {
            match serde_json::from_str(t.as_str()) {
                Ok(s) => s,
                Err(e) => {
                    let _ = socket
                    .send(Message::Text(serde_json::json!({"stage": "error", "error": format!("bad start: {e}")}).to_string().into()))
                    .await;
                    return;
                }
            }
        }
        _ => return,
    };
    let creds = match ps5upload_core::rp_session::SessionCreds::from_hex(
        &start.regist_key,
        &start.rp_key,
    ) {
        Ok(c) => c,
        Err(e) => {
            let _ = socket
                .send(Message::Text(
                    serde_json::json!({"stage": "error", "error": format!("{e:#}")})
                        .to_string()
                        .into(),
                ))
                .await;
            return;
        }
    };
    if BUSY.swap(true, Ordering::SeqCst) {
        let _ = socket
            .send(Message::Text(
                serde_json::json!({"stage": "error", "error": "a Remote Play stream is already open"}).to_string().into(),
            ))
            .await;
        return;
    }
    let mut cfg = StreamConfig::default();
    if let (Some(w), Some(h)) = (start.width, start.height) {
        cfg.width = w;
        cfg.height = h;
        cfg.bitrate_kbps = if h >= 1080 { 15000 } else { 10000 };
    }
    if let Some(f) = start.fps {
        cfg.fps = f;
    }
    if let Some(b) = start.bitrate_kbps {
        cfg.bitrate_kbps = b;
    }
    if start.codec.as_deref() == Some("h265") {
        cfg.codec = Codec::H265;
    }

    let shared = Arc::new(Shared::default());
    let (tx, mut rx) = mpsc::channel::<Message>(256);
    let host = start.host.clone();
    let sh = shared.clone();
    let worker = tokio::task::spawn_blocking(move || {
        let mut sink = WsSink {
            out: tx,
            shared: sh,
            t0: Instant::now(),
            dropped: 0,
        };
        let r = run_stream(&host, &creds, cfg, Duration::from_secs(4 * 3600), &mut sink);
        let end = match r {
            Ok(rep) => serde_json::json!({
                "stage": "ended",
                "frames": rep.video.frames,
                "dropped": rep.video.frames_dropped,
                "bad_mac": rep.av_bad_mac,
                "ws_dropped": sink.dropped,
                "reason": rep.disconnect_reason,
            }),
            Err(e) => serde_json::json!({"stage": "error", "error": format!("{e:#}")}),
        };
        crate::log_info!("rp_stream: {end}");
        sink.status(end);
        BUSY.store(false, Ordering::SeqCst);
    });

    loop {
        tokio::select! {
            out = rx.recv() => match out {
                Some(m) => {
                    if socket.send(m).await.is_err() {
                        break;
                    }
                }
                None => break, // the stream thread finished
            },
            inc = socket.recv() => match inc {
                Some(Ok(Message::Text(t))) => {
                    if let Ok(m) = serde_json::from_str::<ClientMsg>(t.as_str()) {
                        if let Some(p) = m.pad {
                            if let Ok(mut g) = shared.pad.lock() {
                                *g = Some(p);
                            }
                        }
                        if m.stop {
                            shared.stop.store(true, Ordering::Relaxed);
                        }
                    }
                }
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => {
                    shared.stop.store(true, Ordering::Relaxed);
                    break;
                }
                _ => {}
            },
        }
    }
    shared.stop.store(true, Ordering::Relaxed);
    drop(rx);
    let _ = worker.await;
}

pub async fn player() -> impl IntoResponse {
    Html(include_str!("rp_player.html"))
}
