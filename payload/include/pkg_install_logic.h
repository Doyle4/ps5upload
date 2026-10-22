/* The pure decisions behind the console page's package install and payload loading (webui_pkg.c),
 * header-only so the host self-test (tests/pkg_info_selftest.c) runs them. */
#ifndef PS5UPLOAD_PKG_INSTALL_LOGIC_H
#define PS5UPLOAD_PKG_INSTALL_LOGIC_H

#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

/* A package on a USB drive or extended storage: copied to internal storage before the install,
 * like the PC app's removableMountRoot (client/src/lib/mountPaths.ts). */
static inline int pkg_needs_staging(const char *path) {
    return strncmp(path, "/mnt/usb", 8) == 0 || strncmp(path, "/mnt/ext", 8) == 0;
}

/* "a.b.c" as three numbers (missing parts 0). */
static inline void pkg_version_triple(const char *s, unsigned long v[3]) {
    int i;
    for (i = 0; i < 3; i++) {
        v[i] = 0;
        while (*s >= '0' && *s <= '9') v[i] = v[i] * 10 + (unsigned long)(*s++ - '0');
        if (*s == '.') s++;
    }
}

/* running < wanted (the installer daemon needs replacing). */
static inline int pkg_version_older(const char *running, const char *wanted) {
    unsigned long a[3], b[3];
    int i;
    pkg_version_triple(running, a);
    pkg_version_triple(wanted, b);
    for (i = 0; i < 3; i++)
        if (a[i] != b[i]) return a[i] < b[i];
    return 0;
}

/* The staging copy's file name: <ContentID>.pkg (Sony's installer keys on it), or
 * minion-<salt>.pkg for a content id that is not plain [A-Za-z0-9_-]. */
static inline void pkg_stage_name(const char *content_id, unsigned salt, char *out, size_t cap) {
    size_t i, n = strlen(content_id);
    int ok = n >= 7 && n <= 36;
    for (i = 0; ok && i < n; i++) {
        char c = content_id[i];
        ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-';
    }
    if (ok) snprintf(out, cap, "%s.pkg", content_id);
    else snprintf(out, cap, "minion-%08x.pkg", salt);
}

static inline int pkg_ends_with_ci(const char *s, const char *suffix) {
    size_t n = strlen(s), m = strlen(suffix), i;
    if (n < m) return 0;
    for (i = 0; i < m; i++) {
        char a = s[n - m + i], b = suffix[i];
        if (a >= 'A' && a <= 'Z') a = (char)(a + 32);
        if (a != b) return 0;
    }
    return 1;
}

/* A file the page offers to load as a payload: .elf or .bin. */
static inline int pkg_is_payload_name(const char *name) {
    return pkg_ends_with_ci(name, ".elf") || pkg_ends_with_ci(name, ".bin");
}

/* The marker every ps5upload helper carries (its AVA1 trust slot). Never written as one literal:
 * the engine stamps its key into the helper's only copy of these bytes (CI counts exactly one), so
 * the search string is put together at run time from bytes stored XORed. */
#define PKG_HELPER_MARKER_LEN 9
static inline void pkg_helper_marker(char out[PKG_HELPER_MARKER_LEN + 1]) {
    static const unsigned char x[PKG_HELPER_MARKER_LEN] = {
        'A' ^ 0x5a, 'V' ^ 0x5a, 'A' ^ 0x5a, '1' ^ 0x5a, 'T' ^ 0x5a, 'R' ^ 0x5a, 'U' ^ 0x5a, 'S' ^ 0x5a, 'T' ^ 0x5a,
    };
    volatile unsigned char key = 0x5a; /* keeps the compiler from folding the bytes back together */
    for (size_t i = 0; i < PKG_HELPER_MARKER_LEN; i++) out[i] = (char)(x[i] ^ key);
    out[PKG_HELPER_MARKER_LEN] = '\0';
}

/* Searches for that marker across block borders: `carry` holds the previous block's last bytes
 * (marker length - 1), *have how many. 1 = found. */
static inline int pkg_scan_marker(const uint8_t *b, size_t n, char carry[16], size_t *have) {
    const size_t m = PKG_HELPER_MARKER_LEN;
    char marker[PKG_HELPER_MARKER_LEN + 1];
    char win[16 + 16];
    size_t i, k;
    pkg_helper_marker(marker);
    /* the seam: the carried tail plus this block's head */
    k = *have;
    memcpy(win, carry, k);
    for (i = 0; i < n && k < sizeof win; i++) win[k++] = (char)b[i];
    for (i = 0; i + m <= k; i++)
        if (memcmp(win + i, marker, m) == 0) return 1;
    for (i = 0; i + m <= n; i++)
        if (b[i] == marker[0] && memcmp(b + i, marker, m) == 0) return 1;
    /* keep the last m - 1 bytes of carry+block for the next seam */
    if (n >= m - 1) {
        memcpy(carry, b + n - (m - 1), m - 1);
        *have = m - 1;
    } else {
        size_t keep = *have + n > m - 1 ? m - 1 : *have + n, drop = *have + n - keep;
        char t[32];
        memcpy(t, carry, *have);
        memcpy(t + *have, b, n);
        memcpy(carry, t + drop, keep);
        *have = keep;
    }
    return 0;
}

#endif
