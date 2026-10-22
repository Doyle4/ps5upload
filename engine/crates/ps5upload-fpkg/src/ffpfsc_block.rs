//! One 64 KiB block of a `.ffpfsc`'s PFSC container, as it is stored.
//!
//! The console's kernel inflates each block on its own as the game reads, so a block is either a
//! complete zlib stream shorter than 64 KiB or the 64 KiB raw; a reader tells them apart by the
//! stored length alone.
//!
//! - a block of zeros is never deflated: its stored form is worked out once per build;
//! - the deflate writes into a buffer the size of what the block must beat;
//! - every block kept compressed is inflated again and compared with its source before it is
//!   handed back, so a container never carries a block that does not decode to its bytes.

use std::io;

use flate2::{Compress, Compression, Decompress, FlushCompress, FlushDecompress, Status};

/// The PFSC block size.
pub const BLOCK: usize = 0x10000;

/// How each block is encoded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BlockOptions {
    /// zlib level, 1–9.
    pub level: u32,
    /// Percent a block must shrink by to be kept compressed (at most 90).
    pub min_gain: u8,
    /// Reserved for a second, stronger pass; not used yet.
    pub strong: bool,
}

impl BlockOptions {
    pub fn check(&self) -> Result<(), String> {
        if !(1..=9).contains(&self.level) {
            return Err(format!(
                "zlib level must be 1 through 9, not {}",
                self.level
            ));
        }
        if self.min_gain > 90 {
            return Err("the minimum block gain must be at most 90%".into());
        }
        Ok(())
    }

    /// What the encoders are, for a log line.
    pub fn encoder(&self) -> String {
        format!("zlib-{}", self.level)
    }

    /// The longest stored form a compressed block may have.
    fn cap(&self) -> usize {
        (BLOCK * (100 - usize::from(self.min_gain)) / 100).min(BLOCK - 1)
    }
}

/// What a block became.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Stored {
    /// All zeros: stored as [`BlockEncoder::zero_block`].
    Zero,
    /// Stored as it is (64 KiB). `prechecked`: ruled out without a deflate.
    Raw { prechecked: bool },
    /// A zlib stream shorter than 64 KiB that inflates back to the block. `strong`: the second
    /// pass's output was the shorter.
    Zlib { bytes: Vec<u8>, strong: bool },
}

/// One worker's encoder and scratch space, reused block after block.
pub struct BlockEncoder {
    cap: usize,
    deflate: Compress,
    inflate: Decompress,
    out: Vec<u8>,
    back: Vec<u8>,
}

impl BlockEncoder {
    pub fn new(opts: BlockOptions) -> Self {
        Self {
            cap: opts.cap(),
            deflate: Compress::new(Compression::new(opts.level), true),
            inflate: Decompress::new(true),
            out: vec![0u8; BLOCK],
            back: vec![0u8; BLOCK],
        }
    }

    /// The stored form of a block of zeros at these options, checked like any other.
    pub fn zero_block(&mut self) -> io::Result<Vec<u8>> {
        let zeros = vec![0u8; BLOCK];
        match self.compress(&zeros)? {
            Some(bytes) => Ok(bytes),
            None => Err(io::Error::other("a block of zeros did not compress")),
        }
    }

    /// `block` (exactly 64 KiB) as it is stored.
    pub fn encode(&mut self, block: &[u8]) -> io::Result<Stored> {
        if block.len() != BLOCK {
            return Err(io::Error::other(format!(
                "a PFSC block is {BLOCK} bytes, not {}",
                block.len()
            )));
        }
        if is_zero(block) {
            return Ok(Stored::Zero);
        }
        Ok(match self.compress(block)? {
            Some(bytes) => Stored::Zlib {
                bytes,
                strong: false,
            },
            None => Stored::Raw { prechecked: false },
        })
    }

    /// The zlib stream within the cap that inflates back to `block`; `None` when it does not
    /// fit.
    fn compress(&mut self, block: &[u8]) -> io::Result<Option<Vec<u8>>> {
        self.deflate.reset();
        let cap = self.cap;
        let status = self
            .deflate
            .compress(block, &mut self.out[..cap], FlushCompress::Finish)
            .map_err(|e| io::Error::other(format!("zlib: {e}")))?;
        // Short of the end means the output ran past the cap: not worth keeping.
        if status != Status::StreamEnd {
            return Ok(None);
        }
        let bytes = self.out[..self.deflate.total_out() as usize].to_vec();
        self.check(&bytes, block)?;
        Ok(Some(bytes))
    }

    /// `stored` inflates to exactly `block`.
    fn check(&mut self, stored: &[u8], block: &[u8]) -> io::Result<()> {
        self.inflate.reset(true);
        let status = self
            .inflate
            .decompress(stored, &mut self.back, FlushDecompress::Finish);
        let whole = matches!(status, Ok(Status::StreamEnd))
            && self.inflate.total_in() as usize == stored.len()
            && self.inflate.total_out() as usize == BLOCK;
        if whole && self.back[..] == block[..] {
            Ok(())
        } else {
            Err(io::Error::other(
                "a compressed block did not inflate back to its source bytes",
            ))
        }
    }
}

fn is_zero(block: &[u8]) -> bool {
    block
        .as_chunks::<64>()
        .0
        .iter()
        .all(|c| c.iter().fold(0u8, |a, &b| a | b) == 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn random(seed: u32) -> Vec<u8> {
        let mut x = seed | 1;
        (0..BLOCK)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 17;
                x ^= x << 5;
                x as u8
            })
            .collect()
    }

    fn inflate(z: &[u8]) -> Vec<u8> {
        use std::io::Read;
        let mut out = Vec::new();
        flate2::read::ZlibDecoder::new(z)
            .read_to_end(&mut out)
            .unwrap();
        out
    }

    #[test]
    fn blocks_round_trip() {
        let opts = BlockOptions {
            level: 6,
            min_gain: 5,
            strong: false,
        };
        let mut e = BlockEncoder::new(opts);
        let zero = e.zero_block().unwrap();
        assert_eq!(inflate(&zero), vec![0u8; BLOCK]);
        assert_eq!(e.encode(&vec![0u8; BLOCK]).unwrap(), Stored::Zero);
        assert_eq!(
            e.encode(&random(1)).unwrap(),
            Stored::Raw { prechecked: false }
        );
        let table: Vec<u8> = (0..BLOCK as u32).map(|i| (i % 251) as u8).collect();
        match e.encode(&table).unwrap() {
            Stored::Zlib { bytes, .. } => assert_eq!(inflate(&bytes), table),
            other => panic!("{other:?}"),
        }
        assert!(e.encode(&[1u8; 100]).is_err());
    }
}
