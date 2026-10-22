# libsmb2 (vendored)

The SMB2/3 client used by the console's SMB daemon (`payload/smb/`, `ps5upload-smb.elf`), which lets
the console's own Files page browse and copy from network shares.

## Source

[sahlberg/libsmb2](https://github.com/sahlberg/libsmb2) at `fc710a3` (2026-10-08, "examples/smb2-share-enum:
build against both the old and new share-enum API"), plus these upstream commits cherry-picked on top
(all applied cleanly; each fixes how the client handles a server's replies or a dropped connection):

| upstream | |
|---|---|
| `e94eee9` | client: enforce sealed replies, validate transform headers, cap receives (#493) |
| `ee56559` | sync: do not leak state when the connection fails mid-call |
| `b4a409e` | Free everything when a call is cancelled or the context is destroyed |
| `ccc53a1` | libsmb2: fstat: don't use a related compound without a CREATE |
| `8fa34fd` | libsmb2: set an error string when stat/truncate/rename/fstat/echo fail |
| `6cd18a5` | read: refuse a READ reply with more data than was asked for |
| `753e218` | libsmb2: stat/fstat/statvfs: fail a QUERY_INFO reply with no output buffer |
| `5199123` | NTLM: do not memcpy() from a NULL buffer when the encoder first grows |

Only the client library is here: `lib/` (core sources, no Kerberos, no QUIC / SMB Direct, no platform
ports), `include/`, and the licence files. `libdcerpc/`, the examples, tests and build systems are left
out. The sources are otherwise unmodified.

Ours: `config.h` (written by hand for the PS5 SDK's FreeBSD libc and the host test builds, replacing the
CMake-generated one; it also defines `_U_`, which `aes128ccm.c` uses and upstream leaves to the build).
`payload/smb/Makefile` compiles every `lib/*.c` with `-DHAVE_CONFIG_H`.

## Licence and what it asks of us

The library (`lib/`, `include/`) is **LGPL-2.1-or-later** (`COPYING`, `LICENCE-LGPL-2.1.txt`; every file
carries the notice). ps5upload is GPL-3.0, and the daemon links libsmb2 statically into one ELF that the
helper embeds. That is allowed: LGPL-2.1 §3 lets the code be used under the GPL (version 2 or any later
version, so GPL-3.0), and the combined daemon is distributed under GPL-3.0 with its complete source.

Obligations we keep:
- ship the licence texts and keep every copyright notice (this folder; nothing removed);
- say what we changed and when (this file: the pin, the cherry-picks, `config.h`);
- make the complete corresponding source of the binary available (this repository: the daemon, this
  library and the build files that produce `ps5upload-smb.elf` and the helper that embeds it). Anyone can
  rebuild and relink the daemon with a modified libsmb2 (`make -C payload/smb`).

## Updating

Copy `lib/*.c`, `lib/*.h` (the files listed in `payload/smb/Makefile`'s wildcard), `include/` and the
licence files from a newer upstream, rebuild (`make -C payload/smb`), run `make test-payload`, and check
SMB on a console: list a share, copy a folder down and up, and pull the network mid-copy.
