//! The controller's orientation from its gyro and accelerometer, ported from chiaki-ng
//! (`lib/src/orientation.c`, AGPL-3.0): Madgwick's IMU filter, warmed up with a strong
//! correction for the first samples, smoothed with the same "fuzz" filter, and turned into the
//! frame the console expects (`chiaki_orientation_tracker_apply_to_controller_state`).
//!
//! A phone used as a controller sends its motion (feedback.rs `MotionSample`); the console gets
//! the gyro, the accelerometer and this orientation in every state packet.

const SIN_1_4_PI: f32 = std::f32::consts::FRAC_1_SQRT_2;
const COS_1_4_PI: f32 = std::f32::consts::FRAC_1_SQRT_2;
const SIN_NEG_1_4_PI: f32 = -std::f32::consts::FRAC_1_SQRT_2;
const COS_NEG_1_4_PI: f32 = std::f32::consts::FRAC_1_SQRT_2;
const WARMUP_SAMPLES_COUNT: u64 = 30;
const BETA_WARMUP: f32 = 20.0;
const BETA_DEFAULT: f32 = 0.05;
const ORIENT_FUZZ: f32 = 0.0007;
const FUZZ_FILTER_PREV_WEIGHT: f32 = 0.75;
const FUZZ_FILTER_PREV_WEIGHT_2X: f32 = 0.6;

/// A quaternion (chiaki `ChiakiOrientation`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Quat {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub w: f32,
}

impl Quat {
    /// chiaki_orientation_init: 90° around x, the frame Madgwick works in.
    fn madgwick_start() -> Self {
        Quat {
            x: SIN_1_4_PI,
            y: 0.0,
            z: 0.0,
            w: COS_1_4_PI,
        }
    }
}

/// What a state packet carries for motion (chiaki's controller state fields).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Motion {
    /// rad/s.
    pub gyro: [f32; 3],
    /// In g.
    pub accel: [f32; 3],
    /// x, y, z, w.
    pub orient: [f32; 4],
}

impl Default for Motion {
    /// chiaki_controller_state_set_idle: still and level.
    fn default() -> Self {
        Motion {
            gyro: [0.0; 3],
            accel: [0.0, 1.0, 0.0],
            orient: [0.0, 0.0, 0.0, 1.0],
        }
    }
}

/// chiaki `ChiakiOrientationTracker`.
#[derive(Debug, Clone)]
pub struct OrientationTracker {
    gyro: [f32; 3],
    accel: [f32; 3],
    orient: Quat,
    timestamp: u32,
    sample_index: u64,
}

impl Default for OrientationTracker {
    fn default() -> Self {
        OrientationTracker {
            gyro: [0.0; 3],
            accel: [0.0, 1.0, 0.0],
            orient: Quat::madgwick_start(),
            timestamp: 0,
            sample_index: 0,
        }
    }
}

impl OrientationTracker {
    /// chiaki_orientation_tracker_update (accel already zeroed by the sender).
    pub fn update(&mut self, gyro: [f32; 3], accel: [f32; 3], timestamp_us: u32) {
        self.gyro = gyro;
        self.accel = accel;
        self.sample_index += 1;
        if self.sample_index <= 1 {
            self.timestamp = timestamp_us;
            return;
        }
        let mut delta_us = timestamp_us as u64;
        if delta_us < self.timestamp as u64 {
            delta_us += 1u64 << 32;
        }
        delta_us -= self.timestamp as u64;
        self.timestamp = timestamp_us;
        let beta = if self.sample_index < WARMUP_SAMPLES_COUNT {
            BETA_WARMUP
        } else {
            BETA_DEFAULT
        };
        orientation_update(
            &mut self.orient,
            gyro,
            accel,
            beta,
            delta_us as f32 / 1_000_000.0,
        );
    }

    /// chiaki_orientation_tracker_apply_to_controller_state: -90° around x back from Madgwick.
    pub fn motion(&self) -> Motion {
        let o = self.orient;
        Motion {
            gyro: self.gyro,
            accel: self.accel,
            orient: [
                COS_NEG_1_4_PI * o.x + SIN_NEG_1_4_PI * o.w,
                COS_NEG_1_4_PI * o.y - SIN_NEG_1_4_PI * o.z,
                COS_NEG_1_4_PI * o.z + SIN_NEG_1_4_PI * o.y,
                COS_NEG_1_4_PI * o.w - SIN_NEG_1_4_PI * o.x,
            ],
        }
    }
}

/// chiaki_orientation_update: one step of Madgwick's IMU algorithm.
fn orientation_update(orient: &mut Quat, g: [f32; 3], a: [f32; 3], beta: f32, dt: f32) {
    let (gx, gy, gz) = (g[0], g[1], g[2]);
    let (mut ax, mut ay, mut az) = (a[0], a[1], a[2]);
    let (mut q0, mut q1, mut q2, mut q3) = (orient.w, orient.x, orient.y, orient.z);

    // Rate of change of quaternion from gyroscope
    let mut q_dot1 = 0.5 * (-q1 * gx - q2 * gy - q3 * gz);
    let mut q_dot2 = 0.5 * (q0 * gx + q2 * gz - q3 * gy);
    let mut q_dot3 = 0.5 * (q0 * gy - q1 * gz + q3 * gx);
    let mut q_dot4 = 0.5 * (q0 * gz + q1 * gy - q2 * gx);

    // Feedback only when the accelerometer reads something (no NaN from normalising zero).
    if !(ax == 0.0 && ay == 0.0 && az == 0.0) {
        let r = inv_sqrt(ax * ax + ay * ay + az * az);
        ax *= r;
        ay *= r;
        az *= r;
        let (_2q0, _2q1, _2q2, _2q3) = (2.0 * q0, 2.0 * q1, 2.0 * q2, 2.0 * q3);
        let (_4q0, _4q1, _4q2) = (4.0 * q0, 4.0 * q1, 4.0 * q2);
        let (_8q1, _8q2) = (8.0 * q1, 8.0 * q2);
        let (q0q0, q1q1, q2q2, q3q3) = (q0 * q0, q1 * q1, q2 * q2, q3 * q3);
        // Gradient descent corrective step
        let mut s0 = _4q0 * q2q2 + _2q2 * ax + _4q0 * q1q1 - _2q1 * ay;
        let mut s1 = _4q1 * q3q3 - _2q3 * ax + 4.0 * q0q0 * q1 - _2q0 * ay - _4q1
            + _8q1 * q1q1
            + _8q1 * q2q2
            + _4q1 * az;
        let mut s2 = 4.0 * q0q0 * q2 + _2q0 * ax + _4q2 * q3q3 - _2q3 * ay - _4q2
            + _8q2 * q1q1
            + _8q2 * q2q2
            + _4q2 * az;
        let mut s3 = 4.0 * q1q1 * q3 - _2q1 * ax + 4.0 * q2q2 * q3 - _2q2 * ay;
        let n = s0 * s0 + s1 * s1 + s2 * s2 + s3 * s3;
        // No NaN when the orientation is already perfect (or exactly inverse).
        if n > 0.000001 {
            let r = inv_sqrt(n);
            s0 *= r;
            s1 *= r;
            s2 *= r;
            s3 *= r;
            q_dot1 -= beta * s0;
            q_dot2 -= beta * s1;
            q_dot3 -= beta * s2;
            q_dot4 -= beta * s3;
        }
    }

    // Integrate, then normalise.
    q0 += q_dot1 * dt;
    q1 += q_dot2 * dt;
    q2 += q_dot3 * dt;
    q3 += q_dot4 * dt;
    let r = inv_sqrt(q0 * q0 + q1 * q1 + q2 * q2 + q3 * q3);
    q0 *= r;
    q1 *= r;
    q2 *= r;
    q3 *= r;

    fuzz(q0, &mut orient.w);
    fuzz(q1, &mut orient.x);
    fuzz(q2, &mut orient.y);
    fuzz(q3, &mut orient.z);
}

/// chiaki's `fuzz`: the kernel input system's jitter filter.
fn fuzz(cur: f32, prev: &mut f32) {
    let f = ORIENT_FUZZ;
    if cur < *prev + f / 2.0 && cur > *prev - f / 2.0 {
        return;
    }
    if cur < *prev + f && cur > *prev - f {
        *prev = FUZZ_FILTER_PREV_WEIGHT * *prev + (1.0 - FUZZ_FILTER_PREV_WEIGHT) * cur;
        return;
    }
    if cur < *prev + f * 2.0 && cur > *prev - f * 2.0 {
        *prev = FUZZ_FILTER_PREV_WEIGHT_2X * *prev + (1.0 - FUZZ_FILTER_PREV_WEIGHT_2X) * cur;
        return;
    }
    *prev = cur;
}

fn inv_sqrt(x: f32) -> f32 {
    1.0 / x.sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_still_level_pad_reads_level() {
        // Held still with gravity along +y (chiaki's idle state): the orientation the console
        // gets stays the identity, as chiaki's idle state has it.
        let mut t = OrientationTracker::default();
        for i in 0..200u32 {
            t.update([0.0; 3], [0.0, 1.0, 0.0], i * 10_000);
        }
        let m = t.motion();
        assert!((m.orient[3] - 1.0).abs() < 0.01, "{:?}", m.orient);
        assert!(m.orient[0].abs() < 0.01 && m.orient[1].abs() < 0.01 && m.orient[2].abs() < 0.01);
        assert_eq!(m.accel, [0.0, 1.0, 0.0]);
    }

    #[test]
    fn turning_shows_in_the_orientation() {
        // 90°/s about y for one second: the orientation turns away from the identity.
        let mut t = OrientationTracker::default();
        for i in 0..40u32 {
            t.update([0.0; 3], [0.0, 1.0, 0.0], i * 10_000);
        }
        let start = t.motion().orient;
        for i in 40..140u32 {
            t.update(
                [0.0, std::f32::consts::FRAC_PI_2, 0.0],
                [0.0, 1.0, 0.0],
                i * 10_000,
            );
        }
        let end = t.motion().orient;
        let moved: f32 = start.iter().zip(end).map(|(a, b)| (a - b).abs()).sum();
        assert!(moved > 0.3, "{start:?} -> {end:?}");
        let norm: f32 = end.iter().map(|v| v * v).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 0.001);
    }

    #[test]
    fn the_clock_may_wrap() {
        let mut t = OrientationTracker::default();
        t.update([0.0; 3], [0.0, 1.0, 0.0], u32::MAX - 5_000);
        t.update([0.0; 3], [0.0, 1.0, 0.0], 5_000); // 10 ms later, past the wrap
        assert!(t.motion().orient.iter().all(|v| v.is_finite()));
    }
}
