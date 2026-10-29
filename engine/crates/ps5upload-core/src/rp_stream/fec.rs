// SPDX-License-Identifier: AGPL-3.0-only
// Ported from chiaki-ng: Copyright (C) the Chiaki and chiaki-ng authors. Rust port for
// ps5upload. Licensed under the GNU AGPL v3.0 (LICENSES/AGPL-3.0.txt).
//! Video forward error correction: Cauchy Reed-Solomon over GF(2^8).
//!
//! Ported from chiaki-ng (AGPL-3.0, `lib/src/fec.c`, which calls jerasure's
//! `cauchy_original_coding_matrix` + `jerasure_matrix_decode` with w = 8).
//! A frame of `k` source units is followed by `m` coding units; unit j of
//! coding row i is Σ C[i][j]·src[j] with C[i][j] = 1 / (i ⊕ (m + j)). Any `k`
//! surviving units rebuild the lost source units: pick `k` surviving rows of
//! [I; C], invert, multiply.

use anyhow::{bail, Result};

/// GF(2^8) with the polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11d, jerasure's
/// default for w = 8).
struct Gf {
    exp: [u8; 512],
    log: [u8; 256],
}

impl Gf {
    fn new() -> Self {
        let mut exp = [0u8; 512];
        let mut log = [0u8; 256];
        let mut x: u16 = 1;
        for (i, e) in exp.iter_mut().take(255).enumerate() {
            *e = x as u8;
            log[x as usize] = i as u8;
            x <<= 1;
            if x & 0x100 != 0 {
                x ^= 0x11d;
            }
        }
        for i in 255..512 {
            exp[i] = exp[i - 255];
        }
        Self { exp, log }
    }
    fn mul(&self, a: u8, b: u8) -> u8 {
        if a == 0 || b == 0 {
            0
        } else {
            self.exp[self.log[a as usize] as usize + self.log[b as usize] as usize]
        }
    }
    fn inv(&self, a: u8) -> u8 {
        self.exp[255 - self.log[a as usize] as usize]
    }
}

fn gf() -> &'static Gf {
    static GF: std::sync::OnceLock<Gf> = std::sync::OnceLock::new();
    GF.get_or_init(Gf::new)
}

/// Row `r` of [I; C] (k columns).
fn generator_row(r: usize, k: usize, m: usize) -> Vec<u8> {
    let g = gf();
    if r < k {
        let mut row = vec![0u8; k];
        row[r] = 1;
        row
    } else {
        let i = r - k;
        (0..k).map(|j| g.inv((i ^ (m + j)) as u8)).collect()
    }
}

fn invert(mut a: Vec<Vec<u8>>) -> Option<Vec<Vec<u8>>> {
    let g = gf();
    let n = a.len();
    let mut inv: Vec<Vec<u8>> = (0..n)
        .map(|i| {
            let mut r = vec![0u8; n];
            r[i] = 1;
            r
        })
        .collect();
    for col in 0..n {
        let pivot = (col..n).find(|&r| a[r][col] != 0)?;
        a.swap(col, pivot);
        inv.swap(col, pivot);
        let p = g.inv(a[col][col]);
        for c in 0..n {
            a[col][c] = g.mul(a[col][c], p);
            inv[col][c] = g.mul(inv[col][c], p);
        }
        for r in 0..n {
            if r != col && a[r][col] != 0 {
                let f = a[r][col];
                for c in 0..n {
                    let (ac, ic) = (g.mul(f, a[col][c]), g.mul(f, inv[col][c]));
                    a[r][c] ^= ac;
                    inv[r][c] ^= ic;
                }
            }
        }
    }
    Some(inv)
}

/// Rebuild the erased source units in `units` (k + m of them, each `unit_size`
/// long; erased ones may hold anything). Coding units are left as they are.
pub fn decode(units: &mut [Vec<u8>], k: usize, m: usize, erasures: &[usize]) -> Result<()> {
    if units.len() != k + m {
        bail!("FEC: expected {} units, got {}", k + m, units.len());
    }
    if erasures.len() > m {
        bail!(
            "FEC: {} units lost, only {m} can be rebuilt",
            erasures.len()
        );
    }
    let lost_src: Vec<usize> = erasures.iter().copied().filter(|&e| e < k).collect();
    if lost_src.is_empty() {
        return Ok(());
    }
    let unit_size = units.iter().map(Vec::len).max().unwrap_or(0);
    // The first k surviving rows.
    let rows: Vec<usize> = (0..k + m)
        .filter(|r| !erasures.contains(r))
        .take(k)
        .collect();
    if rows.len() < k {
        bail!("FEC: not enough units survive");
    }
    let a: Vec<Vec<u8>> = rows.iter().map(|&r| generator_row(r, k, m)).collect();
    let Some(inv) = invert(a) else {
        bail!("FEC: the surviving units cannot be inverted");
    };
    let g = gf();
    let surviving: Vec<Vec<u8>> = rows
        .iter()
        .map(|&r| {
            let mut u = units[r].clone();
            u.resize(unit_size, 0);
            u
        })
        .collect();
    for &d in &lost_src {
        let mut out = vec![0u8; unit_size];
        for (c, s) in surviving.iter().enumerate() {
            let f = inv[d][c];
            if f == 0 {
                continue;
            }
            for (o, &b) in out.iter_mut().zip(s.iter()) {
                *o ^= g.mul(f, b);
            }
        }
        units[d] = out;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine as _;

    /// Cases from chiaki-ng's test/fec_test_cases.inl.
    #[test]
    fn chiaki_fec_vectors() {
        let text = include_str!("testdata/fec_vectors.txt");
        let mut n = 0;
        for line in text.lines().filter(|l| !l.is_empty()) {
            let parts: Vec<&str> = line.split(' ').collect();
            let k: usize = parts[0].parse().unwrap();
            let m: usize = parts[1].parse().unwrap();
            let erasures: Vec<usize> = parts[2].split(',').map(|e| e.parse().unwrap()).collect();
            let unit: usize = parts[3].parse().unwrap();
            let data = base64::engine::general_purpose::STANDARD
                .decode(parts[4])
                .unwrap();
            assert_eq!(data.len(), unit * (k + m));
            let reference: Vec<Vec<u8>> = data.chunks(unit).map(<[u8]>::to_vec).collect();
            let mut units = reference.clone();
            for &e in &erasures {
                units[e] = vec![0x42; unit];
            }
            decode(&mut units, k, m, &erasures).unwrap();
            for i in 0..k {
                assert_eq!(
                    units[i], reference[i],
                    "case {n} (k={k} m={m} erasures={erasures:?}) unit {i}"
                );
            }
            n += 1;
        }
        assert!(n >= 8);
    }
}
