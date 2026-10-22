/* Console clean-up (spec 2026-10-22-console-cleanup-design.md): one scan of the console that lists
 * what can safely be removed (installed updates, leftover packages, ps5upload temp files, Sony
 * download files and leftovers of removed games), and an apply that removes the items the user
 * picked, re-checking each one first. The rules are in cleanup_rules.h.
 *
 * Both run on a worker thread of their own (never a management or web worker); the calls below
 * only start, read or stop them, and answer at once. One scan or apply at a time per console.
 *
 * Every call writes a JSON body into `out` and returns its length; a refusal is
 * {"ok":false,"err":"<token>"} (the management table turns that into an AVA1 error, the web API
 * into an HTTP status). Tokens: busy, unknown_scan, scan_expired, scan_not_done, unknown_apply,
 * install_running, bad_request, out_of_memory. */
#ifndef PS5UPLOAD_STORAGE_CLEANUP_H
#define PS5UPLOAD_STORAGE_CLEANUP_H

#include <stddef.h>
#include <stdint.h>

/* The longest status reply (a scan with its items). */
#define SC_STATUS_MAX (224u * 1024u)
/* At most this many items per scan; more is reported as "truncated". */
#define SC_MAX_ITEMS 400
/* A scan older than this cannot be applied (scan again). */
#define SC_SCAN_MAX_AGE_MS (10u * 60u * 1000u)

/* {} -> {"ok":true,"scan_id":N}. */
int sc_scan_start(char *out, size_t cap);
/* {"scan_id":N} -> the scan: state, phase, items (when done), totals, reserve. */
int sc_scan_status(const char *body, size_t n, char *out, size_t cap);
/* {"scan_id":N,"item_ids":[..]} -> {"ok":true,"apply_id":N}. */
int sc_apply_start(const char *body, size_t n, char *out, size_t cap);
/* {"apply_id":N} -> {"ok":true,"state":..,"done":[..],"skipped":[..],"failed":[..],"freed_bytes":N}. */
int sc_apply_status(const char *body, size_t n, char *out, size_t cap);
/* {"id":N}: stops that scan, or that apply after its current item. */
int sc_cancel(const char *body, size_t n, char *out, size_t cap);

/* 1 when `body` (one of the replies above) is a refusal; its token goes into `tok`. */
int sc_reply_error(const char *body, size_t n, char *tok, size_t cap);

#endif
