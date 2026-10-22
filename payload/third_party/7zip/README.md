# 7-Zip (decoders only) — vendored for the on-console extractor

Upstream: 7-Zip 26.05 by Igor Pavlov, <https://7-zip.org> (git mirror
<https://github.com/ip7z/7zip>, tag `26.05`). License: GNU LGPL 2.1 or later, with parts under
the BSD 3-clause license — see `DOC/License.txt` and `DOC/copying.txt`. LGPL-2.1-or-later code
may be combined with ps5upload's GPL-3.0-or-later code.

Only the files `payload/extractor` builds are kept (the archive handlers for 7z, zip, tar, gz,
bz2, xz, zstd, lzma and numbered split sets, their decoders, and AES/ZipCrypto decryption). **No
RAR code is vendored:** 7-Zip's RAR decoders are derived from the UnRAR source, whose license adds
a restriction GPL-3.0 code (the payload SDK's startup code, linked into every payload) does not
allow. The extractor reads RAR with libarchive's independent readers instead
(`../libarchive`).

## The change

`ps5upload.patch` (applied here) lets four archive handlers build without their update side when
`Z7_EXTRACT_ONLY` is defined, the way upstream's 7z handler and codec registrations already do:
`Bz2Handler.cpp`, `GzHandler.cpp`, `Tar/TarHandler.h` and `Zip/ZipHandler.h`. Without it those
handlers pull in the archive writers and every encoder.

## Updating

Check out the new tag of the git mirror, copy over the files listed here (`find C CPP -type f`),
re-apply `ps5upload.patch`, then `make -C payload/extractor host-test` and the PS5 build.
