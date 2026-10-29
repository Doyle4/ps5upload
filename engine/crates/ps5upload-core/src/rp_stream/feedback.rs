// SPDX-License-Identifier: AGPL-3.0-only
// Ported from chiaki-ng: Copyright (C) the Chiaki and chiaki-ng authors. Rust port for
// ps5upload. Licensed under the GNU AGPL v3.0 (LICENSES/AGPL-3.0.txt).
//! Controller input: what the console reads as "the pad".
//!
//! Ported from chiaki-ng (AGPL-3.0, `lib/src/feedback.c`,
//! `lib/src/feedbacksender.c`, `lib/src/controller.c`). Two packet kinds:
//!
//! * **state** (sticks + motion), sent on change and at least every 200 ms;
//! * **history** (buttons, triggers, touchpad), a list of the most recent
//!   events, newest first. A history packet is sent once per change and, since
//!   UDP may drop it, repeated 20/50/100/200 ms later while nothing new
//!   happens (events are absolute, so a repeat can never undo anything).

use std::collections::VecDeque;
use std::time::{Duration, Instant};

/// Button bits, as chiaki numbers them.
pub mod button {
    pub const CROSS: u32 = 1 << 0;
    pub const CIRCLE: u32 = 1 << 1;
    pub const SQUARE: u32 = 1 << 2;
    pub const TRIANGLE: u32 = 1 << 3;
    pub const DPAD_LEFT: u32 = 1 << 4;
    pub const DPAD_RIGHT: u32 = 1 << 5;
    pub const DPAD_UP: u32 = 1 << 6;
    pub const DPAD_DOWN: u32 = 1 << 7;
    pub const L1: u32 = 1 << 8;
    pub const R1: u32 = 1 << 9;
    pub const L3: u32 = 1 << 10;
    pub const R3: u32 = 1 << 11;
    pub const OPTIONS: u32 = 1 << 12;
    pub const SHARE: u32 = 1 << 13;
    pub const TOUCHPAD: u32 = 1 << 14;
    pub const PS: u32 = 1 << 15;
    pub const COUNT: u32 = 16;
}

/// One snapshot of the pad. Sticks are -32768..32767 (down/right positive).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Deserialize)]
pub struct ControllerState {
    #[serde(default)]
    pub buttons: u32,
    #[serde(default)]
    pub l2: u8,
    #[serde(default)]
    pub r2: u8,
    #[serde(default)]
    pub lx: i16,
    #[serde(default)]
    pub ly: i16,
    #[serde(default)]
    pub rx: i16,
    #[serde(default)]
    pub ry: i16,
    /// One finger on the touchpad, at (x 0-1919, y 0-941), or none.
    #[serde(default)]
    pub touch: Option<[u16; 2]>,
}

/// The touchpad's coordinate space (DualShock 4 / DualSense).
pub const TOUCHPAD_W: u16 = 1920;
pub const TOUCHPAD_H: u16 = 942;

/// A touch event (chiaki `feedback_history_event_set_touchpad`).
fn touch_event(down: bool, id: u8, x: u16, y: u16) -> Vec<u8> {
    let x = x.min(TOUCHPAD_W - 1);
    let y = y.min(TOUCHPAD_H - 1);
    vec![
        if down { 0xd0 } else { 0xc0 },
        id & 0x7f,
        (x >> 4) as u8,
        (((x & 0xf) << 4) as u8) | (y >> 8) as u8,
        y as u8,
    ]
}

const HISTORY_SIZE: usize = 16;
const HISTORY_RESEND_EVENTS: usize = 8;
const STATE_MAX_INTERVAL: Duration = Duration::from_millis(200);
const TAIL_MS: [u64; 4] = [20, 50, 100, 200];
pub const STATE_SIZE_V12: usize = 0x1c;

/// The button event bytes (chiaki `feedback_history_event_set_button`).
fn button_event(bit: u32, value: u8) -> Option<Vec<u8>> {
    let code = match bit {
        button::CROSS => 0x88,
        button::CIRCLE => 0x89,
        button::SQUARE => 0x8a,
        button::TRIANGLE => 0x8b,
        button::DPAD_LEFT => 0x82,
        button::DPAD_RIGHT => 0x83,
        button::DPAD_UP => 0x80,
        button::DPAD_DOWN => 0x81,
        button::L1 => 0x84,
        button::R1 => 0x85,
        // Two-byte events: the state is in the code.
        button::L3 => return Some(vec![0x80, if value != 0 { 0xaf } else { 0x8f }]),
        button::R3 => return Some(vec![0x80, if value != 0 { 0xb0 } else { 0x90 }]),
        button::OPTIONS => return Some(vec![0x80, if value != 0 { 0xac } else { 0x8c }]),
        button::SHARE => return Some(vec![0x80, if value != 0 { 0xad } else { 0x8d }]),
        button::TOUCHPAD => return Some(vec![0x80, if value != 0 { 0xb1 } else { 0x91 }]),
        button::PS => return Some(vec![0x80, if value != 0 { 0xae } else { 0x8e }]),
        _ => return None,
    };
    Some(vec![0x80, code, value])
}
const L2_CODE: u8 = 0x86;
const R2_CODE: u8 = 0x87;

/// The v12 state payload (chiaki `feedback_state_format_v9` + v12 tail),
/// with the pad held still and level.
pub fn format_state(s: &ControllerState) -> [u8; STATE_SIZE_V12] {
    fn scaled(v: f32, min: f32, max: f32) -> u16 {
        (0xffff as f32 * (v - min) / (max - min)) as u16
    }
    let mut b = [0u8; STATE_SIZE_V12];
    b[0] = 0xa0;
    let gyro = scaled(0.0, -30.0, 30.0).to_le_bytes();
    b[1..3].copy_from_slice(&gyro);
    b[3..5].copy_from_slice(&gyro);
    b[5..7].copy_from_slice(&gyro);
    b[7..9].copy_from_slice(&scaled(0.0, -5.0, 5.0).to_le_bytes());
    b[9..11].copy_from_slice(&scaled(1.0, -5.0, 5.0).to_le_bytes());
    b[11..13].copy_from_slice(&scaled(0.0, -5.0, 5.0).to_le_bytes());
    // Orientation (0,0,0,1), compressed as chiaki's compress_quat does.
    let q = [0.0f32, 0.0, 0.0, 1.0];
    let largest = 3u32;
    let mut qc: u32 = largest << 1;
    for (i, qi) in [0usize, 1, 2].into_iter().enumerate() {
        let r = std::f32::consts::FRAC_1_SQRT_2;
        let v = (q[qi].clamp(-r, r) + r) * (0x1ff as f32 / (2.0 * r));
        qc |= (v as u32) << (3 + i * 9);
    }
    b[0xd..0x11].copy_from_slice(&qc.to_le_bytes());
    b[0x11..0x13].copy_from_slice(&(s.lx as u16).to_be_bytes());
    b[0x13..0x15].copy_from_slice(&(s.ly as u16).to_be_bytes());
    b[0x15..0x17].copy_from_slice(&(s.rx as u16).to_be_bytes());
    b[0x17..0x19].copy_from_slice(&(s.ry as u16).to_be_bytes());
    b[0x1b] = 1;
    b
}

/// What the sender wants on the wire this tick.
pub enum Packet {
    /// Payload for a feedback-state packet.
    State([u8; STATE_SIZE_V12]),
    /// Event count and payload for a feedback-history packet.
    History(u8, Vec<u8>),
}

pub struct FeedbackSender {
    state: ControllerState,
    state_sent: ControllerState,
    last_state_at: Instant,
    state_dirty: bool,
    /// Newest first.
    history: VecDeque<Vec<u8>>,
    queued: VecDeque<(u8, Vec<u8>)>,
    last_history: Option<(u8, Vec<u8>, Instant)>,
    tail_sent: usize,
    touch_id: u8,
}

impl Default for FeedbackSender {
    fn default() -> Self {
        Self::new()
    }
}

impl FeedbackSender {
    pub fn new() -> Self {
        Self {
            state: ControllerState::default(),
            state_sent: ControllerState::default(),
            last_state_at: Instant::now() - STATE_MAX_INTERVAL,
            state_dirty: true,
            history: VecDeque::new(),
            queued: VecDeque::new(),
            last_history: None,
            tail_sent: TAIL_MS.len(),
            touch_id: 0,
        }
    }

    fn push_event(&mut self, ev: Vec<u8>) {
        self.history.push_front(ev);
        self.history.truncate(HISTORY_SIZE);
        let packet: Vec<u8> = self.history.iter().flatten().copied().collect();
        self.queued.push_back((self.history.len() as u8, packet));
        self.history.truncate(HISTORY_RESEND_EVENTS);
    }

    fn buttons_changed(&mut self, prev: u32, now: u32, pressed: bool) {
        for i in 0..button::COUNT {
            let bit = 1 << i;
            let (p, n) = (prev & bit != 0, now & bit != 0);
            if p != n && n == pressed {
                if let Some(ev) = button_event(bit, if n { 0xff } else { 0 }) {
                    self.push_event(ev);
                }
            }
        }
    }

    /// Take a new pad snapshot; records button/trigger events for history.
    pub fn set(&mut self, now: ControllerState) {
        let prev = self.state;
        if prev == now {
            return;
        }
        // Releases first, then the finger, then presses (chiaki's order: a
        // touchpad click and its finger released together must not lift the
        // finger while the click is still held), then the triggers.
        self.buttons_changed(prev.buttons, now.buttons, false);
        match (prev.touch, now.touch) {
            (Some([x, y]), None) => self.push_event(touch_event(false, self.touch_id, x, y)),
            (None, Some([x, y])) => {
                self.touch_id = (self.touch_id + 1) & 0x7f;
                self.push_event(touch_event(true, self.touch_id, x, y));
            }
            (Some(a), Some(b)) if a != b => {
                self.push_event(touch_event(true, self.touch_id, b[0], b[1]))
            }
            _ => {}
        }
        self.buttons_changed(prev.buttons, now.buttons, true);
        if prev.l2 != now.l2 {
            self.push_event(vec![0x80, L2_CODE, now.l2]);
        }
        if prev.r2 != now.r2 {
            self.push_event(vec![0x80, R2_CODE, now.r2]);
        }
        if (prev.lx, prev.ly, prev.rx, prev.ry) != (now.lx, now.ly, now.rx, now.ry) {
            self.state_dirty = true;
        }
        self.state = now;
    }

    /// Packets due now.
    pub fn tick(&mut self, now: Instant) -> Vec<Packet> {
        let mut out = Vec::new();
        if let Some((n, p)) = self.queued.pop_front() {
            self.last_history = Some((n, p.clone(), now));
            self.tail_sent = 0;
            out.push(Packet::History(n, p));
        } else if let Some((n, p, at)) = &self.last_history {
            if self.tail_sent < TAIL_MS.len()
                && now >= *at + Duration::from_millis(TAIL_MS[self.tail_sent])
            {
                self.tail_sent += 1;
                out.push(Packet::History(*n, p.clone()));
            }
        }
        if self.state_dirty || now.duration_since(self.last_state_at) >= STATE_MAX_INTERVAL {
            self.state_dirty = false;
            self.last_state_at = now;
            self.state_sent = self.state;
            out.push(Packet::State(format_state(&self.state)));
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_press_then_release_makes_two_history_packets_newest_first() {
        let mut f = FeedbackSender::new();
        f.set(ControllerState {
            buttons: button::CROSS,
            ..Default::default()
        });
        f.set(ControllerState::default());
        let t = Instant::now();
        let mut hist = Vec::new();
        for _ in 0..2 {
            for p in f.tick(t) {
                if let Packet::History(n, b) = p {
                    hist.push((n, b));
                }
            }
        }
        assert_eq!(hist[0], (1, vec![0x80, 0x88, 0xff]));
        assert_eq!(hist[1], (2, vec![0x80, 0x88, 0x00, 0x80, 0x88, 0xff]));
    }

    #[test]
    fn a_touch_is_down_then_up_with_one_id() {
        let mut f = FeedbackSender::new();
        f.set(ControllerState {
            touch: Some([960, 471]),
            ..Default::default()
        });
        f.set(ControllerState::default());
        let t = Instant::now();
        let mut hist = Vec::new();
        for _ in 0..2 {
            for p in f.tick(t) {
                if let Packet::History(_, b) = p {
                    hist.push(b);
                }
            }
        }
        // x 960 = 0x3c0, y 471 = 0x1d7: [d0, id, 3c, 0x0<<4|0x1, d7].
        assert_eq!(hist[0], vec![0xd0, 1, 0x3c, 0x01, 0xd7]);
        assert_eq!(&hist[1][..5], &[0xc0, 1, 0x3c, 0x01, 0xd7]);
    }

    #[test]
    fn parses_the_page_pad_json() {
        let p: ControllerState = serde_json::from_str(
            r#"{"buttons":32,"l2":0,"r2":0,"lx":0,"ly":0,"rx":0,"ry":0,"touch":null}"#,
        )
        .unwrap();
        assert_eq!(p.buttons, button::DPAD_RIGHT);
        assert_eq!(p.touch, None);
        let p: ControllerState =
            serde_json::from_str(r#"{"buttons":0,"touch":[960,471]}"#).unwrap();
        assert_eq!(p.touch, Some([960, 471]));
    }

    #[test]
    fn idle_state_matches_chiaki_layout() {
        let b = format_state(&ControllerState::default());
        assert_eq!(b[0], 0xa0);
        assert_eq!(u16::from_le_bytes([b[1], b[2]]), 0x7fff);
        assert_eq!(b[0x1b], 1);
        // Quaternion (0,0,0,1): largest index 3, the others at the midpoint.
        let qc = u32::from_le_bytes(b[0xd..0x11].try_into().unwrap());
        assert_eq!(qc & 7, 6);
        assert_eq!((qc >> 3) & 0x1ff, 255);
    }
}
