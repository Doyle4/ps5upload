//! `.lz4` links: a game image compressed with LZ4 is unpacked on its way to the console.
//!
//! The scene shares PS5 game images (`.exfat`, `.ffpkg`, `.ffpfs`, `.ffpfsc`, the formats
//! ShadowMount+ mounts) as whole-file LZ4 (`Game.exfat.lz4`, the `lz4` command line tool's
//! output). ShadowMount+ cannot mount the `.lz4` itself, and the user asking for this has no
//! room on the computer for the unpacked image. So the engine reads the link through its
//! parallel ranged fetcher, decodes the LZ4 stream as it arrives and hands the decoded bytes
//! to AVA1 as a forward-only source (`ava1::seq`): nothing is stored on the computer, and the
//! console writes `<name>.ava-part`, renamed into place only when complete, so ShadowMount+
//! never sees half an image.
//!
//! Both LZ4 container formats are read: the frame format (magic `04 22 4D 18`, linked or
//! independent blocks, optional checksums, concatenated and skippable frames) and the legacy
//! format (`02 21 4C 18`, 8 MiB independent blocks). Checksums are not verified (no xxHash
//! here); a damaged stream almost always fails to decode, and AVA1 verifies what it delivers.
//!
//! The size the console is promised must be known before the first byte is sent (the space
//! check and AVA1's manifest both need it). It comes from the frame's content-size field when
//! the tool wrote one, and otherwise from the decoded image's own file system header: the exFAT
//! boot sector, the UFS2 superblock or the PFS header each state the volume size. A stream that
//! carries neither (a `.tar.lz4`, an unknown payload) is refused with the reason, before
//! anything is downloaded beyond the first block.
//!
//! Resume: the decoder can only run forward, so a job that has to start over (a new engine
//! process, a console that lost the job) decodes from the beginning again and skips what the
//! console already holds without re-sending it; the compressed prefix is downloaded again.

use std::io::{self, Read};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use ava1::seq::{EntrySink, Keep, Restart, SeqSource};
use ava1::source::{ReadAt, Source, SourceMeta};
use serde::Serialize;

use crate::remote_pkg::RemoteSource;

const FRAME_MAGIC: u32 = 0x184D_2204;
const LEGACY_MAGIC: u32 = 0x184C_2102;
const SKIPPABLE_MASK: u32 = 0xFFFF_FFF0;
const SKIPPABLE_BASE: u32 = 0x184D_2A50;
/// A legacy-format block always decodes to at most this.
const LEGACY_BLOCK: usize = 8 << 20;
/// LZ4's match window: a linked block may refer this far back.
const DICT: usize = 64 * 1024;
/// How much of the decoded image the size sniff needs: the UFS2 superblock sits at 64 KiB.
const SNIFF_DECODED: usize = 65536 + 8192;
/// The most compressed bytes the probe reads to find that much decoded data.
const SNIFF_COMPRESSED: usize = 12 << 20;
/// The PFS header's magic (ps5-dump-forge-pfs `PFS_MAGIC`).
const PFS_MAGIC: u64 = 20_130_315;
const UFS2_MAGIC: u32 = 0x1954_0119;
/// Delivered to the sink at most this much at a time, so cancel is polled at least this often.
const SLICE: usize = 1 << 20;

/// Whether `head` (the first bytes a link serves) starts an LZ4 stream.
pub fn is_lz4(head: &[u8]) -> bool {
    head.len() >= 4 && matches!(le32(head, 0), FRAME_MAGIC | LEGACY_MAGIC)
}

fn le32(b: &[u8], o: usize) -> u32 {
    u32::from_le_bytes(b[o..o + 4].try_into().unwrap())
}
fn le64(b: &[u8], o: usize) -> u64 {
    u64::from_le_bytes(b[o..o + 8].try_into().unwrap())
}

fn bad(msg: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, msg.into())
}

/// A game image file system, as ShadowMount+ names it by extension.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ImageKind {
    Exfat,
    Ufs,
    Pfs,
}

impl ImageKind {
    pub fn ext(self) -> &'static str {
        match self {
            ImageKind::Exfat => "exfat",
            ImageKind::Ufs => "ffpkg",
            ImageKind::Pfs => "ffpfs",
        }
    }
}

/// The image a decoded prefix starts, with the size its header states.
pub fn sniff_image(d: &[u8]) -> Option<(ImageKind, u64)> {
    // exFAT boot sector: "EXFAT   " at 3, VolumeLength (sectors) at 72, BytesPerSectorShift at 108.
    if d.len() >= 120 && &d[3..11] == b"EXFAT   " {
        let sectors = le64(d, 72);
        let shift = u32::from(d[108]);
        if (9..=12).contains(&shift) && sectors > 0 {
            return sectors.checked_shl(shift).map(|n| (ImageKind::Exfat, n));
        }
    }
    // PFS header (also the outer header of a .ffpfsc): version 1..=2, magic at 8,
    // block size at 0x20, data block count at 0x38.
    if d.len() >= 0x40 && (1..=2).contains(&le64(d, 0)) && le64(d, 8) == PFS_MAGIC {
        let bs = u64::from(le32(d, 0x20));
        let blocks = le64(d, 0x38);
        if bs.is_power_of_two() && (0x1000..=0x10000).contains(&bs) && blocks > 0 {
            return blocks.checked_mul(bs).map(|n| (ImageKind::Pfs, n));
        }
    }
    // UFS2 superblock at 64 KiB: fs_fsize at 52, fs_size (fragments) at 1080, magic at 1372.
    const SB: usize = 65536;
    if d.len() >= SB + 1376 && le32(d, SB + 1372) == UFS2_MAGIC {
        let fsize = u64::from(le32(d, SB + 52));
        let frags = le64(d, SB + 1080);
        if fsize.is_power_of_two() && frags > 0 {
            return frags.checked_mul(fsize).map(|n| (ImageKind::Ufs, n));
        }
    }
    None
}

/// Whether a decoded prefix is a tar archive (`ustar` at 257): a folder, which cannot be
/// streamed because its file list is only known once the whole stream has been read.
fn is_tar(d: &[u8]) -> bool {
    d.len() >= 262 && &d[257..262] == b"ustar"
}

#[derive(Debug, Clone, Copy)]
enum Container {
    Frame {
        independent: bool,
        block_checksum: bool,
        content_checksum: bool,
        max_block: usize,
    },
    Legacy,
}

/// A forward-only LZ4 decoder over any byte stream: frame and legacy formats, frames one
/// after another, skippable frames ignored.
pub struct Decoder<R: Read> {
    r: R,
    /// The current frame or legacy stream; `None` between frames.
    cur: Option<Container>,
    /// The last [`DICT`] bytes decoded in this frame (linked blocks refer back into them).
    dict: Vec<u8>,
    inbuf: Vec<u8>,
    out: Vec<u8>,
    /// The first frame's content size, when it states one.
    pub content_size: Option<u64>,
    frames: u32,
    /// A legacy stream ended by the next frame's magic, already read.
    pending_magic: Option<u32>,
    /// The last container was a frame that ended with its end mark. A legacy stream has no end
    /// mark, so one cut at a block boundary looks like a whole one: this stays false for it.
    pub closed: bool,
}

impl<R: Read> Decoder<R> {
    pub fn new(r: R) -> Self {
        Self {
            r,
            cur: None,
            dict: Vec::with_capacity(DICT),
            inbuf: Vec::new(),
            out: Vec::new(),
            content_size: None,
            frames: 0,
            pending_magic: None,
            closed: false,
        }
    }

    /// Fills `buf` exactly; `Ok(false)` on a clean end of input before the first byte.
    fn fill(&mut self, n: usize) -> io::Result<bool> {
        self.inbuf.resize(n, 0);
        let mut got = 0;
        while got < n {
            match self.r.read(&mut self.inbuf[got..]) {
                Ok(0) if got == 0 => return Ok(false),
                Ok(0) => return Err(bad("the LZ4 stream ends in the middle of a block")),
                Ok(k) => got += k,
                Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
                Err(e) => return Err(e),
            }
        }
        Ok(true)
    }

    fn read_u32(&mut self) -> io::Result<Option<u32>> {
        if !self.fill(4)? {
            return Ok(None);
        }
        Ok(Some(le32(&self.inbuf, 0)))
    }

    fn need_u32(&mut self) -> io::Result<u32> {
        self.read_u32()?
            .ok_or_else(|| bad("the LZ4 stream ends in the middle of a frame"))
    }

    fn skip(&mut self, mut n: u64) -> io::Result<()> {
        while n > 0 {
            let k = n.min(1 << 20) as usize;
            if !self.fill(k)? {
                return Err(bad("the LZ4 stream ends inside a skippable frame"));
            }
            n -= k as u64;
        }
        Ok(())
    }

    /// Reads frame headers until a data frame starts. `Ok(false)` at the end of the stream.
    fn start_frame(&mut self) -> io::Result<bool> {
        loop {
            let magic = match self.pending_magic.take() {
                Some(m) => m,
                None => match self.read_u32()? {
                    Some(m) => m,
                    None if self.frames > 0 => return Ok(false),
                    None => return Err(bad("the link is empty, not an LZ4 stream")),
                },
            };
            if magic & SKIPPABLE_MASK == SKIPPABLE_BASE {
                let n = self.need_u32()?;
                self.skip(u64::from(n))?;
                continue;
            }
            if magic == LEGACY_MAGIC {
                self.closed = false;
                self.cur = Some(Container::Legacy);
                self.frames += 1;
                return Ok(true);
            }
            if magic != FRAME_MAGIC {
                return if self.frames > 0 {
                    Err(bad("unexpected data after the end of the LZ4 stream"))
                } else {
                    Err(bad("not an LZ4 stream"))
                };
            }
            if !self.fill(2)? {
                return Err(bad("the LZ4 frame header is cut short"));
            }
            let (flg, bd) = (self.inbuf[0], self.inbuf[1]);
            if flg >> 6 != 0b01 {
                return Err(bad(format!("unsupported LZ4 frame version {}", flg >> 6)));
            }
            if flg & 0x01 != 0 {
                return Err(bad(
                    "the LZ4 frame needs a separate dictionary, which a link cannot supply",
                ));
            }
            let max_block = match (bd >> 4) & 0x7 {
                4 => 64 << 10,
                5 => 256 << 10,
                6 => 1 << 20,
                7 => 4 << 20,
                n => return Err(bad(format!("invalid LZ4 block size code {n}"))),
            };
            if flg & 0x08 != 0 {
                if !self.fill(8)? {
                    return Err(bad("the LZ4 frame header is cut short"));
                }
                let size = le64(&self.inbuf, 0);
                if self.frames == 0 {
                    self.content_size = Some(size);
                } else if let Some(total) = self.content_size.as_mut() {
                    // Concatenated frames that each state their size add up.
                    *total = total.saturating_add(size);
                }
            } else if self.frames > 0 {
                self.content_size = None;
            }
            // The header checksum byte.
            if !self.fill(1)? {
                return Err(bad("the LZ4 frame header is cut short"));
            }
            self.cur = Some(Container::Frame {
                independent: flg & 0x20 != 0,
                block_checksum: flg & 0x10 != 0,
                content_checksum: flg & 0x04 != 0,
                max_block,
            });
            self.dict.clear();
            self.frames += 1;
            self.closed = false;
            return Ok(true);
        }
    }

    /// The next decoded block, or `None` at the end of the stream. The slice is valid until
    /// the next call.
    pub fn next_block(&mut self) -> io::Result<Option<&[u8]>> {
        loop {
            let Some(c) = self.cur else {
                if !self.start_frame()? {
                    return Ok(None);
                }
                continue;
            };
            match c {
                Container::Legacy => {
                    let Some(word) = self.read_u32()? else {
                        self.cur = None;
                        return Ok(None);
                    };
                    if word == FRAME_MAGIC
                        || word == LEGACY_MAGIC
                        || word & SKIPPABLE_MASK == SKIPPABLE_BASE
                    {
                        self.cur = None;
                        self.pending_magic = Some(word);
                        continue;
                    }
                    let n = word as usize;
                    if n == 0 || n > lz4_flex::block::get_maximum_output_size(LEGACY_BLOCK) {
                        return Err(bad(format!("invalid LZ4 legacy block size {n}")));
                    }
                    if !self.fill(n)? {
                        return Err(bad("the LZ4 stream ends in the middle of a block"));
                    }
                    self.out.resize(LEGACY_BLOCK, 0);
                    let k = lz4_flex::block::decompress_into(&self.inbuf, &mut self.out)
                        .map_err(|e| bad(format!("the LZ4 data is damaged: {e}")))?;
                    return Ok(Some(&self.out[..k]));
                }
                Container::Frame {
                    independent,
                    block_checksum,
                    content_checksum,
                    max_block,
                } => {
                    let word = self.need_u32()?;
                    if word == 0 {
                        if content_checksum {
                            self.need_u32()?;
                        }
                        self.cur = None;
                        self.closed = true;
                        continue;
                    }
                    let stored = word & 0x8000_0000 != 0;
                    let n = (word & 0x7FFF_FFFF) as usize;
                    if n > max_block {
                        return Err(bad(format!(
                            "an LZ4 block is larger ({n} bytes) than its frame allows"
                        )));
                    }
                    if !self.fill(n)? {
                        return Err(bad("the LZ4 stream ends in the middle of a block"));
                    }
                    let k = if stored {
                        self.out.clear();
                        self.out.extend_from_slice(&self.inbuf[..n]);
                        n
                    } else {
                        self.out.resize(max_block, 0);
                        let r = if independent || self.dict.is_empty() {
                            lz4_flex::block::decompress_into(&self.inbuf, &mut self.out)
                        } else {
                            lz4_flex::block::decompress_into_with_dict(
                                &self.inbuf,
                                &mut self.out,
                                &self.dict,
                            )
                        };
                        r.map_err(|e| bad(format!("the LZ4 data is damaged: {e}")))?
                    };
                    if block_checksum {
                        self.need_u32()?;
                    }
                    if !independent {
                        let block = &self.out[..k];
                        if k >= DICT {
                            self.dict.clear();
                            self.dict.extend_from_slice(&block[k - DICT..]);
                        } else {
                            let keep = DICT - k;
                            if self.dict.len() > keep {
                                self.dict.drain(..self.dict.len() - keep);
                            }
                            self.dict.extend_from_slice(block);
                        }
                    }
                    return Ok(Some(&self.out[..k]));
                }
            }
        }
    }
}

/// What a `.lz4` link unpacks to, as the probe reports it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Lz4Info {
    /// The unpacked size, when the stream or the image header states it. `None` means the
    /// link cannot be streamed to the console (see `unsupported`).
    pub unpacked_size: Option<u64>,
    /// The name it gets on the console: the link's name without `.lz4`, with the image's
    /// extension when the name has none ShadowMount+ knows.
    pub unpacked_name: String,
    /// The game image inside, when it is one ShadowMount+ mounts.
    pub image: Option<ImageKind>,
    /// Why it cannot be streamed, in a sentence for the user.
    pub unsupported: Option<String>,
    /// `unpacked_size` is the image header's size, not the stream's. An image file can end
    /// before the size its header gives (blocks past the end were never written), so a stream
    /// that ends cleanly short of it is padded with zeros rather than failed.
    #[serde(skip)]
    pub size_from_image: bool,
}

const IMAGE_EXTS: [&str; 4] = ["exfat", "ffpkg", "ffpfs", "ffpfsc"];

/// The image extension a file name ends with, lower-cased.
pub fn image_ext(name: &str) -> Option<&'static str> {
    let lower = name.to_ascii_lowercase();
    IMAGE_EXTS
        .into_iter()
        .find(|e| lower.ends_with(&format!(".{e}")))
}

/// `Game.exfat.lz4` → `Game.exfat`; `Game.lz4` holding an exFAT image → `Game.exfat`.
pub fn unpacked_name(name: &str, image: Option<ImageKind>) -> String {
    let base = if name.to_ascii_lowercase().ends_with(".lz4") {
        &name[..name.len() - 4]
    } else {
        name
    };
    let base = if base.is_empty() { "image" } else { base };
    match image {
        Some(kind) if image_ext(base).is_none() => format!("{base}.{}", kind.ext()),
        _ => base.to_string(),
    }
}

/// Decides from the first decoded bytes (and the frame's content size) what the link unpacks to.
pub fn inspect_prefix(name: &str, content_size: Option<u64>, decoded: &[u8]) -> Lz4Info {
    let sniffed = sniff_image(decoded);
    let image = sniffed.map(|(k, _)| k);
    let unpacked_name = unpacked_name(name, image);
    // A .ffpfsc is PFS on the outside; keep the name the link gave it.
    // The probe sees only the first frame: frames that follow may add to its stated size. An
    // image header that gives more than the first frame wins (several frames, one image).
    let image_size = sniffed.map(|(_, n)| n);
    let size_from_image = match (content_size, image_size) {
        (Some(c), Some(i)) => i > c,
        (None, Some(_)) => true,
        _ => false,
    };
    let unpacked_size = if size_from_image {
        image_size
    } else {
        content_size
    };
    let unsupported = if unpacked_size.is_some() {
        None
    } else if is_tar(decoded) {
        Some(
            "This .lz4 holds a tar archive (a folder). A folder's file list is only known \
             after the whole download, so it cannot be unpacked on the way to the PS5. \
             Download and extract it on a computer instead."
                .to_string(),
        )
    } else {
        Some(
            "This .lz4 does not say how big it unpacks to, and what is inside is not a game \
             image (exFAT, UFS or PFS) whose size can be read from its header. It cannot be \
             unpacked on the way to the PS5."
                .to_string(),
        )
    };
    Lz4Info {
        unpacked_size,
        unpacked_name,
        image,
        unsupported,
        size_from_image,
    }
}

/// Reads a remote file forward through the ranged fetcher (with its read-ahead), polling
/// `cancel` for every request.
struct RemoteReader<'a> {
    src: Arc<RemoteSource>,
    total: u64,
    pos: u64,
    cancel: Option<&'a AtomicBool>,
    /// Stop after this many bytes (the probe's sniff budget).
    limit: u64,
}

impl Read for RemoteReader<'_> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.cancel.is_some_and(|c| c.load(Ordering::Relaxed)) {
            return Err(io::Error::other("transfer_cancelled"));
        }
        let end = self.total.min(self.limit);
        if self.pos >= end || buf.is_empty() {
            return Ok(0);
        }
        let want = (buf.len() as u64).min(end - self.pos).min(SLICE as u64);
        let bytes = self.src.read_range(self.pos, self.pos + want - 1)?;
        let n = bytes.len().min(buf.len());
        buf[..n].copy_from_slice(&bytes[..n]);
        // The probe reads a few MiB and stops: read-ahead would fetch windows nobody reads.
        if self.limit == u64::MAX {
            RemoteSource::prefetch_after(&self.src, self.pos);
        }
        self.pos += n as u64;
        Ok(n)
    }
}

/// Reads the start of a `.lz4` link and says what it unpacks to. Blocking.
pub fn inspect(src: Arc<RemoteSource>, total: u64, name: &str) -> Result<Lz4Info, String> {
    let reader = RemoteReader {
        src,
        total,
        pos: 0,
        cancel: None,
        limit: SNIFF_COMPRESSED as u64,
    };
    let mut d = Decoder::new(reader);
    let mut decoded = Vec::with_capacity(SNIFF_DECODED);
    while decoded.len() < SNIFF_DECODED {
        match d.next_block() {
            Ok(Some(b)) => decoded.extend_from_slice(b),
            Ok(None) => break,
            // The sniff budget ran out in the middle of a block: decide from what decoded.
            Err(_) if !decoded.is_empty() => break,
            Err(e) => return Err(format!("could not read the LZ4 stream: {e}")),
        }
    }
    Ok(inspect_prefix(name, d.content_size, &decoded))
}

/// One unpacked `.lz4` link as a forward-only AVA1 source (and, for the manifest, a
/// one-file [`Source`] that only answers `stat`).
pub struct Lz4LinkSource {
    src: Arc<RemoteSource>,
    compressed: u64,
    name: String,
    size: u64,
    /// See [`Lz4Info::size_from_image`].
    pad_short: bool,
}

impl Lz4LinkSource {
    pub fn new(src: Arc<RemoteSource>, compressed: u64, name: String, size: u64) -> Self {
        Self {
            src,
            compressed,
            name,
            size,
            pad_short: false,
        }
    }

    /// An image whose size came from its own header: a clean end short of it is padded.
    pub fn pad_short(mut self, pad: bool) -> Self {
        self.pad_short = pad;
        self
    }
}

impl Source for Lz4LinkSource {
    fn open(&self, rel: &str) -> io::Result<Box<dyn ReadAt>> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            format!("{rel}: an LZ4 link is read sequentially"),
        ))
    }

    fn list(&self, rel: &str) -> io::Result<Vec<(String, SourceMeta)>> {
        if !rel.is_empty() {
            return Err(io::Error::new(io::ErrorKind::NotFound, rel.to_string()));
        }
        Ok(vec![(self.name.clone(), self.stat(&self.name)?)])
    }

    fn stat(&self, rel: &str) -> io::Result<SourceMeta> {
        if rel.is_empty() {
            return Ok(SourceMeta {
                size: 0,
                mtime: 0,
                mode: 0o755,
                is_dir: true,
            });
        }
        if rel != self.name {
            return Err(io::Error::new(io::ErrorKind::NotFound, rel.to_string()));
        }
        Ok(SourceMeta {
            size: self.size,
            mtime: 0,
            mode: 0o644,
            is_dir: false,
        })
    }
}

/// Decodes the whole stream into `sink`, exactly `size` bytes. Bytes past `size` are
/// allowed only when they are zeros (an image file padded beyond its volume). With
/// `pad_short`, a stream whose last frame closed cleanly short of `size` is filled up with
/// zeros (an image file that ends before its header's size).
pub fn decode_into<R: Read>(
    r: R,
    size: u64,
    pad_short: bool,
    sink: &mut dyn EntrySink,
    cancel: &AtomicBool,
) -> io::Result<()> {
    let mut d = Decoder::new(r);
    let mut pos = 0u64;
    while let Some(block) = d.next_block()? {
        let take = (block.len() as u64).min(size - pos) as usize;
        if block[take..].iter().any(|b| *b != 0) {
            return Err(bad(format!(
                "the unpacked data is larger than the {size} bytes it was announced as"
            )));
        }
        for piece in block[..take].chunks(SLICE) {
            if cancel.load(Ordering::Relaxed) {
                return Err(io::Error::other("transfer_cancelled"));
            }
            sink.data(piece)?;
        }
        pos += take as u64;
    }
    if pos < size && pad_short && d.closed {
        let zeros = vec![0u8; SLICE];
        while pos < size {
            if cancel.load(Ordering::Relaxed) {
                return Err(io::Error::other("transfer_cancelled"));
            }
            let n = (size - pos).min(SLICE as u64) as usize;
            sink.data(&zeros[..n])?;
            pos += n as u64;
        }
    }
    if pos != size {
        return Err(bad(format!(
            "the LZ4 stream unpacked to {pos} bytes, not the {size} announced; the link is \
             cut short or damaged"
        )));
    }
    Ok(())
}

impl SeqSource for Lz4LinkSource {
    fn pass(
        &self,
        _restart: Restart,
        want: &mut dyn FnMut(&str, u64) -> Keep,
        sink: &mut dyn EntrySink,
        cancel: &AtomicBool,
    ) -> io::Result<()> {
        if want(&self.name, self.size) == Keep::Skip {
            return Ok(());
        }
        sink.begin(&self.name)?;
        let reader = RemoteReader {
            src: Arc::clone(&self.src),
            total: self.compressed,
            pos: 0,
            cancel: Some(cancel),
            limit: u64::MAX,
        };
        decode_into(reader, self.size, self.pad_short, sink, cancel)?;
        sink.end()
    }

    fn restart_for(&self, _file_id: u32) -> Restart {
        Restart::START
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A frame-format stream of `data`: linked or independent blocks of `block` bytes, with
    /// an optional content size. Written by hand so the tests do not need the frame encoder.
    pub fn frame(data: &[u8], block: usize, independent: bool, size: bool) -> Vec<u8> {
        let mut out = FRAME_MAGIC.to_le_bytes().to_vec();
        let mut flg = 0x40u8;
        if independent {
            flg |= 0x20;
        }
        if size {
            flg |= 0x08;
        }
        out.push(flg);
        out.push(0x40); // 64 KiB blocks
        if size {
            out.extend_from_slice(&(data.len() as u64).to_le_bytes());
        }
        out.push(0); // header checksum (not checked)
        assert_eq!(block, 64 << 10);
        let mut prev: &[u8] = &[];
        for chunk in data.chunks(block) {
            let c = if independent || prev.is_empty() {
                lz4_flex::block::compress(chunk)
            } else {
                let dict = &prev[prev.len().saturating_sub(DICT)..];
                lz4_flex::block::compress_with_dict(chunk, dict)
            };
            if c.len() >= chunk.len() {
                out.extend_from_slice(&(chunk.len() as u32 | 0x8000_0000).to_le_bytes());
                out.extend_from_slice(chunk);
            } else {
                out.extend_from_slice(&(c.len() as u32).to_le_bytes());
                out.extend_from_slice(&c);
            }
            prev = chunk;
        }
        out.extend_from_slice(&0u32.to_le_bytes());
        out
    }

    pub fn legacy(data: &[u8]) -> Vec<u8> {
        let mut out = LEGACY_MAGIC.to_le_bytes().to_vec();
        for chunk in data.chunks(LEGACY_BLOCK) {
            let c = lz4_flex::block::compress(chunk);
            out.extend_from_slice(&(c.len() as u32).to_le_bytes());
            out.extend_from_slice(&c);
        }
        out
    }

    /// Bytes that compress (repeats) but are not trivial.
    pub fn sample(n: usize) -> Vec<u8> {
        (0..n)
            .map(|i| ((i / 7) as u8).wrapping_mul(13) ^ ((i % 97) as u8))
            .collect()
    }

    /// A fake exFAT image: a boot sector that says `sectors` × 512 bytes, then sample data.
    pub fn exfat_image(len: usize) -> Vec<u8> {
        let mut d = sample(len);
        d[..512].fill(0);
        d[3..11].copy_from_slice(b"EXFAT   ");
        d[72..80].copy_from_slice(&((len / 512) as u64).to_le_bytes());
        d[108] = 9;
        d
    }

    fn decode_all(stream: &[u8]) -> Vec<u8> {
        let mut d = Decoder::new(stream);
        let mut out = Vec::new();
        while let Some(b) = d.next_block().unwrap() {
            out.extend_from_slice(b);
        }
        out
    }

    #[test]
    fn decodes_linked_and_independent_frames_and_legacy() {
        let data = sample(700_000);
        for independent in [false, true] {
            let s = frame(&data, 64 << 10, independent, false);
            assert!(s.len() < data.len());
            assert_eq!(decode_all(&s), data, "independent={independent}");
        }
        assert_eq!(decode_all(&legacy(&data)), data);
    }

    #[test]
    fn concatenated_and_skippable_frames_are_one_stream() {
        let (a, b) = (sample(100_000), sample(30_000));
        let mut s = frame(&a, 64 << 10, false, true);
        s.extend_from_slice(&(SKIPPABLE_BASE | 3).to_le_bytes());
        s.extend_from_slice(&5u32.to_le_bytes());
        s.extend_from_slice(b"hello");
        s.extend_from_slice(&frame(&b, 64 << 10, true, true));
        let mut d = Decoder::new(&s[..]);
        let mut out = Vec::new();
        while let Some(x) = d.next_block().unwrap() {
            out.extend_from_slice(x);
        }
        assert_eq!(out, [a.clone(), b.clone()].concat());
        assert_eq!(d.content_size, Some((a.len() + b.len()) as u64));
    }

    #[test]
    fn an_image_ending_before_its_header_size_is_padded_only_when_the_frame_closed() {
        let data = sample(200_000);
        let whole = frame(&data, 64 << 10, false, false);
        // A frame that closed cleanly: the rest of the announced size is zeros.
        let mut c = Collect::default();
        decode_into(&whole[..], 300_000, true, &mut c, &AtomicBool::new(false)).unwrap();
        assert_eq!(c.0.len(), 300_000);
        assert_eq!(&c.0[..data.len()], &data[..]);
        assert!(c.0[data.len()..].iter().all(|b| *b == 0));
        // Without the image's own size it is still an error, and so is a legacy stream, which
        // has no end mark to tell a whole stream from a cut one.
        let mut c = Collect::default();
        assert!(decode_into(&whole[..], 300_000, false, &mut c, &AtomicBool::new(false)).is_err());
        let mut c = Collect::default();
        assert!(decode_into(
            &legacy(&data)[..],
            300_000,
            true,
            &mut c,
            &AtomicBool::new(false)
        )
        .is_err());
    }

    #[test]
    fn an_image_bigger_than_the_first_frame_takes_the_image_size() {
        let mut head = vec![0u8; 120];
        head[3..11].copy_from_slice(b"EXFAT   ");
        head[72..80].copy_from_slice(&4096u64.to_le_bytes());
        head[108] = 9;
        let info = inspect_prefix("g.exfat.lz4", Some(1000), &head);
        assert_eq!(info.unpacked_size, Some(4096 * 512));
        assert!(info.size_from_image);
        // The stream's own size wins when the image is not bigger.
        let info = inspect_prefix("g.exfat.lz4", Some(4096 * 512), &head);
        assert_eq!(info.unpacked_size, Some(4096 * 512));
        assert!(!info.size_from_image);
    }

    #[test]
    fn a_cut_stream_is_an_error_not_a_short_file() {
        let s = frame(&sample(200_000), 64 << 10, false, false);
        let mut d = Decoder::new(&s[..s.len() - 1000]);
        let r = loop {
            match d.next_block() {
                Ok(Some(_)) => continue,
                other => break other.map(|o| o.is_some()),
            }
        };
        assert!(r.is_err());
    }

    #[test]
    fn the_size_comes_from_the_frame_or_the_image_header() {
        let img = exfat_image(1 << 20);
        let info = inspect_prefix("Game.exfat.lz4", None, &img[..4096]);
        assert_eq!(info.unpacked_size, Some(1 << 20));
        assert_eq!(info.image, Some(ImageKind::Exfat));
        assert_eq!(info.unpacked_name, "Game.exfat");
        assert!(info.unsupported.is_none());

        let info = inspect_prefix("PPSA01234.lz4", None, &img[..4096]);
        assert_eq!(info.unpacked_name, "PPSA01234.exfat");

        let info = inspect_prefix("blob.bin.lz4", Some(42), &sample(4096));
        assert_eq!(info.unpacked_size, Some(42));
        assert_eq!(info.unpacked_name, "blob.bin");
        assert_eq!(info.image, None);

        let info = inspect_prefix("blob.lz4", None, &sample(4096));
        assert!(info.unpacked_size.is_none() && info.unsupported.is_some());

        let mut tar = vec![0u8; 1024];
        tar[257..262].copy_from_slice(b"ustar");
        let info = inspect_prefix("folder.tar.lz4", None, &tar);
        assert!(info.unsupported.unwrap().contains("tar"));
    }

    #[test]
    fn ufs2_and_pfs_headers_state_their_size() {
        let mut ufs = vec![0u8; SNIFF_DECODED];
        let sb = 65536;
        ufs[sb + 52..sb + 56].copy_from_slice(&65536u32.to_le_bytes());
        ufs[sb + 1080..sb + 1088].copy_from_slice(&1000u64.to_le_bytes());
        ufs[sb + 1372..sb + 1376].copy_from_slice(&UFS2_MAGIC.to_le_bytes());
        assert_eq!(sniff_image(&ufs), Some((ImageKind::Ufs, 1000 * 65536)));

        let mut pfs = vec![0u8; 0x400];
        pfs[0..8].copy_from_slice(&1u64.to_le_bytes());
        pfs[8..16].copy_from_slice(&PFS_MAGIC.to_le_bytes());
        pfs[0x20..0x24].copy_from_slice(&0x10000u32.to_le_bytes());
        pfs[0x38..0x40].copy_from_slice(&77u64.to_le_bytes());
        assert_eq!(sniff_image(&pfs), Some((ImageKind::Pfs, 77 * 0x10000)));
        // A .ffpfsc keeps its own name.
        assert_eq!(
            unpacked_name("x.ffpfsc.lz4", Some(ImageKind::Pfs)),
            "x.ffpfsc"
        );
    }

    #[derive(Default)]
    struct Collect(Vec<u8>);
    impl EntrySink for Collect {
        fn begin(&mut self, _: &str) -> io::Result<()> {
            Ok(())
        }
        fn data(&mut self, b: &[u8]) -> io::Result<()> {
            self.0.extend_from_slice(b);
            Ok(())
        }
        fn end(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn a_zero_tail_past_the_volume_is_dropped_but_data_is_not() {
        let mut img = exfat_image(256 * 1024);
        img.extend_from_slice(&[0u8; 70_000]);
        let s = frame(&img, 64 << 10, false, false);
        let mut c = Collect(Vec::new());
        decode_into(&s[..], 256 * 1024, false, &mut c, &AtomicBool::new(false)).unwrap();
        assert_eq!(c.0, img[..256 * 1024]);

        let mut img = exfat_image(256 * 1024);
        img.extend_from_slice(&[1u8; 10]);
        let s = frame(&img, 64 << 10, false, false);
        let mut c = Collect(Vec::new());
        assert!(decode_into(&s[..], 256 * 1024, false, &mut c, &AtomicBool::new(false)).is_err());

        let s = frame(&exfat_image(128 * 1024), 64 << 10, false, false);
        let mut c = Collect(Vec::new());
        assert!(decode_into(&s[..], 256 * 1024, false, &mut c, &AtomicBool::new(false)).is_err());
    }

    #[test]
    fn cancel_stops_the_decode() {
        let s = frame(&sample(300_000), 64 << 10, true, false);
        let mut c = Collect(Vec::new());
        let r = decode_into(&s[..], 300_000, false, &mut c, &AtomicBool::new(true));
        assert!(r.is_err());
        assert!(c.0.is_empty());
    }
}
