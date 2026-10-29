//! The helper's side of the pipe protocol, driven the way the engine drives it.
//! (Having an integration test also makes `cargo test` build the binary, which the
//! engine's RAR tests start from the target directory.)
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};

fn fixture(name: &str) -> String {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../ps5upload-core/testdata/rar")
        .join(name)
        .to_string_lossy()
        .into_owned()
}

fn frame(r: &mut impl Read) -> (u8, Vec<u8>) {
    let mut hdr = [0u8; 5];
    r.read_exact(&mut hdr).unwrap();
    let len = u32::from_le_bytes(hdr[1..].try_into().unwrap()) as usize;
    let mut body = vec![0u8; len];
    r.read_exact(&mut body).unwrap();
    (hdr[0], body)
}

fn json(b: &[u8]) -> serde_json::Value {
    serde_json::from_slice(b).unwrap()
}

fn start(req: serde_json::Value) -> std::process::Child {
    let mut child = Command::new(env!("CARGO_BIN_EXE_ps5upload-unrar"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let stdin = child.stdin.as_mut().unwrap();
    writeln!(stdin, "{req}").unwrap();
    stdin.flush().unwrap();
    child
}

#[test]
fn lists_headers_then_ends() {
    let mut child = start(serde_json::json!({
        "op": "list", "path": fixture("crypted.rar"), "password": null
    }));
    let mut out = child.stdout.take().unwrap();
    let (tag, body) = frame(&mut out);
    assert_eq!(tag, b'O');
    assert_eq!(json(&body)["solid"], false);
    let mut names = Vec::new();
    loop {
        let (tag, body) = frame(&mut out);
        match tag {
            b'H' => names.push(json(&body)["name"].as_str().unwrap().to_owned()),
            b'Z' => break,
            other => panic!("unexpected frame {}", other as char),
        }
    }
    assert!(names.iter().any(|n| n == ".gitignore"), "{names:?}");
    assert!(child.wait().unwrap().success());
}

#[test]
fn walk_decodes_the_entry_it_is_told_to() {
    let mut child = start(serde_json::json!({
        "op": "walk", "path": fixture("crypted.rar"), "password": "unrar"
    }));
    let mut out = child.stdout.take().unwrap();
    let mut stdin = child.stdin.take().unwrap();
    assert_eq!(frame(&mut out).0, b'O');
    loop {
        let (tag, body) = frame(&mut out);
        assert_eq!(tag, b'H');
        let h = json(&body);
        if h["name"] != ".gitignore" {
            stdin.write_all(b"S").unwrap();
            stdin.flush().unwrap();
            assert_eq!(frame(&mut out).0, b'E');
            continue;
        }
        stdin.write_all(b"R").unwrap();
        stdin.flush().unwrap();
        let mut data = Vec::new();
        loop {
            match frame(&mut out) {
                (b'D', b) => data.extend_from_slice(&b),
                (b'E', _) => break,
                (t, b) => panic!("unexpected frame {} {:?}", t as char, json(&b)),
            }
        }
        assert_eq!(data, b"target\nCargo.lock\n");
        break;
    }
    drop(stdin); // end of input ends the walk
    assert!(child.wait().unwrap().success());
}

#[test]
fn a_missing_password_is_reported_by_code() {
    let mut child = start(serde_json::json!({
        "op": "list", "path": fixture("comment-hpw-password.rar"), "password": null
    }));
    let mut out = child.stdout.take().unwrap();
    // Opening succeeds; the first (encrypted) header is what needs the password.
    let (mut tag, mut body) = frame(&mut out);
    if tag == b'O' {
        (tag, body) = frame(&mut out);
    }
    assert_eq!(tag, b'X');
    assert_eq!(json(&body)["code"], "MissingPassword");
    let _ = child.wait();
}
