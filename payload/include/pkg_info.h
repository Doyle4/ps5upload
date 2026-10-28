/* What a .pkg says about itself, read on the console for the console page's package preview and
 * install (webui_pkg.c): the C twin of the engine's ps5upload_pkg::metadata_from_reader, plus the
 * required firmware and where icon0.png sits.
 *
 * Plain C over a read callback (no runtime.c types): the host self-test runs the real code
 * against built packages. Every read is bounded (the header, the entry table of at most
 * PKG_INFO_MAX_ENTRIES, a PARAM.SFO / param.json of at most PKG_INFO_MAX_META bytes, all on the
 * heap) and every offset is checked against the file size before it is read. */
#ifndef PS5UPLOAD_PKG_INFO_H
#define PS5UPLOAD_PKG_INFO_H

#include <stddef.h>
#include <stdint.h>

#define PKG_INFO_MAX_ENTRIES 1024u
#define PKG_INFO_MAX_META (256u * 1024u)
/* The largest icon0.png the preview serves (stock icons are under 500 KiB). */
#define PKG_INFO_MAX_ICON (1024u * 1024u)

/* Reads exactly `len` bytes at `off` into buf: 0, or -1 (short read, error). */
typedef int (*pkg_read_fn)(void *ctx, uint64_t off, void *buf, size_t len);

typedef struct {
    char content_id[40];
    char title_id[16];
    char title[256];
    char category[8];   /* PARAM.SFO CATEGORY ("gd", "gp", "ac", ...); a PS5 image's from its flags */
    char app_ver[24];   /* APP_VER, or param.json contentVersion / masterVersion */
    char fw[16];        /* the required system software ("7.50"), "" when the package does not say */
    char sdk[16];       /* the SDK it was built with ("4.50": param.json sdkVersion, PARAM.SFO PUBTOOLINFO sdk_ver), "" */
    char platform[4];   /* "ps4", "ps5" or "" */
    int fih;            /* a PS5 finalized image (\x7FFIH envelope) */
    int fake;           /* FIH signed byte 0x00: a fake (debug-signed) package */
    uint64_t icon_off;  /* icon0.png's absolute offset, 0 when there is none to show */
    uint32_t icon_len;
} pkg_info_t;

/* Parses the package. NULL, or a cause token: "pkg_not_pkg" (no CNT/FIH magic), "pkg_truncated",
 * "pkg_bad_header", "pkg_no_memory". A package whose metadata entries cannot be read still
 * answers NULL with what the header gave (the content id), like the engine's parser. */
const char *pkg_info_read(pkg_read_fn rd, void *ctx, uint64_t file_size, pkg_info_t *out);

/* A folder dump's sce_sys/param.json (`is_json`) or param.sfo, read on its own: the same fields
 * as from a package (title, ids, version, category, platform, firmware). */
void pkg_info_from_meta(const uint8_t *b, size_t n, int is_json, pkg_info_t *out);

/* "game", "patch", "dlc", "app" or "other", from the category. */
const char *pkg_info_kind(const pkg_info_t *p);

/* A PARAM.SFO int SYSTEM_VER (0x05050000) or a param.json requiredSystemSoftwareVersion's top
 * 32 bits (0x07500000) as "5.05" / "7.50" into out; "" for 0. */
void pkg_info_fw_text(uint32_t v, char *out, size_t cap);

#endif
