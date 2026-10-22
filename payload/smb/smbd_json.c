/* See smbd_json.h. The scanner follows payload/src/webui_codec.c's (same bounds, same refusals). */
#include "smbd_json.h"

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char *ws(const char *p, const char *e) {
    while (p < e && (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r')) p++;
    return p;
}

static const char *skip_str(const char *p, const char *e) {
    for (p++; p < e; p++) {
        if (*p == '\\') {
            if (++p >= e) return NULL;
        } else if (*p == '"') {
            return p + 1;
        }
    }
    return NULL;
}

static int is_delim(char c) { return c == ',' || c == '}' || c == ']' || c == ' ' || c == '\t' || c == '\n' || c == '\r'; }

static const char *skip_val(const char *p, const char *e) {
    int depth = 0;
    if (p >= e) return NULL;
    if (*p == '"') return skip_str(p, e);
    if (*p != '{' && *p != '[') {
        const char *s = p;
        while (p < e && !is_delim(*p)) p++;
        return p > s ? p : NULL;
    }
    while (p < e) {
        if (*p == '"') {
            p = skip_str(p, e);
            if (!p) return NULL;
            continue;
        }
        if (*p == '{' || *p == '[') depth++;
        else if (*p == '}' || *p == ']') {
            if (--depth == 0) return p + 1;
        }
        p++;
    }
    return NULL;
}

static const char *top_value(const char *json, size_t n, const char *key) {
    const char *e, *p;
    size_t kl = strlen(key);
    if (!json) return NULL;
    e = json + n;
    p = ws(json, e);
    if (p >= e || *p != '{') return NULL;
    p++;
    for (;;) {
        const char *ks, *ke;
        p = ws(p, e);
        if (p >= e || *p != '"') return NULL;
        ks = p + 1;
        ke = skip_str(p, e);
        if (!ke) return NULL;
        p = ws(ke, e);
        if (p >= e || *p != ':') return NULL;
        p = ws(p + 1, e);
        if (p >= e) return NULL;
        if ((size_t)(ke - 1 - ks) == kl && memcmp(ks, key, kl) == 0) return p;
        p = skip_val(p, e);
        if (!p) return NULL;
        p = ws(p, e);
        if (p < e && *p == ',') {
            p++;
            continue;
        }
        return NULL;
    }
}

static int hexval(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

static long hex4(const char *p, const char *e) {
    long v = 0;
    int i;
    if (e - p < 4) return -1;
    for (i = 0; i < 4; i++) {
        int h = hexval(p[i]);
        if (h < 0) return -1;
        v = v * 16 + h;
    }
    return v;
}

static size_t put_utf8(unsigned long cp, unsigned char u[4]) {
    if (cp < 0x80) {
        u[0] = (unsigned char)cp;
        return 1;
    }
    if (cp < 0x800) {
        u[0] = (unsigned char)(0xc0 | (cp >> 6));
        u[1] = (unsigned char)(0x80 | (cp & 0x3f));
        return 2;
    }
    if (cp < 0x10000) {
        u[0] = (unsigned char)(0xe0 | (cp >> 12));
        u[1] = (unsigned char)(0x80 | ((cp >> 6) & 0x3f));
        u[2] = (unsigned char)(0x80 | (cp & 0x3f));
        return 3;
    }
    u[0] = (unsigned char)(0xf0 | (cp >> 18));
    u[1] = (unsigned char)(0x80 | ((cp >> 12) & 0x3f));
    u[2] = (unsigned char)(0x80 | ((cp >> 6) & 0x3f));
    u[3] = (unsigned char)(0x80 | (cp & 0x3f));
    return 4;
}

static int decode_str(const char *p, const char *e, char *out, size_t cap) {
    size_t o = 0;
    if (p >= e || *p != '"' || cap == 0) return -1;
    for (p++; p < e; p++) {
        unsigned char c = (unsigned char)*p, u[4];
        unsigned long cp;
        size_t k, ul;
        if (c == '"') {
            out[o] = '\0';
            return 1;
        }
        if (c < 0x20) return -1;
        if (c != '\\') {
            if (o + 1 >= cap) return -1;
            out[o++] = (char)c;
            continue;
        }
        if (++p >= e) return -1;
        switch (*p) {
        case '"': cp = '"'; break;
        case '\\': cp = '\\'; break;
        case '/': cp = '/'; break;
        case 'b': cp = '\b'; break;
        case 'f': cp = '\f'; break;
        case 'n': cp = '\n'; break;
        case 'r': cp = '\r'; break;
        case 't': cp = '\t'; break;
        case 'u': {
            long v = hex4(p + 1, e);
            if (v < 0) return -1;
            p += 4;
            if (v >= 0xdc00 && v <= 0xdfff) return -1;
            if (v >= 0xd800 && v <= 0xdbff) {
                long lo;
                if (e - p < 7 || p[1] != '\\' || p[2] != 'u') return -1;
                lo = hex4(p + 3, e);
                if (lo < 0xdc00 || lo > 0xdfff) return -1;
                p += 6;
                v = 0x10000 + ((v - 0xd800) << 10) + (lo - 0xdc00);
            }
            if (v == 0) return -1;
            cp = (unsigned long)v;
            break;
        }
        default: return -1;
        }
        ul = put_utf8(cp, u);
        if (o + ul >= cap) return -1;
        for (k = 0; k < ul; k++) out[o++] = (char)u[k];
    }
    return -1;
}

int sj_str(const char *json, size_t n, const char *key, char *out, size_t cap) {
    const char *p = top_value(json, n, key);
    if (cap) out[0] = '\0';
    if (!p) return 0;
    if (decode_str(p, json + n, out, cap) != 1) {
        if (cap) out[0] = '\0';
        return -1;
    }
    return 1;
}

int sj_u64(const char *json, size_t n, const char *key, uint64_t *out) {
    const char *p = top_value(json, n, key), *e = json + n;
    uint64_t v = 0;
    int digits = 0;
    if (!p) return 0;
    while (p < e && *p >= '0' && *p <= '9') {
        uint64_t d = (uint64_t)(*p - '0');
        if (v > (UINT64_MAX - d) / 10) return -1;
        v = v * 10 + d;
        p++;
        digits++;
    }
    if (!digits || (p < e && !is_delim(*p))) return -1;
    *out = v;
    return 1;
}

int sj_bool(const char *json, size_t n, const char *key, int *out) {
    const char *p = top_value(json, n, key), *e = json + n;
    if (!p) return 0;
    if (e - p >= 4 && memcmp(p, "true", 4) == 0 && (e - p == 4 || is_delim(p[4]))) {
        *out = 1;
        return 1;
    }
    if (e - p >= 5 && memcmp(p, "false", 5) == 0 && (e - p == 5 || is_delim(p[5]))) {
        *out = 0;
        return 1;
    }
    return -1;
}

/* ---- builder ---- */

void sj_init(sj_buf_t *b, size_t max) {
    memset(b, 0, sizeof *b);
    b->max = max;
}

void sj_free(sj_buf_t *b) {
    free(b->buf);
    memset(b, 0, sizeof *b);
}

static int grow(sj_buf_t *b, size_t add) {
    size_t want, cap;
    char *nb;
    if (b->err) return -1;
    want = b->len + add + 1;
    if (b->max && want > b->max) {
        b->err = 1;
        return -1;
    }
    if (want <= b->cap) return 0;
    cap = b->cap ? b->cap : 256;
    while (cap < want) cap *= 2;
    if (b->max && cap > b->max) cap = b->max;
    nb = realloc(b->buf, cap);
    if (!nb) {
        b->err = 1;
        return -1;
    }
    b->buf = nb;
    b->cap = cap;
    return 0;
}

static void append(sj_buf_t *b, const char *s, size_t n) {
    if (grow(b, n) != 0) return;
    memcpy(b->buf + b->len, s, n);
    b->len += n;
    b->buf[b->len] = '\0';
}

void sj_raw(sj_buf_t *b, const char *s) { append(b, s, strlen(s)); }

void sj_fmt(sj_buf_t *b, const char *fmt, ...) {
    char tmp[512];
    va_list ap;
    int k;
    va_start(ap, fmt);
    k = vsnprintf(tmp, sizeof tmp, fmt, ap);
    va_end(ap);
    if (k < 0) {
        b->err = 1;
        return;
    }
    if ((size_t)k >= sizeof tmp) k = (int)sizeof tmp - 1;
    append(b, tmp, (size_t)k);
}

/* The length of the valid UTF-8 sequence at s (1-4), or 0 when it is not one. */
static size_t utf8_len(const unsigned char *s, size_t left) {
    unsigned long cp;
    size_t n, i;
    if (s[0] < 0x80) return 1;
    if ((s[0] & 0xe0) == 0xc0) {
        n = 2;
        cp = s[0] & 0x1f;
    } else if ((s[0] & 0xf0) == 0xe0) {
        n = 3;
        cp = s[0] & 0x0f;
    } else if ((s[0] & 0xf8) == 0xf0) {
        n = 4;
        cp = s[0] & 0x07;
    } else {
        return 0;
    }
    if (left < n) return 0;
    for (i = 1; i < n; i++) {
        if ((s[i] & 0xc0) != 0x80) return 0;
        cp = (cp << 6) | (s[i] & 0x3f);
    }
    if ((n == 2 && cp < 0x80) || (n == 3 && cp < 0x800) || (n == 4 && cp < 0x10000) || cp > 0x10ffff ||
        (cp >= 0xd800 && cp <= 0xdfff))
        return 0;
    return n;
}

void sj_strlit(sj_buf_t *b, const char *s) {
    const unsigned char *p = (const unsigned char *)(s ? s : "");
    size_t left = strlen((const char *)p);
    append(b, "\"", 1);
    while (left) {
        size_t ul;
        char esc[8];
        if (*p == '"' || *p == '\\') {
            esc[0] = '\\';
            esc[1] = (char)*p;
            append(b, esc, 2);
            p++;
            left--;
            continue;
        }
        if (*p < 0x20 || *p == 0x7f) {
            snprintf(esc, sizeof esc, "\\u%04x", *p);
            append(b, esc, 6);
            p++;
            left--;
            continue;
        }
        ul = utf8_len(p, left);
        if (!ul) {
            append(b, "\\ufffd", 6);
            p++;
            left--;
            continue;
        }
        append(b, (const char *)p, ul);
        p += ul;
        left -= ul;
    }
    append(b, "\"", 1);
}

void sj_kv_str(sj_buf_t *b, int comma, const char *key, const char *s) {
    if (comma) sj_raw(b, ",");
    sj_strlit(b, key);
    sj_raw(b, ":");
    sj_strlit(b, s);
}
