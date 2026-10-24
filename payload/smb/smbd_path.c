/* See smbd_path.h. */
#include "smbd_path.h"

#include <stdio.h>
#include <string.h>

const char *smbp_err_token(int e) {
    switch (e) {
    case XE_OK: return "ok";
    case XE_NOT_FOUND: return "not_found";
    case XE_EXISTS: return "exists";
    case XE_ACCESS: return "access_denied";
    case XE_NO_SPACE: return "no_space";
    case XE_DISCONNECTED: return "smb_disconnected";
    case XE_TIMEOUT: return "smb_timeout";
    case XE_AUTH: return "smb_auth";
    case XE_NO_SHARE: return "smb_no_share";
    case XE_UNREACHABLE: return "smb_unreachable";
    case XE_CANCELLED: return "cancelled";
    case XE_NOT_DIR: return "not_dir";
    case XE_IS_DIR: return "is_dir";
    case XE_BAD_NAME: return "bad_name";
    case XE_NOMEM: return "out_of_memory";
    case XE_BAD_REQUEST: return "bad_request";
    case XE_BUSY: return "busy";
    case XE_TOO_DEEP: return "too_deep";
    case XE_INTO_ITSELF: return "into_itself";
    case XE_NOT_SUPPORTED: return "smb_not_supported";
    default: return "io_error";
    }
}

/* The length of the valid UTF-8 sequence at s (1-4; overlongs, surrogates and > U+10FFFF refused),
 * or 0. */
static size_t u8len(const unsigned char *s) {
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
    for (i = 1; i < n; i++) {
        if ((s[i] & 0xc0) != 0x80) return 0; /* also stops at the NUL */
        cp = (cp << 6) | (s[i] & 0x3f);
    }
    if ((n == 2 && cp < 0x80) || (n == 3 && cp < 0x800) || (n == 4 && cp < 0x10000) || cp > 0x10ffff ||
        (cp >= 0xd800 && cp <= 0xdfff))
        return 0;
    return n;
}

static int utf8_ok(const char *s) {
    const unsigned char *p = (const unsigned char *)s;
    while (*p) {
        size_t n = u8len(p);
        if (!n) return 0;
        p += n;
    }
    return 1;
}

int smbp_name_readable(const char *name) {
    const unsigned char *p = (const unsigned char *)name;
    size_t len;
    if (!name) return 0;
    len = strlen(name);
    if (len == 0 || len >= SMBP_NAME_MAX) return 0;
    if (strcmp(name, ".") == 0 || strcmp(name, "..") == 0) return 0;
    for (; *p; p++) {
        if (*p < 0x20 || *p == 0x7f) return 0;
        if (*p == '/' || *p == '\\') return 0;
    }
    return utf8_ok(name);
}

int smbp_name_ok(const char *name) {
    const unsigned char *p = (const unsigned char *)name;
    if (!smbp_name_readable(name)) return 0;
    for (; *p; p++)
        if (strchr(":*?\"<>|", *p)) return 0;
    return 1;
}

int smbp_rel_normalize(const char *in, char *out, size_t cap) {
    const char *p = in, *e;
    size_t o = 0;
    if (!in || !cap) return -1;
    out[0] = '\0';
    while (*p == '/') p++;
    e = p + strlen(p);
    while (e > p && e[-1] == '/') e--;
    while (p < e) {
        const char *s = p;
        char comp[SMBP_NAME_MAX];
        size_t n;
        while (p < e && *p != '/') p++;
        n = (size_t)(p - s);
        if (n == 0 || n >= sizeof comp) goto bad; /* "a//b" or an over-long name */
        memcpy(comp, s, n);
        comp[n] = '\0';
        /* Names that exist on the server (a Linux/macOS NAS holds "God of War: Ragnarok"): the lax
         * rule. The strict one applies where WE create a name there (mkdir, an upload's target). */
        if (!smbp_name_readable(comp)) goto bad;
        if (o + (o ? 1 : 0) + n + 1 > cap) goto bad;
        if (o) out[o++] = '/';
        memcpy(out + o, comp, n);
        o += n;
        out[o] = '\0';
        if (p < e) p++; /* the '/' */
    }
    if (o + 1 > SMBP_PATH_MAX) goto bad;
    return 0;
bad:
    out[0] = '\0';
    return -1;
}

int smbp_join(const char *dir, const char *name, char *out, size_t cap) {
    int k;
    if (!dir[0]) k = snprintf(out, cap, "%s", name);
    else if (strcmp(dir, "/") == 0) k = snprintf(out, cap, "/%s", name);
    else k = snprintf(out, cap, "%s/%s", dir, name);
    if (k < 0 || (size_t)k >= cap) {
        if (cap) out[0] = '\0';
        return -1;
    }
    return 0;
}

void smbp_parent(const char *path, char *out, size_t cap) {
    const char *slash = strrchr(path, '/');
    size_t n;
    if (!cap) return;
    if (!slash) {
        out[0] = '\0';
        return;
    }
    n = (size_t)(slash - path);
    if (n == 0 && path[0] == '/') n = 1; /* "/x" -> "/" */
    if (n >= cap) n = cap - 1;
    memcpy(out, path, n);
    out[n] = '\0';
}

const char *smbp_base(const char *path) {
    const char *slash = strrchr(path, '/');
    return slash ? slash + 1 : path;
}

int smbp_local_ok(const char *path) {
    const char *p;
    size_t len;
    if (!path || path[0] != '/') return 0;
    len = strlen(path);
    if (len >= SMBP_PATH_MAX) return 0;
    if (len == 1) return 1;
    if (path[len - 1] == '/') return 0;
    for (p = path; *p; p++)
        if ((unsigned char)*p < 0x20 || *p == 0x7f) return 0;
    p = path;
    while (*p) {
        const char *s;
        size_t n;
        p++; /* the '/' */
        s = p;
        while (*p && *p != '/') p++;
        n = (size_t)(p - s);
        if (n == 0) return 0;
        if ((n == 1 && s[0] == '.') || (n == 2 && s[0] == '.' && s[1] == '.')) return 0;
    }
    return utf8_ok(path);
}

int smbp_part_name(const char *path, char *out, size_t cap) {
    int k = snprintf(out, cap, "%s%s", path, SMBP_PART_SUFFIX);
    if (k < 0 || (size_t)k >= cap) {
        if (cap) out[0] = '\0';
        return -1;
    }
    return 0;
}

int smbp_skip_download(const char *name) {
    return strncmp(name, "._", 2) == 0 || strcmp(name, ".DS_Store") == 0;
}

int smbp_host_ok(const char *host) {
    size_t len, i;
    int colons = 0, pct = 0;
    if (!host) return 0;
    len = strlen(host);
    if (len == 0 || len > 253) return 0;
    for (i = 0; i < len; i++) {
        unsigned char c = (unsigned char)host[i];
        if (c == ':') {
            colons++;
            continue;
        }
        if (c == '%') {
            /* an IPv6 zone ("fe80::1%em0"): only after a ':' address */
            if (!colons || pct) return 0;
            pct = 1;
            continue;
        }
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' || c == '-' ||
            c == '_')
            continue;
        return 0;
    }
    if (colons == 1) return 0; /* "host:port" belongs in smbp_parse_server */
    if (host[0] == '-' || host[0] == '.') return 0;
    return 1;
}

int smbp_share_ok(const char *share) {
    if (!share || !smbp_name_ok(share)) return 0;
    /* the RPC pipe, never a folder (compared case-insensitively, as servers do) */
    if (strlen(share) == 4 && (share[0] == 'I' || share[0] == 'i') && (share[1] == 'P' || share[1] == 'p') &&
        (share[2] == 'C' || share[2] == 'c') && share[3] == '$')
        return 0;
    return 1;
}

static int copy_n(char *out, size_t cap, const char *s, size_t n) {
    if (n >= cap) return -1;
    memcpy(out, s, n);
    out[n] = '\0';
    return 0;
}

int smbp_parse_server(const char *in, char *host, size_t host_cap, uint16_t *port, char *share, size_t share_cap,
                      char *path, size_t path_cap) {
    char buf[SMBP_PATH_MAX + SMBP_HOST_MAX];
    const char *p, *auth_end, *h, *he;
    size_t len, i;
    unsigned long pv = 445;
    if (!in || !host_cap || !share_cap || !path_cap) return -1;
    host[0] = share[0] = path[0] = '\0';
    *port = 445;
    while (*in == ' ' || *in == '\t') in++;
    len = strlen(in);
    while (len && (in[len - 1] == ' ' || in[len - 1] == '\t')) len--;
    if (len == 0 || len >= sizeof buf) return -1;
    memcpy(buf, in, len);
    buf[len] = '\0';
    /* \\server\share\path -> //server/share/path */
    for (i = 0; i < len; i++)
        if (buf[i] == '\\') buf[i] = '/';
    p = buf;
    if (strncmp(p, "smb://", 6) == 0 || strncmp(p, "SMB://", 6) == 0 || strncmp(p, "cifs://", 7) == 0) {
        p = strstr(p, "//") + 2;
    } else if (p[0] == '/' && p[1] == '/') {
        p += 2;
    }
    auth_end = strchr(p, '/');
    if (!auth_end) auth_end = p + strlen(p);
    if (memchr(p, '@', (size_t)(auth_end - p))) return -1; /* credentials have their own fields */
    h = p;
    if (*h == '[') {
        const char *rb = memchr(h, ']', (size_t)(auth_end - h));
        if (!rb) return -1;
        if (copy_n(host, host_cap, h + 1, (size_t)(rb - h - 1)) != 0) return -1;
        he = rb + 1;
        if (he < auth_end && *he != ':') return -1;
    } else {
        const char *colon = memchr(h, ':', (size_t)(auth_end - h));
        /* more than one ':' without brackets: a bare IPv6 literal, no port */
        if (colon && memchr(colon + 1, ':', (size_t)(auth_end - colon - 1))) colon = NULL;
        he = colon ? colon : auth_end;
        if (copy_n(host, host_cap, h, (size_t)(he - h)) != 0) return -1;
    }
    if (he < auth_end && *he == ':') {
        const char *d = he + 1;
        pv = 0;
        if (d == auth_end) return -1;
        for (; d < auth_end; d++) {
            if (*d < '0' || *d > '9') return -1;
            pv = pv * 10 + (unsigned long)(*d - '0');
            if (pv > 65535) return -1;
        }
        if (pv == 0) return -1;
    }
    if (!smbp_host_ok(host)) {
        host[0] = '\0';
        return -1;
    }
    *port = (uint16_t)pv;
    if (*auth_end == '/') {
        const char *s = auth_end, *se;
        while (*s == '/') s++;
        se = strchr(s, '/');
        if (!se) se = s + strlen(s);
        if (se > s) {
            if (copy_n(share, share_cap, s, (size_t)(se - s)) != 0 || !smbp_share_ok(share)) {
                host[0] = share[0] = '\0';
                return -1;
            }
            if (*se && smbp_rel_normalize(se, path, path_cap) != 0) {
                host[0] = share[0] = path[0] = '\0';
                return -1;
            }
        }
    }
    return 0;
}

int smbp_server_arg(const char *host, uint16_t port, char *out, size_t cap) {
    int k = strchr(host, ':') ? snprintf(out, cap, "[%s]:%u", host, (unsigned)port)
                              : snprintf(out, cap, "%s:%u", host, (unsigned)port);
    if (k < 0 || (size_t)k >= cap) {
        if (cap) out[0] = '\0';
        return -1;
    }
    return 0;
}
