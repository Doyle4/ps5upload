/* game_patch.c — see include/game_patch.h. Pure C, no console calls. */
#include "game_patch.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>

/* ── XML scanning ────────────────────────────────────────────────── */

void gp_strip_comments(char *xml) {
    if (!xml) return;
    char *p = xml;
    while ((p = strstr(p, "<!--"))) {
        char *e = strstr(p + 4, "-->");
        char *stop = e ? e + 3 : p + strlen(p);
        memset(p, ' ', (size_t)(stop - p));
        p = stop;
    }
}

/* The '>' closing the tag that starts at `p` ('<'), skipping quoted attribute values (which may
 * hold '>'). NULL when the tag never closes. */
static const char *tag_close(const char *p) {
    char q = 0;
    for (; *p; p++) {
        if (q) {
            if (*p == q) q = 0;
        } else if (*p == '"' || *p == '\'') {
            q = *p;
        } else if (*p == '>') {
            return p;
        }
    }
    return NULL;
}

/* Next "<name" tag at or after p (the name followed by whitespace, '/' or '>'), before `end` when
 * end is not NULL. */
static const char *find_tag(const char *p, const char *end, const char *name) {
    size_t n = strlen(name);
    while ((p = strstr(p, name))) {
        if (end && p >= end) return NULL;
        char c = p[n];
        if (c == ' ' || c == '\t' || c == '\r' || c == '\n' || c == '/' || c == '>') return p;
        p += n;
    }
    return NULL;
}

static void entity_decode(char *s) {
    static const struct { const char *e; char c; } E[] = {
        {"&lt;", '<'}, {"&gt;", '>'}, {"&quot;", '"'}, {"&apos;", '\''}, {"&amp;", '&'},
    };
    char *r = s, *w = s;
    while (*r) {
        if (*r == '&') {
            int done = 0;
            for (size_t i = 0; i < sizeof E / sizeof E[0]; i++) {
                size_t l = strlen(E[i].e);
                if (strncmp(r, E[i].e, l) == 0) {
                    *w++ = E[i].c;
                    r += l;
                    done = 1;
                    break;
                }
            }
            if (!done && r[1] == '#') {
                char *end = NULL;
                unsigned long cp = (r[2] == 'x' || r[2] == 'X') ? strtoul(r + 3, &end, 16)
                                                                : strtoul(r + 2, &end, 10);
                if (end && *end == ';' && cp > 0 && cp < 0x80) {
                    *w++ = (char)cp;
                    r = end + 1;
                    done = 1;
                }
            }
            if (done) continue;
        }
        *w++ = *r++;
    }
    *w = '\0';
}

/* Attribute `name` of the tag [tag, end). 1 and the decoded value in out, or 0 when absent (out is
 * then ""). A value longer than cap is cut. */
static int attr(const char *tag, const char *end, const char *name, char *out, size_t cap) {
    size_t n = strlen(name);
    if (cap) out[0] = '\0';
    char q = 0;
    for (const char *p = tag + 1; p < end; p++) { /* tag[0] is '<', so p[-1] stays in bounds */
        if (q) {
            if (*p == q) q = 0;
            continue;
        }
        if (*p == '"' || *p == '\'') {
            q = *p;
            continue;
        }
        if ((p[-1] == ' ' || p[-1] == '\t' || p[-1] == '\r' || p[-1] == '\n') &&
            (size_t)(end - p) > n && strncmp(p, name, n) == 0) {
            const char *v = p + n;
            while (v < end && (*v == ' ' || *v == '\t' || *v == '\r' || *v == '\n')) v++;
            if (v >= end || *v != '=') continue;
            v++;
            while (v < end && (*v == ' ' || *v == '\t' || *v == '\r' || *v == '\n')) v++;
            if (v >= end || (*v != '"' && *v != '\'')) continue;
            char vq = *v++;
            size_t i = 0;
            while (v < end && *v != vq) {
                if (i + 1 < cap) out[i++] = *v;
                v++;
            }
            if (cap) out[i < cap ? i : cap - 1] = '\0';
            entity_decode(out);
            return 1;
        }
    }
    return 0;
}

/* Entry `index`: its opening tag [*tag, *tag_end] and its body up to *body_end. 0 or -1. */
static int find_entry(const char *xml, int index, const char **tag, const char **tag_end,
                      const char **body_end) {
    const char *p = xml;
    for (int i = 0; p && i <= index && i < GP_MAX_ENTRIES; i++) {
        p = find_tag(p, NULL, "<Metadata");
        if (!p) return -1;
        const char *te = tag_close(p);
        if (!te) return -1;
        if (i == index) {
            const char *be;
            if (te > p && te[-1] == '/') {
                be = te; /* <Metadata .../>: no lines */
            } else {
                be = strstr(te, "</Metadata>");
                if (!be) be = te + strlen(te);
            }
            *tag = p;
            *tag_end = te;
            *body_end = be;
            return 0;
        }
        p = te + 1;
    }
    return -1;
}

int gp_count(const char *xml) {
    if (!xml) return 0;
    int n = 0;
    const char *p = xml;
    while (n < GP_MAX_ENTRIES && (p = find_tag(p, NULL, "<Metadata"))) {
        const char *te = tag_close(p);
        if (!te) break;
        n++;
        p = te + 1;
    }
    return n;
}

static int parse_hex_u64(const char *s, uint64_t *out) {
    while (*s == ' ' || *s == '\t') s++;
    if (s[0] == '0' && (s[1] == 'x' || s[1] == 'X')) s += 2;
    else if (*s == '#' || *s == '$') s++;
    if (!isxdigit((unsigned char)*s)) return -1;
    char *end = NULL;
    *out = strtoull(s, &end, 16);
    while (end && (*end == ' ' || *end == '\t')) end++;
    return (end && *end == '\0') ? 0 : -1;
}

int gp_meta(const char *xml, int index, gp_meta_t *m) {
    const char *tag, *te, *be;
    memset(m, 0, sizeof *m);
    if (!xml || find_entry(xml, index, &tag, &te, &be) != 0) return -1;
    attr(tag, te, "Title", m->title, sizeof m->title);
    attr(tag, te, "Name", m->name, sizeof m->name);
    attr(tag, te, "Note", m->note, sizeof m->note);
    attr(tag, te, "Author", m->author, sizeof m->author);
    attr(tag, te, "AppVer", m->app_ver, sizeof m->app_ver);
    attr(tag, te, "AppElf", m->app_elf, sizeof m->app_elf);
    char ib[40];
    if (attr(tag, te, "ImageBase", ib, sizeof ib) && ib[0]) {
        uint64_t v = 0;
        if (parse_hex_u64(ib, &v) == 0) {
            m->has_imagebase = 1;
            m->imagebase = v;
        }
    }
    return 0;
}

/* ── Values ──────────────────────────────────────────────────────── */

static int hexv(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

int gp_pattern(const char *s, uint8_t *pat, uint8_t *wild, int max) {
    int n = 0;
    const char *p = s;
    while (*p) {
        if (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') {
            p++;
            continue;
        }
        if (n >= max) return -1;
        if (*p == '?') {
            p++;
            if (*p == '?') p++;
            pat[n] = 0;
            wild[n] = 1;
            n++;
            continue;
        }
        int h = hexv(p[0]);
        if (h < 0) return -1;
        int l = hexv(p[1]);
        if (l < 0) {
            /* a single digit, as strtoul would read it */
            pat[n] = (uint8_t)h;
            p += 1;
        } else {
            pat[n] = (uint8_t)(h << 4 | l);
            p += 2;
        }
        wild[n] = 0;
        n++;
    }
    return n > 0 ? n : -1;
}

/* Hex digit string (separators allowed). An odd count: the first digit is a byte of its own, as
 * GoldHEN reads it. */
static int hex_bytes(const char *s, uint8_t *out, int cap) {
    char d[2 * GP_VALUE_MAX + 2];
    int nd = 0;
    for (const char *p = s; *p; p++) {
        if (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') continue;
        if (hexv(*p) < 0) return -1;
        if (nd >= (int)sizeof d - 1) return -1;
        d[nd++] = *p;
    }
    if (nd == 0) return -1;
    int n = 0, i = 0;
    if (nd % 2) {
        out[n++] = (uint8_t)hexv(d[0]);
        i = 1;
    }
    for (; i < nd; i += 2) {
        if (n >= cap) return -1;
        out[n++] = (uint8_t)(hexv(d[i]) << 4 | hexv(d[i + 1]));
    }
    return n;
}

static int number(const char *s, int width, uint8_t *out) {
    while (*s == ' ' || *s == '\t') s++;
    uint64_t v = 0;
    char *end = NULL;
    if ((s[0] == '0' && (s[1] == 'x' || s[1] == 'X')) || s[0] == '#' || s[0] == '$') {
        const char *h = s[0] == '0' ? s + 2 : s + 1;
        if (!isxdigit((unsigned char)*h)) return -1;
        v = strtoull(h, &end, 16);
    } else {
        if (!(isdigit((unsigned char)*s) || ((*s == '-' || *s == '+') && isdigit((unsigned char)s[1]))))
            return -1;
        v = (uint64_t)strtoll(s, &end, 10);
    }
    while (end && (*end == ' ' || *end == '\t')) end++;
    if (!end || *end) return -1;
    for (int i = 0; i < width; i++) out[i] = (uint8_t)(v >> (8 * i));
    return width;
}

/* Backslash escapes in utf8 / utf16 strings: \n \r \t \\ \" \0 \xNN. */
static int unescape(const char *s, char *out, int cap) {
    int n = 0;
    for (const char *p = s; *p; p++) {
        char c = *p;
        if (c == '\\' && p[1]) {
            p++;
            switch (*p) {
            case 'n': c = '\n'; break;
            case 'r': c = '\r'; break;
            case 't': c = '\t'; break;
            case '0': c = '\0'; break;
            case 'x':
                if (hexv(p[1]) >= 0 && hexv(p[2]) >= 0) {
                    c = (char)(hexv(p[1]) << 4 | hexv(p[2]));
                    p += 2;
                } else {
                    c = 'x';
                }
                break;
            default: c = *p; break;
            }
        }
        if (n >= cap) return -1;
        out[n++] = c;
    }
    return n;
}

int gp_value(const char *type, const char *value, uint8_t *out, int cap) {
    if (!type || !value) return -1;
    const char *t = type;
    if (strcmp(t, "mask") == 0) t = "bytes";
    else if (strncmp(t, "mask_", 5) == 0) t += 5;

    if (strcmp(t, "byte") == 0) return cap >= 1 ? number(value, 1, out) : -1;
    if (strcmp(t, "bytes16") == 0) return cap >= 2 ? number(value, 2, out) : -1;
    if (strcmp(t, "bytes32") == 0) return cap >= 4 ? number(value, 4, out) : -1;
    if (strcmp(t, "bytes64") == 0) return cap >= 8 ? number(value, 8, out) : -1;
    if (strcmp(t, "bytes") == 0 || strcmp(t, "jump32") == 0 || strcmp(t, "patchCall") == 0)
        return hex_bytes(value, out, cap);
    if (strcmp(t, "float32") == 0 || strcmp(t, "float64") == 0) {
        char *end = NULL;
        double d = strtod(value, &end);
        if (end == value) return -1;
        if (t[5] == '3') {
            float f = (float)d;
            if (cap < 4) return -1;
            memcpy(out, &f, 4);
            return 4;
        }
        if (cap < 8) return -1;
        memcpy(out, &d, 8);
        return 8;
    }
    if (strcmp(t, "utf8") == 0) {
        int n = unescape(value, (char *)out, cap - 1);
        if (n < 0) return -1;
        out[n++] = 0; /* "strings must be manually null terminated" — GoldHEN writes one anyway */
        return n;
    }
    if (strcmp(t, "utf16") == 0) {
        char tmp[GP_VALUE_MAX];
        int n = unescape(value, tmp, (int)sizeof tmp);
        if (n < 0) return -1;
        int o = 0;
        for (int i = 0; i < n;) {
            unsigned char c = (unsigned char)tmp[i];
            uint32_t cp;
            int len;
            if (c < 0x80) { cp = c; len = 1; }
            else if ((c & 0xE0) == 0xC0 && i + 1 < n) { cp = (uint32_t)(c & 0x1F) << 6 | (tmp[i + 1] & 0x3F); len = 2; }
            else if ((c & 0xF0) == 0xE0 && i + 2 < n) {
                cp = (uint32_t)(c & 0x0F) << 12 | (uint32_t)(tmp[i + 1] & 0x3F) << 6 | (tmp[i + 2] & 0x3F);
                len = 3;
            } else if ((c & 0xF8) == 0xF0 && i + 3 < n) {
                cp = (uint32_t)(c & 0x07) << 18 | (uint32_t)(tmp[i + 1] & 0x3F) << 12 |
                     (uint32_t)(tmp[i + 2] & 0x3F) << 6 | (tmp[i + 3] & 0x3F);
                len = 4;
            } else { cp = '?'; len = 1; }
            i += len;
            if (cp >= 0x10000) {
                if (o + 4 > cap) return -1;
                uint32_t v = cp - 0x10000;
                uint16_t hi = (uint16_t)(0xD800 | (v >> 10)), lo = (uint16_t)(0xDC00 | (v & 0x3FF));
                out[o++] = (uint8_t)hi; out[o++] = (uint8_t)(hi >> 8);
                out[o++] = (uint8_t)lo; out[o++] = (uint8_t)(lo >> 8);
            } else {
                if (o + 2 > cap) return -1;
                out[o++] = (uint8_t)cp;
                out[o++] = (uint8_t)(cp >> 8);
            }
        }
        if (o + 2 > cap) return -1;
        out[o++] = 0;
        out[o++] = 0;
        return o;
    }
    return -1;
}

/* ── Lines ───────────────────────────────────────────────────────── */

static int parse_offset(const char *s, int64_t *out) {
    while (*s == ' ') s++;
    if (!*s) { *out = 0; return 0; }
    int neg = 0;
    if (*s == '+') s++;
    else if (*s == '-') { neg = 1; s++; }
    char *end = NULL;
    long long v = (s[0] == '0' && (s[1] == 'x' || s[1] == 'X')) ? strtoll(s + 2, &end, 16)
                                                                 : strtoll(s, &end, 10);
    if (end == s || (end && *end)) return -1;
    *out = neg ? -v : v;
    return 0;
}

/* One <Line>'s attributes (a Value can be a long string, Address a long pattern). */
typedef struct {
    char type[40];
    char addr[1024];
    char val[2 * GP_VALUE_MAX + 8];
    char off[40];
    char tgt[1024];
    char size[16];
} line_attrs_t;

int gp_lines(const char *xml, int index, gp_line_t **out, char *err, size_t err_cap) {
    const char *tag, *te, *be;
    *out = NULL;
    if (err && err_cap) err[0] = '\0';
    gp_meta_t m;
    if (!xml || gp_meta(xml, index, &m) != 0 || find_entry(xml, index, &tag, &te, &be) != 0) {
        if (err) snprintf(err, err_cap, "patch entry not found");
        return -1;
    }
    int cap = 16, n = 0, lineno = 0;
    gp_line_t *v = (gp_line_t *)malloc((size_t)cap * sizeof *v);
    if (!v) {
        if (err) snprintf(err, err_cap, "out of memory");
        return -1;
    }
    /* Attribute buffers (a Value can be a long string, Address a long pattern), on the heap: the
     * helper's management handlers that reach this keep small stacks (tools/mgmt_audit.py). */
    line_attrs_t *A = (line_attrs_t *)malloc(sizeof(line_attrs_t));
    if (!A) {
        if (err) snprintf(err, err_cap, "out of memory");
        free(v);
        return -1;
    }
    char *type = A->type, *addr = A->addr, *val = A->val, *off = A->off, *tgt = A->tgt, *size = A->size;
    for (const char *p = te + 1; (p = find_tag(p, be, "<Line"));) {
        const char *le = tag_close(p);
        if (!le || le > be) break;
        lineno++;
        attr(p, le, "Type", type, sizeof A->type);
        attr(p, le, "Address", addr, sizeof A->addr);
        attr(p, le, "Value", val, sizeof A->val);
        attr(p, le, "Offset", off, sizeof A->off);
        attr(p, le, "Target", tgt, sizeof A->tgt);
        attr(p, le, "Size", size, sizeof A->size);
        p = le + 1;
        if (!addr[0] || !val[0]) continue;
        if (n >= GP_MAX_LINES) {
            if (err) snprintf(err, err_cap, "patch has more than %d lines", GP_MAX_LINES);
            free(v);
            free(A);
            return -1;
        }
        if (n == cap) {
            gp_line_t *g = (gp_line_t *)realloc(v, (size_t)cap * 2 * sizeof *v);
            if (!g) {
                if (err) snprintf(err, err_cap, "out of memory");
                free(v);
                free(A);
                return -1;
            }
            v = g;
            cap *= 2;
        }
        gp_line_t *l = &v[n];
        memset(l, 0, sizeof *l);
        int is_mask = strncmp(type, "mask", 4) == 0;
        if (strcmp(type, "mask_jump32") == 0) l->kind = GP_JUMP32;
        else if (strcmp(type, "patchCall") == 0 || strcmp(type, "mask_patchCall") == 0) l->kind = GP_CALL;
        else l->kind = is_mask ? GP_MASK : GP_WRITE;

        l->value_len = gp_value(type, val, l->value, GP_VALUE_MAX);
        if (l->value_len <= 0) {
            if (err) {
                if (gp_value(type, "0", l->value, GP_VALUE_MAX) < 0 && gp_value(type, "00", l->value, GP_VALUE_MAX) < 0)
                    snprintf(err, err_cap, "line %d: type \"%s\" is not supported", lineno, type);
                else
                    snprintf(err, err_cap, "line %d: bad %s value", lineno, type);
            }
            free(v);
            free(A);
            return -1;
        }
        if (is_mask) {
            l->by_pattern = 1;
            l->pat_len = gp_pattern(addr, l->pat, l->wild, GP_PATTERN_MAX);
            if (l->pat_len <= 0 || parse_offset(off, &l->match_offset) != 0) {
                if (err) snprintf(err, err_cap, "line %d: bad pattern or offset", lineno);
                free(v);
                free(A);
                return -1;
            }
            if (l->kind == GP_JUMP32) {
                l->tpat_len = gp_pattern(tgt, l->tpat, l->twild, GP_PATTERN_MAX);
                l->jump_size = size[0] ? atoi(size) : 5;
                if (l->tpat_len <= 0 || l->jump_size < 5 || l->jump_size > GP_PATTERN_MAX ||
                    l->value_len + 5 > GP_VALUE_MAX) {
                    if (err) snprintf(err, err_cap, "line %d: bad jump target or size", lineno);
                    free(v);
                    free(A);
                    return -1;
                }
            }
        } else {
            uint64_t a = 0;
            if (parse_hex_u64(addr, &a) != 0 || gp_rel(&m, a, &l->offset) != 0) {
                if (err) snprintf(err, err_cap, "line %d: bad address \"%s\"", lineno, addr);
                free(v);
                free(A);
                return -1;
            }
        }
        n++;
    }
    free(A);
    if (n == 0) {
        if (err) snprintf(err, err_cap, "patch has no lines");
        free(v);
        return -1;
    }
    *out = v;
    return n;
}

/* ── Helpers for the apply side ──────────────────────────────────── */

long gp_find(const uint8_t *hay, size_t n, const uint8_t *pat, const uint8_t *wild, int len) {
    if (len <= 0 || (size_t)len > n) return -1;
    int anchor = -1;
    for (int i = 0; i < len; i++)
        if (!wild[i]) { anchor = i; break; }
    if (anchor < 0) return 0;
    size_t last = n - (size_t)len;
    size_t i = 0;
    while (i <= last) {
        const uint8_t *hit = memchr(hay + i + anchor, pat[anchor], last - i + 1);
        if (!hit) return -1;
        size_t at = (size_t)(hit - hay) - (size_t)anchor;
        int ok = 1;
        for (int j = 0; j < len; j++)
            if (!wild[j] && hay[at + j] != pat[j]) { ok = 0; break; }
        if (ok) return (long)at;
        i = at + 1;
    }
    return -1;
}

int gp_rel(const gp_meta_t *m, uint64_t addr, uint64_t *off) {
    uint64_t base = m->has_imagebase ? m->imagebase : GP_NO_ASLR_PS4;
    if (addr < base) return -1;
    *off = addr - base;
    return 0;
}

int gp_version_ok(const char *app_ver, const char *content_ver, const char *app_ver2) {
    if (!app_ver || !app_ver[0]) return 0;
    if (strncasecmp(app_ver, "mask", 4) == 0 || strncasecmp(app_ver, "all", 3) == 0) return 1;
    if (content_ver && content_ver[0] && strcmp(app_ver, content_ver) == 0) return 1;
    if (app_ver2 && app_ver2[0] && strcmp(app_ver, app_ver2) == 0) return 1;
    return 0;
}

static int ends_with_ci(const char *s, const char *suf) {
    size_t a = strlen(s), b = strlen(suf);
    return a >= b && strcasecmp(s + a - b, suf) == 0;
}

int gp_elf_is_module(const char *app_elf) {
    return app_elf && (ends_with_ci(app_elf, ".prx") || ends_with_ci(app_elf, ".sprx"));
}

int gp_elf_ok(const char *app_elf, const char *exe_path) {
    if (!app_elf || !app_elf[0] || !exe_path || !exe_path[0]) return 1;
    const char *b = strrchr(exe_path, '/');
    b = b ? b + 1 : exe_path;
    return strcasecmp(app_elf, b) == 0;
}

int gp_jump32(uint64_t site, uint64_t cave, int jump_size, const uint8_t *value, int value_len,
              uint8_t *site_out, uint8_t *cave_out) {
    if (jump_size < 5 || jump_size > GP_PATTERN_MAX || value_len < 0) return -1;
    int64_t to_cave = (int64_t)cave - (int64_t)(site + 5);
    uint64_t back_from = cave + (uint64_t)value_len + 5;
    int64_t to_site = (int64_t)(site + (uint64_t)jump_size) - (int64_t)back_from;
    if (to_cave < INT32_MIN || to_cave > INT32_MAX || to_site < INT32_MIN || to_site > INT32_MAX)
        return -1;
    int32_t a = (int32_t)to_cave, b = (int32_t)to_site;
    site_out[0] = 0xE9;
    memcpy(site_out + 1, &a, 4);
    for (int i = 5; i < jump_size; i++) site_out[i] = 0x90;
    memcpy(cave_out, value, (size_t)value_len);
    cave_out[value_len] = 0xE9;
    memcpy(cave_out + value_len + 1, &b, 4);
    return 0;
}
