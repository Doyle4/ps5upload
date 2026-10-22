/* Archive names the console extracts (payload/extractor), shared by the helper (which offers the
 * operation and picks the default destination) and the extractor (which picks its back end). The
 * client's copy is client/src/lib/archiveName.ts; keep the three in step.
 *
 * Header-only and plain C so the host tests build it as is. */
#ifndef PS5UPLOAD_ARCHIVE_NAME_H
#define PS5UPLOAD_ARCHIVE_NAME_H

#include <stddef.h>
#include <stdio.h>
#include <string.h>
#include <strings.h>

static inline int archive_name_ends(const char *s, const char *suffix) {
    size_t a = strlen(s), b = strlen(suffix);
    return a >= b && strcasecmp(s + a - b, suffix) == 0;
}

/* The digits of ".partN.rar" in `name` (start and length), or 0 when the name is not one. */
static inline int archive_rar_part(const char *name, size_t *at, size_t *len) {
    size_t n = strlen(name), i;
    if (n < 10 || !archive_name_ends(name, ".rar")) return 0;
    i = n - 4;
    while (i > 0 && name[i - 1] >= '0' && name[i - 1] <= '9') i--;
    if (i == n - 4 || i < 5 || strncasecmp(name + i - 5, ".part", 5) != 0) return 0;
    *at = i;
    *len = n - 4 - i;
    return 1;
}

/* The kind of archive a name says it is: "7z", "zip", "rar", "tar", "gz", "bz2", "xz", "zst" or
 * "split" (a numbered volume set, x.7z.001), or NULL. A later volume of a set (x.part2.rar, x.002)
 * is NULL too: only the first one is opened. */
static inline const char *archive_kind(const char *name) {
    size_t at, len, n = strlen(name);
    if (archive_rar_part(name, &at, &len)) {
        for (size_t i = at; i < at + len - 1; i++)
            if (name[i] != '0') return NULL;
        return name[at + len - 1] == '1' ? "rar" : NULL;
    }
    if (archive_name_ends(name, ".rar")) return "rar";
    if (archive_name_ends(name, ".7z")) return "7z";
    if (archive_name_ends(name, ".zip") || archive_name_ends(name, ".zipx")) return "zip";
    if (archive_name_ends(name, ".tar")) return "tar";
    if (archive_name_ends(name, ".tgz") || archive_name_ends(name, ".gz")) return "gz";
    if (archive_name_ends(name, ".tbz") || archive_name_ends(name, ".tbz2") || archive_name_ends(name, ".bz2")) return "bz2";
    if (archive_name_ends(name, ".txz") || archive_name_ends(name, ".xz")) return "xz";
    if (archive_name_ends(name, ".tzst") || archive_name_ends(name, ".zst")) return "zst";
    if (n > 4 && archive_name_ends(name, ".001")) return "split";
    return NULL;
}

/* The name of volume `k` of the set whose first volume is `first` (k = 0 is `first` itself):
 * x.part01.rar -> x.part02.rar (the same digit count, unless the set outgrows it: x.part9.rar,
 * x.part10.rar); x.rar -> x.r00, x.r01 ... x.r99, x.s00 (the old RAR naming); x.7z.001 -> x.7z.002.
 * 0, or -1 (no such name, or `cap` too small). Whether that volume exists is the caller's to check. */
static inline int archive_volume_name(const char *first, unsigned k, char *out, size_t cap) {
    size_t at, len, flen = strlen(first);
    int w;
    if (k == 0) {
        w = snprintf(out, cap, "%s", first);
    } else if (archive_rar_part(first, &at, &len)) {
        w = snprintf(out, cap, "%.*s%0*u.rar", (int)at, first, (int)len, k + 1);
    } else if (archive_name_ends(first, ".rar")) {
        if (k > 900) return -1;
        w = snprintf(out, cap, "%.*s.%c%02u", (int)(flen - 4), first, (char)('r' + (k - 1) / 100), (k - 1) % 100);
    } else if (flen > 4 && archive_name_ends(first, ".001")) {
        if (k > 998) return -1;
        w = snprintf(out, cap, "%.*s.%03u", (int)(flen - 4), first, k + 1);
    } else {
        return -1;
    }
    return w < 0 || (size_t)w >= cap ? -1 : 0;
}

/* The folder an archive is extracted into by default: its name without the archive's extensions
 * (x.tar.gz, x.tgz, x.part01.rar, x.7z.001 -> x; x.bin.gz -> x.bin), "extracted" when nothing is
 * left. 0, or -1 when `cap` is too small. */
static inline int archive_folder_name(const char *name, char *out, size_t cap) {
    static const char *const exts[] = {".tar.gz", ".tar.bz2", ".tar.xz", ".tar.zst", ".tgz", ".tbz2", ".tbz",
                                       ".txz",    ".tzst",    ".tar",    ".zipx",    ".zip", ".7z",   ".rar",
                                       ".gz",     ".bz2",     ".xz",     ".zst"};
    size_t n = strlen(name), at, len;
    if (n + 1 > cap) return -1;
    memcpy(out, name, n + 1);
    if (archive_rar_part(out, &at, &len)) {
        out[at - 5] = 0;
    } else {
        if (archive_name_ends(out, ".001")) out[n - 4] = 0;
        for (size_t i = 0; i < sizeof exts / sizeof exts[0]; i++) {
            if (archive_name_ends(out, exts[i]) && strlen(out) > strlen(exts[i])) {
                out[strlen(out) - strlen(exts[i])] = 0;
                break;
            }
        }
    }
    if (!out[0] || strcmp(out, ".") == 0 || strcmp(out, "..") == 0) {
        if (cap < 10) return -1;
        snprintf(out, cap, "extracted");
    }
    return 0;
}

#endif
