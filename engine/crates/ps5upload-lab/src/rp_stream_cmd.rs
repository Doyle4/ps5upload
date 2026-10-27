//! `rp-stream <creds.json> <out> [seconds] [h264|h265] [WxH]`: open a Remote
//! Play stream with a paired console and write its video (Annex-B) to a file,
//! timing each milestone. `creds.json` is `{"<host>": {"regist_key": hex32,
//! "rp_key": hex32}}`; the keys are never printed.

use std::io::Write as _;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Result};
use ps5upload_core::rp_session::SessionCreds;
use ps5upload_core::rp_stream::{run_stream, Codec, Progress, StreamConfig};

pub fn run(host: &str, args: &[String]) -> Result<()> {
    let creds_path = args.first().ok_or_else(|| anyhow!("need creds.json"))?;
    let out_path = args.get(1).ok_or_else(|| anyhow!("need an output file"))?;
    let secs: u64 = args.get(2).map(|s| s.parse()).transpose()?.unwrap_or(10);
    let mut cfg = StreamConfig::default();
    if args.get(3).map(String::as_str) == Some("h265") {
        cfg.codec = Codec::H265;
    }
    if let Some((w, h)) = args.get(4).and_then(|s| s.split_once('x')) {
        cfg.width = w.parse()?;
        cfg.height = h.parse()?;
        if cfg.height >= 1080 {
            cfg.bitrate_kbps = 15000;
        }
    }
    let all: serde_json::Value = serde_json::from_slice(&std::fs::read(creds_path)?)?;
    let c = &all[host];
    let creds = SessionCreds::from_hex(
        c["regist_key"].as_str().unwrap_or(""),
        c["rp_key"].as_str().unwrap_or(""),
    )?;
    let mut out = std::fs::File::create(out_path)?;
    let t0 = Instant::now();
    let mut units = 0u64;
    let report = run_stream(
        host,
        &creds,
        cfg,
        Duration::from_secs(secs),
        |p| {
            let ms = t0.elapsed().as_millis();
            match p {
                Progress::Nonce => eprintln!("[{ms:>6} ms] session-init: nonce"),
                Progress::SessionId => eprintln!("[{ms:>6} ms] ctrl: session id"),
                Progress::TakionConnected => eprintln!("[{ms:>6} ms] takion: connected"),
                Progress::Bang => eprintln!("[{ms:>6} ms] stream: BANG, crypt on"),
                Progress::StreamInfo(r) => eprintln!("[{ms:>6} ms] stream: STREAMINFO {r:?}"),
                Progress::FirstFrame(n) => eprintln!("[{ms:>6} ms] video: first frame ({n} bytes)"),
            }
        },
        |au| {
            units += 1;
            out.write_all(au).is_ok()
        },
    )?;
    let secs_f = t0.elapsed().as_secs_f64();
    eprintln!(
        "done in {secs_f:.1}s: {} frames ({} dropped), {:.1} MB video, {} AV packets ({} bad MAC), \
         {:.1} Mbit/s on the wire, disconnect: {:?}",
        report.video.frames,
        report.video.frames_dropped,
        report.video.bytes as f64 / 1e6,
        report.av_packets,
        report.av_bad_mac,
        report.bytes_received as f64 * 8.0 / 1e6 / secs_f,
        report.disconnect_reason
    );
    eprintln!("{units} access units written to {out_path}");
    Ok(())
}
