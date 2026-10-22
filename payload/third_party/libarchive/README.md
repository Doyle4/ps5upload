# libarchive (RAR readers only) — vendored for the on-console extractor

Upstream: libarchive 3.8.10, <https://github.com/libarchive/libarchive> (tag `v3.8.10`).
License: BSD 2-clause (see `COPYING`; a few files carry their own permissive notices, listed
there). Unmodified.

Only the RAR (1.5–4.x) and RAR5 readers and what they need are kept, built with the hand-written
`config.h` (no zlib, iconv or crypto library). These readers are independent implementations, not
derived from UnRAR, so they carry no field-of-use restriction. They cannot decrypt: an encrypted
RAR is refused by the extractor (`fs_extract_rar_encrypted`).

The RAR test archives in `payload/extractor/tests/fixtures` come from libarchive's own test suite
(`libarchive/test/*.rar.uu`, decoded).

## Updating

Copy the same file names from the new release's `libarchive/` folder, then
`make -C payload/extractor host-test` and the PS5 build.
