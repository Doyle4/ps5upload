/* Pure JSON <-> AVA1 adapters for the console web UI's API routes (webui_api.c).
 *
 * No I/O, no globals, no allocation: everything here is host-tested
 * (payload/tests/webui_codec_selftest.c). Request bodies are NOT NUL-terminated;
 * every reader takes (json, n). Only TOP-LEVEL keys of a JSON object match: a key
 * inside a nested object or inside a string never does. */
#ifndef PS5UPLOAD_WEBUI_CODEC_H
#define PS5UPLOAD_WEBUI_CODEC_H

#include <stddef.h>
#include <stdint.h>

/* The string value of top-level `key`, unescaped into `out` as UTF-8 (\" \\ \/ \b \f \n
 * \r \t and \uXXXX, surrogate pairs joined) and NUL-terminated.
 * Returns 1 found, 0 absent (or the body is not a JSON object), -1 present but unusable:
 * not a string, a bad escape, a lone surrogate, a \u0000 (it would cut a path short), a raw
 * control character, or longer than cap - 1 bytes. */
int webui_json_str(const char *json, size_t n, const char *key, char *out, size_t cap);
/* An unsigned integer value: 1 found, 0 absent, -1 present but not a non-negative integer
 * that fits 64 bits (a string, a fraction, an exponent, a sign). */
int webui_json_u64(const char *json, size_t n, const char *key, uint64_t *out);
/* true / false: 1 found (*out 1 or 0), 0 absent, -1 any other value. */
int webui_json_bool(const char *json, size_t n, const char *key, int *out);

/* Escapes n bytes of `s` as the inside of a JSON string (no quotes added): `"` and `\` are
 * backslashed, control characters become \n \r \t \b \f or \u00XX, valid UTF-8 is copied as
 * is, and every byte that is not part of a valid UTF-8 sequence becomes �, so the result
 * is valid JSON whatever the input. Writes at most cap - 1 bytes plus a NUL (when cap > 0) and
 * returns the full escaped length, like snprintf: a return >= cap means it did not fit. */
size_t webui_json_escape(char *out, size_t cap, const char *s, size_t n);

/* An encoded ava1_fs_list_result_t as
 *   {"entries":[{"name":..,"kind":"file"|"dir"|"link"|"other","size":N,"mtime":N|null},...],
 *    "more":bool,"next":N}
 * Entries that do not fit `cap` are left out and "more" is set; "next" is the directory
 * position after the last entry written (the next page's offset; not a count), so a cut page
 * still pages correctly. Returns the number of entries written, or -1 when `res` does not decode or not even
 * the empty list fits. `out` is always NUL-terminated when cap > 0. */
int webui_list_to_json(const uint8_t *res, size_t n, char *out, size_t cap);

/* An encoded ava1_job_list_result_t as
 *   {"jobs":[{"job":"<32 hex>","kind":"upload"|"download"|"copy"|"op"|"other",
 *             "state":"running"|"done"|"failed","files_done":N,"files_total":N,
 *             "bytes_done":N,"bytes_total":N,"mine":bool},...]}
 * `mine` (may be NULL: never mine) tells whether a job is the caller's. Returns the number of
 * jobs written or -1 (does not decode, or does not fit). */
int webui_jobs_to_json(const uint8_t *res, size_t n, int (*mine)(const uint8_t id[16], void *ctx), void *ctx,
                       char *out, size_t cap);

/* 16 bytes as 32 lowercase hex characters + NUL. */
void webui_hex16(const uint8_t id[16], char out[33]);
/* Exactly 32 hex characters (either case) to 16 bytes: 0, or -1. */
int webui_parse_hex16(const char *s, uint8_t id[16]);

/* The HTTP status for an AVA1 error status and its cause: 400 a malformed request, 403 a path
 * the helper refuses, 404 something missing (unknown job, ENOENT), 409 busy / exists / crosses
 * a mount, 500 anything else. */
int webui_http_status_for(int ava1_status, const char *cause);

/* The Content-Type /api/fs/read answers for `path`, by its extension (case-insensitive):
 * png, jpg/jpeg, txt/log/ini (UTF-8 text), json; anything else (xml, svg, html included: they
 * can render as active documents) application/octet-stream. */
const char *webui_mime_for(const char *path);

/* `key=value` lines (HW_INFO, HW_TEMPS): the value of `key` as a string (1 found, 0 absent;
 * cut to cap - 1) or as a signed integer (1 found, 0 absent, -1 not an integer). */
int webui_kv_str(const char *text, size_t n, const char *key, char *out, size_t cap);
int webui_kv_int(const char *text, size_t n, const char *key, long *out);

/* 1 when `tid` is a game's title id: four letters of a game prefix (PPSA, CUSA, PCJS, PLJS, ...:
 * Sony's disc and digital game ranges for every region) and five digits. Homebrew (FAKE..., PLDM...,
 * WKAL...), system apps (NPXS...) and the page's own tile (WEBUI_TILE_TITLE_ID) are not games. */
int webui_is_game_title_id(const char *tid);

/* From a PROC_FOCUS reply ({"apps":[{"title_id":..,"app_id":..},...],"focus_app_id":N,
 * "big_app_id":N,...}): what Home shows as running (and may close). First the app that owns the
 * screen (focus_app_id, else big_app_id) when its title id is set, not a system app (NPXS...) and
 * not the page's own tile; else the first app whose title id is a game's (webui_is_game_title_id),
 * so the fallback never names the browser, the tile or a homebrew app. Returns 1 with title_id /
 * *app_id set, 0 when no game runs, -1 when the reply does not parse. */
int webui_focus_running(const char *json, size_t n, char *title_id, size_t cap, uint32_t *app_id);

#endif
