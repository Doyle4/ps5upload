/* The console web UI's JSON API: see include/webui_api.h.
 *
 * Each route decodes its JSON body (webui_codec.c), encodes the AVA1 request into a buffer,
 * dispatches it through ava1_payload_rpc (the AVA1 server's own entry: data plane first, then
 * the management table with its per-call credential/breadcrumb hooks), and turns the reply
 * back into JSON. Routes run on the web server's worker threads (256 KiB stacks): every reply
 * buffer is on the heap. */
#include "webui_api.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "ava1_data.h"
#include "ava1_gen.h"
#include "ava1_glue.h"
#include "ava1_op.h"
#include "ava1_server.h"
#include "ava1_wire.h"
#include "path_policy.h"
#include "ps5_firmware.h"
#include "webui_codec.h"
#include "webui_server.h"

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
    if (at + 3 > sizeof buf) at = sizeof buf - 3; /* cannot happen: 6 bytes per input byte at most */
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

/* Appends `"key":"<escaped s>"` or `"key":null` (s NULL) to buf at *at. */
static void put_str(char *buf, size_t cap, size_t *at, const char *key, const char *s) {
    if (*at >= cap) return;
    if (!s) {
        *at += (size_t)snprintf(buf + *at, cap - *at, "\"%s\":null", key);
        return;
    }
    *at += (size_t)snprintf(buf + *at, cap - *at, "\"%s\":\"", key);
    if (*at >= cap) return;
    *at += webui_json_escape(buf + *at, cap - *at, s, strlen(s));
    if (*at >= cap) return;
    *at += (size_t)snprintf(buf + *at, cap - *at, "\"");
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
        at = (size_t)snprintf(j, cap, "{");
        put_str(j, cap, &at, "version", have_ver ? version : NULL);
        at += (size_t)snprintf(j + at, cap - at, ",");
        put_str(j, cap, &at, "firmware", have_ver ? firmware : NULL);
        at += (size_t)snprintf(j + at, cap - at, ",");
        put_str(j, cap, &at, "model", have_model ? model : NULL);
        if (have_temp) at += (size_t)snprintf(j + at, cap - at, ",\"temp_c\":%ld,\"running\":", temp);
        else at += (size_t)snprintf(j + at, cap - at, ",\"temp_c\":null,\"running\":");
        if (running) {
            at += (size_t)snprintf(j + at, cap - at, "{");
            put_str(j, cap, &at, "title_id", title);
            at += (size_t)snprintf(j + at, cap - at, ",\"app_id\":%lu,\"name\":null}", (unsigned long)app_id);
        } else {
            at += (size_t)snprintf(j + at, cap - at, "null");
        }
        at += (size_t)snprintf(j + at, cap - at, "}");
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
    webui_send(fd, 200, webui_mime_for(path), data, got);
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

static void r_fs_delete(const char *b, size_t n, uint8_t *out, int fd) {
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
    memcpy(args + at, "\"}", 3);
    at += 2;
    memset(&q, 0, sizeof q);
    arc4random_buf(q.job_id, sizeof q.job_id);
    q.op = (uint8_t)AVA1_JOB_OP_DELETE;
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
    if (webui_jobs_to_json(out, ol, is_mine, NULL, json, API_JOBS_JSON) < 0) send_error(fd, 500, "bad_jobs_reply", 14);
    else send_json(fd, 200, json, strlen(json));
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

/* POWER_CONTROL: rest (the helper's "standby"), reboot, shutdown. The helper replies first and
 * acts ~0.4 s later, so this answer reaches the page before the network goes down. */
static void r_power(const char *b, size_t n, uint8_t *out, int fd) {
    char action[16], req[48];
    const char *sys;
    const uint8_t *t;
    size_t ol, tl;
    int k, st;
    if (webui_json_str(b, n, "action", action, sizeof action) != 1) {
        send_bad(fd, "bad_action");
        return;
    }
    if (strcmp(action, "rest") == 0) sys = "standby";
    else if (strcmp(action, "reboot") == 0) sys = "reboot";
    else if (strcmp(action, "shutdown") == 0) sys = "shutdown";
    else {
        send_bad(fd, "bad_action");
        return;
    }
    k = snprintf(req, sizeof req, "{\"action\":\"%s\"}", sys);
    st = call_text(AVA1_METHOD_POWER_CONTROL, req, (size_t)k, out, &ol, &t, &tl);
    if (st != AVA1_STATUS_OK) send_status_error(fd, st, out, ol);
    else send_json(fd, 200, (const char *)t, tl);
}

/* The allowlist: nothing else is reachable. (/api/settings and /api/settings/set: Task 6.) */
static const struct {
    const char *path;
    api_fn fn;
} k_routes[] = {
    { "/api/status", r_status },
    { "/api/volumes", r_volumes },
    { "/api/fs/list", r_fs_list },
    { "/api/fs/stat", r_fs_stat },
    { "/api/fs/mkdir", r_fs_mkdir },
    { "/api/fs/rename", r_fs_rename },
    { "/api/fs/read", r_fs_read },
    { "/api/fs/copy", r_fs_copy },
    { "/api/fs/delete", r_fs_delete },
    { "/api/jobs", r_jobs },
    { "/api/jobs/cancel", r_jobs_cancel },
    { "/api/app/close", r_app_close },
    { "/api/power", r_power },
};

int webui_api_route(const webui_req_t *r, const uint8_t *body, size_t body_len, int fd) {
    size_t i;
    uint8_t *out;
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
    /* Every call acts as the console page, never as whichever device this thread served last. */
    ava1_server_set_rpc_peer(k_console_id);
    out = malloc(API_OUT_MAX);
    if (!out) {
        webui_send_json(fd, 500, "{\"error\":\"out_of_memory\"}");
        return 0;
    }
    k_routes[i].fn((const char *)body, body_len, out, fd);
    free(out);
    return 0;
}
