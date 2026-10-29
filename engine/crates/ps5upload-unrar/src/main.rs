//! `ps5upload-unrar`: reads RAR archives for the ps5upload engine, as a separate program.
//!
//! The engine starts this program for every RAR operation and talks to it over its
//! stdin/stdout (`ps5upload-core/src/rar_helper.rs` is the other end). Everything about
//! which entries to deliver, path safety, exclusions and error wording stays in the
//! engine; this program only opens the archive, reports headers and decodes or skips
//! the entry it is told to.
//!
//! Protocol (all integers little-endian):
//!
//! 1. The engine writes ONE request line to stdin, JSON:
//!    `{"op":"list"|"walk","path":"…","password":null|"…"}`. The password travels only
//!    here, never in argv or the environment, and is never printed.
//! 2. This program answers with frames on stdout: a tag byte, a u32 payload length,
//!    the payload.
//!    - `O` the archive opened: JSON `{"solid":bool}`
//!    - `H` an entry header: JSON `{"name","size","time","dir","encrypted","split_before"}`
//!    - `D` decoded bytes of the current entry (at most 1 MiB per frame)
//!    - `N` a u64: bytes decoded and discarded
//!    - `E` the current entry is done
//!    - `X` UnRAR failed: JSON `{"code","message"}`; nothing follows
//!    - `Z` the end of the archive; nothing follows
//! 3. `list` sends `O`, every header (`H`), then `Z` (or `X` at any point).
//!    `walk` sends `O`, then for each entry an `H` and waits for one command byte on
//!    stdin: `S` skip it, `R` decode it as `D` frames, `C` decode it and report only
//!    sizes (`N` frames); each ends in `E` (or `X`). Then the next `H`, or `Z`.
//!    End of stdin (or `Q`) ends the walk.
//!
//! The pipe is the backpressure: a decode blocks while the engine is not reading. The
//! engine stops a walk early by killing this process.
//!
//! REQUIRED UnRAR NOTICE (UnRAR license, paragraph 2 — reproduced verbatim, as the
//! license mandates it appear "in source code comments of resulting package"):
//!   UnRAR source code may be used in any software to handle RAR archives
//!   without limitations free of charge, but cannot be used to develop RAR
//!   (WinRAR) compatible archiver and to re-create RAR compression algorithm,
//!   which is proprietary. Distribution of modified UnRAR source code in
//!   separate form or as a part of other software is permitted, provided that
//!   full text of this paragraph, starting from "UnRAR source code" words, is
//!   included in license, or in documentation if license is not available, and
//!   in source code comments of resulting package.
//!
//! ps5upload uses UnRAR ONLY to extract; it never compresses RAR. This program holds
//! only ps5upload's own code (GPL-3.0-or-later, with the GPLv3 §7 permission in
//! LICENSES/UnRAR-exception.md) and UnRAR (LICENSES/UnRAR-license.txt).

use std::io::{self, BufRead, BufReader, BufWriter, Read, Write};

use serde::{Deserialize, Serialize};
use unrar::error::UnrarError;
use unrar::{Archive, FileHeader};

/// Largest `D` frame payload.
const MAX_DATA_FRAME: usize = 1 << 20;

#[derive(Deserialize)]
struct Request {
    op: String,
    path: String,
    password: Option<String>,
}

#[derive(Serialize)]
struct Opened {
    solid: bool,
}

#[derive(Serialize)]
struct Header<'a> {
    name: &'a str,
    size: u64,
    time: u32,
    dir: bool,
    encrypted: bool,
    split_before: bool,
}

#[derive(Serialize)]
struct Failure<'a> {
    code: &'a str,
    message: &'a str,
}

/// Frames to stdout. A write that fails means the engine went away: everything after
/// it is dropped and the program ends quietly.
struct Out<W: Write> {
    w: W,
    broken: bool,
}

impl<W: Write> Out<W> {
    fn frame(&mut self, tag: u8, payload: &[u8]) -> bool {
        if self.broken {
            return false;
        }
        let len = u32::try_from(payload.len()).expect("frame payload fits in u32");
        let ok = self.w.write_all(&[tag]).is_ok()
            && self.w.write_all(&len.to_le_bytes()).is_ok()
            && self.w.write_all(payload).is_ok();
        self.broken = !ok;
        ok
    }

    fn json<T: Serialize>(&mut self, tag: u8, v: &T) -> bool {
        let body = serde_json::to_vec(v).expect("serializable frame");
        self.frame(tag, &body)
    }

    fn flush(&mut self) -> bool {
        if !self.broken && self.w.flush().is_err() {
            self.broken = true;
        }
        !self.broken
    }

    fn header(&mut self, h: &FileHeader) -> bool {
        let name = h.filename.to_string_lossy();
        self.json(
            b'H',
            &Header {
                name: &name,
                size: h.unpacked_size,
                time: h.file_time,
                dir: h.is_directory(),
                encrypted: h.is_encrypted(),
                split_before: h.is_split_before(),
            },
        )
    }

    fn fail(&mut self, e: &UnrarError) {
        let code = format!("{:?}", e.code);
        let message = e.to_string();
        self.fail_with(&code, &message);
    }

    fn fail_with(&mut self, code: &str, message: &str) {
        self.json(b'X', &Failure { code, message });
        self.flush();
    }

    fn data(&mut self, bytes: &[u8]) -> bool {
        bytes.chunks(MAX_DATA_FRAME).all(|c| self.frame(b'D', c))
    }
}

// UnRAR's Windows code calls the registry, token and crypto functions in advapi32. The engine
// used to pull that library in through its other dependencies; this program has none of them,
// so it names it itself.
#[cfg(windows)]
#[link(name = "advapi32")]
extern "system" {}

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--version") {
        println!("ps5upload-unrar {}", env!("CARGO_PKG_VERSION"));
        return;
    }
    let mut input = BufReader::new(io::stdin().lock());
    let mut out = Out {
        w: BufWriter::with_capacity(MAX_DATA_FRAME + 64, io::stdout().lock()),
        broken: false,
    };
    let mut line = String::new();
    if input.read_line(&mut line).unwrap_or(0) == 0 {
        let _ = writeln!(
            io::stderr(),
            "ps5upload-unrar: expects a request on stdin; it is started by the ps5upload engine"
        );
        std::process::exit(2);
    }
    let req: Request = match serde_json::from_str(&line) {
        Ok(r) => r,
        Err(e) => {
            out.fail_with("Request", &format!("bad request: {e}"));
            std::process::exit(2);
        }
    };
    // UnRAR takes the password as a C string; one with a NUL in it cannot be passed on.
    if req.password.as_deref().is_some_and(|p| p.contains('\0')) {
        out.fail_with("BadPassword", "Wrong password was specified");
        return;
    }
    match req.op.as_str() {
        "list" => list(&req, &mut out),
        "walk" => walk(&req, &mut input, &mut out),
        other => out.fail_with("Request", &format!("unknown op {other:?}")),
    }
    out.flush();
}

fn archive(req: &Request) -> Archive<'_> {
    match &req.password {
        Some(pw) => Archive::with_password(&req.path, pw),
        None => Archive::new(&req.path),
    }
}

fn list<W: Write>(req: &Request, out: &mut Out<W>) {
    let open = match archive(req).open_for_listing() {
        Ok(o) => o,
        Err(e) => return out.fail(&e),
    };
    out.json(
        b'O',
        &Opened {
            solid: open.is_solid(),
        },
    );
    for entry in open {
        match entry {
            Ok(h) => {
                if !out.header(&h) {
                    return;
                }
            }
            Err(e) => return out.fail(&e),
        }
    }
    out.frame(b'Z', &[]);
}

fn walk<R: Read, W: Write>(req: &Request, input: &mut R, out: &mut Out<W>) {
    let mut open = match archive(req).open_for_processing() {
        Ok(o) => o,
        Err(e) => return out.fail(&e),
    };
    out.json(
        b'O',
        &Opened {
            solid: open.is_solid(),
        },
    );
    loop {
        let header = match open.read_header() {
            Ok(Some(h)) => h,
            Ok(None) => {
                out.frame(b'Z', &[]);
                return;
            }
            Err(e) => return out.fail(&e),
        };
        if !out.header(header.entry()) || !out.flush() {
            return;
        }
        let mut cmd = [0u8; 1];
        if input.read_exact(&mut cmd).is_err() {
            return; // the engine is done with this archive
        }
        let next = match cmd[0] {
            b'S' => header.skip(),
            // Each piece is flushed as it is produced, so the engine sees progress (and
            // can stop the decode) while a long entry is still being decoded.
            b'R' => header.read_to_fn(&mut |b: &[u8]| out.data(b) && out.flush()),
            b'C' => header.read_to_fn(&mut |b: &[u8]| {
                out.frame(b'N', &(b.len() as u64).to_le_bytes()) && out.flush()
            }),
            b'Q' => return,
            other => {
                return out.fail_with("Request", &format!("unknown command {other:#04x}"));
            }
        };
        if out.broken {
            return;
        }
        match next {
            Ok(n) => {
                if !out.frame(b'E', &[]) {
                    return;
                }
                open = n;
            }
            Err(e) => return out.fail(&e),
        }
    }
}
