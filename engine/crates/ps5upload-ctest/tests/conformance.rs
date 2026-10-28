#![cfg(unix)]
//! The payload's application messages (`protocol/ps5upload-ava1/app.toml`): the generated C
//! (`payload/gen/ava1_app_gen.c`) and the generated Rust (`ps5upload_ava1::app_gen`) must agree byte
//! for byte. The core messages are the AVA1 library's own conformance test
//! (`third_party/ava1/crates/ava1-ctest/tests/conformance.rs`).
use ava1::wire::SplitMix;
use ps5upload_ava1::app_gen::conformance as app;
use ps5upload_ctest::*;

fn rust_roundtrip(name: &str, b: &[u8]) -> Result<Vec<u8>, String> {
    app::roundtrip(name, b).unwrap_or_else(|| panic!("Rust knows no app message {name}"))
}

#[test]
fn c_and_rust_know_the_same_app_messages() {
    let rust: Vec<String> = app::ALL.iter().map(|s| s.to_string()).collect();
    assert_eq!(c_app_message_names(), rust);
}

#[test]
fn golden_app_vectors_round_trip_in_c_and_rust() {
    let mut n = 0;
    for l in include_str!("../../../../protocol/ps5upload-ava1/vectors/messages.txt").lines() {
        if l.starts_with('#') || l.trim().is_empty() {
            continue;
        }
        let (name, h) = l.split_once(' ').unwrap();
        let b = ava1::hex::decode(h).unwrap();
        assert_eq!(c_app_roundtrip(name, &b), Ok(b.clone()), "C {name}");
        assert_eq!(rust_roundtrip(name, &b), Ok(b.clone()), "Rust {name}");
        n += 1;
    }
    assert!(n > 0, "no app vectors");
}

#[test]
fn rust_app_samples_round_trip_in_c() {
    let mut rng = SplitMix(42);
    for _ in 0..500 {
        for name in app::ALL {
            let b = app::sample(name, &mut rng).unwrap();
            assert_eq!(c_app_roundtrip(name, &b), Ok(b.clone()), "{name}");
        }
    }
}

#[test]
fn c_and_rust_agree_on_app_garbage() {
    // Random bytes: both sides must accept exactly the same inputs; re-encodings are compared on
    // canonical bytes (SPEC.md §3), as in the core test.
    let mut rng = SplitMix(9);
    for _ in 0..20_000 {
        let name = app::ALL[rng.below(app::ALL.len() as u64) as usize];
        let n = rng.below(120) as usize;
        let mut b = vec![0u8; n];
        rng.fill(&mut b);
        let rust = rust_roundtrip(name, &b);
        let c = c_app_roundtrip(name, &b);
        assert_eq!(rust.is_ok(), c.is_ok(), "{name} {}", ava1::hex::encode(&b));
        if let Ok(r) = rust {
            assert_eq!(
                c_app_roundtrip(name, &r),
                Ok(r.clone()),
                "C must reproduce Rust's canonical bytes: {name} {}",
                ava1::hex::encode(&r)
            );
        }
        if let Ok(c) = c {
            assert_eq!(
                c_app_roundtrip(name, &c),
                Ok(c.clone()),
                "re-encoding twice changes nothing: {name}"
            );
        }
    }
}

/// A sample with one bit flipped, truncated, or with bytes appended.
fn mutate(b: &[u8], rng: &mut SplitMix) -> Vec<u8> {
    let mut m = b.to_vec();
    match rng.below(3) {
        0 if !m.is_empty() => {
            let i = rng.below(m.len() as u64) as usize;
            m[i] ^= 1 << rng.below(8);
        }
        1 => m.truncate(rng.below(m.len() as u64 + 1) as usize),
        _ => {
            let mut x = vec![0u8; 1 + rng.below(8) as usize];
            rng.fill(&mut x);
            m.extend(x);
        }
    }
    m
}

#[test]
fn c_and_rust_agree_on_mutated_app_messages() {
    let mut rng = SplitMix(77);
    let (mut total, mut accepted) = (0usize, 0usize);
    for _ in 0..800 {
        for name in app::ALL {
            let m = mutate(&app::sample(name, &mut rng).unwrap(), &mut rng);
            let rust = rust_roundtrip(name, &m);
            let c = c_app_roundtrip(name, &m);
            assert_eq!(rust.is_ok(), c.is_ok(), "{name} {}", ava1::hex::encode(&m));
            if let Ok(r) = rust {
                assert_eq!(c_app_roundtrip(name, &r), Ok(r.clone()), "{name}");
                accepted += 1;
            }
            total += 1;
        }
    }
    assert!(
        accepted > total / 20,
        "mutations too destructive: {accepted}/{total}"
    );
}
