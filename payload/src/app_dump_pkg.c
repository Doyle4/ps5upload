/* JOB_OP_APP_DUMP: the sce_sys entries of an installed package and the files of a PS4 title's
 * nested PFS image (see include/app_dump.h).
 *
 * Ported from ps5-app-dumper (https://github.com/EchoStretch/ps5-app-dumper): ps5_pkg.c, ps4_pkg.c
 * and pfs.c. Changes: entries are streamed through the dump's buffer instead of malloc(size);
 * every read and write is checked; an entry or image name that would leave the folder is skipped;
 * the PFS inodes are read as needed instead of all at once, a directory's later blocks are read
 * too, and an entry that does not advance ends the walk; a stop reaches every loop.
 *
 * Copyright (C) 2025 EchoStretch, slopmaster33
 * Copyright (C) 2026 PhantomPtr (the port)
 *
 * This program is free software; you can redistribute it and/or modify it under the terms of the
 * GNU General Public License as published by the Free Software Foundation; either version 3, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
 * without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See
 * the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with this program; see
 * the file LICENSE. If not, see <http://www.gnu.org/licenses/>. */
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include "app_dump.h"
#include "app_dump_int.h"

#define PS4_CNT_MAGIC_BE 0x7F434E54u /* "\x7FCNT" read big-endian */
#define PKG_NAME_TABLE 0x0200u
#define PKG_MAX_ENTRIES 4096u
#define PKG_MAX_ENTRY (100u * 1024u * 1024u)
#define PKG_JSON_MAX (64u * 1024u)
#define PKG_SCAN_TAIL (500ull * 1024 * 1024)

struct cnt_pkg_main_header {
    uint32_t magic;
    uint32_t type;
    uint32_t unk_0x08;
    uint32_t unk_0x0C;
    uint16_t unk1_entries_num;
    uint16_t table_entries_num;
    uint16_t system_entries_num;
    uint16_t unk2_entries_num;
    uint32_t file_table_offset;
    uint32_t main_entries_data_size;
    uint32_t unk_0x20;
    uint32_t body_offset;
    uint32_t unk_0x28;
    uint32_t body_size;
    uint8_t unk_0x30[0x10];
    uint8_t content_id[0x30];
    uint32_t unk_0x70;
    uint32_t unk_0x74;
    uint32_t unk_0x78;
    uint32_t unk_0x7C;
    uint32_t date;
    uint32_t time;
    uint32_t unk_0x88;
    uint32_t unk_0x8C;
    uint8_t unk_0x90[0x70];
    uint8_t main_entries1_digest[0x20];
    uint8_t main_entries2_digest[0x20];
    uint8_t digest_table_digest[0x20];
    uint8_t body_digest[0x20];
} __attribute__((packed));

struct cnt_pkg_table_entry {
    uint32_t type;
    uint32_t name_table_offset; /* byte offset of this entry's name */
    uint32_t flags1;
    uint32_t flags2;
    uint32_t offset;
    uint32_t size;
    uint32_t unk2;
    uint32_t unk3;
} __attribute__((packed));

_Static_assert(sizeof(struct cnt_pkg_main_header) == 0x180, "CNT header layout");
_Static_assert(sizeof(struct cnt_pkg_table_entry) == 0x20, "CNT entry layout");

static uint16_t be16(uint16_t v) { return (uint16_t)(((v & 0x00FFu) << 8) | ((v & 0xFF00u) >> 8)); }
static uint32_t be32(uint32_t v) {
    return ((v & 0x000000FFu) << 24) | ((v & 0x0000FF00u) << 8) | ((v & 0x00FF0000u) >> 8) | ((v & 0xFF000000u) >> 24);
}

/* The fallback name of an entry without one in the name table. param_name: param.json (PS5) or
 * param.sfo (PS4). */
static const char *entry_name_by_type(uint32_t type, int ps4) {
    switch (type) {
    case 0x0400: return "license.dat";
    case 0x0401: return "license.info";
    case 0x0402: return "nptitle.dat";
    case 0x0403: return "npbind.dat";
    case 0x0404: return "selfinfo.dat";
    case 0x0406: return "imageinfo.dat";
    case 0x0407: return "target-deltainfo.dat";
    case 0x0408: return "origin-deltainfo.dat";
    case 0x0409: return "psreserved.dat";
    case 0x1000: return ps4 ? "param.sfo" : "param.json";
    case 0x1001: return "playgo-chunk.dat";
    case 0x1002: return "playgo-chunk.sha";
    case 0x1003: return "playgo-manifest.xml";
    case 0x1004: return "pronunciation.xml";
    case 0x1005: return "pronunciation.sig";
    case 0x1006: return "pic1.png";
    case 0x1007: return "pubtoolinfo.dat";
    case 0x1200: return "icon0.png";
    case 0x1220: return "pic0.png";
    case 0x1240: return "snd0.at9";
    case 0x1260: return "changeinfo/changeinfo.xml";
    case 0x1280: return "icon0.dds";
    case 0x12A0: return "pic0.dds";
    case 0x12C0: return "pic1.dds";
    default: return NULL;
    }
}

/* ps4_pkg.c's clean_entry_name: a leading sce_sys/ or /mnt/usb0/ path is dropped. */
static void clean_entry_name(char *name) {
    if (strncmp(name, "/sce_sys/", 9) == 0) memmove(name, name + 9, strlen(name + 9) + 1);
    else if (strncmp(name, "sce_sys/", 8) == 0) memmove(name, name + 8, strlen(name + 8) + 1);
    if (strncmp(name, "/mnt/usb0/", 10) == 0) memmove(name, name + 10, strlen(name + 10) + 1);
    else if (strncmp(name, "mnt/usb0/", 9) == 0) memmove(name, name + 9, strlen(name + 9) + 1);
    if (name[0] == '/') memmove(name, name + 1, strlen(name));
}

int app_dump_is_ps4_pkg(const char *pkg) {
    uint8_t h[4];
    int fd = open(pkg, O_RDONLY), ok;
    if (fd < 0) return 0;
    ok = ad_pread_all(fd, h, 4, 0) == 0 && h[0] == 0x7F && h[1] == 'C' && h[2] == 'N' && h[3] == 'T';
    close(fd);
    return ok;
}

/* The entries of the CNT at `base` in fd written into <out_dir>/sce_sys. 0, -1, -2 cancelled. */
static int extract_cnt(int fd, uint64_t base, const char *out_dir, int ps4, const app_dump_hooks_t *h) {
    struct cnt_pkg_main_header hdr;
    struct cnt_pkg_table_entry *ents = NULL;
    char *names = NULL, sce[APP_DUMP_PATH_MAX], full[APP_DUMP_PATH_MAX];
    size_t names_size = 0;
    uint32_t i, n, table;
    int rc = 0;
    if (ad_pread_all(fd, &hdr, sizeof hdr, (off_t)base) != 0) return -1;
    if (hdr.magic != be32(PS4_CNT_MAGIC_BE) && hdr.magic != PS4_CNT_MAGIC_BE) return -1;
    table = be32(hdr.file_table_offset);
    n = be16(hdr.table_entries_num);
    if (n == 0 || n > PKG_MAX_ENTRIES) return -1;
    if (!(ents = calloc(n, sizeof *ents))) return -1;
    if (ad_pread_all(fd, ents, (size_t)n * sizeof *ents, (off_t)(base + table)) != 0) {
        free(ents);
        return -1;
    }
    for (i = 0; i < n; i++) {
        ents[i].type = be32(ents[i].type);
        ents[i].name_table_offset = be32(ents[i].name_table_offset);
        ents[i].offset = be32(ents[i].offset);
        ents[i].size = be32(ents[i].size);
    }
    if (snprintf(sce, sizeof sce, "%s/sce_sys", out_dir) >= (int)sizeof sce || ad_mkdirs(sce) != 0) {
        free(ents);
        return -1;
    }
    /* The name table: one blob of NUL-terminated names every entry points into by byte offset. */
    for (i = 0; i < n; i++) {
        if (ents[i].type != PKG_NAME_TABLE) continue;
        if (ents[i].size == 0 || ents[i].size > 64 * 1024) break;
        if (!(names = malloc((size_t)ents[i].size + 1))) break;
        if (ad_pread_all(fd, names, ents[i].size, (off_t)(base + ents[i].offset)) != 0) {
            free(names);
            names = NULL;
            break;
        }
        names[ents[i].size] = '\0'; /* a damaged table cannot run off */
        names_size = ents[i].size;
        break;
    }
    for (i = 0; i < n && rc == 0; i++) {
        char clean[256];
        const char *name = NULL;
        int r;
        if (ad_cancelled(h)) {
            rc = -2;
            break;
        }
        if (ents[i].size == 0 || ents[i].size > PKG_MAX_ENTRY) continue;
        /* The table's name wins: it is what the package itself says. */
        if (names && ents[i].name_table_offset < names_size) name = names + ents[i].name_table_offset;
        if (!name || !name[0]) name = entry_name_by_type(ents[i].type, ps4);
        if (!name || !name[0]) continue;
        snprintf(clean, sizeof clean, "%s", name);
        if (ps4) clean_entry_name(clean);
        if (!ad_safe_relpath(clean)) continue;
        if (snprintf(full, sizeof full, "%s/%s", sce, clean) >= (int)sizeof full || ad_mkparent(full) != 0) continue;
        r = ad_copy_range(fd, base + ents[i].offset, ents[i].size, full, h, 0);
        if (r == -2) rc = -2;
        else if (r != 0) fprintf(stderr, "app_dump: package entry %s not written: %s\n", clean, strerror(errno));
    }
    free(names);
    free(ents);
    return rc;
}

/* <pkg>.json's "_sc.pkg" piece: where the CNT starts inside a PS5 package. 0 found. */
static int pkg_json_sc_offset(const char *pkg, uint64_t *off) {
    char json[APP_DUMP_PATH_MAX + 8], *buf, *sc, *start, *k;
    size_t len = strlen(pkg);
    ssize_t got;
    int fd, rc = -1;
    if (len <= 4 || strcmp(pkg + len - 4, ".pkg") != 0 ||
        snprintf(json, sizeof json, "%.*s.json", (int)(len - 4), pkg) >= (int)sizeof json)
        return -1;
    if ((fd = open(json, O_RDONLY)) < 0) return -1;
    if (!(buf = malloc(PKG_JSON_MAX + 1))) {
        close(fd);
        return -1;
    }
    got = read(fd, buf, PKG_JSON_MAX);
    close(fd);
    if (got > 0) {
        buf[got] = '\0';
        if ((sc = strstr(buf, "_sc.pkg")) != NULL) {
            /* Back to the start of that piece's object. */
            for (start = sc; start > buf && *start != '{'; start--) {
            }
            if ((k = strstr(start, "\"fileOffset\":")) != NULL) {
                *off = strtoull(k + strlen("\"fileOffset\":"), NULL, 10);
                rc = 0;
            }
        }
    }
    free(buf);
    return rc;
}

/* ps5_pkg.c's fallback: the CNT header in the package's last 500 MB. */
static int pkg_scan_cnt(int fd, uint64_t *off, const app_dump_hooks_t *h) {
    static const uint8_t magic[] = {0x7F, 0x43, 0x4E, 0x54, 0x83};
    struct stat st;
    uint8_t *buf = ad_buf();
    uint64_t at, size;
    const size_t chunk = 4u * 1024u * 1024u;
    if (!buf || fstat(fd, &st) != 0 || st.st_size <= 0) return -1;
    size = (uint64_t)st.st_size;
    at = size > PKG_SCAN_TAIL ? size - PKG_SCAN_TAIL : 0;
    while (at < size) {
        size_t n = size - at > chunk ? chunk : (size_t)(size - at), i;
        ssize_t got;
        if (ad_cancelled(h)) return -2;
        got = pread(fd, buf, n, (off_t)at);
        if (got < (ssize_t)sizeof magic) return -1;
        for (i = 0; i + sizeof magic <= (size_t)got; i++) {
            if (buf[i] == magic[0] && memcmp(buf + i, magic, sizeof magic) == 0) {
                *off = at + i;
                return 0;
            }
        }
        at += (uint64_t)got - (sizeof magic - 1);
    }
    return -1;
}

int app_dump_unpkg_ps5(const char *pkg, const char *out_dir, const app_dump_hooks_t *h) {
    uint64_t base = UINT64_MAX;
    int fd = open(pkg, O_RDONLY), rc;
    if (fd < 0) return -1;
    if (pkg_json_sc_offset(pkg, &base) != 0) {
        rc = pkg_scan_cnt(fd, &base, h);
        if (rc != 0) {
            close(fd);
            if (rc == -1) fprintf(stderr, "app_dump: no CNT found in %s\n", pkg);
            return rc;
        }
    }
    rc = extract_cnt(fd, base, out_dir, 0, h);
    close(fd);
    if (rc == -1) fprintf(stderr, "app_dump: %s: unreadable CNT at 0x%llx\n", pkg, (unsigned long long)base);
    return rc;
}

int app_dump_unpkg_ps4(const char *pkg, const char *out_dir, const app_dump_hooks_t *h) {
    int fd = open(pkg, O_RDONLY), rc;
    if (fd < 0) return -1;
    rc = extract_cnt(fd, 0, out_dir, 1, h);
    close(fd);
    if (rc == -1) fprintf(stderr, "app_dump: %s: unreadable package header\n", pkg);
    return rc;
}

/* ---- PFS (pfs.c) ---- */

struct pfs_header_t {
    uint64_t version;
    uint64_t magic;
    uint32_t id[2];
    char fmode;
    char clean;
    char ronly;
    char rsv;
    uint16_t mode;
    uint16_t unk1;
    uint32_t blocksz;
    uint32_t nbackup;
    uint64_t nblock;
    uint64_t ndinode;
    uint64_t ndblock;
    uint64_t ndinodeblock;
    uint64_t superroot_ino;
} __attribute__((packed));

struct di_d32 {
    uint16_t mode;
    uint16_t nlink;
    uint32_t flags;
    uint64_t size;
    uint64_t size_compressed;
    uint64_t unix_time[4];
    uint32_t time_nsec[4];
    uint32_t uid;
    uint32_t gid;
    uint64_t spare[2];
    uint32_t blocks;
    uint32_t db[12];
    uint32_t ib[5];
} __attribute__((packed));

struct pfs_dirent_t {
    uint32_t ino;
    uint32_t type;
    uint32_t namelen;
    uint32_t entsize;
} __attribute__((packed));

typedef struct {
    int fd;
    struct pfs_header_t hdr;
    uint64_t per_block;
    int dry;
    const app_dump_hooks_t *h;
    uint64_t *files, *bytes;
} pfs_t;

static int pfs_inode(pfs_t *p, uint64_t ino, struct di_d32 *out) {
    uint64_t blk, off;
    if (ino >= p->hdr.ndinode) return -1;
    blk = ino / p->per_block;
    if (blk >= p->hdr.ndinodeblock) return -1;
    off = (uint64_t)p->hdr.blocksz * (blk + 1) + sizeof(struct di_d32) * (ino % p->per_block);
    return ad_pread_all(p->fd, out, sizeof *out, (off_t)off);
}

/* pfs.c's parse_dir: type 2 a file, 3 a folder; level 0 is the super-root, whose folder is the
 * image's root. 0, -1, -2 cancelled. */
static int pfs_dir(pfs_t *p, uint64_t ino, int level, const char *path) {
    struct di_d32 node;
    uint32_t b;
    if (level > 48 || pfs_inode(p, ino, &node) != 0) return -1;
    for (b = 0; b < node.blocks; b++) {
        uint64_t pos = (uint64_t)p->hdr.blocksz * ((uint64_t)node.db[0] + b);
        uint64_t end = pos + p->hdr.blocksz;
        while (pos + sizeof(struct pfs_dirent_t) <= end) {
            struct pfs_dirent_t ent;
            char name[256], full[APP_DUMP_PATH_MAX];
            int rc;
            if (ad_cancelled(p->h)) return -2;
            if (ad_pread_all(p->fd, &ent, sizeof ent, (off_t)pos) != 0) return -1;
            if (ent.type == 0) break; /* the rest of this block is empty */
            if (ent.entsize < sizeof ent || ent.namelen >= sizeof name || ent.entsize < sizeof ent + ent.namelen)
                return -1; /* damaged: an entry that does not advance would loop forever */
            name[0] = '\0';
            if (level > 0) {
                if (ad_pread_all(p->fd, name, ent.namelen, (off_t)(pos + sizeof ent)) != 0) return -1;
                name[ent.namelen] = '\0';
            }
            pos += ent.entsize;
            if (level > 0 && (!ad_safe_relpath(name) || strchr(name, '/'))) continue;
            if (name[0]) {
                if (snprintf(full, sizeof full, "%s/%s", path, name) >= (int)sizeof full) return -1;
            } else {
                snprintf(full, sizeof full, "%s", path);
            }
            if (ent.type == 2 && level > 0) {
                struct di_d32 f;
                if (pfs_inode(p, ent.ino, &f) != 0) return -1;
                if (p->dry) {
                    (*p->files)++;
                    *p->bytes += f.size;
                } else {
                    rc = ad_copy_range(p->fd, (uint64_t)p->hdr.blocksz * f.db[0], f.size, full, p->h, 1);
                    if (rc != 0) return rc;
                    (*p->files)++;
                    *p->bytes += f.size;
                    ad_add(p->h, 1, 0);
                }
            } else if (ent.type == 3 && ent.ino != ino) {
                if (!p->dry && ad_mkdirs(full) != 0) return -1;
                if ((rc = pfs_dir(p, ent.ino, level + 1, full)) != 0) return rc;
            }
        }
    }
    return 0;
}

int app_dump_unpfs(const char *image, const char *out_dir, int dry, const app_dump_hooks_t *h, uint64_t *files,
                   uint64_t *bytes) {
    pfs_t p;
    int rc;
    memset(&p, 0, sizeof p);
    p.dry = dry;
    p.h = h;
    p.files = files;
    p.bytes = bytes;
    if (!dry && (!out_dir || ad_mkdirs(out_dir) != 0)) return -1;
    if ((p.fd = open(image, O_RDONLY)) < 0) return -1;
    if (ad_pread_all(p.fd, &p.hdr, sizeof p.hdr, 0) != 0 || p.hdr.blocksz < sizeof(struct di_d32) ||
        p.hdr.blocksz > (1u << 24) || (p.hdr.blocksz & (p.hdr.blocksz - 1)) != 0) {
        close(p.fd);
        errno = EINVAL;
        return -1;
    }
    p.per_block = p.hdr.blocksz / sizeof(struct di_d32);
    rc = pfs_dir(&p, p.hdr.superroot_ino, 0, dry ? "" : out_dir);
    close(p.fd);
    if (rc == -1 && !errno) errno = EINVAL;
    return rc;
}
