//! What one Mesh Drive sync pass does (8.0.0), decided without touching a disk: a three-way
//! comparison of a member folder and the drive's home folder on the console (the hub) against what
//! the two last agreed on (the base).
//!
//! A side "changed" a file when its size or modification time differs from what that side had at
//! the last agreement (each side's own time: the two clocks are never compared). Then:
//! * changed on one side only: it is copied to the other;
//! * changed on both: a conflict, both kept (the member's copy is renamed, the hub's comes over),
//!   unless the two hold the same bytes (same size: the executor compares hashes, `Compare`);
//! * gone from one side and unchanged on the other: deleted there too (into the trash);
//! * gone from one side but changed on the other: the change wins, it is copied back;
//! * new on both: the same, if their bytes are (same size, then hashes); else a conflict.
use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

/// A file as one side lists it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Meta {
    pub size: u64,
    pub mtime: i64,
}

/// What the two sides last agreed on for one path: each side's own view of the file then.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BaseEntry {
    pub m: Meta,
    pub h: Meta,
}

pub type Listing = BTreeMap<String, Meta>;
pub type Base = BTreeMap<String, BaseEntry>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Op {
    /// Member -> hub.
    Upload(String),
    /// Hub -> member.
    Download(String),
    /// Into the member's trash.
    DeleteMember(String),
    /// Into the hub's trash.
    DeleteHub(String),
    /// Both changed: the member's copy is renamed, then the hub's is downloaded.
    Conflict(String),
    /// Changed (or new) on both with the same size: the same file if their hashes match, a
    /// conflict otherwise. Two different edits of a fixed-size file (a save) must not pass for one.
    Compare(String),
    /// Gone from both: forget it.
    Forget(String),
}

impl Op {
    pub fn path(&self) -> &str {
        match self {
            Op::Upload(p)
            | Op::Download(p)
            | Op::DeleteMember(p)
            | Op::DeleteHub(p)
            | Op::Conflict(p)
            | Op::Compare(p)
            | Op::Forget(p) => p,
        }
    }
    pub fn is_delete(&self) -> bool {
        matches!(self, Op::DeleteMember(_) | Op::DeleteHub(_))
    }
}

pub fn plan(member: &Listing, hub: &Listing, base: &Base) -> Vec<Op> {
    let paths: BTreeSet<&String> = member.keys().chain(hub.keys()).chain(base.keys()).collect();
    let mut ops = Vec::new();
    for p in paths {
        let (m, h, b) = (member.get(p), hub.get(p), base.get(p));
        let op = match (m, h, b) {
            (Some(_), None, None) => Op::Upload(p.clone()),
            (None, Some(_), None) => Op::Download(p.clone()),
            (Some(m), Some(h), None) => {
                if m.size == h.size {
                    Op::Compare(p.clone())
                } else {
                    Op::Conflict(p.clone())
                }
            }
            (Some(m), Some(h), Some(b)) => match (*m != b.m, *h != b.h) {
                (false, false) => continue,
                (true, false) => Op::Upload(p.clone()),
                (false, true) => Op::Download(p.clone()),
                (true, true) => {
                    if m.size == h.size {
                        Op::Compare(p.clone())
                    } else {
                        Op::Conflict(p.clone())
                    }
                }
            },
            (Some(m), None, Some(b)) => {
                if *m != b.m {
                    Op::Upload(p.clone()) // edited here after it was deleted there: keep the edit
                } else {
                    Op::DeleteMember(p.clone())
                }
            }
            (None, Some(h), Some(b)) => {
                if *h != b.h {
                    Op::Download(p.clone())
                } else {
                    Op::DeleteHub(p.clone())
                }
            }
            (None, None, Some(_)) => Op::Forget(p.clone()),
            (None, None, None) => continue,
        };
        ops.push(op);
    }
    ops
}

/// Too many deletes for one pass to do on its own: more than `MASS_DELETE_MIN` files and more
/// than a tenth of what the drive held. Usually a folder that was moved or a drive half-unmounted,
/// so a person confirms first.
pub const MASS_DELETE_MIN: usize = 50;

pub fn too_many_deletes(ops: &[Op], base_len: usize) -> bool {
    let n = ops.iter().filter(|o| o.is_delete()).count();
    n > MASS_DELETE_MIN && n * 10 > base_len
}

/// Names a sync never touches: its own markers and trash, half-written files, the clutter
/// operating systems leave.
pub fn ignored(name: &str) -> bool {
    name == MARKER
        || name == TRASH
        || name == TMP
        || name == BASE_FILE
        || name == ".DS_Store"
        || name == "Thumbs.db"
        || name == "desktop.ini"
        || name.starts_with("._")
        || name.ends_with(".partial")
        || name.ends_with(".ps5upload-tmp")
        // An upload to the console still under way (or cut off): never a file of the drive.
        || name.ends_with(".ava-part")
}

/// The file at a member folder's and the hub's root that says "this is the drive". Missing:
/// the folder is offline (an unplugged drive, an unmounted share), never "everything deleted".
pub const MARKER: &str = ".ps5upload-mesh";
pub const TRASH: &str = ".ps5upload-trash";
pub const TMP: &str = ".ps5upload-mesh-tmp";
/// A console member's base (what its folder and the hub last agreed on), kept in that folder so
/// any engine can run its pass (8.1.0).
pub const BASE_FILE: &str = ".ps5upload-mesh-base";

/// "photo (conflict from Pixel 2026-10-25 1405).jpg"
pub fn conflict_name(path: &str, device: &str, stamp: &str) -> String {
    let (dir, file) = match path.rfind('/') {
        Some(i) => (&path[..=i], &path[i + 1..]),
        None => ("", path),
    };
    let device: String = device
        .chars()
        .map(|c| {
            if c == '/' || c == '\\' || c.is_control() {
                '-'
            } else {
                c
            }
        })
        .take(40)
        .collect();
    let tag = format!(" (conflict from {device} {stamp})");
    match file.rfind('.') {
        Some(i) if i > 0 => format!("{dir}{}{tag}{}", &file[..i], &file[i..]),
        _ => format!("{dir}{file}{tag}"),
    }
}

/// A conflict copy's name taken apart: the file it is a copy of, the device that made it, and
/// when (`YYYY-MM-DD HHMM`). None for any other name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConflictName {
    pub original: String,
    pub device: String,
    pub stamp: String,
}

pub fn parse_conflict(path: &str) -> Option<ConflictName> {
    let (dir, file) = match path.rfind('/') {
        Some(i) => (&path[..=i], &path[i + 1..]),
        None => ("", path),
    };
    let start = file.rfind(" (conflict from ")?;
    let inner_from = start + " (conflict from ".len();
    let close = inner_from + file[inner_from..].find(')')?;
    let inner = &file[inner_from..close];
    // "<device> YYYY-MM-DD HHMM"
    if inner.len() < 16 {
        return None;
    }
    let (device, stamp) = inner.split_at(inner.len() - 15);
    let device = device.strip_suffix(' ')?;
    if !stamp.as_bytes()[..4].iter().all(u8::is_ascii_digit) || stamp.as_bytes()[10] != b' ' {
        return None;
    }
    let mut rest = &file[close + 1..];
    // free_name's " (2)" after a second conflict in the same minute.
    if let Some(r) = rest.strip_prefix(" (") {
        if let Some(end) = r.find(')') {
            if r[..end].bytes().all(|b| b.is_ascii_digit()) && !r[..end].is_empty() {
                rest = &r[end + 1..];
            }
        }
    }
    Some(ConflictName {
        original: format!("{dir}{}{rest}", &file[..start]),
        device: device.to_string(),
        stamp: stamp.to_string(),
    })
}

/// `YYYY-MM-DD` and `YYYY-MM-DD HHMM` (UTC) for a time in seconds since 1970.
pub fn date_parts(secs: i64) -> (String, String) {
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    // Howard Hinnant's days-from-civil, inverted.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    let date = format!("{y:04}-{m:02}-{d:02}");
    let stamp = format!("{date} {:02}{:02}", rem / 3600, (rem % 3600) / 60);
    (date, stamp)
}

#[cfg(test)]
mod tests {

    #[test]
    fn conflict_copies_are_taken_apart() {
        let made = conflict_name("photos/a.jpg", "Pixel 9", "2026-10-25 2112");
        assert_eq!(
            parse_conflict(&made),
            Some(ConflictName {
                original: "photos/a.jpg".into(),
                device: "Pixel 9".into(),
                stamp: "2026-10-25 2112".into(),
            })
        );
        assert_eq!(
            parse_conflict("notes (conflict from Mac 2026-10-25 2112) (2)").map(|c| c.original),
            Some("notes".into())
        );
        assert_eq!(
            parse_conflict("a (conflict from Mac 2026-10-25 2112) (2).txt").map(|c| c.original),
            Some("a.txt".into())
        );
        assert_eq!(parse_conflict("plain.txt"), None);
        assert_eq!(parse_conflict("x (conflict from soon).txt"), None);
    }

    use super::*;

    fn meta(size: u64, mtime: i64) -> Meta {
        Meta { size, mtime }
    }

    fn listing(items: &[(&str, u64, i64)]) -> Listing {
        items
            .iter()
            .map(|(p, s, t)| (p.to_string(), meta(*s, *t)))
            .collect()
    }

    #[test]
    fn new_files_go_to_the_side_that_lacks_them() {
        let ops = plan(
            &listing(&[("a.txt", 1, 10)]),
            &listing(&[("b.txt", 2, 20)]),
            &Base::new(),
        );
        assert_eq!(
            ops,
            vec![Op::Upload("a.txt".into()), Op::Download("b.txt".into())]
        );
    }

    #[test]
    fn a_change_on_one_side_is_copied_and_untouched_files_are_left_alone() {
        let base: Base = [
            (
                "x".to_string(),
                BaseEntry {
                    m: meta(1, 10),
                    h: meta(1, 99),
                },
            ),
            (
                "y".to_string(),
                BaseEntry {
                    m: meta(1, 10),
                    h: meta(1, 99),
                },
            ),
            (
                "z".to_string(),
                BaseEntry {
                    m: meta(1, 10),
                    h: meta(1, 99),
                },
            ),
        ]
        .into();
        let m = listing(&[("x", 2, 11), ("y", 1, 10), ("z", 1, 10)]);
        let h = listing(&[("x", 1, 99), ("y", 3, 100), ("z", 1, 99)]);
        assert_eq!(
            plan(&m, &h, &base),
            vec![Op::Upload("x".into()), Op::Download("y".into())]
        );
    }

    #[test]
    fn both_changed_is_a_conflict_unless_they_ended_up_the_same_size() {
        let base: Base = [
            (
                "c".to_string(),
                BaseEntry {
                    m: meta(1, 10),
                    h: meta(1, 99),
                },
            ),
            (
                "s".to_string(),
                BaseEntry {
                    m: meta(1, 10),
                    h: meta(1, 99),
                },
            ),
        ]
        .into();
        let m = listing(&[("c", 5, 11), ("s", 7, 11)]);
        let h = listing(&[("c", 6, 100), ("s", 7, 100)]);
        assert_eq!(
            plan(&m, &h, &base),
            vec![Op::Conflict("c".into()), Op::Compare("s".into())]
        );
    }

    #[test]
    fn a_delete_travels_unless_the_other_side_changed_the_file() {
        let b = BaseEntry {
            m: meta(1, 10),
            h: meta(1, 99),
        };
        let base: Base = [
            ("gone-here".to_string(), b),
            ("gone-there".to_string(), b),
            ("gone-here-edited-there".to_string(), b),
            ("gone-both".to_string(), b),
        ]
        .into();
        let m = listing(&[("gone-there", 1, 10)]);
        let h = listing(&[("gone-here", 1, 99), ("gone-here-edited-there", 4, 120)]);
        assert_eq!(
            plan(&m, &h, &base),
            vec![
                Op::Forget("gone-both".into()),
                Op::DeleteHub("gone-here".into()),
                Op::Download("gone-here-edited-there".into()),
                Op::DeleteMember("gone-there".into()),
            ]
        );
    }

    #[test]
    fn an_emptied_side_asks_before_deleting_everywhere() {
        let base: Base = (0..200)
            .map(|i| {
                (
                    format!("f{i}"),
                    BaseEntry {
                        m: meta(1, 1),
                        h: meta(1, 1),
                    },
                )
            })
            .collect();
        let hub: Listing = base.keys().map(|k| (k.clone(), meta(1, 1))).collect();
        let ops = plan(&Listing::new(), &hub, &base);
        assert!(too_many_deletes(&ops, base.len()));
        let few: Vec<Op> = ops.into_iter().take(10).collect();
        assert!(!too_many_deletes(&few, base.len()));
    }

    #[test]
    fn conflict_names_keep_the_extension_and_folder() {
        assert_eq!(
            conflict_name("pics/a.photo.jpg", "Pixel 9", "2026-10-25 1405"),
            "pics/a.photo (conflict from Pixel 9 2026-10-25 1405).jpg"
        );
        assert_eq!(
            conflict_name("README", "Mac/Book", "2026-10-25 1405"),
            "README (conflict from Mac-Book 2026-10-25 1405)"
        );
        assert_eq!(conflict_name(".env", "X", "s"), ".env (conflict from X s)");
    }

    #[test]
    fn dates_are_utc_calendar_dates() {
        assert_eq!(date_parts(0).0, "1970-01-01");
        assert_eq!(date_parts(1_792_960_321).1, "2026-10-25 2032");
        assert_eq!(date_parts(951_782_400).0, "2000-02-29");
    }

    #[test]
    fn markers_trash_and_clutter_are_never_synced() {
        for n in [MARKER, TRASH, TMP, ".DS_Store", "._x", "a.partial"] {
            assert!(ignored(n), "{n}");
        }
        assert!(!ignored("notes.txt"));
    }
}
