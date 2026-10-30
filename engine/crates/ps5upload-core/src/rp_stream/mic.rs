// SPDX-License-Identifier: AGPL-3.0-only
// Ported from chiaki-ng: Copyright (C) the Chiaki and chiaki-ng authors. Rust port for
// ps5upload. Licensed under the GNU AGPL v3.0 (LICENSES/AGPL-3.0.txt).
//! Microphone: the player's voice to the console (voice chat).
//!
//! Ported from chiaki-ng (AGPL-3.0, `lib/src/audiosender.c`,
//! `lib/src/opusencoder.c`, `ctrl.c` `ctrl_message_connect_microphone` /
//! `ctrl_message_toggle_microphone`, `streamconnection.c`
//! `stream_connection_enable_microphone`, `takion.c`
//! `chiaki_takion_send_mic_packet`). Four pieces:
//!
//! * **STREAMINFO** from us, right after the controller connection, carrying
//!   an audio header for the uplink (every session, as chiaki does).
//! * **ctrl** messages: CONNECT (0x30) the first time the mic is turned on,
//!   then TOGGLE (0x36) to unmute and mute it.
//! * **audio packets** (Takion kind 3, like the console's audio): each one
//!   carries three 40-byte Opus units, and an Opus packet of any other size is
//!   dropped (chiaki's encoder is capped at 40 bytes; a 3-byte packet is
//!   silence). 48 kHz, 2 channels, 480-sample (10 ms) frames.
//! * **encryption**: the units are encrypted with our GKCrypt at
//!   `key_pos + 16`, the key position goes in the header, and the whole packet
//!   is MACed, the same as a controller feedback packet.
//!
//! Experimental: written from chiaki-ng's code, not yet heard on a console.

use super::crypto::{GkCrypt, BLOCK, GMAC_SIZE};

/// The Opus format chiaki's GUI encodes (`streamsession.cpp`:
/// `chiaki_audio_header_set(&audio_header, 2, 16, MICROPHONE_SAMPLES * 100,
/// MICROPHONE_SAMPLES)`, `OPUS_APPLICATION_RESTRICTED_LOWDELAY`).
pub const SAMPLE_RATE: u32 = 48000;
pub const CHANNELS: u8 = 2;
pub const FRAME_SAMPLES: u32 = 480;
/// The only Opus packet size the sender passes on (`buf_size_per_unit`).
pub const UNIT_SIZE: usize = 40;
/// Units per packet (`units_in_frame_total`).
const UNITS: usize = 3;
/// `units_in_frame_fec_raw`, as chiaki sends it.
const UNITS_FEC_RAW: u32 = 10273;
/// The codec byte chiaki puts in a mic packet.
const CODEC: u8 = 5;
/// Packet header before the units: 19 bytes, plus one on a PS5.
const HEADER: usize = 19;

pub const CTRL_MIC_CONNECT: u16 = 0x30;
pub const CTRL_MIC_TOGGLE: u16 = 0x36;

/// What the page asks of the mic, in order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MicInput {
    On,
    Off,
    /// One Opus packet.
    Frame(Vec<u8>),
}

/// The CONNECT payload (`ctrl_message_connect_microphone`).
pub fn connect_payload() -> [u8; 2] {
    [0, 0]
}

/// The TOGGLE payload (`ctrl_message_toggle_microphone`). chiaki's argument
/// is the state being left, so its `muted == true` unmutes: byte 2 is 0 to
/// unmute, 1 to mute.
pub fn toggle_payload(unmute: bool) -> [u8; 4] {
    [0, 1, if unmute { 0 } else { 1 }, 89]
}

/// The audio header sent in our STREAMINFO. chiaki calls
/// `chiaki_audio_header_set(&h, 16, 1, 48000, 480)`, whose arguments are
/// (channels, bits, ...), and `chiaki_audio_header_save` writes bits first:
/// so `[1, 16, rate BE32, frame size BE32, 1 BE32]`, kept as chiaki sends it.
pub fn stream_info_audio_header() -> [u8; 14] {
    let mut h = [0u8; 14];
    h[0] = 1; // bits
    h[1] = 16; // channels
    h[2..6].copy_from_slice(&SAMPLE_RATE.to_be_bytes());
    h[6..10].copy_from_slice(&FRAME_SAMPLES.to_be_bytes());
    h[10..14].copy_from_slice(&1u32.to_be_bytes()); // unknown
    h
}

/// Builds mic packets from Opus packets (`ChiakiAudioSender`).
#[derive(Debug, Default)]
pub struct AudioSender {
    frame_index: u16,
    framea: Option<[u8; UNIT_SIZE]>,
    frameb: Option<[u8; UNIT_SIZE]>,
}

impl AudioSender {
    pub fn new() -> Self {
        Self::default()
    }

    /// One Opus packet in; a packet to seal and send out, or None
    /// (`chiaki_audio_sender_opus_data`). The key position and MAC are left
    /// zero for [`seal`].
    pub fn opus_data(&mut self, opus: &[u8], ps5: bool) -> Option<Vec<u8>> {
        // Skip packets without encoded audio: silence encodes to 3 bytes.
        if opus.len() != UNIT_SIZE {
            return None;
        }
        let opus: [u8; UNIT_SIZE] = opus.try_into().ok()?;
        // The first two packets only fill frameb, then framea.
        let Some(frameb) = self.frameb else {
            self.frameb = Some(opus);
            return None;
        };
        let Some(framea) = self.framea else {
            self.framea = Some(opus);
            return None;
        };
        // chiaki lays out [frameb][framea][new], then overwrites the first
        // unit with the new packet and sets both framea and frameb to it. So
        // a packet is [new][previous][new] from the third on. Kept as is.
        let mut units = [0u8; UNITS * UNIT_SIZE];
        units[..UNIT_SIZE].copy_from_slice(&frameb);
        units[UNIT_SIZE..2 * UNIT_SIZE].copy_from_slice(&framea);
        units[2 * UNIT_SIZE..].copy_from_slice(&opus);
        units[..UNIT_SIZE].copy_from_slice(&opus);
        self.framea = Some(opus);
        self.frameb = self.framea;

        let units_number: u32 = (UNITS_FEC_RAW & 0xffff) | ((((UNITS - 1) & 0xff) as u32) << 0x10);
        let extra = usize::from(ps5);
        let mut pkt = Vec::with_capacity(HEADER + extra + units.len());
        pkt.push(super::takion::PACKET_AUDIO);
        pkt.extend_from_slice(&self.frame_index.to_be_bytes()); // packet index
        pkt.extend_from_slice(&self.frame_index.wrapping_add(1).to_be_bytes()); // frame index
        pkt.extend_from_slice(&units_number.to_be_bytes());
        pkt.push(CODEC);
        pkt.extend_from_slice(&[0; GMAC_SIZE]);
        pkt.extend_from_slice(&[0; 4]); // key pos
        pkt.push(0);
        if ps5 {
            pkt.push(0);
        }
        pkt.extend_from_slice(&units);
        // chiaki_audio_sender_frame: the index advances once per packet sent.
        self.frame_index = self.frame_index.wrapping_add(1);
        Some(pkt)
    }
}

/// How far a mic packet moves our key position: its units plus a block
/// (`chiaki_takion_send_mic_packet`).
pub fn key_pos_len(pkt: &[u8], ps5: bool) -> usize {
    pkt.len() - HEADER - usize::from(ps5) + BLOCK
}

/// Encrypt the units at `key_pos + 16`, write the key position, MAC the whole
/// packet (`chiaki_takion_send_mic_packet`).
pub fn seal(gk: &mut GkCrypt, key_pos: u64, pkt: &mut [u8], ps5: bool) {
    let start = HEADER + usize::from(ps5);
    gk.apply(key_pos + BLOCK as u64, &mut pkt[start..]);
    pkt[14..18].copy_from_slice(&(key_pos as u32).to_be_bytes());
    let mac = gk.gmac(key_pos, pkt);
    pkt[10..10 + GMAC_SIZE].copy_from_slice(&mac);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unit(b: u8) -> Vec<u8> {
        vec![b; UNIT_SIZE]
    }

    /// The header chiaki writes for packet `idx`, worked out by hand from
    /// `chiaki_audio_sender_opus_data`: type 3, packet index, frame index
    /// (+1), units_number htonl(0x2821 | 2 << 16) = 00 02 28 21, codec 5,
    /// gmac 0, key pos 0, a zero byte and the PS5's extra zero.
    fn header(idx: u16) -> Vec<u8> {
        let mut h = vec![0x03];
        h.extend_from_slice(&idx.to_be_bytes());
        h.extend_from_slice(&idx.wrapping_add(1).to_be_bytes());
        h.extend_from_slice(&[0x00, 0x02, 0x28, 0x21, 0x05]);
        h.extend_from_slice(&[0; 8]);
        h.extend_from_slice(&[0, 0]);
        h
    }

    #[test]
    fn packets_match_chiaki_audiosender_bytes() {
        let mut s = AudioSender::new();
        assert_eq!(s.opus_data(&unit(0x11), true), None);
        assert_eq!(s.opus_data(&unit(0x22), true), None);
        let p = s.opus_data(&unit(0x33), true).unwrap();
        // [new][framea][new]: frameb (0x11) is overwritten by the new unit.
        let mut want = header(0);
        assert_eq!(&want[..9], &[3, 0, 0, 0, 1, 0, 2, 0x28, 0x21]);
        want.extend(unit(0x33));
        want.extend(unit(0x22));
        want.extend(unit(0x33));
        assert_eq!(p.len(), 140);
        assert_eq!(p, want);
        // From here on framea and frameb are both the last unit.
        let p = s.opus_data(&unit(0x44), true).unwrap();
        let mut want = header(1);
        want.extend(unit(0x44));
        want.extend(unit(0x33));
        want.extend(unit(0x44));
        assert_eq!(p, want);
    }

    #[test]
    fn a_ps4_packet_has_no_extra_byte() {
        let mut s = AudioSender::new();
        s.opus_data(&unit(1), false);
        s.opus_data(&unit(2), false);
        let p = s.opus_data(&unit(3), false).unwrap();
        assert_eq!(p.len(), 19 + 120);
        assert_eq!(p[18], 0);
        assert_eq!(&p[19..59], &unit(3)[..]);
    }

    #[test]
    fn silence_and_odd_sizes_are_skipped_without_touching_state() {
        let mut s = AudioSender::new();
        assert_eq!(s.opus_data(&[0xf8, 0xff, 0xfe], true), None);
        assert_eq!(s.opus_data(&[0; 41], true), None);
        s.opus_data(&unit(1), true);
        s.opus_data(&unit(2), true);
        assert_eq!(s.opus_data(&[1, 2, 3], true), None);
        let p = s.opus_data(&unit(3), true).unwrap();
        assert_eq!(&p[1..5], &[0, 0, 0, 1], "first packet is index 0");
    }

    #[test]
    fn the_index_wraps_like_a_u16() {
        let mut s = AudioSender {
            frame_index: u16::MAX,
            framea: Some([1; UNIT_SIZE]),
            frameb: Some([1; UNIT_SIZE]),
        };
        let p = s.opus_data(&unit(2), true).unwrap();
        assert_eq!(&p[1..5], &[0xff, 0xff, 0x00, 0x00]);
        let p = s.opus_data(&unit(2), true).unwrap();
        assert_eq!(&p[1..5], &[0x00, 0x00, 0x00, 0x01]);
    }

    #[test]
    fn ctrl_payloads_match_chiaki() {
        assert_eq!(connect_payload(), [0x00, 0x00]);
        // ctrl_enable_features sends toggle(false) = mute: {0, 1, 1, 89}.
        assert_eq!(toggle_payload(false), [0x00, 0x01, 0x01, 0x59]);
        assert_eq!(toggle_payload(true), [0x00, 0x01, 0x00, 0x59]);
        assert_eq!(
            stream_info_audio_header(),
            [1, 16, 0, 0, 0xbb, 0x80, 0, 0, 0x01, 0xe0, 0, 0, 0, 1]
        );
    }

    #[test]
    fn seal_encrypts_units_and_macs_like_chiaki() {
        let hk = [7u8; super::super::crypto::HANDSHAKE_KEY_SIZE];
        let secret = [9u8; 32];
        let mut gk = GkCrypt::new(2, &hk, &secret);
        let mut check = GkCrypt::new(2, &hk, &secret);
        let mut s = AudioSender::new();
        s.opus_data(&unit(0xa1), true);
        s.opus_data(&unit(0xa2), true);
        let plain = s.opus_data(&unit(0xa3), true).unwrap();
        // chiaki advances by payload + 16 = 136, rounded its way to 144.
        assert_eq!(key_pos_len(&plain, true), 136);
        let key_pos = 0x1230;
        let mut pkt = plain.clone();
        seal(&mut gk, key_pos, &mut pkt, true);

        // Header untouched except the MAC (10..14) and key pos (14..18).
        assert_eq!(&pkt[..10], &plain[..10]);
        assert_eq!(&pkt[14..18], &[0, 0, 0x12, 0x30]);
        assert_eq!(&pkt[18..20], &[0, 0]);
        // Units: XORed with the keystream one block past the key position.
        let mut units = plain[20..].to_vec();
        check.apply(key_pos + 16, &mut units);
        assert_eq!(&pkt[20..], &units[..]);
        assert_ne!(&pkt[20..], &plain[20..]);
        // MAC: over the whole packet with the MAC field zero, key pos set.
        let mut macd = pkt.clone();
        macd[10..14].fill(0);
        assert_eq!(&pkt[10..14], &check.gmac(key_pos, &macd));
        // And the console's side gets the units back.
        let mut back = pkt[20..].to_vec();
        check.apply(key_pos + 16, &mut back);
        assert_eq!(&back[..], &plain[20..]);
    }
}
