/* The console web UI's JSON API: see include/webui_api.h.
 *
 * Each route decodes its JSON body (webui_codec.c), encodes the AVA1 request into a buffer,
 * dispatches it through ava1_payload_rpc (the AVA1 server's own entry: data plane first, then
 * the management table with its per-call credential/breadcrumb hooks), and turns the reply
 * back into JSON. Routes run on the web server's worker threads (256 KiB stacks): every reply
 * buffer is on the heap. */
#include "webui_api.h"

#include <pthread.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "ava1_data.h"
#include "ava1_gen.h"
#include "ava1_glue.h"
#include "ava1_op.h"
#include "ava1_server.h"
#include "ava1_wire.h"
#include "config.h"
#include "files_prefs.h"
#include "path_policy.h"
#include "proc_identity.h"
#include "ps5_firmware.h"
#include "webui_codec.h"
#include "webui_inputlog.h"
#include "webui_page.h"
#include "webui_server.h"
#include "webui_settings.h"
#include "webui_strings.h"
#include "webui_tile.h"

#define API_OUT_MAX (256u * 1024u)   /* an AVA1 reply's ceiling (the server's RPC_OUT_MAX) */
#define API_LIST_JSON (64u * 1024u)  /* one fs.list page as JSON: entries past it page on */
#define API_JOBS_JSON (16u * 1024u)  /* AVA1_MAX_JOBS (32) entries of ~260 bytes */
#define API_PATH (1024u)             /* a path, NUL included (the helper's FS_PATH_MAX) */
#define API_READ_MAX (1024u * 1024u) /* /api/fs/read's longest answer */
#define API_LIST_MAX 256u            /* fs.list entries per call (the helper's own ceiling) */
#define API_CAUSE_MAX 200u

/* The console page's identity: the owner of the jobs it starts (constraints: fixed value). */
static const uint8_t k_console_id[32] = "ps5upload-console-webui";

/* ---- replies ---- */

static void send_json(int fd, int status, const char *json, size_t len) {
    webui_send(fd, status, "application/json", json, len);
}

/* {"error":"<token>"} with the token escaped (a cause can carry any bytes). */
static void send_error(int fd, int http, const char *token, size_t len) {
    char buf[64 + 6 * API_CAUSE_MAX];
    size_t at;
    if (len > API_CAUSE_MAX) len = API_CAUSE_MAX;
    at = (size_t)snprintf(buf, sizeof buf, "{\"error\":\"");
    at += webui_json_escape(buf + at, sizeof buf - at, token, len);
    /* escape returns the full length: clamp before any `sizeof buf - at` (cannot trigger: 6 bytes
     * per input byte at most, and the buffer holds that) */
    if (at + 3 > sizeof buf) at = sizeof buf - 3;
    memcpy(buf + at, "\"}", 3);
    send_json(fd, http, buf, at + 2);
}

static void send_bad(int fd, const char *token) { send_error(fd, 400, token, strlen(token)); }

static const char *status_token(int st) {
    switch (st) {
    case AVA1_ERR_PROTOCOL: return "bad_request";
    case AVA1_ERR_UNKNOWN_METHOD: return "unavailable";
    case AVA1_ERR_BUSY: return "busy";
    case AVA1_ERR_PATH: return "path_not_allowed";
    case AVA1_ERR_NO_SPACE: return "no_space";
    case AVA1_ERR_UNKNOWN_JOB: return "unknown_job";
    case AVA1_ERR_IO: return "io_error";
    case AVA1_ERR_EXISTS: return "exists";
    case AVA1_ERR_CANCELLED: return "cancelled";
    case AVA1_ERR_CROSS_DEVICE: return "cross_mount";
    default: return "internal";
    }
}

/* An AVA1 error as HTTP: the helper's cause when it gave one (the token inside a legacy
 * {"ok":false,"err":..} body), else a name for the status. A cross-device move is always
 * 409 {"error":"cross_mount"}: the page then copies with move set. */
static void send_status_error(int fd, int st, const uint8_t *cause, size_t len) {
    char c[API_CAUSE_MAX + 1], tok[API_CAUSE_MAX + 1];
    const char *use = c;
    if (st == AVA1_ERR_CROSS_DEVICE) {
        send_error(fd, 409, "cross_mount", 11);
        return;
    }
    if (len > API_CAUSE_MAX) len = API_CAUSE_MAX;
    if (cause && len) memcpy(c, cause, len);
    c[len] = '\0';
    if (len && c[0] == '{' &&
        (webui_json_str(c, len, "err", tok, sizeof tok) == 1 || webui_json_str(c, len, "error", tok, sizeof tok) == 1 ||
         webui_json_str(c, len, "reason", tok, sizeof tok) == 1) &&
        tok[0])
        use = tok;
    if (!use[0]) use = status_token(st);
    send_error(fd, webui_http_status_for(st, c), use, strlen(use));
}

/* ---- dispatch ---- */

/* One AVA1 call into `out` (API_OUT_MAX bytes). */
static int call(uint16_t method, const uint8_t *req, size_t req_len, uint8_t *out, size_t *out_len) {
    int st;
    *out_len = 0;
    st = ava1_payload_rpc(method, req, (uint32_t)req_len, out, API_OUT_MAX, out_len);
    if (*out_len > API_OUT_MAX) {
        *out_len = 0;
        st = AVA1_ERR_INTERNAL;
    }
    return st;
}

/* A MgmtText method: `body` (may be empty: the request is then empty, as the engine sends it) in,
 * the reply text out (a pointer into `out`). */
static int call_text(uint16_t method, const char *body, size_t len, uint8_t *out, size_t *out_len, const uint8_t **text,
                     size_t *text_len) {
    uint8_t *req = NULL;
    size_t req_len = 0;
    ava1_mgmt_text_t m;
    int st;
    *text = NULL;
    *text_len = 0;
    if (len) {
        ava1_w_t w;
        memset(&m, 0, sizeof m);
        m.body = (const uint8_t *)body;
        m.body_len = (uint32_t)len;
        req = malloc(len + 16);
        if (!req) return AVA1_ERR_INTERNAL;
        ava1_w_init(&w, req, len + 16);
        if (ava1_mgmt_text_encode(&m, &w) != 0) {
            free(req);
            return AVA1_ERR_INTERNAL;
        }
        req_len = w.len;
    }
    st = call(method, req, req_len, out, out_len);
    free(req);
    if (st != AVA1_STATUS_OK) return st;
    if (ava1_mgmt_text_decode(out, *out_len, &m) != 0) {
        *out_len = 0;
        return AVA1_ERR_INTERNAL;
    }
    *text = m.body;
    *text_len = m.body_len;
    return AVA1_STATUS_OK;
}

/* ---- request fields ---- */

/* A required non-empty string field; on failure answers 400 bad_<key> and returns -1. */
static int need_str(int fd, const char *b, size_t n, const char *key, char *out, size_t cap) {
    char tok[32];
    if (webui_json_str(b, n, key, out, cap) == 1 && out[0]) return 0;
    snprintf(tok, sizeof tok, "bad_%s", key);
    send_bad(fd, tok);
    return -1;
}

/* A required path: need_str, and never the AVA1 trust store or anything below it (the helper's
 * write policy refuses it already; this keeps the page from listing, stat'ing or reading it too).
 * On failure answers 400 / 403 and returns -1. */
static int need_path(int fd, const char *b, size_t n, const char *key, char *out, size_t cap) {
    if (need_str(fd, b, n, key, out, cap) != 0) return -1;
    if (!path_in_protected(out)) return 0;
    send_error(fd, 403, "path_not_allowed", 16);
    return -1;
}

/* An optional unsigned field: `def` when absent; on a bad value answers 400 bad_<key>, -1. */
static int opt_u64(int fd, const char *b, size_t n, const char *key, uint64_t def, uint64_t max, uint64_t *out) {
    char tok[32];
    int rc = webui_json_u64(b, n, key, out);
    if (rc == 0) {
        *out = def;
        return 0;
    }
    if (rc == 1 && *out <= max) return 0;
    snprintf(tok, sizeof tok, "bad_%s", key);
    send_bad(fd, tok);
    return -1;
}

static const char *kind_name(uint8_t k) {
    switch (k) {
    case AVA1_ENTRY_FILE: return "file";
    case AVA1_ENTRY_DIR: return "dir";
    case AVA1_ENTRY_LINK: return "link";
    default: return "other";
    }
}

/* ---- routes ---- */

typedef void (*api_fn)(const char *b, size_t n, uint8_t *out, int fd);

/* snprintf and webui_json_escape return the length they WANTED to write: after a truncation *at
 * would point past the buffer and `cap - *at` would wrap. Keep it on the NUL instead. */
static void clamp_at(size_t *at, size_t cap) {
    if (cap && *at > cap - 1) *at = cap - 1;
}

/* Appends printf output to buf at *at, never past cap (a truncated append is cut short). */
static void put_fmt(char *buf, size_t cap, size_t *at, const char *fmt, ...) __attribute__((format(printf, 4, 5)));
static void put_fmt(char *buf, size_t cap, size_t *at, const char *fmt, ...) {
    va_list ap;
    int k;
    clamp_at(at, cap);
    if (*at + 1 >= cap) return;
    va_start(ap, fmt);
    k = vsnprintf(buf + *at, cap - *at, fmt, ap);
    va_end(ap);
    if (k > 0) *at += (size_t)k;
    clamp_at(at, cap);
}

/* Appends `"key":"<escaped s>"` or `"key":null` (s NULL) to buf at *at. */
static void put_str(char *buf, size_t cap, size_t *at, const char *key, const char *s) {
    if (!s) {
        put_fmt(buf, cap, at, "\"%s\":null", key);
        return;
    }
    put_fmt(buf, cap, at, "\"%s\":\"", key);
    if (*at + 1 >= cap) return;
    *at += webui_json_escape(buf + *at, cap - *at, s, strlen(s));
    clamp_at(at, cap);
    put_fmt(buf, cap, at, "\"");
}

/* NODE_STATUS + HW_INFO (model) + HW_TEMPS + PROC_FOCUS. Each call is in-process and bounded by
 * its own handler; one that fails leaves its fields null instead of failing the route. */
static void r_status(const char *b, size_t n, uint8_t *out, int fd) {
    char version[96], firmware[64], model[128], title[16];
    const uint8_t *t;
    size_t ol, tl, at = 0;
    long soc = 0, cpu = 0, temp = 0;
    uint32_t app_id = 0;
    int have_ver = 0, have_model = 0, have_temp = 0, running = 0;
    (void)b;
    (void)n;
    if (call(AVA1_METHOD_NODE_STATUS, NULL, 0, out, &ol) == AVA1_STATUS_OK) {
        ava1_node_status_t ns;
        if (ava1_node_status_decode(out, ol, &ns) == 0) {
            char kernel[320];
            size_t vl = ns.version_len < sizeof version - 1 ? ns.version_len : sizeof version - 1;
            size_t kl = ns.ps5_kernel_len < sizeof kernel - 1 ? ns.ps5_kernel_len : sizeof kernel - 1;
            memcpy(version, ns.version, vl);
            version[vl] = '\0';
            memcpy(kernel, ns.ps5_kernel, kl);
            kernel[kl] = '\0';
            ps5_firmware_from_kernel(kernel, firmware, sizeof firmware);
            have_ver = 1;
        }
    }
    if (call_text(AVA1_METHOD_HW_INFO, NULL, 0, out, &ol, &t, &tl) == AVA1_STATUS_OK)
        have_model = webui_kv_str((const char *)t, tl, "model", model, sizeof model) == 1 && model[0];
    if (call_text(AVA1_METHOD_HW_TEMPS, NULL, 0, out, &ol, &t, &tl) == AVA1_STATUS_OK) {
        /* 0 means "no reading" (hw_info.c): the SoC junction sensor first, else the CPU's */
        if (webui_kv_int((const char *)t, tl, "soc_temp", &soc) == 1 && soc > 0) temp = soc;
        else if (webui_kv_int((const char *)t, tl, "cpu_temp", &cpu) == 1 && cpu > 0) temp = cpu;
        have_temp = temp > 0;
    }
    if (call_text(AVA1_METHOD_PROC_FOCUS, NULL, 0, out, &ol, &t, &tl) == AVA1_STATUS_OK)
        running = webui_focus_running((const char *)t, tl, title, sizeof title, &app_id) == 1;
    /* every string is copied out of `out` above: it is the JSON buffer now */
    {
        char *j = (char *)out;
        size_t cap = API_OUT_MAX;
        at = 0;
        put_fmt(j, cap, &at, "{");
        put_str(j, cap, &at, "version", have_ver ? version : NULL);
        put_fmt(j, cap, &at, ",");
        put_str(j, cap, &at, "firmware", have_ver ? firmware : NULL);
        put_fmt(j, cap, &at, ",");
        put_str(j, cap, &at, "model", have_model ? model : NULL);
        if (have_temp) put_fmt(j, cap, &at, ",\"temp_c\":%ld,\"running\":", temp);
        else put_fmt(j, cap, &at, ",\"temp_c\":null,\"running\":");
        if (running) {
            put_fmt(j, cap, &at, "{");
            put_str(j, cap, &at, "title_id", title);
            put_fmt(j, cap, &at, ",\"app_id\":%lu,\"name\":null}", (unsigned long)app_id);
        } else {
            put_fmt(j, cap, &at, "null");
        }
        put_fmt(j, cap, &at, "}");
        send_json(fd, 200, j, at);
    }
}

static void r_volumes(const char *b, size_t n, uint8_t *out, int fd) {
    const uint8_t *t;
    size_t ol, tl;
    int st;
    (void)b;
    (void)n;
    st = call_text(AVA1_METHOD_FS_VOLUMES, NULL, 0, out, &ol, &t, &tl);
    if (st != AVA1_STATUS_OK) {
        send_status_error(fd, st, out, ol);
        return;
    }
    send_json(fd, 200, (const char *)t, tl);
}

static void r_fs_list(const char *b, size_t n, uint8_t *out, int fd) {
    char path[API_PATH], req[API_PATH + 32];
    uint64_t offset, limit;
    ava1_fs_list_t q;
    ava1_w_t w;
    size_t ol;
    char *json;
    int st;
    if (need_path(fd, b, n, "path", path, sizeof path) != 0) return;
    if (opt_u64(fd, b, n, "offset", 0, UINT32_MAX, &offset) != 0) return;
    if (opt_u64(fd, b, n, "limit", API_LIST_MAX, UINT64_MAX, &limit) != 0) return;
    if (limit == 0 || limit > API_LIST_MAX) limit = API_LIST_MAX;
    memset(&q, 0, sizeof q);
    q.path = (const uint8_t *)path;
    q.path_len = (uint16_t)strlen(path);
    q.offset = (uint32_t)offset;
    q.limit = (uint16_t)limit;
    ava1_w_init(&w, (uint8_t *)req, sizeof req);
    if (ava1_fs_list_encode(&q, &w) != 0) {
        send_bad(fd, "bad_path");
        return;
    }
    st = call(AVA1_METHOD_FS_LIST, (const uint8_t *)req, w.len, out, &ol);
    if (st != AVA1_STATUS_OK) {
        send_status_error(fd, st, out, ol);
        return;
    }
    json = malloc(API_LIST_JSON);
    if (!json) {
        send_error(fd, 500, "out_of_memory", 13);
        return;
    }
    if (webui_list_to_json(out, ol, json, API_LIST_JSON) < 0) send_error(fd, 500, "bad_list_reply", 14);
    else send_json(fd, 200, json, strlen(json));
    free(json);
}

static void r_fs_stat(const char *b, size_t n, uint8_t *out, int fd) {
    char path[API_PATH], req[API_PATH + 16], json[160];
    ava1_fs_path_t q;
    ava1_fs_stat_t s;
    ava1_w_t w;
    size_t ol;
    int st, k;
    if (need_path(fd, b, n, "path", path, sizeof path) != 0) return;
    memset(&q, 0, sizeof q);
    q.path = (const uint8_t *)path;
    q.path_len = (uint16_t)strlen(path);
    ava1_w_init(&w, (uint8_t *)req, sizeof req);
    if (ava1_fs_path_encode(&q, &w) != 0) {
        send_bad(fd, "bad_path");
        return;
    }
    st = call(AVA1_METHOD_FS_STAT, (const uint8_t *)req, w.len, out, &ol);
    if (st != AVA1_STATUS_OK) {
        send_status_error(fd, st, out, ol);
        return;
    }
    if (ava1_fs_stat_decode(out, ol, &s) != 0) {
        send_error(fd, 500, "bad_stat_reply", 14);
        return;
    }
    k = snprintf(json, sizeof json, "{\"kind\":\"%s\",\"size\":%llu,\"mtime\":%llu,\"mode\":%lu}", kind_name(s.kind),
                 (unsigned long long)s.size, (unsigned long long)s.mtime, (unsigned long)s.mode);
    send_json(fd, 200, json, (size_t)k);
}

static void r_fs_mkdir(const char *b, size_t n, uint8_t *out, int fd) {
    char path[API_PATH], req[API_PATH + 32];
    ava1_fs_mkdir_t q;
    ava1_w_t w;
    size_t ol;
    int st;
    if (need_path(fd, b, n, "path", path, sizeof path) != 0) return;
    memset(&q, 0, sizeof q);
    q.path = (const uint8_t *)path;
    q.path_len = (uint16_t)strlen(path);
    q.mode = 0777;  /* the helper writes 0777 whatever is asked (game files must stay launchable) */
    q.parents = 1;  /* as the engine sends it (mgmt_convert.rs) */
    ava1_w_init(&w, (uint8_t *)req, sizeof req);
    if (ava1_fs_mkdir_encode(&q, &w) != 0) {
        send_bad(fd, "bad_path");
        return;
    }
    st = call(AVA1_METHOD_FS_MKDIR, (const uint8_t *)req, w.len, out, &ol);
    if (st != AVA1_STATUS_OK) send_status_error(fd, st, out, ol);
    else send_json(fd, 200, "{}", 2);
}

/* A rename never crosses a mount (it would panic the kernel): the helper refuses with
 * ERR_CROSS_DEVICE, answered 409 cross_mount, and the page copies with move set instead. An
 * existing target is refused (409 exists): the page does not overwrite by renaming. */
static void r_fs_rename(const char *b, size_t n, uint8_t *out, int fd) {
    char from[API_PATH], to[API_PATH], req[2 * API_PATH + 32];
    ava1_fs_rename_t q;
    ava1_w_t w;
    size_t ol;
    int st;
    if (need_path(fd, b, n, "from", from, sizeof from) != 0) return;
    if (need_path(fd, b, n, "to", to, sizeof to) != 0) return;
    memset(&q, 0, sizeof q);
    q.from = (const uint8_t *)from;
    q.from_len = (uint16_t)strlen(from);
    q.to = (const uint8_t *)to;
    q.to_len = (uint16_t)strlen(to);
    q.overwrite = 0;
    ava1_w_init(&w, (uint8_t *)req, sizeof req);
    if (ava1_fs_rename_encode(&q, &w) != 0) {
        send_bad(fd, "bad_path");
        return;
    }
    st = call(AVA1_METHOD_FS_RENAME, (const uint8_t *)req, w.len, out, &ol);
    if (st != AVA1_STATUS_OK) send_status_error(fd, st, out, ol);
    else send_json(fd, 200, "{}", 2);
}

/* Raw bytes, at most 1 MiB, in fs.read calls of up to AVA1_FS_READ_MAX each. */
static void r_fs_read(const char *b, size_t n, uint8_t *out, int fd) {
    char path[API_PATH], req[API_PATH + 32];
    uint64_t offset, len;
    uint8_t *data;
    size_t got = 0;
    if (need_path(fd, b, n, "path", path, sizeof path) != 0) return;
    if (opt_u64(fd, b, n, "offset", 0, (uint64_t)INT64_MAX, &offset) != 0) return;
    if (opt_u64(fd, b, n, "len", API_READ_MAX, UINT64_MAX, &len) != 0) return;
    if (len > API_READ_MAX) len = API_READ_MAX;
    data = malloc(len ? (size_t)len : 1);
    if (!data) {
        send_error(fd, 500, "out_of_memory", 13);
        return;
    }
    while (got < len) {
        ava1_fs_read_t q;
        ava1_fs_read_result_t r;
        ava1_w_t w;
        size_t ol;
        uint64_t ask = len - got;
        int st;
        if (ask > AVA1_FS_READ_MAX) ask = AVA1_FS_READ_MAX;
        memset(&q, 0, sizeof q);
        q.path = (const uint8_t *)path;
        q.path_len = (uint16_t)strlen(path);
        q.offset = offset + got;
        q.len = (uint32_t)ask;
        q.flags = 0; /* never the unsafe system-partition read */
        ava1_w_init(&w, (uint8_t *)req, sizeof req);
        if (ava1_fs_read_encode(&q, &w) != 0) {
            free(data);
            send_bad(fd, "bad_path");
            return;
        }
        st = call(AVA1_METHOD_FS_READ, (const uint8_t *)req, w.len, out, &ol);
        if (st != AVA1_STATUS_OK) {
            free(data);
            send_status_error(fd, st, out, ol);
            return;
        }
        if (ava1_fs_read_result_decode(out, ol, &r) != 0 || r.data_len > ask) {
            free(data);
            send_error(fd, 500, "bad_read_reply", 14);
            return;
        }
        memcpy(data + got, r.data, r.data_len);
        got += r.data_len;
        if (r.eof || r.data_len == 0) break;
    }
    /* nosniff is on every response (webui_http_head); the sandbox keeps a file opened as a document
     * from running script in this origin, whatever its bytes. */
    webui_send_ex(fd, 200, webui_mime_for(path), data, got, "Content-Security-Policy: sandbox\r\n");
    free(data);
}

static void send_job(int fd, const uint8_t id[16]) {
    char hex[33], json[48];
    int k;
    webui_hex16(id, hex);
    k = snprintf(json, sizeof json, "{\"job\":\"%s\"}", hex);
    send_json(fd, 200, json, (size_t)k);
}

static void r_fs_copy(const char *b, size_t n, uint8_t *out, int fd) {
    char src[API_PATH], dest[API_PATH];
    uint8_t req[2 * API_PATH + 64];
    ava1_job_copy_t q;
    ava1_w_t w;
    size_t ol;
    int move = 0, st, rc;
    if (need_path(fd, b, n, "src", src, sizeof src) != 0) return;
    if (need_path(fd, b, n, "dest", dest, sizeof dest) != 0) return;
    rc = webui_json_bool(b, n, "move", &move);
    if (rc < 0) {
        send_bad(fd, "bad_move");
        return;
    }
    memset(&q, 0, sizeof q);
    arc4random_buf(q.job_id, sizeof q.job_id); /* a fresh job: a known id would resume that job instead */
    q.src = (const uint8_t *)src;
    q.src_len = (uint16_t)strlen(src);
    q.dest = (const uint8_t *)dest;
    q.dest_len = (uint16_t)strlen(dest);
    q.flags = move ? (uint32_t)AVA1_JF_MOVE : 0u;
    ava1_w_init(&w, req, sizeof req);
    if (ava1_job_copy_encode(&q, &w) != 0) {
        send_bad(fd, "bad_path");
        return;
    }
    st = call(AVA1_METHOD_JOB_COPY, req, w.len, out, &ol);
    if (st != AVA1_STATUS_OK) send_status_error(fd, st, out, ol);
    else send_job(fd, q.job_id);
}

/* A one-path job (delete, chmod): op's args are {"path":...} plus `tail` (e.g. ,"mode":"0777"). */
static void run_path_job(const char *b, size_t n, uint8_t *out, int fd, int op, const char *tail) {
    char path[API_PATH], *args;
    uint8_t *req;
    size_t args_cap = 6 * API_PATH + 16, at, ol;
    ava1_job_run_t q;
    ava1_w_t w;
    int st;
    if (need_path(fd, b, n, "path", path, sizeof path) != 0) return;
    args = malloc(args_cap);
    req = malloc(args_cap + 64);
    if (!args || !req) {
        free(args);
        free(req);
        send_error(fd, 500, "out_of_memory", 13);
        return;
    }
    /* {"path":...}: fs_jobs.c's op_delete reads it with fsj_json_str (\" \\ \uXXXX understood) */
    at = (size_t)snprintf(args, args_cap, "{\"path\":\"");
    at += webui_json_escape(args + at, args_cap - at, path, strlen(path));
    if (at + 40 > args_cap) at = args_cap - 40; /* escape returns the full length (cannot trigger: 6x fits) */
    at += (size_t)snprintf(args + at, args_cap - at, "\"%s}", tail);
    memset(&q, 0, sizeof q);
    arc4random_buf(q.job_id, sizeof q.job_id);
    q.op = (uint8_t)op;
    q.args = (const uint8_t *)args;
    q.args_len = (uint32_t)at;
    ava1_w_init(&w, req, args_cap + 64);
    if (ava1_job_run_encode(&q, &w) != 0) {
        free(args);
        free(req);
        send_bad(fd, "bad_path");
        return;
    }
    st = call(AVA1_METHOD_JOB_RUN, req, w.len, out, &ol);
    free(args);
    free(req);
    if (st != AVA1_STATUS_OK) send_status_error(fd, st, out, ol);
    else send_job(fd, q.job_id);
}

static void r_fs_delete(const char *b, size_t n, uint8_t *out, int fd) {
    run_path_job(b, n, out, fd, AVA1_JOB_OP_DELETE, "");
}

/* Fix permissions: the PC app's recursive chmod, fixed to 0777 (the page never picks a mode). */
static void r_fs_chmod(const char *b, size_t n, uint8_t *out, int fd) {
    run_path_job(b, n, out, fd, AVA1_JOB_OP_CHMOD_R, ",\"mode\":\"0777\"");
}

static int is_mine(const uint8_t id[16], void *ctx) {
    (void)ctx;
    return ava1_jobs_owner_is(id, k_console_id);
}

static void r_jobs(const char *b, size_t n, uint8_t *out, int fd) {
    size_t ol = 0;
    char *json;
    int st;
    (void)b;
    (void)n;
    st = ava1_jobs_list_all(k_console_id, out, API_OUT_MAX, &ol);
    if (st != AVA1_STATUS_OK) {
        send_status_error(fd, st, NULL, 0);
        return;
    }
    json = malloc(API_JOBS_JSON);
    if (!json) {
        send_error(fd, 500, "out_of_memory", 13);
        return;
    }
    if (webui_jobs_to_json(out, ol, is_mine, NULL, json, API_JOBS_JSON) < 0) {
        send_error(fd, 500, "bad_jobs_reply", 14);
    } else {
        /* The page has now seen how its finished jobs ended: release them (after a short grace, so
         * a second open page still sees them) instead of letting each hold one of the 32 job slots
         * every owner shares for the full park age. A paired PC's jobs are left alone. */
        ava1_jobs_release_seen(k_console_id);
        send_json(fd, 200, json, strlen(json));
    }
    free(json);
}

/* Any job, a paired PC's included (the console's own screen may stop what runs on it). May block
 * on a socket write to that job's session: fine here, on a web worker. */
static void r_jobs_cancel(const char *b, size_t n, uint8_t *out, int fd) {
    char hex[40];
    uint8_t id[16];
    int st;
    (void)out;
    if (webui_json_str(b, n, "job", hex, sizeof hex) != 1 || webui_parse_hex16(hex, id) != 0) {
        send_bad(fd, "bad_job");
        return;
    }
    st = ava1_job_cancel_any(id);
    if (st != AVA1_STATUS_OK) send_status_error(fd, st, NULL, 0);
    else send_json(fd, 200, "{}", 2);
}

/* APP_LIFECYCLE kill, as the engine sends it: {"action":"kill","app_id":N}. */
static void r_app_close(const char *b, size_t n, uint8_t *out, int fd) {
    char req[64];
    const uint8_t *t;
    size_t ol, tl;
    uint64_t app_id;
    int k, st;
    if (webui_json_u64(b, n, "app_id", &app_id) != 1 || app_id == 0 || app_id > UINT32_MAX) {
        send_bad(fd, "bad_app_id");
        return;
    }
    k = snprintf(req, sizeof req, "{\"action\":\"kill\",\"app_id\":%lu}", (unsigned long)app_id);
    st = call_text(AVA1_METHOD_APP_LIFECYCLE, req, (size_t)k, out, &ol, &t, &tl);
    if (st != AVA1_STATUS_OK) send_status_error(fd, st, out, ol);
    else send_json(fd, 200, (const char *)t, tl);
}

/* ---- volumes: eject a USB drive, unmount a mounted image ---- */

/* USB_EJECT {"mount_point":"/mnt/usbN","force":"0"|"1"} as the engine sends it (fs_ops.rs usb_eject). The
 * helper accepts /mnt/usb0-7 only and answers {"ok":false,"err":"usb_eject_busy"} while the drive is held
 * open; that reaches the page as 409 usb_eject_busy, and it may ask again with force (sync, then a forced
 * unmount). */
static void r_volumes_eject(const char *b, size_t n, uint8_t *out, int fd) {
    char path[64], req[128];
    const uint8_t *t;
    size_t ol, tl;
    int force = 0, k, st;
    if (webui_json_str(b, n, "path", path, sizeof path) != 1 || strncmp(path, "/mnt/usb", 8) != 0 || path[8] < '0' ||
        path[8] > '7' || path[9] != '\0') {
        send_bad(fd, "bad_path");
        return;
    }
    if (webui_json_bool(b, n, "force", &force) < 0) {
        send_bad(fd, "bad_force");
        return;
    }
    k = snprintf(req, sizeof req, "{\"mount_point\":\"%s\",\"force\":\"%s\"}", path, force ? "1" : "0");
    st = call_text(AVA1_METHOD_USB_EJECT, req, (size_t)k, out, &ol, &t, &tl);
    if (st != AVA1_STATUS_OK) send_status_error(fd, st, out, ol);
    else send_json(fd, 200, "{}", 2);
}

/* FS_UNMOUNT {"mount_point":..} (fs_ops.rs fs_unmount): an image the helper mounted. The helper does NOT
 * refuse a busy mount: fs_mount_try_unmount (runtime.c) escalates to MNT_FORCE on EBUSY, so a game
 * running from the image would lose it mid-play. Ruling R20: refused here while any game runs (the same
 * PROC_FOCUS reading /api/status shows: 409 game_running), and the console's own volumes are never
 * unmounted from the page (403 system_volume; webui_unmount_refusal). The helper itself still refuses
 * mounts it did not make (fs_unmount_not_our_mount). */
static void r_volumes_unmount(const char *b, size_t n, uint8_t *out, int fd) {
    char path[API_PATH], req[API_PATH * 2 + 32];
    const uint8_t *t;
    size_t ol, tl, at = 0;
    int st;
    const char *why;
    char title[16];
    uint32_t app_id = 0;
    int running = 0;
    if (need_path(fd, b, n, "path", path, sizeof path) != 0) return;
    if (!webui_unmount_refusal(path, 0)) {
        /* a failed focus read counts as running: never force an unmount on a guess */
        running = call_text(AVA1_METHOD_PROC_FOCUS, NULL, 0, out, &ol, &t, &tl) != AVA1_STATUS_OK ||
                  webui_focus_running((const char *)t, tl, title, sizeof title, &app_id) != 0;
    }
    why = webui_unmount_refusal(path, running);
    if (why) {
        send_error(fd, strcmp(why, "game_running") == 0 ? 409 : 403, why, strlen(why));
        return;
    }
    put_fmt(req, sizeof req, &at, "{");
    put_str(req, sizeof req, &at, "mount_point", path);
    put_fmt(req, sizeof req, &at, "}");
    if (at + 1 >= sizeof req) {
        send_bad(fd, "bad_path");
        return;
    }
    st = call_text(AVA1_METHOD_FS_UNMOUNT, req, at, out, &ol, &t, &tl);
    if (st != AVA1_STATUS_OK) send_status_error(fd, st, out, ol);
    else send_json(fd, 200, "{}", 2);
}

/* ---- file manager prefs (files_prefs.c): pinned folders, recent folders, the last folder ---- */

static void send_prefs_error(int fd, int rc) {
    switch (rc) {
    case FILES_PREFS_E_BAD_PATH: send_bad(fd, "bad_path"); break;
    case FILES_PREFS_E_BAD_OP: send_bad(fd, "bad_op"); break;
    case FILES_PREFS_E_FULL: send_error(fd, 409, "prefs_full", 10); break;
    case FILES_PREFS_E_NOMEM: send_error(fd, 500, "out_of_memory", 13); break;
    default: send_error(fd, 500, "save_failed", 11); break;
    }
}

/* {} -> {"v":1,"favorites":[..],"recent":[..],"last":".."|null}. A garbled file answers empty lists. */
static void r_files_prefs(const char *b, size_t n, uint8_t *out, int fd) {
    int len;
    (void)b;
    if (n > FILES_PREFS_REQ_MAX) {
        send_error(fd, 413, "too_large", 9);
        return;
    }
    len = files_prefs_get(FILES_PREFS_PATH, (char *)out, API_OUT_MAX);
    if (len < 0) send_prefs_error(fd, len);
    else send_json(fd, 200, (const char *)out, (size_t)len);
}

/* {"op":"pin"|"unpin"|"visit","path":".."} -> the new prefs, as /api/files/prefs answers. */
static void r_files_prefs_set(const char *b, size_t n, uint8_t *out, int fd) {
    char op[16], path[API_PATH];
    int o, len;
    if (n > FILES_PREFS_REQ_MAX) {
        send_error(fd, 413, "too_large", 9);
        return;
    }
    if (webui_json_str(b, n, "op", op, sizeof op) != 1 || (o = files_prefs_op_from_name(op)) == 0) {
        send_bad(fd, "bad_op");
        return;
    }
    if (need_path(fd, b, n, "path", path, sizeof path) != 0) return;
    len = files_prefs_update(FILES_PREFS_PATH, o, path, (char *)out, API_OUT_MAX);
    if (len < 0) send_prefs_error(fd, len);
    else send_json(fd, 200, (const char *)out, (size_t)len);
}

/* ---- settings ---- */

/* The live settings. g_set_mu is held across a save, so two /api/settings/set calls never write
 * the file at once and memory always matches what is on disk. */
static pthread_mutex_t g_set_mu = PTHREAD_MUTEX_INITIALIZER;
static webui_settings_t g_set = { 0, 1 };
/* Serializes the LAN rebinds: each one reads the newest `lan` under it, so the last rebind to run
 * applies the last value saved, whatever order the threads ran in. */
static pthread_mutex_t g_rebind_mu = PTHREAD_MUTEX_INITIALIZER;

void webui_api_settings_init(const webui_settings_t *s) {
    pthread_mutex_lock(&g_set_mu);
    g_set = *s;
    pthread_mutex_unlock(&g_set_mu);
}

/* tile_busy / tile_failed: the tile switch is applied on the tile thread after this reply (Sony calls
 * take seconds), so the page re-reads /api/settings until tile_busy is false and then says so when
 * the last ensure/remove failed (webui_tile_state). */
static void send_settings(int fd, const webui_settings_t *s) {
    char json[200];
    int busy, failed, k;
    webui_tile_state(&busy, &failed);
    k = snprintf(json, sizeof json,
                 "{\"lan\":%s,\"tile\":%s,\"tile_busy\":%s,\"tile_failed\":%s,\"version\":\"%s\"}",
                 s->lan ? "true" : "false", s->tile ? "true" : "false", busy ? "true" : "false",
                 failed ? "true" : "false", PS5UPLOAD2_VERSION);
    send_json(fd, 200, json, (size_t)k);
}

static void r_settings(const char *b, size_t n, uint8_t *out, int fd) {
    webui_settings_t s;
    (void)b;
    (void)n;
    (void)out;
    pthread_mutex_lock(&g_set_mu);
    s = g_set;
    pthread_mutex_unlock(&g_set_mu);
    send_settings(fd, &s);
}

/* Rebinds the listener for the saved `lan`. Runs on its own thread, started after the reply was
 * written: webui_restart waits up to 1.5 s for the bind, which must not hold a web worker, and the
 * page that asked keeps working (the token survives webui_restart; open connections are not
 * touched, only the listener). */
static void *rebind_main(void *arg) {
    int lan;
    (void)arg;
    proc_name_set_self("ps5upload-web");
    pthread_mutex_lock(&g_rebind_mu);
    pthread_mutex_lock(&g_set_mu);
    lan = g_set.lan;
    pthread_mutex_unlock(&g_set_mu);
    if (webui_restart(lan) != 0) fprintf(stderr, "webui: rebind for lan=%d not bound yet (the server keeps retrying)\n", lan);
    pthread_mutex_unlock(&g_rebind_mu);
    return NULL;
}

static void spawn_lan_apply(void) {
    pthread_attr_t attr;
    pthread_t t;
    int rc = -1;
    if (pthread_attr_init(&attr) == 0) {
        if (pthread_attr_setstacksize(&attr, 256u * 1024u) == 0 &&
            pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED) == 0)
            rc = pthread_create(&t, &attr, rebind_main, NULL);
        pthread_attr_destroy(&attr);
    }
    if (rc != 0) fprintf(stderr, "webui: cannot start the rebind thread (%d); LAN applies at the next start\n", rc);
}

/* {lan?, tile?}: saved first (the file is the truth at the next start), then answered with the
 * new settings, then applied: a `lan` change rebinds the listener on a thread of its own, a `tile`
 * change (or tile:true again) registers or removes the tile on the tile thread. A failed save
 * changes nothing. */
static void r_settings_set(const char *b, size_t n, uint8_t *out, int fd) {
    webui_settings_t old, s;
    int lan, tile, has_lan, has_tile;
    (void)out;
    has_lan = webui_json_bool(b, n, "lan", &lan);
    if (has_lan < 0) {
        send_bad(fd, "bad_lan");
        return;
    }
    has_tile = webui_json_bool(b, n, "tile", &tile);
    if (has_tile < 0) {
        send_bad(fd, "bad_tile");
        return;
    }
    pthread_mutex_lock(&g_set_mu);
    old = s = g_set;
    if (has_lan) s.lan = lan;
    if (has_tile) s.tile = tile;
    if ((s.lan != old.lan || s.tile != old.tile) && webui_settings_save(WEBUI_SETTINGS_PATH, &s) != 0) {
        pthread_mutex_unlock(&g_set_mu);
        send_error(fd, 500, "save_failed", 11);
        return;
    }
    g_set = s;
    pthread_mutex_unlock(&g_set_mu);
    /* tile:true is applied even when unchanged: it retries an ensure that failed (and costs one statfs
     * plus three file compares when the tile is already in place). A remove only on a change. Requested
     * before the reply (it only starts the tile thread), so the reply already says tile_busy. */
    if (has_tile && (s.tile || s.tile != old.tile)) webui_tile_request(s.tile, WEBUI_PORT);
    send_settings(fd, &s); /* written in full (or the deadline passed) before the rebind below runs */
    if (s.lan != old.lan) spawn_lan_apply();
}

int webui_api_tile_off(void) {
    webui_settings_t s;
    int rc = 0;
    pthread_mutex_lock(&g_set_mu);
    s = g_set;
    s.tile = 0;
    /* The tile is removed whatever the save does, so memory says off even when the save fails:
     * Settings then shows what is true (the file may still say on until the next successful save). */
    if (g_set.tile && webui_settings_save(WEBUI_SETTINGS_PATH, &s) != 0) {
        fprintf(stderr, "webui: cannot save tile:false after a PC removed the tile\n");
        rc = -1;
    }
    g_set = s;
    pthread_mutex_unlock(&g_set_mu);
    webui_tile_request(0, WEBUI_PORT);
    return rc;
}

/* ---- cheats: the running game's cheats, through the methods the engine calls (cheats.rs) ---- */

#define API_CHEATS_JSON (96u * 1024u) /* CHEATS_GET's 64 KiB reply, re-escaped */

/* A required title id the cheat methods can take (webui_cheats_title_ok); else 400 bad_title_id. */
static int need_title(int fd, const char *b, size_t n, char *out, size_t cap) {
    if (webui_json_str(b, n, "title_id", out, cap) == 1 && webui_cheats_title_ok(out)) return 0;
    send_bad(fd, "bad_title_id");
    return -1;
}

/* CHEATS_STATUS (empty request): {"engine":bool,"game":{"title_id":..}|null}. Cheap (the helper
 * caches the running game): the page polls it. */
static void r_cheats_status(const char *b, size_t n, uint8_t *out, int fd) {
    const uint8_t *t;
    size_t ol, tl;
    char json[96];
    int st;
    (void)b;
    (void)n;
    st = call_text(AVA1_METHOD_CHEATS_STATUS, NULL, 0, out, &ol, &t, &tl);
    if (st != AVA1_STATUS_OK) {
        send_status_error(fd, st, out, ol);
        return;
    }
    if (webui_cheats_status_to_json((const char *)t, tl, json, sizeof json) != 0) send_error(fd, 500, "bad_cheats_reply", 16);
    else send_json(fd, 200, json, strlen(json));
}

/* {title_id}: CHEATS_GET {"title_id":..}, as {"mods":[{index,name,desc,button,on}],"truncated":bool}. */
static void r_cheats_list(const char *b, size_t n, uint8_t *out, int fd) {
    char title[32], req[64], err[API_CAUSE_MAX];
    const uint8_t *t;
    size_t ol, tl;
    char *json;
    int st, k;
    if (need_title(fd, b, n, title, sizeof title) != 0) return;
    k = snprintf(req, sizeof req, "{\"title_id\":\"%s\"}", title); /* letters and digits only */
    st = call_text(AVA1_METHOD_CHEATS_GET, req, (size_t)k, out, &ol, &t, &tl);
    if (st != AVA1_STATUS_OK) {
        send_status_error(fd, st, out, ol);
        return;
    }
    json = malloc(API_CHEATS_JSON);
    if (!json) {
        send_error(fd, 500, "out_of_memory", 13);
        return;
    }
    if (webui_cheats_mods_to_json((const char *)t, tl, json, API_CHEATS_JSON, err, sizeof err) < 0) {
        if (err[0]) send_error(fd, 500, err, strlen(err));
        else send_error(fd, 500, "bad_cheats_reply", 16);
    } else {
        send_json(fd, 200, json, strlen(json));
    }
    free(json);
}

static int cheats_error_http(const char *token) {
    if (strcmp(token, "game_not_running") == 0 || strcmp(token, "module_missing") == 0) return 409;
    if (strcmp(token, "no_cheats") == 0) return 404;
    if (strcmp(token, "bad_index") == 0) return 400;
    return 500;
}

/* {title_id, index, on}: CHEATS_TOGGLE as the engine sends it. The helper refuses unless that game
 * is running (it patches the live process) and turns its cheat engine on with any switch-on. A
 * refusal is {"error":"game_not_running"|"no_cheats"|"bad_index"|"module_missing"|"toggle_failed"}. */
static void r_cheats_toggle(const char *b, size_t n, uint8_t *out, int fd) {
    char title[32], req[96];
    const uint8_t *t;
    size_t ol, tl;
    uint64_t index;
    int on, st, k;
    if (need_title(fd, b, n, title, sizeof title) != 0) return;
    if (webui_json_u64(b, n, "index", &index) != 1 || index > 0x7fffffffu) {
        send_bad(fd, "bad_index");
        return;
    }
    if (webui_json_bool(b, n, "on", &on) != 1) {
        send_bad(fd, "bad_on");
        return;
    }
    k = snprintf(req, sizeof req, "{\"title_id\":\"%s\",\"index\":%lu,\"on\":%s}", title, (unsigned long)index,
                 on ? "true" : "false");
    st = call_text(AVA1_METHOD_CHEATS_TOGGLE, req, (size_t)k, out, &ol, &t, &tl);
    if (st != AVA1_STATUS_OK) {
        /* the handler's whole {"ok":false,"err":..} body is the cause (mgmt_call_text_keep) */
        if (ol && out[0] == '{') {
            const char *tok = webui_cheats_toggle_error((const char *)out, ol);
            send_error(fd, cheats_error_http(tok), tok, strlen(tok));
        } else {
            send_status_error(fd, st, out, ol);
        }
        return;
    }
    {
        const char *ok = on ? "{\"ok\":true,\"on\":true}" : "{\"ok\":true,\"on\":false}";
        send_json(fd, 200, ok, strlen(ok));
    }
}

/* ---- input log ---- */

/* One append at a time (the file is a ring rewritten in place), and a rate gate: a page that
 * ignores its one-a-second rule is told 429 instead of making the helper write. Its last batch
 * ({"final":true}, as Controls closes or the page is hidden) may follow a regular one sooner, once
 * per window (webui_inputlog_gate_admit). */
static pthread_mutex_t g_inlog_mu = PTHREAD_MUTEX_INITIALIZER;
static webui_inputlog_gate g_inlog_gate = WEBUI_INPUTLOG_GATE_INIT;
#define INLOG_MIN_GAP_MS 500 /* half the page's period: its timer jitter never trips it */
#define INLOG_LINES_CAP (8u * 1024u)

static long long mono_ms(void) {
    struct timespec ts;
    if (clock_gettime(CLOCK_MONOTONIC, &ts) != 0) return 0;
    return (long long)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

/* {events:["<line>",...]}: appended to WEBUI_INPUTLOG_PATH (webui_inputlog.c checks every line).
 * `out` (API_OUT_MAX, heap) holds the lines, then serves as the ring rewrite's scratch. */
static void r_input_log(const char *b, size_t n, uint8_t *out, int fd) {
    const char *arr;
    size_t alen;
    long lines;
    int rc, final = 0;
    _Static_assert(INLOG_LINES_CAP + WEBUI_INPUTLOG_CAP <= API_OUT_MAX, "input log scratch must fit the route buffer");
    if (n > WEBUI_INPUTLOG_BODY_MAX) {
        send_error(fd, 413, "too_large", 9);
        return;
    }
    if (webui_json_array(b, n, "events", &arr, &alen) != 1) {
        send_bad(fd, "bad_events");
        return;
    }
    lines = webui_inputlog_lines(arr, alen, (char *)out, INLOG_LINES_CAP);
    if (lines < 0) {
        send_bad(fd, "bad_events");
        return;
    }
    if (webui_json_bool(b, n, "final", &final) != 1) final = 0;
    pthread_mutex_lock(&g_inlog_mu);
    if (!webui_inputlog_gate_admit(&g_inlog_gate, mono_ms(), final != 0, INLOG_MIN_GAP_MS)) {
        pthread_mutex_unlock(&g_inlog_mu);
        send_error(fd, 429, "too_many", 8);
        return;
    }
    rc = webui_inputlog_append(WEBUI_INPUTLOG_PATH, (const char *)out, (size_t)lines, WEBUI_INPUTLOG_CAP,
                               (char *)out + INLOG_LINES_CAP, API_OUT_MAX - INLOG_LINES_CAP);
    pthread_mutex_unlock(&g_inlog_mu);
    if (rc != 0) send_error(fd, 500, "write_failed", 12);
    else send_json(fd, 200, "{\"ok\":true}", 11);
}

/* The allowlist: nothing else is reachable. */
static const struct {
    const char *path;
    api_fn fn;
} k_routes[] = {
    { "/api/status", r_status },
    { "/api/volumes", r_volumes },
    { "/api/volumes/eject", r_volumes_eject },
    { "/api/volumes/unmount", r_volumes_unmount },
    { "/api/files/prefs", r_files_prefs },
    { "/api/files/prefs/set", r_files_prefs_set },
    { "/api/fs/list", r_fs_list },
    { "/api/fs/stat", r_fs_stat },
    { "/api/fs/mkdir", r_fs_mkdir },
    { "/api/fs/rename", r_fs_rename },
    { "/api/fs/read", r_fs_read },
    { "/api/fs/copy", r_fs_copy },
    { "/api/fs/delete", r_fs_delete },
    { "/api/fs/chmod", r_fs_chmod },
    { "/api/jobs", r_jobs },
    { "/api/jobs/cancel", r_jobs_cancel },
    { "/api/app/close", r_app_close },
    { "/api/settings", r_settings },
    { "/api/settings/set", r_settings_set },
    { "/api/input-log", r_input_log },
    { "/api/cheats/status", r_cheats_status },
    { "/api/cheats/list", r_cheats_list },
    { "/api/cheats/toggle", r_cheats_toggle },
};

/* The page's own headers: only same-origin fetches, inline script/style (the page is one file),
 * data:/blob: images; nosniff is on every response already. Never framed (frame-ancestors plus
 * X-Frame-Options for older engines): with LAN access on, another site could otherwise frame the
 * page, whose token works inside the frame, and click its buttons for the user. */
#define PAGE_HEADERS                                                                       \
    "Content-Encoding: gzip\r\n"                                                          \
    "Content-Security-Policy: default-src 'self' 'unsafe-inline' data: blob:; connect-src 'self'; " \
    "frame-ancestors 'none'\r\n"                                                          \
    "X-Frame-Options: DENY\r\n"
/* webui_send_ex builds the head in 512 bytes and sends nothing when it does not fit: the fixed
 * part (status line, Content-Type text/html, a 10-digit length, Connection, Cache-Control,
 * nosniff, final CRLF) is under 200 bytes, so the extra lines get at most 300. */
_Static_assert(sizeof(PAGE_HEADERS) <= 300, "PAGE_HEADERS must fit webui_send_ex's 512-byte head");

/* One language's strings (webui_strings.h): gzip'd JSON, cached for a year. The page asks with
 * ?v=<hash of the strings> (the query is not read here), so every build is a new URL. */
#define STRINGS_HEADERS                                       \
    "Content-Encoding: gzip\r\n"                              \
    "Cache-Control: public, max-age=31536000, immutable\r\n"
_Static_assert(sizeof(STRINGS_HEADERS) <= 300, "STRINGS_HEADERS must fit webui_send_ex's 512-byte head");

#define STRINGS_PREFIX "/strings/"

/* GET /, GET /api/token and GET /strings/<lang>.json: the server checked Host/Origin but no token
 * (is_api is 0 for all three). None reaches a helper method, so they stay outside the in-flight RPC
 * gate. The token goes out as JSON with no CORS headers: another site's page cannot read the reply,
 * and loaded through a <script> tag it executes nothing. Never serve it as JavaScript. A strings
 * path names one of the embedded languages exactly (webui_strings_find) or answers 404. */
static int serve_static(const webui_req_t *r, int fd) {
    int page = strcmp(r->path, "/") == 0;
    int strings = strncmp(r->path, STRINGS_PREFIX, sizeof STRINGS_PREFIX - 1) == 0;
    if (!page && !strings && strcmp(r->path, "/api/token") != 0) return 0;
    if (strcmp(r->method, "GET") != 0) {
        webui_send_json(fd, 405, "{\"error\":\"method_not_allowed\"}");
        return 1;
    }
    if (strings) {
        const webui_strings_entry_t *e = webui_strings_find(webui_strings_table, webui_strings_count, r->path);
        if (!e) webui_send_json(fd, 404, "{\"error\":\"not_found\"}");
        else webui_send_ex(fd, 200, "application/json", e->data, e->len, STRINGS_HEADERS);
    } else if (page) {
        webui_send_ex(fd, 200, "text/html; charset=utf-8", webui_page_gz, webui_page_gz_len, PAGE_HEADERS);
    } else {
        char tok[65], json[96];
        int n;
        webui_token_copy(tok);
        if (!tok[0]) {
            webui_send_json(fd, 503, "{\"error\":\"stopping\"}");
            return 1;
        }
        n = snprintf(json, sizeof json, "{\"token\":\"%s\"}", tok);
        send_json(fd, 200, json, (size_t)n);
    }
    return 1;
}

int webui_api_route(const webui_req_t *r, const uint8_t *body, size_t body_len, int fd) {
    size_t i;
    uint8_t *out;
    if (serve_static(r, fd)) return 0;
    for (i = 0; i < sizeof k_routes / sizeof k_routes[0]; i++)
        if (strcmp(r->path, k_routes[i].path) == 0) break;
    if (i == sizeof k_routes / sizeof k_routes[0]) {
        webui_send_json(fd, 404, "{\"error\":\"not_found\"}");
        return 0;
    }
    if (strcmp(r->method, "POST") != 0) {
        webui_send_json(fd, 405, "{\"error\":\"method_not_allowed\"}");
        return 0;
    }
    /* Counted with the AVA1 workers' RPCs, so the exit (ava1_payload_stop) waits for this call
     * before it stops the data layer; refused once the exit has begun. Every route reaches the
     * helper (mgmt, data layer, job table), so the whole route is inside the gate. */
    if (ava1_server_local_rpc_enter() != 0) {
        webui_send_json(fd, 503, "{\"error\":\"stopping\"}");
        return 0;
    }
    /* Every call acts as the console page, never as whichever device this thread served last. */
    ava1_server_set_rpc_peer(k_console_id);
    out = malloc(API_OUT_MAX);
    if (!out) {
        ava1_server_local_rpc_leave();
        webui_send_json(fd, 500, "{\"error\":\"out_of_memory\"}");
        return 0;
    }
    k_routes[i].fn((const char *)body, body_len, out, fd);
    free(out);
    ava1_server_local_rpc_leave();
    return 0;
}
