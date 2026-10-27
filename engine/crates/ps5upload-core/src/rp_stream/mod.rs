//! Remote Play streaming (spike): open a session with a paired PS5 and receive
//! its video.
//!
//! Ported from chiaki-ng (AGPL-3.0: `lib/src/session.c`, `ctrl.c`,
//! `streamconnection.c`, `launchspec.c`, `takion.c`, `gkcrypt.c`, `ecdh.c`,
//! `videoreceiver.c`, `frameprocessor.c`), reusing this crate's pairing and
//! control-session pieces (`rp_regist`, `rp_session`).
//!
//! The order, each step waiting on the last:
//! 1. **session-init** (TCP 9295, plain): the console hands out a nonce.
//! 2. **ctrl** (TCP 9295, our auth encrypted with the nonce + RP-Key): the
//!    console answers with a SESSION_ID and then heartbeats, which must be
//!    answered for the whole stream. A background thread does that.
//! 3. **Takion** (UDP 9296): INIT/COOKIE handshake, then BIG (our launch spec
//!    and ECDH key) → BANG (the console's key) → both sides switch on GKCrypt →
//!    STREAMINFO (resolutions + codec headers) → we ack and say a controller is
//!    connected → video and audio flow; we heartbeat every second and report
//!    congestion every 200 ms.
//!
//! Senkusha (the MTU/RTT probe on 9297) is skipped: chiaki falls back to an
//! MTU of 1454 and 1 ms RTT when it fails and streams anyway.

pub mod audio;
pub mod crypto;
pub mod fec;
pub mod feedback;
pub mod guard;
pub mod proto;
pub mod takion;
pub mod video;

use std::io::{Read, Write};
use std::net::{Shutdown, SocketAddr, TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Context, Result};

use crate::rp_regist::split_http;
use crate::rp_session::{
    ambassador, auth_decrypt, auth_encrypt, b64, bright, make_did, session_init, SessionCreds,
    KEY_SIZE, RP_VERSION, SESSION_PORT,
};

use self::crypto::{Ecdh, GkCrypt, HANDSHAKE_KEY_SIZE};
use self::proto::Message;
use self::takion::{Event, Takion};

pub use self::audio::{AudioAssembler, AudioHeader};
pub use self::feedback::{button, ControllerState, FeedbackSender};
pub use self::proto::Resolution;
pub use self::video::{FrameAssembler, VideoStats};

const STREAM_PORT: u16 = 9296;
const MTU: u32 = 1454;
const RTT_MS: u32 = 1;
/// Takion protocol version a PS5 speaks.
const TAKION_VERSION_PS5: u32 = 12;

const CTRL_SESSION_ID: u16 = 0x0033;
const CTRL_HEARTBEAT_REQ: u16 = 0x00fe;
const CTRL_HEARTBEAT_REP: u16 = 0x01fe;
const CTRL_LOGIN_PIN_REQ: u16 = 0x0004;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Codec {
    H264,
    H265,
}

#[derive(Debug, Clone, Copy)]
pub struct StreamConfig {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub bitrate_kbps: u32,
    pub codec: Codec,
    /// Wake a console found in rest mode before opening the session.
    pub wake: bool,
}

impl Default for StreamConfig {
    fn default() -> Self {
        // chiaki's 720p60 preset.
        Self {
            width: 1280,
            height: 720,
            fps: 60,
            bitrate_kbps: 10000,
            codec: Codec::H264,
            wake: true,
        }
    }
}

/// Milestones, for a caller that wants to time or log them.
#[derive(Debug, Clone)]
pub enum Progress {
    Nonce,
    SessionId,
    TakionConnected,
    Bang,
    StreamInfo(Vec<(u32, u32)>),
    FirstFrame(usize),
}

/// Ctrl: our auth, the console's SESSION_ID, then heartbeats until stopped.
struct Ctrl {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
    stream: TcpStream,
}

impl Drop for Ctrl {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        let _ = self.stream.shutdown(Shutdown::Both);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

fn resolve(host: &str, port: u16) -> Result<SocketAddr> {
    (host, port)
        .to_socket_addrs()
        .with_context(|| format!("resolving {host}"))?
        .next()
        .ok_or_else(|| anyhow!("{host} did not resolve"))
}

fn ctrl_open(
    host: &str,
    creds: &SessionCreds,
    nonce: &[u8; KEY_SIZE],
    codec: Codec,
) -> Result<(Ctrl, String, [u8; 16], [u8; 16])> {
    let amb = ambassador(nonce);
    let brt = bright(nonce, &creds.morning);
    let mut counter = 0u64;
    let mut next = |data: &[u8]| {
        let enc = auth_encrypt(&brt, &amb, counter, data);
        counter += 1;
        b64(&enc)
    };
    let auth = next(&creds.regist_key);
    let did = next(&make_did(&creds.regist_key));
    let ostype = next(b"Win10.0.0\0");
    let bitrate = next(&[0u8; 4]);
    let streaming_type: u32 = match codec {
        Codec::H264 => 1,
        Codec::H265 => 2,
    };
    let streaming_type = next(&streaming_type.to_le_bytes());

    let addr = resolve(host, SESSION_PORT)?;
    let mut s = TcpStream::connect_timeout(&addr, Duration::from_secs(10))
        .context("connecting for ctrl")?;
    s.set_nodelay(true).ok();
    let req = format!(
        "GET /sie/ps5/rp/sess/ctrl HTTP/1.1\r\n\
         Host: {host}:{SESSION_PORT}\r\n\
         User-Agent: remoteplay Windows\r\n\
         Connection: keep-alive\r\n\
         Content-Length: 0\r\n\
         RP-Auth: {auth}\r\n\
         RP-Version: {RP_VERSION}\r\n\
         RP-Did: {did}\r\n\
         RP-ControllerType: 3\r\n\
         RP-ClientType: 11\r\n\
         RP-OSType: {ostype}\r\n\
         RP-ConPath: 1\r\n\
         RP-StartBitrate: {bitrate}\r\n\
         RP-StreamingType: {streaming_type}\r\n\r\n"
    );
    s.write_all(req.as_bytes())?;
    s.set_read_timeout(Some(Duration::from_secs(15)))?;

    let mut raw = Vec::new();
    let mut buf = [0u8; 2048];
    let header_end = loop {
        let n = s.read(&mut buf).context("reading the ctrl reply")?;
        if n == 0 {
            bail!("the console closed the control connection without answering");
        }
        raw.extend_from_slice(&buf[..n]);
        if let Some(i) = raw.windows(4).position(|w| w == b"\r\n\r\n") {
            break i + 4;
        }
    };
    let reply = split_http(&raw[..header_end])?;
    if reply.code != 200 {
        let reason = reply
            .headers
            .iter()
            .find(|(k, _)| k == "rp-application-reason")
            .map(|(_, v)| v.clone())
            .unwrap_or_default();
        bail!(
            "the console refused the control session (HTTP {}) {reason}",
            reply.code
        );
    }
    let mut pending = raw[header_end..].to_vec();

    // The console's counter starts at 1 (measured; see rp_session).
    let mut remote_counter = 1u64;
    let deadline = Instant::now() + Duration::from_secs(15);
    s.set_read_timeout(Some(Duration::from_millis(500)))?;
    let session_id = loop {
        if Instant::now() > deadline {
            bail!("the console never sent a session id over ctrl");
        }
        if pending.len() >= 8 {
            let size = u32::from_be_bytes(pending[0..4].try_into().unwrap()) as usize;
            if size > 8192 {
                bail!("ctrl stream desynced");
            }
            if pending.len() >= 8 + size {
                let kind = u16::from_be_bytes([pending[4], pending[5]]);
                let raw_payload = pending[8..8 + size].to_vec();
                pending.drain(..8 + size);
                let mut payload = Vec::new();
                if !raw_payload.is_empty() {
                    payload = auth_decrypt(&brt, &amb, remote_counter, &raw_payload);
                    remote_counter += 1;
                }
                match kind {
                    CTRL_HEARTBEAT_REQ => s.write_all(&ctrl_msg(CTRL_HEARTBEAT_REP))?,
                    CTRL_LOGIN_PIN_REQ => bail!(
                        "the console asks for a login passcode, which streaming cannot supply"
                    ),
                    CTRL_SESSION_ID => {
                        // A length byte, then the id. chiaki takes the console's
                        // id only when it is 24+ alphanumeric characters and
                        // otherwise makes one up, which the console accepts:
                        // FW 13.60 sends 16 characters, so the fallback is the
                        // path that runs there (measured).
                        if session_id_ok(&payload) {
                            break String::from_utf8_lossy(&payload[1..]).into_owned();
                        }
                        break fallback_session_id()?;
                    }
                    _ => {}
                }
                continue;
            }
        }
        match s.read(&mut buf) {
            Ok(0) => bail!("the console closed ctrl before sending a session id"),
            Ok(n) => pending.extend_from_slice(&buf[..n]),
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) => {}
            Err(e) => return Err(anyhow!("reading ctrl: {e}")),
        }
    };

    // Keep answering heartbeats for the life of the stream.
    let stop = Arc::new(AtomicBool::new(false));
    let mut ts = s.try_clone()?;
    let stop_t = stop.clone();
    let thread = std::thread::Builder::new()
        .name("rp-ctrl".into())
        .spawn(move || {
            let mut pending = pending;
            let mut buf = [0u8; 2048];
            while !stop_t.load(Ordering::Relaxed) {
                while pending.len() >= 8 {
                    let size = u32::from_be_bytes(pending[0..4].try_into().unwrap()) as usize;
                    if size > 8192 || pending.len() < 8 + size {
                        break;
                    }
                    let kind = u16::from_be_bytes([pending[4], pending[5]]);
                    pending.drain(..8 + size);
                    if kind == CTRL_HEARTBEAT_REQ
                        && ts.write_all(&ctrl_msg(CTRL_HEARTBEAT_REP)).is_err()
                    {
                        return;
                    }
                }
                match ts.read(&mut buf) {
                    Ok(0) => return,
                    Ok(n) => pending.extend_from_slice(&buf[..n]),
                    Err(e)
                        if matches!(
                            e.kind(),
                            std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                        ) => {}
                    Err(_) => return,
                }
            }
        })?;
    Ok((
        Ctrl {
            stop,
            thread: Some(thread),
            stream: s,
        },
        session_id,
        brt,
        amb,
    ))
}

/// chiaki's stand-in session id: seconds of uptime, then 48 random bytes in base64.
fn fallback_session_id() -> Result<String> {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() % 1_000_000)
        .unwrap_or(0);
    let mut r = [0u8; 48];
    getrandom::fill(&mut r).map_err(|e| anyhow!("random: {e}"))?;
    Ok(format!("{secs}{}", b64(&r)))
}

/// `[len][len alphanumeric bytes]` with at least 24 characters, as chiaki accepts.
fn session_id_ok(p: &[u8]) -> bool {
    p.len() >= 25
        && p[0] as usize == p.len() - 1
        && p[1..].iter().all(|c| c.is_ascii_alphanumeric())
}

/// An empty ctrl message: just the 8-byte header.
fn ctrl_msg(kind: u16) -> [u8; 8] {
    let mut h = [0u8; 8];
    h[4..6].copy_from_slice(&kind.to_be_bytes());
    h
}

fn launch_spec(cfg: &StreamConfig, handshake_key: &[u8; HANDSHAKE_KEY_SIZE]) -> String {
    let codec = match cfg.codec {
        Codec::H264 => "avc",
        Codec::H265 => "hevc",
    };
    format!(
        "{{\"sessionId\":\"sessionId4321\",\"streamResolutions\":[{{\"resolution\":{{\"width\":{w},\"height\":{h}}},\
\"maxFps\":{fps},\"score\":10}}],\"network\":{{\"bwKbpsSent\":{bw},\"bwLoss\":0.001000,\"mtu\":{mtu},\"rtt\":{rtt},\
\"ports\":[53,2053]}},\"slotId\":1,\"appSpecification\":{{\"minFps\":30,\"minBandwidth\":0,\"extTitleId\":\"ps3\",\
\"version\":1,\"timeLimit\":1,\"startTimeout\":100,\"afkTimeout\":100,\"afkTimeoutDisconnect\":100}},\"konan\":{{\
\"ps3AccessToken\":\"accessToken\",\"ps3RefreshToken\":\"refreshToken\"}},\"requestGameSpecification\":{{\
\"model\":\"bravia_tv\",\"platform\":\"android\",\"audioChannels\":\"5.1\",\"language\":\"sp\",\"acceptButton\":\"X\",\
\"connectedControllers\":[\"xinput\",\"ds3\",\"ds4\"],\"yuvCoefficient\":\"bt601\",\"videoEncoderProfile\":\"hw4.1\",\
\"audioEncoderProfile\":\"audio1\",\"adaptiveStreamMode\": \"resize\"}},\"userProfile\":{{\"onlineId\":\"psnId\",\
\"npId\":\"npId\",\"region\":\"US\",\"languagesUsed\":[\"en\",\"jp\"]}},\"videoCodec\":\"{codec}\",\
\"dynamicRange\":\"SDR\",\"handshakeKey\":\"{hk}\"}}",
        w = cfg.width,
        h = cfg.height,
        fps = cfg.fps,
        bw = cfg.bitrate_kbps,
        mtu = MTU,
        rtt = RTT_MS,
        hk = b64(handshake_key),
    )
}

/// Where a stream's output goes and its input comes from.
pub trait StreamSink {
    fn progress(&mut self, _p: Progress) {}
    /// One Annex-B access unit (`header` = codec parameter sets). False stops.
    fn video(&mut self, au: &[u8], header: bool) -> bool;
    /// One audio frame: its frame index (u16 BE) then one Opus packet; or, with
    /// `header`, the 14-byte audio header (channels, bits, rate, frame size).
    /// False stops.
    fn audio(&mut self, _frame: &[u8], _header: bool) -> bool {
        true
    }
    /// The pad's latest state, if it changed since the last call.
    fn input(&mut self) -> Option<ControllerState> {
        None
    }
    /// True once the consumer has gone; the stream then ends.
    fn stopped(&mut self) -> bool {
        false
    }
}

/// Records the console's hold-off when a session ends, however it ends.
struct ReleaseHold {
    host: String,
    clean: std::cell::Cell<bool>,
}

impl Drop for ReleaseHold {
    fn drop(&mut self) {
        guard::hold_off(
            &self.host,
            if self.clean.get() {
                guard::RELEASE_AFTER_CLEAN_STOP
            } else {
                guard::RELEASE_AFTER_DROP
            },
        );
    }
}

/// Puts video packets back in order (chiaki-ng's video reorder queue): a
/// missing packet is waited for up to 16 ms (about a frame), then skipped.
#[derive(Default)]
struct VideoReorder {
    next: Option<u16>,
    waiting_since: Option<Instant>,
    buf: std::collections::HashMap<u16, takion::AvPacket>,
}

impl VideoReorder {
    const TIMEOUT: Duration = Duration::from_millis(16);
    const CAPACITY: usize = 64;

    fn push(&mut self, p: takion::AvPacket) {
        let next = *self
            .next
            .get_or_insert(p.packet_index.wrapping_sub(p.unit_index));
        if (p.packet_index.wrapping_sub(next) as i16) < 0 {
            return; // older than what was already handed on
        }
        self.buf.insert(p.packet_index, p);
    }

    fn pull(&mut self, now: Instant) -> Vec<takion::AvPacket> {
        let mut out = Vec::new();
        let Some(mut next) = self.next else {
            return out;
        };
        loop {
            if let Some(p) = self.buf.remove(&next) {
                out.push(p);
                next = next.wrapping_add(1);
                self.waiting_since = None;
                continue;
            }
            if self.buf.is_empty() {
                break;
            }
            let since = *self.waiting_since.get_or_insert(now);
            if now.duration_since(since) < Self::TIMEOUT && self.buf.len() < Self::CAPACITY {
                break;
            }
            // Give up on the gap: jump to the oldest packet we hold.
            next = *self
                .buf
                .keys()
                .min_by_key(|k| k.wrapping_sub(next))
                .expect("not empty");
            self.waiting_since = None;
        }
        self.next = Some(next);
        out
    }
}

/// What a finished stream run saw.
#[derive(Debug, Default, Clone)]
pub struct StreamReport {
    pub resolutions: Vec<(u32, u32)>,
    pub video: VideoStats,
    pub av_packets: u64,
    pub av_bad_mac: u64,
    pub audio_frames: u64,
    pub av_dropped_on_purpose: u64,
    /// Units the congestion reports covered, lost as seen, and lost as reported.
    pub units_seen: u64,
    pub loss_seen: u64,
    pub loss_reported: u64,
    pub bytes_received: u64,
    pub disconnect_reason: Option<String>,
}

/// Open a stream and run it into `sink` (video, audio, status; pad input back)
/// until the sink stops, `max` time passes, or the console disconnects.
pub fn run_stream(
    host: &str,
    creds: &SessionCreds,
    cfg: StreamConfig,
    max: Duration,
    sink: &mut impl StreamSink,
) -> Result<StreamReport> {
    // Readiness without touching the Remote Play slot (see guard.rs).
    guard::prepare(host, creds, cfg.wake, Duration::from_secs(60))?;
    let nonce = match session_init(host, &creds.regist_key) {
        Ok(n) => n,
        Err(e) if format!("{e:#}").contains(guard::REASON_IN_USE) => {
            guard::hold_off(host, guard::IN_USE_BACKOFF);
            return Err(guard::NotReady::Busy(guard::IN_USE_BACKOFF).into());
        }
        Err(e) => return Err(e),
    };
    // From here the console holds a slot for us: whatever happens next, do
    // not ask again until it has had time to let go.
    let _release = ReleaseHold {
        host: host.to_string(),
        clean: std::cell::Cell::new(false),
    };
    sink.progress(Progress::Nonce);
    let (ctrl, session_id, brt, amb) = ctrl_open(host, creds, &nonce, cfg.codec)?;
    sink.progress(Progress::SessionId);

    let mut takion = Takion::connect(resolve(host, STREAM_PORT)?)?;
    sink.progress(Progress::TakionConnected);

    let mut handshake_key = [0u8; HANDSHAKE_KEY_SIZE];
    getrandom::fill(&mut handshake_key).map_err(|e| anyhow!("random: {e}"))?;
    let ecdh = Ecdh::new()?;
    let (pub_key, sig) = ecdh.public_key_and_sig(&handshake_key);

    // The launch spec is XORed with the ctrl cipher's keystream at counter 0
    // (chiaki encrypts zeros, then XORs), NUL terminator included.
    let mut spec = launch_spec(&cfg, &handshake_key).into_bytes();
    spec.push(0);
    let ks = auth_encrypt(&brt, &amb, 0, &vec![0u8; spec.len()]);
    for (b, k) in spec.iter_mut().zip(ks) {
        *b ^= k;
    }
    let spec_b64 = b64(&spec);
    let big = proto::big(&proto::Big {
        client_version: TAKION_VERSION_PS5,
        session_key: &session_id,
        launch_spec_b64: &spec_b64,
        ecdh_pub_key: &pub_key,
        ecdh_sig: &sig,
    });
    takion.send_message(1, &big)?;

    let mut report = StreamReport::default();
    let mut early_streaminfo: Option<Vec<u8>> = None;
    let mut have_bang = false;
    let mut stream_info: Option<proto::StreamInfo> = None;
    let deadline = Instant::now() + Duration::from_secs(10);
    while stream_info.is_none() {
        if Instant::now() > deadline {
            bail!(if have_bang {
                "the console never sent STREAMINFO"
            } else {
                "the console never answered BIG with BANG"
            });
        }
        if have_bang {
            if let Some(buf) = early_streaminfo.take() {
                if let Message::StreamInfo(si) = proto::decode(&buf)? {
                    stream_info = Some(si);
                    continue;
                }
            }
        }
        let Some(ev) = takion.poll(Duration::from_millis(200))? else {
            continue;
        };
        let Event::Data(buf) = ev else { continue };
        match proto::decode(&buf)? {
            Message::Bang(b) if !have_bang => {
                if !b.version_accepted {
                    bail!("the console did not accept Takion version {TAKION_VERSION_PS5}");
                }
                if !b.encrypted_key_accepted {
                    bail!("the console did not accept our key");
                }
                let secret = ecdh.derive(&b.ecdh_pub_key, &b.ecdh_sig, &handshake_key)?;
                takion.gk_local = Some(GkCrypt::new(2, &handshake_key, &secret));
                takion.gk_remote = Some(GkCrypt::new(3, &handshake_key, &secret));
                have_bang = true;
                sink.progress(Progress::Bang);
            }
            Message::StreamInfo(si) if have_bang => stream_info = Some(si),
            Message::StreamInfo(_) => early_streaminfo = Some(buf),
            Message::Disconnect(r) => bail!("the console ended the stream: {r}"),
            _ => {}
        }
    }
    let si = stream_info.unwrap();
    report.resolutions = si.resolutions.iter().map(|r| (r.width, r.height)).collect();
    sink.progress(Progress::StreamInfo(report.resolutions.clone()));
    takion.send_message(9, &proto::bare(proto::kind::STREAMINFOACK))?;
    takion.send_message(1, &proto::controller_connection())?;
    if !si.audio_header.is_empty() {
        sink.audio(&si.audio_header, true);
    }
    let mut audio = AudioAssembler::default();

    let mut assembler = FrameAssembler::new();
    let mut profile: Option<u8> = None;
    let mut first_frame = true;
    let started = Instant::now();
    let mut last_heartbeat = Instant::now();
    let mut feedback = FeedbackSender::new();
    let mut reorder = VideoReorder::default();
    let mut last_congestion = Instant::now();
    let mut last_idr: Option<Instant> = None;
    let (mut state_seq, mut history_seq) = (0u16, 0u16);
    let result = loop {
        if started.elapsed() > max || sink.stopped() {
            break Ok(());
        }
        if last_heartbeat.elapsed() >= Duration::from_secs(1) {
            last_heartbeat = Instant::now();
            takion.send_message(1, &proto::bare(proto::kind::HEARTBEAT))?;
        }
        if let Some(pad) = sink.input() {
            feedback.set(pad);
        }
        for pkt in feedback.tick(Instant::now()) {
            match pkt {
                feedback::Packet::State(p) => {
                    takion.send_feedback(6, state_seq, 1, &p)?;
                    state_seq = state_seq.wrapping_add(1);
                }
                feedback::Packet::History(n, p) => {
                    takion.send_feedback(1, history_seq, n, &p)?;
                    history_seq = history_seq.wrapping_add(1);
                }
            }
        }
        // Every 200 ms: what arrived and what did not (chiaki's congestion
        // control). Reported loss is capped at 5%, as chiaki does by default:
        // the console cuts its bitrate on what it is told.
        if last_congestion.elapsed() >= Duration::from_millis(200) {
            last_congestion = Instant::now();
            let (vr, vl) = assembler.take_generation();
            let (ar, al) = audio.take_seq();
            let (mut received, mut lost) = (vr + ar, vl + al);
            let total = received + lost;
            if total > 0 && lost * 100 > total * 5 {
                lost = total * 5 / 100;
                received = total - lost;
            }
            report.loss_reported += lost;
            report.loss_seen += vl + al;
            report.units_seen += total;
            takion.send_congestion(
                received.min(u16::MAX as u64) as u16,
                lost.min(u16::MAX as u64) as u16,
            )?;
        }
        // Video packets in order (late ones waited for briefly) into frames.
        let mut stop = false;
        for p in reorder.pull(Instant::now()) {
            for out in assembler.push(&p) {
                match out {
                    video::Output::Frame(frame) => {
                        if first_frame {
                            first_frame = false;
                            sink.progress(Progress::FirstFrame(frame.len()));
                        }
                        if !sink.video(&frame, false) {
                            stop = true;
                        }
                    }
                    video::Output::Lost { from, to } => {
                        // Tell the console which frames are gone, and ask for a
                        // keyframe so the picture repairs itself quickly.
                        takion.send_message(2, &proto::corrupt_frame(from, to))?;
                        if last_idr
                            .is_none_or(|t: Instant| t.elapsed() > Duration::from_millis(500))
                        {
                            last_idr = Some(Instant::now());
                            takion.send_message(2, &proto::bare(proto::kind::IDRREQUEST))?;
                        }
                    }
                }
            }
        }
        if stop {
            break Ok(());
        }
        // Short waits: input is polled between packets, and video packets
        // arrive every few milliseconds anyway.
        let ev = match takion.poll(Duration::from_millis(4)) {
            Ok(Some(ev)) => ev,
            Ok(None) => continue,
            Err(e) => break Err(e),
        };
        match ev {
            Event::Data(buf) => {
                if let Ok(Message::Disconnect(r)) = proto::decode(&buf) {
                    report.disconnect_reason = Some(r);
                    break Ok(());
                }
            }
            Event::Av(p) if p.is_video => {
                // The codec header goes out before the first frame of each profile.
                if profile != Some(p.adaptive_stream_index) {
                    let Some(r) = si.resolutions.get(p.adaptive_stream_index as usize) else {
                        continue;
                    };
                    profile = Some(p.adaptive_stream_index);
                    if !sink.video(&r.video_header, true) {
                        break Ok(());
                    }
                }
                reorder.push(p);
            }
            Event::Av(p) => {
                for (idx, frame) in audio.push(&p) {
                    let mut f = Vec::with_capacity(2 + frame.len());
                    f.extend_from_slice(&idx.to_be_bytes());
                    f.extend_from_slice(&frame);
                    if !sink.audio(&f, false) {
                        break;
                    }
                }
            }
        }
    };
    // Clean stop, in chiaki's order: DISCONNECT over Takion, then close ctrl.
    takion.close();
    drop(ctrl);
    _release.clean.set(true);
    report.video = assembler.stats;
    report.av_packets = takion.av_received;
    report.av_bad_mac = takion.av_bad_mac;
    report.audio_frames = audio.frames;
    report.av_dropped_on_purpose = takion.av_dropped_on_purpose;
    report.bytes_received = takion.bytes_received;
    result.map(|_| report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_spec_is_valid_json() {
        let s = launch_spec(&StreamConfig::default(), &[0u8; 16]);
        let v: serde_json::Value = serde_json::from_str(&s).unwrap();
        assert_eq!(v["videoCodec"], "avc");
        assert_eq!(v["network"]["mtu"], 1454);
        assert_eq!(v["streamResolutions"][0]["resolution"]["width"], 1280);
    }
}
