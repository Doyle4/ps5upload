// SPDX-License-Identifier: AGPL-3.0-only
// Ported from chiaki-ng: Copyright (C) the Chiaki and chiaki-ng authors. Rust port for
// ps5upload. Licensed under the GNU AGPL v3.0 (LICENSES/AGPL-3.0.txt).
//! Remote Play stream crypto: the ECDH key exchange and the "GKCrypt" stream
//! cipher + GMAC that protect every Takion packet once the stream is up.
//!
//! Ported from chiaki-ng (AGPL-3.0, `lib/src/gkcrypt.c`, `lib/src/ecdh.c`).
//!
//! * **ECDH** on secp256k1. Each side signs its uncompressed public key with
//!   HMAC-SHA256 keyed by the 16-byte handshake key sent in the launch spec.
//!   The shared secret is the x coordinate (OpenSSL `ECDH_compute_key`, no KDF).
//! * **GKCrypt** per direction (index 2 = ours, 3 = the console's): an
//!   HMAC-SHA256 of the secret gives a key and a base IV. The keystream is
//!   AES-128-ECB of `iv + key_pos / 16` (a little-endian counter), XORed in.
//! * **GMAC** is AES-GCM over the packet as associated data with a 16-byte IV
//!   at `iv + key_pos / 16`, truncated to 4 bytes. Its key is re-derived every
//!   45000 bytes of key position.

use aes::cipher::{BlockCipherEncrypt, KeyInit};
use aes_gcm::aead::inout::InOutBuf;
use aes_gcm::aes::cipher::consts::U16;
use aes_gcm::AeadInOut;
use anyhow::{anyhow, bail, Result};
use hmac::{Hmac, Mac};
use k256::elliptic_curve::sec1::ToSec1Point;
use sha2::{Digest, Sha256};

pub const BLOCK: usize = 16;
pub const GMAC_SIZE: usize = 4;
pub const HANDSHAKE_KEY_SIZE: usize = 16;
const GMAC_KEY_REFRESH_KEY_POS: u64 = 45000;
const GMAC_KEY_REFRESH_IV_OFFSET: u64 = 44910;

type HmacSha256 = Hmac<Sha256>;

fn hmac_sha256(key: &[u8], data: &[u8]) -> [u8; 32] {
    let mut mac =
        <HmacSha256 as hmac::KeyInit>::new_from_slice(key).expect("hmac takes any key length");
    mac.update(data);
    let out = mac.finalize().into_bytes();
    let mut r = [0u8; 32];
    r.copy_from_slice(&out);
    r
}

/// `base + v` with `base` read as a little-endian 128-bit number.
pub fn counter_add(base: &[u8; BLOCK], v: u64) -> [u8; BLOCK] {
    u128::from_le_bytes(*base)
        .wrapping_add(v as u128)
        .to_le_bytes()
}

/// Our side of the key exchange.
pub struct Ecdh {
    secret: k256::SecretKey,
}

impl Ecdh {
    pub fn new() -> Result<Self> {
        let mut seed = [0u8; 32];
        loop {
            getrandom::fill(&mut seed).map_err(|e| anyhow!("random: {e}"))?;
            if let Ok(secret) = k256::SecretKey::from_slice(&seed) {
                return Ok(Self { secret });
            }
        }
    }

    /// Our uncompressed public key and its signature.
    pub fn public_key_and_sig(
        &self,
        handshake_key: &[u8; HANDSHAKE_KEY_SIZE],
    ) -> (Vec<u8>, [u8; 32]) {
        let pk = self
            .secret
            .public_key()
            .to_sec1_point(false)
            .as_bytes()
            .to_vec();
        let sig = hmac_sha256(handshake_key, &pk);
        (pk, sig)
    }

    /// The shared secret from the console's public key (BANG), after checking
    /// the console signed it with the same handshake key.
    pub fn derive(
        &self,
        remote_pub: &[u8],
        remote_sig: &[u8],
        handshake_key: &[u8; HANDSHAKE_KEY_SIZE],
    ) -> Result<[u8; 32]> {
        if hmac_sha256(handshake_key, remote_pub).as_slice() != remote_sig {
            bail!("the console's key exchange signature does not match the handshake key");
        }
        let remote = k256::PublicKey::from_sec1_bytes(remote_pub)
            .map_err(|_| anyhow!("the console sent an invalid ECDH public key"))?;
        let shared =
            k256::ecdh::diffie_hellman(self.secret.to_nonzero_scalar(), remote.as_affine());
        let mut out = [0u8; 32];
        out.copy_from_slice(shared.raw_secret_bytes());
        Ok(out)
    }
}

/// One direction's stream cipher and MAC.
pub struct GkCrypt {
    cipher: aes::Aes128,
    iv: [u8; BLOCK],
    gmac_base: [u8; BLOCK],
    gmac_index: u64,
    gmac_current: [u8; BLOCK],
}

fn gen_gmac_key(index: u64, key_base: &[u8; BLOCK], iv: &[u8; BLOCK]) -> [u8; BLOCK] {
    let mut data = [0u8; 32];
    data[..16].copy_from_slice(key_base);
    data[16..].copy_from_slice(&counter_add(
        iv,
        index.wrapping_mul(GMAC_KEY_REFRESH_IV_OFFSET),
    ));
    let md = Sha256::digest(data);
    let mut out = [0u8; BLOCK];
    for i in 0..BLOCK {
        out[i] = md[i] ^ md[i + 16];
    }
    out
}

impl GkCrypt {
    /// `index` 2 = what we send, 3 = what the console sends.
    pub fn new(
        index: u8,
        handshake_key: &[u8; HANDSHAKE_KEY_SIZE],
        ecdh_secret: &[u8; 32],
    ) -> Self {
        let mut data = [0u8; 3 + HANDSHAKE_KEY_SIZE + 2];
        data[0] = 1;
        data[1] = index;
        data[2] = 0;
        data[3..3 + HANDSHAKE_KEY_SIZE].copy_from_slice(handshake_key);
        data[3 + HANDSHAKE_KEY_SIZE] = 1;
        data[3 + HANDSHAKE_KEY_SIZE + 1] = 0;
        let h = hmac_sha256(ecdh_secret, &data);
        let mut key_base = [0u8; BLOCK];
        let mut iv = [0u8; BLOCK];
        key_base.copy_from_slice(&h[..16]);
        iv.copy_from_slice(&h[16..]);
        let gmac_base = gen_gmac_key(0, &key_base, &iv);
        Self {
            cipher: aes::Aes128::new(&key_base.into()),
            iv,
            gmac_base,
            gmac_index: 0,
            gmac_current: gmac_base,
        }
    }

    fn key_stream(&self, key_pos: u64, len: usize) -> Vec<u8> {
        debug_assert!(key_pos.is_multiple_of(BLOCK as u64) && len.is_multiple_of(BLOCK));
        let mut out = vec![0u8; len];
        let first = key_pos / BLOCK as u64;
        for (i, chunk) in out.chunks_mut(BLOCK).enumerate() {
            let mut block = counter_add(&self.iv, first + i as u64).into();
            self.cipher.encrypt_block(&mut block);
            chunk.copy_from_slice(&block);
        }
        out
    }

    /// XOR the keystream at `key_pos` into `buf` (encrypts and decrypts).
    pub fn apply(&self, key_pos: u64, buf: &mut [u8]) {
        let pre = (key_pos % BLOCK as u64) as usize;
        let full = (pre + buf.len()).div_ceil(BLOCK) * BLOCK;
        let ks = self.key_stream(key_pos - pre as u64, full);
        for (b, k) in buf.iter_mut().zip(&ks[pre..]) {
            *b ^= k;
        }
    }

    pub fn gmac(&mut self, key_pos: u64, buf: &[u8]) -> [u8; GMAC_SIZE] {
        let iv = counter_add(&self.iv, key_pos / BLOCK as u64);
        let key_index = key_pos.saturating_sub(1) / GMAC_KEY_REFRESH_KEY_POS;
        let key = if key_index > self.gmac_index {
            self.gmac_current = gen_gmac_key(key_index, &self.gmac_base, &self.iv);
            self.gmac_index = key_index;
            self.gmac_current
        } else if key_index < self.gmac_index {
            if key_index == 0 {
                self.gmac_base
            } else {
                gen_gmac_key(key_index, &self.gmac_base, &self.iv)
            }
        } else {
            self.gmac_current
        };
        let gcm = aes_gcm::AesGcm::<aes::Aes128, U16>::new(&key.into());
        let mut empty: [u8; 0] = [];
        let tag = gcm
            .encrypt_inout_detached(&iv.into(), buf, InOutBuf::from(&mut empty[..]))
            .expect("GCM over an empty message cannot fail");
        let mut out = [0u8; GMAC_SIZE];
        out.copy_from_slice(&tag[..GMAC_SIZE]);
        out
    }
}

/// Serial-number comparison (RFC 1982) for the 32-bit key-position low word.
fn seq32_gt(a: u32, b: u32) -> bool {
    a != b && (a.wrapping_sub(b) as i32) > 0
}
fn seq32_lt(a: u32, b: u32) -> bool {
    a != b && (a.wrapping_sub(b) as i32) < 0
}

/// Tracks the high 32 bits of the console's key position, which packets carry
/// only the low 32 bits of.
#[derive(Default)]
pub struct KeyState {
    prev: u64,
}

impl KeyState {
    pub fn request_pos(&mut self, low: u32, commit: bool) -> u64 {
        let prev_low = self.prev as u32;
        let mut high = (self.prev >> 32) as u32;
        if seq32_gt(low, prev_low) && low < prev_low {
            high = high.wrapping_add(1);
        } else if seq32_lt(low, prev_low) && low > prev_low && high > 0 {
            high -= 1;
        }
        let res = ((high as u64) << 32) | low as u64;
        if commit {
            self.prev = res;
        }
        res
    }
    pub fn commit(&mut self, pos: u64) {
        self.prev = pos;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counter_add_carries_little_endian() {
        let mut base = [0u8; 16];
        base[0] = 0xff;
        let r = counter_add(&base, 1);
        assert_eq!(r[0], 0);
        assert_eq!(r[1], 1);
        let r = counter_add(&[0xff; 16], 1);
        assert_eq!(r, [0u8; 16]);
        let r = counter_add(&[0u8; 16], 0x1_0000_0001);
        assert_eq!(&r[..5], &[1, 0, 0, 0, 1]);
    }

    #[test]
    fn ecdh_both_sides_agree() {
        let hk = [7u8; 16];
        let a = Ecdh::new().unwrap();
        let b = Ecdh::new().unwrap();
        let (pa, sa) = a.public_key_and_sig(&hk);
        let (pb, sb) = b.public_key_and_sig(&hk);
        assert_eq!(pa.len(), 65);
        assert_eq!(
            a.derive(&pb, &sb, &hk).unwrap(),
            b.derive(&pa, &sa, &hk).unwrap()
        );
        assert!(a.derive(&pb, &sa, &hk).is_err());
    }

    // Vectors from chiaki-ng test/gkcrypt.c.
    #[test]
    fn chiaki_ecdh_vector() {
        let hk = [
            0xfc, 0x5d, 0x4b, 0xa0, 0x3a, 0x35, 0x3a, 0xbb, 0x6a, 0x7f, 0xac, 0x79, 0x1b, 0x17,
            0xbb, 0x34,
        ];
        let local_private = [
            0x16, 0xe7, 0x5d, 0xcb, 0xda, 0x98, 0x55, 0xfb, 0x6b, 0xef, 0xdd, 0x8a, 0xa5, 0xf1,
            0x6e, 0x7f, 0x46, 0xfd, 0xe1, 0xd2, 0x27, 0x97, 0x3, 0x60, 0x18, 0x72, 0xd8, 0x4b,
            0x15, 0x38, 0xd9, 0x0,
        ];
        let local_sig = [
            0x99, 0xb5, 0xcb, 0xb5, 0x37, 0x18, 0xb, 0xfc, 0x55, 0xda, 0x43, 0x7f, 0x44, 0x76,
            0xa8, 0x17, 0xc9, 0x37, 0xfe, 0x56, 0x1b, 0x8a, 0xbe, 0xc, 0x41, 0x12, 0xab, 0x71,
            0xf5, 0xa6, 0x8d, 0x29,
        ];
        let remote_pub = [
            0x4, 0xdf, 0xef, 0x8, 0xbb, 0xa8, 0x56, 0xf2, 0xb4, 0x4b, 0x8a, 0xe, 0x4f, 0x44, 0x20,
            0x3f, 0x8e, 0x49, 0x3f, 0xee, 0xd4, 0x3c, 0xe9, 0x3a, 0xfe, 0x5c, 0x64, 0x67, 0x77,
            0x20, 0x15, 0x7c, 0x59, 0x10, 0x15, 0x67, 0x94, 0xae, 0x5f, 0x2, 0x4a, 0xad, 0xc, 0xce,
            0xfa, 0x14, 0x15, 0xa, 0xab, 0xee, 0x8, 0xb, 0x14, 0x12, 0x76, 0xea, 0x3e, 0xc0, 0xd5,
            0x65, 0xf4, 0x68, 0x77, 0xa3, 0xca,
        ];
        let remote_sig = [
            0x13, 0xc5, 0x89, 0xe2, 0x3b, 0x72, 0x85, 0x24, 0xa9, 0x9f, 0x96, 0x80, 0x3, 0xa1,
            0x81, 0x30, 0x59, 0x68, 0xf1, 0xbb, 0xb6, 0x4d, 0xc4, 0xa7, 0x6c, 0xce, 0xf6, 0x79,
            0x4c, 0xeb, 0x2d, 0x98,
        ];
        let secret = [
            0xb8, 0x1c, 0x61, 0x46, 0xe7, 0x49, 0x73, 0x8c, 0x96, 0x30, 0xca, 0x13, 0xff, 0x71,
            0xe5, 0x9b, 0x3b, 0xf9, 0x41, 0x98, 0xd4, 0x67, 0xa5, 0xa2, 0xbc, 0x78, 0x4, 0x92,
            0x81, 0x43, 0xec, 0x1d,
        ];
        let e = Ecdh {
            secret: k256::SecretKey::from_slice(&local_private).unwrap(),
        };
        let (_, sig) = e.public_key_and_sig(&hk);
        assert_eq!(sig, local_sig);
        assert_eq!(e.derive(&remote_pub, &remote_sig, &hk).unwrap(), secret);
    }

    #[test]
    fn chiaki_key_stream_vector() {
        let hk = [
            0x83, 0xcf, 0x93, 0x1a, 0x6a, 0xa7, 0x69, 0xa6, 0xc4, 0x48, 0x5d, 0x19, 0xc1, 0x5c,
            0xcc, 0x52,
        ];
        let secret = [
            0x73, 0xc8, 0xd5, 0x49, 0xc4, 0xd9, 0xdb, 0x50, 0x2e, 0xc0, 0x44, 0xea, 0x33, 0x64,
            0x8c, 0x6a, 0xc9, 0xf3, 0x6c, 0x41, 0xb6, 0xa0, 0x50, 0x4f, 0xe0, 0x93, 0xde, 0xfb,
            0x61, 0x9b, 0x9, 0x73,
        ];
        let iv = [
            0x2a, 0xe1, 0xbb, 0x3d, 0x84, 0xdc, 0x9a, 0xa9, 0xc3, 0x52, 0xa4, 0xcf, 0x3f, 0xfb,
            0x8b, 0x72,
        ];
        let ks = [
            0xf, 0x6d, 0x89, 0x85, 0x5b, 0xa7, 0x86, 0x74, 0x5b, 0xa1, 0xfe, 0x5c, 0x81, 0x19,
            0x6c, 0xd5, 0x54, 0xc4, 0x1c, 0xca, 0xf6, 0xe9, 0x34, 0xa4, 0x89, 0x26, 0x98, 0xb0,
            0x62, 0x12, 0xb3, 0x1a,
        ];
        let ks_high = [
            0x14, 0x31, 0x9f, 0xf8, 0xbe, 0x08, 0x17, 0xa4, 0xfc, 0x28, 0x49, 0x0b, 0x1e, 0x5f,
            0x7b, 0x7e, 0xfa, 0xe9, 0x14, 0xde, 0xc6, 0xdf, 0xe7, 0x5d, 0xd6, 0x9c, 0x75, 0x3f,
            0x94, 0x62, 0xd5, 0x2c,
        ];
        let g = GkCrypt::new(42, &hk, &secret);
        assert_eq!(g.iv, iv);
        assert_eq!(g.key_stream(0x30, 0x20), ks);
        assert_eq!(g.key_stream((1u64 << 32) + 0x420, 0x20), ks_high);
    }

    #[test]
    fn chiaki_gmac_vectors() {
        let key = [
            0xb6, 0x4b, 0x1e, 0x65, 0x3f, 0xbb, 0xa7, 0xab, 0x80, 0xb3, 0x1e, 0x5a, 0x32, 0x4d,
            0xec, 0xc0,
        ];
        let iv = [
            0x7c, 0xc8, 0xd0, 0x19, 0x9e, 0xdf, 0xd8, 0xc3, 0xb5, 0x0f, 0x32, 0xee, 0x36, 0x33,
            0x6a, 0x5a,
        ];
        let buf = GMAC_BUF.to_vec();
        let mk = || GkCrypt {
            cipher: aes::Aes128::new(&[0u8; 16].into()),
            iv,
            gmac_base: [0u8; 16],
            gmac_index: 0,
            gmac_current: key,
        };
        assert_eq!(mk().gmac(0x69a0, &buf), [0x6f, 0x81, 0x10, 0x97]);
        assert_eq!(
            mk().gmac((1u64 << 32) + 0x420, &buf),
            [0x4a, 0x30, 0x98, 0x10]
        );
    }

    #[test]
    fn chiaki_gmac_key_vector() {
        let key = [
            0xbe, 0xeb, 0xa0, 0xf0, 0x3d, 0x05, 0x70, 0x7d, 0x3a, 0xc7, 0x3c, 0xd7, 0x32, 0xb9,
            0x48, 0x01,
        ];
        let iv = [
            0xe8, 0x71, 0x87, 0xe7, 0x63, 0xe0, 0xdf, 0x46, 0x3d, 0xc2, 0x02, 0x4a, 0x2c, 0xd2,
            0x9c, 0x45,
        ];
        let want = [
            0xe3, 0xdb, 0x92, 0xd9, 0xdd, 0xd3, 0x68, 0x99, 0xae, 0xfd, 0x9b, 0x15, 0xe1, 0xa6,
            0x87, 0x8b,
        ];
        assert_eq!(gen_gmac_key(1, &key, &iv), want);
    }

    const GMAC_BUF: [u8; 259] = [
        0x03, 0x00, 0x18, 0x00, 0x19, 0x00, 0x02, 0x50, 0x21, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x69, 0xa0, 0x00, 0xf9, 0xf8, 0x98, 0x24, 0xda, 0x56, 0x0b, 0x74, 0xec, 0x68, 0x15,
        0xd3, 0x1f, 0x85, 0x43, 0xaa, 0xd3, 0xcd, 0xb8, 0x50, 0x2e, 0x90, 0xa4, 0xb0, 0x85, 0xf3,
        0xbe, 0x9a, 0x47, 0x97, 0xc1, 0xab, 0x5f, 0xa5, 0xfd, 0x62, 0x5c, 0x26, 0x1a, 0x54, 0x36,
        0x72, 0x30, 0xc3, 0x2b, 0xe0, 0x2c, 0x5a, 0x86, 0x07, 0xf5, 0xdc, 0x12, 0x55, 0xb4, 0x8e,
        0x17, 0x5b, 0xe4, 0x7f, 0x96, 0x55, 0x86, 0xf0, 0xfb, 0x45, 0xe2, 0xf8, 0xe8, 0x7d, 0x5f,
        0x3a, 0x8b, 0xb0, 0x64, 0x6c, 0x54, 0xf6, 0x8c, 0x4e, 0xa4, 0x12, 0xa3, 0x26, 0x7f, 0x22,
        0x5b, 0x19, 0x98, 0xba, 0xd4, 0xad, 0x9f, 0x5f, 0x63, 0xaf, 0x1f, 0x97, 0x8c, 0x17, 0x49,
        0xa3, 0x30, 0x71, 0xd2, 0xb0, 0x49, 0x2c, 0x75, 0xa2, 0x89, 0xda, 0x50, 0xfd, 0x9b, 0x08,
        0x41, 0x98, 0x2d, 0x8c, 0x0b, 0x92, 0x79, 0xae, 0x60, 0x23, 0x83, 0xef, 0x5c, 0xda, 0xce,
        0x71, 0x08, 0x2d, 0x0b, 0x17, 0x62, 0x56, 0x48, 0xc5, 0xe2, 0x0f, 0x22, 0x1d, 0xdc, 0xcc,
        0xc2, 0x82, 0xa6, 0x8e, 0xec, 0x1e, 0x04, 0x0c, 0x08, 0xaa, 0xa2, 0x80, 0x6c, 0x4f, 0xd3,
        0x6f, 0xc1, 0x9b, 0x76, 0x9a, 0x58, 0xaa, 0x25, 0x56, 0xef, 0xf2, 0xfd, 0x77, 0xf0, 0x32,
        0x4e, 0x83, 0xe2, 0x30, 0x25, 0xa5, 0x5a, 0xf1, 0xdf, 0xc8, 0x75, 0xa2, 0xb6, 0x2b, 0xfd,
        0xac, 0xbc, 0x63, 0x09, 0xa1, 0xcc, 0x2b, 0xf5, 0x46, 0xef, 0x49, 0x83, 0x8f, 0x0b, 0xc1,
        0x47, 0xac, 0x5a, 0x00, 0x2e, 0xec, 0x1c, 0xd0, 0x0a, 0x66, 0xb5, 0xee, 0x9e, 0xad, 0xc9,
        0x64, 0x2d, 0xcb, 0x98, 0x0f, 0x43, 0xa6, 0xe1, 0x4c, 0xe7, 0x9f, 0x2d, 0xab, 0x94, 0x01,
        0xd7, 0x52, 0x84, 0x19,
    ];

    #[test]
    fn keystream_is_position_addressed() {
        let g = GkCrypt::new(3, &[1u8; 16], &[2u8; 32]);
        let mut whole = vec![0u8; 64];
        g.apply(0, &mut whole);
        let mut part = vec![0u8; 20];
        g.apply(13, &mut part);
        assert_eq!(&part[..], &whole[13..33]);
    }
}
