/* JOB_OP_APP_DUMP: a decrypted ELF rewritten as a fake-signed SELF (see include/app_dump.h).
 *
 * Ported from ps5-app-dumper's elf2fself.c (https://github.com/EchoStretch/ps5-app-dumper).
 * Changes: the PT_SCE_VERSION header starts zeroed (an ELF without one read an uninitialised
 * size), the program header count and the SELF header size are bounded, and the copies go through
 * a heap buffer.
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
#include <unistd.h>

#include "app_dump.h"
#include "app_dump_int.h"
#include "app_dump_sha256.h"

#define META_ENTRY_SIZE 0x4000u
#define ROUND_UP(val, a) (((val) + ((a) - 1)) & ~((uint64_t)(a) - 1))
#define FSELF_COPY_BUF (256u * 1024u)
#define FSELF_MAX_PHNUM 256u

typedef struct {
    uint32_t magic;
    uint8_t version;
    uint8_t mode;
    uint8_t endian;
    uint8_t attrs;
    uint32_t key_type;
    uint16_t header_size;
    uint16_t meta_size;
    uint64_t file_size;
    uint16_t num_entries;
    uint16_t flags;
    uint8_t pad[4];
} self_head_t;

typedef struct {
    struct __attribute__((packed)) {
        uint8_t is_ordered : 1;
        uint8_t is_encrypted : 1;
        uint8_t is_signed : 1;
        uint8_t is_compressed : 1;
        uint8_t unknown0 : 4;
        uint8_t window_bits : 3;
        uint8_t has_blocks : 1;
        uint8_t block_bits : 4;
        uint8_t has_digest : 1;
        uint8_t has_extents : 1;
        uint8_t unknown1 : 2;
        uint16_t segment_index : 16;
        uint32_t unknown2 : 28;
    } props;
    uint64_t offset;
    uint64_t enc_size;
    uint64_t dec_size;
} self_entry_t;

typedef struct {
    uint64_t authid;
    uint64_t type;
    uint64_t app_version;
    uint64_t fw_version;
    uint8_t digest[0x20];
} self_exinfo_t;

typedef struct {
    uint16_t type;
    uint8_t unknown[0x0e];
    uint8_t content_id[0x13];
    uint8_t random_pad[0x0d];
} self_npdrm_block_t;

typedef struct {
    uint8_t unknown[0x50];
} self_meta_block_t;

typedef struct {
    uint8_t unknown0[0x30];
    int32_t unknown1;
    uint8_t unknown2[0x1c];
    uint8_t signature[0x100];
} self_meta_foot_t;

typedef struct {
    ad_phdr_t phdr;
    self_entry_t entry;
} self_entry_map_t;

_Static_assert(sizeof(self_head_t) == 0x20, "SELF header layout");
_Static_assert(sizeof(self_entry_t) == 0x20, "SELF entry layout");
_Static_assert(sizeof(self_exinfo_t) == 0x40, "SELF exinfo layout");
_Static_assert(sizeof(self_npdrm_block_t) == 0x30, "SELF npdrm layout");

static int is_segment(uint32_t t) {
    return t == AD_PT_LOAD || t == AD_PT_SCE_RELRO || t == AD_PT_SCE_DYNLIBDATA || t == AD_PT_SCE_COMMENT;
}

static int nread(int fd, void *buf, size_t n) {
    uint8_t *p = buf;
    while (n) {
        ssize_t r = read(fd, p, n);
        if (r < 0 && errno == EINTR) continue;
        if (r <= 0) {
            if (r == 0) errno = EIO;
            return -1;
        }
        p += r;
        n -= (size_t)r;
    }
    return 0;
}

static int ncopy(int in, int out, uint64_t size, uint8_t *buf) {
    while (size) {
        size_t n = size > FSELF_COPY_BUF ? FSELF_COPY_BUF : (size_t)size;
        if (nread(in, buf, n) != 0 || ad_write_all(out, buf, n) != 0) return -1;
        size -= n;
    }
    return 0;
}

static int align_fd(int fd, uint64_t a) {
    off_t off = lseek(fd, 0, SEEK_CUR);
    if (off < 0) return -1;
    return lseek(fd, (off_t)ROUND_UP((uint64_t)off, a), SEEK_SET) < 0 ? -1 : 0;
}

/* SHA-256 of the whole file, the position kept. */
static int sha256_fd(int fd, uint8_t hash[SHA256_BLOCK_SIZE], uint8_t *buf) {
    SHA256_CTX ctx;
    off_t cur = lseek(fd, 0, SEEK_CUR);
    ssize_t n;
    if (cur < 0 || lseek(fd, 0, SEEK_SET) < 0) return -1;
    sha256_init(&ctx);
    while ((n = read(fd, buf, FSELF_COPY_BUF)) > 0) sha256_update(&ctx, buf, (size_t)n);
    if (n < 0) return -1;
    sha256_final(&ctx, hash);
    return lseek(fd, cur, SEEK_SET) < 0 ? -1 : 0;
}

int app_dump_elf2fself(const char *elf_path, const char *fself_path) {
    self_head_t head = {.magic = AD_SELF_PROSPERO_MAGIC,
                        .version = 0,
                        .mode = 1,
                        .endian = 1,
                        .attrs = 0x12,
                        .key_type = 0x101,
                        .flags = 0x22};
    self_meta_foot_t metafoot;
    self_meta_block_t metablk;
    self_npdrm_block_t npdrm;
    self_exinfo_t exinfo;
    self_entry_map_t *map = NULL;
    ad_ehdr_t ehdr;
    ad_phdr_t phdr, version_seg;
    uint8_t *buf = NULL, signature[0x100];
    uint64_t offset, header_size, meta_size;
    int elf_fd, self_fd = -1, i, j, rc = -1;

    memset(&metafoot, 0, sizeof metafoot);
    memset(&metablk, 0, sizeof metablk);
    memset(&npdrm, 0, sizeof npdrm);
    memset(&exinfo, 0, sizeof exinfo);
    memset(&version_seg, 0, sizeof version_seg);
    memset(signature, 0, sizeof signature);
    metafoot.unknown1 = 0x10000;
    npdrm.type = 3;
    exinfo.authid = 0x3100000000000002ull;
    exinfo.type = 1;

    if ((elf_fd = open(elf_path, O_RDONLY)) < 0) return -1;
    if (!(buf = malloc(FSELF_COPY_BUF))) goto out;
    if (nread(elf_fd, &ehdr, sizeof ehdr) != 0) goto out;
    if (ehdr.e_ident[0] != 0x7f || ehdr.e_ident[1] != 'E' || ehdr.e_ident[2] != 'L' || ehdr.e_ident[3] != 'F' ||
        ehdr.e_phnum == 0 || ehdr.e_phnum > FSELF_MAX_PHNUM || ehdr.e_phoff > 0x10000) {
        errno = EINVAL;
        goto out;
    }

    /* The segments that get a digest and a block entry each. */
    if (lseek(elf_fd, (off_t)ehdr.e_phoff, SEEK_SET) < 0) goto out;
    for (i = 0; i < ehdr.e_phnum; i++) {
        if (nread(elf_fd, &phdr, sizeof phdr) != 0) goto out;
        if (phdr.p_type == AD_PT_SCE_VERSION) version_seg = phdr;
        if (is_segment(phdr.p_type)) head.num_entries += 2;
    }

    header_size = sizeof(self_head_t) + (uint64_t)head.num_entries * sizeof(self_entry_t);
    header_size = ROUND_UP(header_size, 0x10);
    header_size += ehdr.e_phoff + (uint64_t)ehdr.e_phnum * sizeof(ad_phdr_t);
    header_size = ROUND_UP(header_size, 0x10);
    header_size += sizeof(self_exinfo_t) + sizeof(self_npdrm_block_t);
    meta_size = (uint64_t)head.num_entries * sizeof(self_meta_block_t) + sizeof(self_meta_foot_t) + 0x100;
    if (header_size > 0xFFFF || meta_size > 0xFFFF) {
        errno = EFBIG;
        goto out;
    }
    head.header_size = (uint16_t)header_size;
    head.meta_size = (uint16_t)meta_size;

    if (head.num_entries && !(map = calloc(head.num_entries, sizeof *map))) goto out;
    if (lseek(elf_fd, (off_t)ehdr.e_phoff, SEEK_SET) < 0) goto out;
    offset = header_size + meta_size;
    for (i = 0, j = 0; i < ehdr.e_phnum; i++) {
        if (nread(elf_fd, &phdr, sizeof phdr) != 0) goto out;
        if (!is_segment(phdr.p_type)) continue;
        if (j + 2 > head.num_entries) break; /* the file changed under us */
        /* The digest entry. */
        map[j].phdr = phdr;
        map[j].entry.props.is_signed = 1;
        map[j].entry.props.has_digest = 1;
        map[j].entry.props.segment_index = (uint16_t)(j + 1);
        map[j].entry.enc_size = (ROUND_UP(phdr.p_filesz, META_ENTRY_SIZE) / META_ENTRY_SIZE) * SHA256_BLOCK_SIZE;
        map[j].entry.dec_size = map[j].entry.enc_size;
        map[j].entry.offset = offset;
        offset = ROUND_UP(offset + map[j].entry.enc_size, 0x10);
        j++;
        /* The block entry. */
        map[j].phdr = phdr;
        map[j].entry.props.is_signed = 1;
        map[j].entry.props.has_blocks = 1;
        map[j].entry.props.segment_index = (uint16_t)i;
        map[j].entry.props.block_bits = 2;
        map[j].entry.enc_size = phdr.p_filesz;
        map[j].entry.dec_size = phdr.p_filesz;
        map[j].entry.offset = offset;
        offset = ROUND_UP(offset + map[j].entry.enc_size, 0x10);
        j++;
    }

    head.file_size = header_size + meta_size;
    for (i = 0; i < head.num_entries; i++) head.file_size += ROUND_UP(map[i].entry.enc_size, 0x10);
    head.file_size = ROUND_UP(head.file_size, 0x10);

    if ((self_fd = open(fself_path, O_WRONLY | O_CREAT | O_TRUNC, 0755)) < 0) goto out;
    if (ad_write_all(self_fd, &head, sizeof head) != 0) goto out;
    for (i = 0; i < head.num_entries; i++)
        if (ad_write_all(self_fd, &map[i].entry, sizeof(self_entry_t)) != 0) goto out;
    if (ad_write_all(self_fd, &ehdr, sizeof ehdr) != 0) goto out;
    if (lseek(elf_fd, (off_t)ehdr.e_phoff, SEEK_SET) < 0) goto out;
    for (i = 0; i < ehdr.e_phnum; i++)
        if (nread(elf_fd, &phdr, sizeof phdr) != 0 || ad_write_all(self_fd, &phdr, sizeof phdr) != 0) goto out;
    if (align_fd(self_fd, 0x10) != 0) goto out;
    if (sha256_fd(elf_fd, exinfo.digest, buf) != 0) goto out;
    if (ad_write_all(self_fd, &exinfo, sizeof exinfo) != 0 || ad_write_all(self_fd, &npdrm, sizeof npdrm) != 0)
        goto out;
    for (i = 0; i < head.num_entries; i++)
        if (ad_write_all(self_fd, &metablk, sizeof metablk) != 0) goto out;
    if (ad_write_all(self_fd, &metafoot, sizeof metafoot) != 0 || ad_write_all(self_fd, signature, sizeof signature) != 0)
        goto out;
    /* The segments' data (the block entries only). */
    for (i = 0; i < head.num_entries; i++) {
        if (!map[i].entry.props.has_blocks) continue;
        if (lseek(elf_fd, (off_t)map[i].phdr.p_offset, SEEK_SET) < 0 ||
            lseek(self_fd, (off_t)map[i].entry.offset, SEEK_SET) < 0 ||
            ncopy(elf_fd, self_fd, map[i].entry.enc_size, buf) != 0)
            goto out;
    }
    if (version_seg.p_filesz > 0) {
        if (version_seg.p_filesz > 0x100000 || lseek(elf_fd, (off_t)version_seg.p_offset, SEEK_SET) < 0 ||
            ncopy(elf_fd, self_fd, version_seg.p_filesz, buf) != 0)
            goto out;
    }
    rc = 0;
out:
    if (self_fd >= 0 && close(self_fd) != 0) rc = -1;
    close(elf_fd);
    free(map);
    free(buf);
    if (rc != 0 && self_fd >= 0) (void)unlink(fself_path);
    return rc;
}
