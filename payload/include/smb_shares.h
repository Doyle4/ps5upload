/* Network shares saved on the console for its own Files page (the SMB daemon, smbd_proto.h, does
 * the network side).
 *
 * File: SMB_SHARES_PATH, one JSON object per line:
 *   {"id":"3fa2c1d0","name":"NAS","host":"192.168.1.10","port":445,"share":"Media","user":"bob",
 *    "domain":"","start_path":"Games","secret":"<hex>"}
 * The field names follow the desktop app's saved connections (engine remote/store.rs Connection:
 * id, name, host, port, share, user, start_path), plus "domain"; a later import between the two can
 * map them one to one.
 *
 * The password never sits in the file as text: "secret" is XChaCha20-Poly1305 (Monocypher) of it
 * under a per-console key in SMB_SHARES_KEY_PATH (32 random bytes, 0600), nonce || mac || text in
 * hex. That keeps it out of anything that copies the file (a bug report, a backup, a log); it is not
 * a defence against someone who can read both files. Nothing here logs a password, and the web API
 * only ever reports has_password.
 *
 * Paths on a share, as the page names them: "smb://<id>/<path in the share>". */
#ifndef PS5UPLOAD_SMB_SHARES_H
#define PS5UPLOAD_SMB_SHARES_H

#include <stddef.h>
#include <stdint.h>

#include "smbd_proto.h"

#define SMB_SHARES_PATH SMBD_DIR "/shares.jsonl"
#define SMB_SHARES_KEY_PATH SMBD_DIR "/shares.key"
#define SMB_SHARES_MAX 16
#define SMB_ID_LEN 8
#define SMB_NAME_MAX 128u
#define SMB_FIELD_MAX 256u
#define SMB_PATH_PREFIX "smb://"

typedef struct {
    char id[SMB_ID_LEN + 1];
    char name[SMB_NAME_MAX];
    char host[SMB_FIELD_MAX];
    uint16_t port;
    char share[SMB_FIELD_MAX];
    char user[SMB_FIELD_MAX];
    char domain[SMB_FIELD_MAX];
    char start_path[1024];
    char password[SMB_FIELD_MAX];
    int has_password;
} smb_share_t; /* ~3 KiB: keep arrays of them on the heap */

enum {
    SMB_SHARES_OK = 0,
    SMB_SHARES_E_IO = -1,
    SMB_SHARES_E_FULL = -2,
    SMB_SHARES_E_NOT_FOUND = -3,
    SMB_SHARES_E_BAD = -4,
};

/* ---- pure (host-tested) ---- */

/* One saved share as its file line (no newline). `key` encrypts the password; with an empty
 * password no "secret" is written. Returns the length, or -1 when it does not fit `cap`. */
int smb_share_to_line(const smb_share_t *s, const uint8_t key[32], char *out, size_t cap);
/* A file line back into `s` (password decrypted). 0, or -1 for a line that is not one (a bad secret
 * drops only the password: has_password 0). */
int smb_share_from_line(const char *line, size_t n, const uint8_t key[32], smb_share_t *s);

/* The fields a page sends are acceptable (host, share, user/domain lengths, start_path shape,
 * name). Fills in defaults: port 445, a name from host/share when empty. 0 or -1 (`why` names the
 * field: "bad_host", "bad_share", "bad_name", "bad_user", "bad_domain", "bad_path"). */
int smb_share_check(smb_share_t *s, const char **why);

/* "smb://<id>/<path>" -> id and the normalized share path (smbd_path.h rules). 0 or -1. */
int smb_path_parse(const char *p, char id[SMB_ID_LEN + 1], char *rel, size_t cap);
/* The page's name for a share path. 0 or -1 when it does not fit. */
int smb_path_make(const char *id, const char *rel, char *out, size_t cap);

/* ---- the file (serialized under one lock) ---- */

/* Every saved share (passwords decrypted), at most `max`. Returns the count, or a negative code. */
int smb_shares_load(smb_share_t *out, int max);
/* One by id: 0 or SMB_SHARES_E_NOT_FOUND / _E_IO. */
int smb_shares_get(const char *id, smb_share_t *out);
/* Add (s->id empty: a fresh id is chosen and written back) or replace (same id). */
int smb_shares_put(smb_share_t *s);
int smb_shares_remove(const char *id);

/* Test hook: another file and key file (NULL restores the defaults). */
void smb_shares_set_paths(const char *file, const char *key_file);

#endif
