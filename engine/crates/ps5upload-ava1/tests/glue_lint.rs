//! The payload's AVA1 glue (payload/src/ava1_glue.c) under the AVA1 library's C rules: no wall
//! clock for timing (a settimeofday once looked like a resume and woke the wake watchdog, #289),
//! the spec's liveness defaults, and counters that are only incremented.
use std::path::Path;

fn root() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

#[test]
fn the_glue_uses_only_monotonic_clocks() {
    for p in ["payload/src/ava1_glue.c", "payload/include/ava1_glue.h"] {
        let src = std::fs::read_to_string(root().join(p)).unwrap();
        for bad in ["gettimeofday", "CLOCK_REALTIME", "clock_settime", "ftime("] {
            let hit = src.match_indices(bad).any(|(i, _)| {
                i == 0
                    || !src.as_bytes()[i - 1].is_ascii_alphanumeric()
                        && src.as_bytes()[i - 1] != b'_'
            });
            assert!(!hit, "{p} uses {bad}; use CLOCK_MONOTONIC");
        }
    }
}

/// The console's liveness defaults must match the engine's (`Timing::default`, the AVA1 spec
/// section 6): a 2 s ping and a 12 s verdict. The glue file is not built on the host, so its text
/// is checked.
#[test]
fn the_payload_glue_uses_the_spec_liveness_defaults() {
    let glue = std::fs::read_to_string(root().join("payload/src/ava1_glue.c")).unwrap();
    assert!(glue.contains("cfg.ping_every_ms = 2000;"), "ping is 2 s");
    assert!(
        glue.contains("cfg.dead_after_ms = 12000;"),
        "dead verdict is 12 s"
    );
}

/// A connection's send/recv counter is written only at its increment: the glue may not assign it.
#[test]
fn the_glue_never_assigns_a_counter() {
    let src = std::fs::read_to_string(root().join("payload/src/ava1_glue.c")).unwrap();
    for (n, line) in src.lines().enumerate() {
        for f in ["send_ctr", "recv_ctr"] {
            if let Some(i) = line.find(f) {
                let rest = line[i + f.len()..].trim_start();
                let op = rest.trim_start_matches(['+', '-', '*', '/', '|', '&', '^']);
                let compound = op.len() != rest.len() && op.starts_with('=');
                let writes = compound || (rest.starts_with("= ") && !rest.starts_with("== "));
                assert!(!writes, "ava1_glue.c:{} assigns {f}: {line}", n + 1);
            }
        }
    }
}
