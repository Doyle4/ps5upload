/* Pure path and address rules for the SMB daemon (and the helper, which validates the same way
 * before it forwards a request). No I/O; host-tested in payload/tests/smbd_path_selftest.c. */
#ifndef PS5UPLOAD_SMBD_PATH_H
#define PS5UPLOAD_SMBD_PATH_H

#include <stddef.h>
#include <stdint.h>

#define SMBP_PATH_MAX 1024u  /* a share-relative path or a console path, NUL included */
#define SMBP_HOST_MAX 256u
#define SMBP_SHARE_MAX 256u  /* Windows caps a share name at 80; Samba lets it run longer */
#define SMBP_NAME_MAX 256u   /* one path component (255 UTF-8 bytes + NUL) */
#define SMBP_PART_SUFFIX ".ps5u-part"

/* Errors the daemon reports, as tokens on the wire ("error":"smb_auth"). */
typedef enum {
    XE_OK = 0,
    XE_NOT_FOUND = -1,
    XE_EXISTS = -2,
    XE_ACCESS = -3,
    XE_NO_SPACE = -4,
    XE_IO = -5,
    XE_DISCONNECTED = -6, /* the server went away mid-operation */
    XE_TIMEOUT = -7,
    XE_AUTH = -8,         /* logon failure, bad password, account locked */
    XE_NO_SHARE = -9,     /* no such share on the server */
    XE_UNREACHABLE = -10, /* nothing answered on the server's port, or the name did not resolve */
    XE_CANCELLED = -11,
    XE_NOT_DIR = -12,
    XE_IS_DIR = -13,
    XE_BAD_NAME = -14,    /* a name the other side cannot hold */
    XE_NOMEM = -15,
    XE_BAD_REQUEST = -16,
    XE_BUSY = -17,
    XE_TOO_DEEP = -18,
    XE_INTO_ITSELF = -19,
    XE_NOT_SUPPORTED = -20 /* the server refuses the operation (some NAS / FUSE-backed shares: rename) */
} xerr_t;

const char *smbp_err_token(int e);

/* A share-relative path as the page sends it ("", "Movies/2024", "/Movies/2024/"): leading and
 * trailing slashes dropped, every component checked (smbp_name_ok). 0 with `out` set, else -1. */
int smbp_rel_normalize(const char *in, char *out, size_t cap);

/* One path component an SMB server can hold: valid UTF-8 of 1..255 bytes, not "." / "..", none of
 * the characters Windows refuses in a name (\ / : * ? " < > |) and no control character. */
int smbp_name_ok(const char *name);

/* `dir` + "/" + `name` ("" dir: just the name; "/" dir: "/name"). 0, or -1 when it does not fit. */
int smbp_join(const char *dir, const char *name, char *out, size_t cap);

/* The parent of a share-relative path ("a/b" -> "a", "a" -> ""), and of a console path
 * ("/data/x" -> "/data", "/x" -> "/"). */
void smbp_parent(const char *path, char *out, size_t cap);

/* The last component ("a/b" -> "b"). */
const char *smbp_base(const char *path);

/* A console path the daemon may be handed: absolute, at most SMBP_PATH_MAX-1 bytes, no "." or ".."
 * component, no empty component, no control character, valid UTF-8. (The helper applies the real
 * write/read policy before it forwards; this is the daemon's own floor.) */
int smbp_local_ok(const char *path);

/* `path` + SMBP_PART_SUFFIX. 0, or -1 when it does not fit. */
int smbp_part_name(const char *path, char *out, size_t cap);

/* macOS metadata a share carries ("._name" AppleDouble files, ".DS_Store"): not copied to the console. */
int smbp_skip_download(const char *name);

/* A server as the user may type it: "192.168.1.10", "nas", "nas.local:4450", "[fe80::1]",
 * "smb://nas/Share/sub", "\\\\nas\\Share". Out: host (no brackets), port (445 when not given), and
 * the share / path when the text carried them ("" otherwise). 0, or -1 when it is not an address.
 * Credentials in the text ("user@host") are refused: they go in their own fields. */
int smbp_parse_server(const char *in, char *host, size_t host_cap, uint16_t *port, char *share, size_t share_cap,
                      char *path, size_t path_cap);

/* A host name or address: 1..253 bytes of letters, digits, '.', '-', '_' or an IPv6 literal's
 * hex digits and ':' (with an optional %zone). */
int smbp_host_ok(const char *host);

/* A share name: 1..255 bytes, smbp_name_ok, and not the IPC$ pipe. */
int smbp_share_ok(const char *share);

/* "host:port" for libsmb2 ("[v6]:port" for an IPv6 literal). 0 or -1. */
int smbp_server_arg(const char *host, uint16_t port, char *out, size_t cap);

#endif
