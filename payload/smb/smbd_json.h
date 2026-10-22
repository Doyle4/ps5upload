/* A bounded reader for the flat JSON objects the helper sends the SMB daemon, and a small string
 * builder for the replies. No allocation in the reader; it never reads past `n` and never recurses.
 * (The helper's own reader, webui_codec.c, pulls in the AVA1 codec; the daemon stays apart from it.) */
#ifndef PS5UPLOAD_SMBD_JSON_H
#define PS5UPLOAD_SMBD_JSON_H

#include <stddef.h>
#include <stdint.h>

/* Top-level `key` of the object `json` as a string (escapes decoded to UTF-8; a \u0000 is refused):
 * 1 found, 0 absent, -1 not a string / too long for `cap` / bad JSON. `out` is "" unless 1. */
int sj_str(const char *json, size_t n, const char *key, char *out, size_t cap);
/* An unsigned integer: 1, 0 absent, -1 bad. */
int sj_u64(const char *json, size_t n, const char *key, uint64_t *out);
/* true / false: 1, 0 absent, -1 bad. */
int sj_bool(const char *json, size_t n, const char *key, int *out);

/* A growing string (heap). Every append keeps it NUL-terminated; after an allocation failure `err`
 * is set and further appends do nothing. */
typedef struct {
    char *buf;
    size_t len;
    size_t cap;
    size_t max; /* 0 = unbounded; past it the builder fails (err) */
    int err;
} sj_buf_t;

void sj_init(sj_buf_t *b, size_t max);
void sj_free(sj_buf_t *b);
void sj_raw(sj_buf_t *b, const char *s);
void sj_fmt(sj_buf_t *b, const char *fmt, ...) __attribute__((format(printf, 2, 3)));
/* A JSON string literal (quotes included) of `s`: control characters and invalid UTF-8 escaped
 * (an invalid byte becomes U+FFFD, so the reply is always valid JSON). */
void sj_strlit(sj_buf_t *b, const char *s);
/* "key":"<s>" with a leading comma when `comma`. */
void sj_kv_str(sj_buf_t *b, int comma, const char *key, const char *s);

#endif
