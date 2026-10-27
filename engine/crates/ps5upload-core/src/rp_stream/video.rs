//! Rebuilds whole video frames from Takion video units.
//!
//! Ported from chiaki-ng (AGPL-3.0, `lib/src/videoreceiver.c`,
//! `lib/src/frameprocessor.c`). A frame is split into source units plus
//! forward-error-correction units; each source unit starts with a 2-byte
//! field and the rest is the next slice of the Annex-B bitstream. FEC
//! (Cauchy Reed-Solomon, jerasure) is NOT ported yet: a frame missing a source
//! unit is dropped and counted.

use super::takion::AvPacket;

fn seq16_gt(a: u16, b: u16) -> bool {
    a != b && (a.wrapping_sub(b) as i16) > 0
}

#[derive(Default, Debug, Clone, Copy)]
pub struct VideoStats {
    pub frames: u64,
    pub frames_dropped: u64,
    pub bytes: u64,
}

pub struct FrameAssembler {
    frame_index: Option<u16>,
    flushed: bool,
    source_expected: usize,
    units: Vec<Option<Vec<u8>>>,
    pub stats: VideoStats,
}

impl Default for FrameAssembler {
    fn default() -> Self {
        Self::new()
    }
}

impl FrameAssembler {
    pub fn new() -> Self {
        Self {
            frame_index: None,
            flushed: true,
            source_expected: 0,
            units: Vec::new(),
            stats: VideoStats::default(),
        }
    }

    /// Feed one decrypted video unit; returns any frame(s) completed by it.
    pub fn push(&mut self, p: &AvPacket) -> Vec<Vec<u8>> {
        let mut out = Vec::new();
        if let Some(cur) = self.frame_index {
            if p.frame_index != cur && !seq16_gt(p.frame_index, cur) {
                return out; // a unit of a frame we have moved past
            }
        }
        if self.frame_index != Some(p.frame_index) {
            if !self.flushed {
                if let Some(f) = self.flush() {
                    out.push(f);
                }
            }
            self.frame_index = Some(p.frame_index);
            self.flushed = false;
            let total = p.units_in_frame_total as usize;
            let fec = p.units_in_frame_fec as usize;
            self.source_expected = total.saturating_sub(fec);
            self.units = vec![None; total.max(1)];
        }
        if self.flushed {
            return out;
        }
        let idx = p.unit_index as usize;
        if idx < self.units.len() && self.units[idx].is_none() && !p.data.is_empty() {
            self.units[idx] = Some(p.data.clone());
        }
        let have = self.units[..self.source_expected.min(self.units.len())]
            .iter()
            .all(|u| u.is_some());
        if have || idx + 1 == p.units_in_frame_total as usize {
            if let Some(f) = self.flush() {
                out.push(f);
            }
        }
        out
    }

    fn flush(&mut self) -> Option<Vec<u8>> {
        self.flushed = true;
        let n = self.source_expected.min(self.units.len());
        if n == 0 || self.units[..n].iter().any(|u| u.is_none()) {
            self.stats.frames_dropped += 1;
            return None;
        }
        let mut frame = Vec::new();
        for u in self.units[..n].iter().flatten() {
            if u.len() >= 2 {
                frame.extend_from_slice(&u[2..]);
            }
        }
        self.stats.frames += 1;
        self.stats.bytes += frame.len() as u64;
        Some(frame)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unit(frame: u16, idx: u16, total: u16, fec: u16, data: &[u8]) -> AvPacket {
        AvPacket {
            is_video: true,
            packet_index: 0,
            frame_index: frame,
            unit_index: idx,
            units_in_frame_total: total,
            units_in_frame_fec: fec,
            codec: 0,
            adaptive_stream_index: 0,
            key_pos: 0,
            data: data.to_vec(),
        }
    }

    #[test]
    fn joins_source_units_and_skips_fec() {
        let mut a = FrameAssembler::new();
        assert!(a.push(&unit(1, 0, 3, 1, &[0, 0, 1, 2])).is_empty());
        let f = a.push(&unit(1, 1, 3, 1, &[0, 0, 3])).pop().unwrap();
        assert_eq!(f, vec![1, 2, 3]);
        // The FEC unit of a finished frame changes nothing.
        assert!(a.push(&unit(1, 2, 3, 1, &[9, 9])).is_empty());
        assert_eq!(a.stats.frames, 1);
    }

    #[test]
    fn a_gap_drops_the_frame() {
        let mut a = FrameAssembler::new();
        a.push(&unit(1, 0, 3, 1, &[0, 0, 1]));
        // Frame 2 starts before frame 1's unit 1 arrived.
        a.push(&unit(2, 0, 2, 1, &[0, 0, 7]));
        assert_eq!(a.stats.frames_dropped, 1);
    }
}
