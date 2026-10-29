/* JOB_OP_APP_DUMP: SELF decryption through the kernel's self pager (see include/app_dump.h).
 *
 * The pager trick is idlesauce's ps5-self-pager (https://github.com/idlesauce/ps5-self-pager, The
 * Unlicense), as ps5-app-dumper's selfpager.c (https://github.com/EchoStretch/ps5-app-dumper,
 * GPLv3-or-later) carries it, with its firmware table: for one mmap() the vnode pager's ops in
 * the kernel's pagertab point at the self pager's, so the mapping of a SELF segment reads back
 * decrypted.
 *
 * Changes for ps5upload, all for the console's sake:
 *  - The swap is held only around that one mmap() and runs under kernel_rw_lock, the payload's
 *    lock for every kernel-R/W window, so it never overlaps another kernel write of ours. A failed
 *    swap is not followed by the mmap; a failed restore is retried. The table entries are checked
 *    before the first swap (both set, different, kernel addresses), else decryption is off.
 *  - The ELF is not built in memory: each segment is mapped, locked and written out a window
 *    (4 MiB) at a time, then unmapped; headers and sizes are bounded (a SELF that claims more is
 *    "dump_decrypt_too_big", not attempted).
 *  - No firmware entry: decryption is reported unsupported and the dump keeps the plain copy.
 *  - Built for the console only; the host build (tests) gets a stub that is never supported.
 *
 * This program is free software; you can redistribute it and/or modify it under the terms of the
 * GNU General Public License as published by the Free Software Foundation; either version 3, or
 * (at your option) any later version. See the file LICENSE. */
#include "app_dump.h"

#ifdef __PROSPERO__

#include <errno.h>
#include <pthread.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#include <ps5/kernel.h>

#include "app_dump_int.h"
#include "fw_spoof.h"
#include "kernel_rw_lock.h"

#define SP_SUPERPAGE_SIZE 0x200000ull
#define SP_WINDOW (4ull * 1024 * 1024)
#define SP_MAX_PHNUM 256u
#define SP_MAX_SEGMENTS 4096u
#define SP_MAX_ELF (8ull * 1024 * 1024 * 1024)
#define SP_MAX_VERSION (16u * 1024u * 1024u)

/* https://github.com/Cryptogenic/PS5-SELF-Decrypter/blob/def326f36c1f1b461030222daa9ea6124d4ce610/include/self.h#L21 */
struct sce_self_header {
    uint32_t magic;
    uint8_t version;
    uint8_t mode;
    uint8_t endian;
    uint8_t attributes;
    uint32_t key_type;
    uint16_t header_size;
    uint16_t metadata_size;
    uint64_t file_size;
    uint16_t segment_count;
    uint16_t flags;
    char pad_2[0x4];
};

struct sce_self_segment_header {
    uint64_t flags;
    uint64_t offset;
    uint64_t compressed_size;
    uint64_t uncompressed_size;
};

static const int pagertab_vnodepagerops_index = 2;
static const int pagertab_selfpagerops_index = 7;

static pthread_mutex_t g_init_mtx = PTHREAD_MUTEX_INITIALIZER;
static int g_state; /* 0 not probed, 1 ready, -1 unsupported */
static uint16_t g_fwver;
static intptr_t g_pagertab;
static uint64_t g_vnodepagerops, g_selfpagerops;

/* ps5-self-pager's table: the kernel data offset of pagertab per firmware. 0 = unknown. */
static intptr_t pagertab_offset(uint16_t fw) {
    switch (fw) {
    case 0x100: case 0x101: case 0x102: case 0x105: case 0x110: case 0x111: case 0x112: return 0xC27C40;
    case 0x113: case 0x114: return 0xC27CA0;
    case 0x200: return 0xC4EF60;
    case 0x220: case 0x225: case 0x226: return 0xC4EFA0;
    case 0x230: case 0x250: case 0x270: return 0xC4F120;
    case 0x300: case 0x310: case 0x320: case 0x321: return 0xCAF8C0;
    case 0x400: case 0x402: case 0x403: case 0x450: case 0x451: return 0xD20840;
    case 0x500: case 0x502: case 0x510: case 0x550: return 0xE0FEF0;
    case 0x600: case 0x602: case 0x650: return 0xE30410;
    case 0x700: case 0x701: return 0xE310C0;
    case 0x720: case 0x740: case 0x760: case 0x761: return 0xE31180;
    case 0x800: case 0x820: case 0x840: case 0x860: return 0xE31250;
    case 0x900: case 0x905: case 0x920: case 0x940: case 0x960: return 0xDE0420;
    case 0x1000: case 0x1001: case 0x1020: case 0x1040: case 0x1060: return 0xDE04F0;
    case 0x1100: case 0x1120: return 0xDF1940;
    case 0x1140: case 0x1160: return 0xDF1960;
    case 0x1200: case 0x1202: case 0x1220: case 0x1240: case 0x1260: case 0x1270: return 0xDF2860;
    case 0x1300: case 0x1320: return 0xE038D0;
    case 0x1340: case 0x1342: case 0x1360: return 0xE03910;
    default: return 0;
    }
}

static int kaddr_ok(uint64_t v) { return (v >> 48) == 0xffff; }

static int sp_init(void) {
    intptr_t off;
    pthread_mutex_lock(&g_init_mtx);
    if (g_state) {
        pthread_mutex_unlock(&g_init_mtx);
        return g_state;
    }
    g_state = -1;
    g_fwver = (uint16_t)(fw_safe_kernel_version() >> 16);
    off = g_fwver ? pagertab_offset(g_fwver) : 0;
    if (off && KERNEL_ADDRESS_DATA_BASE) {
        g_pagertab = KERNEL_ADDRESS_DATA_BASE + off;
        pthread_mutex_lock(&kernel_rw_lock);
        g_vnodepagerops = kernel_getlong(g_pagertab + pagertab_vnodepagerops_index * 8);
        g_selfpagerops = kernel_getlong(g_pagertab + pagertab_selfpagerops_index * 8);
        /* Every entry of the table a kernel address: a wrong offset that happens to land on two
         * kernel pointers is far less likely to pass this than the two entries alone. */
        int all_kernel = 1;
        for (int k = 0; k < 8; k++)
            if (!kaddr_ok((uint64_t)kernel_getlong(g_pagertab + k * 8))) all_kernel = 0;
        pthread_mutex_unlock(&kernel_rw_lock);
        /* Both pointers kernel addresses, and different: a vnode slot that already holds the self
         * pager (a swap left behind) would be "restored" to the self pager for good. */
        if (all_kernel && kaddr_ok(g_vnodepagerops) && kaddr_ok(g_selfpagerops) &&
            g_vnodepagerops != g_selfpagerops)
            g_state = 1;
        else
            fprintf(stderr, "app_dump: pagertab entries look wrong (fw %04x); decryption is off\n", g_fwver);
    }
    pthread_mutex_unlock(&g_init_mtx);
    return g_state;
}

/* Set while the vnode pager slot may hold the self pager: the fatal-signal handler puts it back
 * (app_dump_pager_emergency_restore) before the process exits, since every file mmap on the
 * console would go through the self pager after that. */
static volatile sig_atomic_t g_swapped = 0;

/* Put the vnode pager back and check it. 0 when it reads back right. */
static int restore_vnode_pager(intptr_t slot) {
    int tries;
    for (tries = 0; tries < 5; tries++) {
        if (kernel_setlong(slot, g_vnodepagerops) == 0 && kernel_getlong(slot) == g_vnodepagerops) return 0;
    }
    return -1;
}

void app_dump_pager_emergency_restore(void) {
    if (!g_swapped) return;
    /* A crash elsewhere while a swap was open: one write, no checks, no locks (async-signal). */
    (void)kernel_setlong(g_pagertab + pagertab_vnodepagerops_index * 8, g_vnodepagerops);
    g_swapped = 0;
}

/* mmap() with the vnode pager swapped for the self pager, for as short as possible. */
static void *mmap_self(void *addr, size_t len, int prot, int flags, int fd, off_t offset) {
    const intptr_t slot = g_pagertab + pagertab_vnodepagerops_index * 8;
    void *res;
    int err, restored;
    if (sp_init() != 1) {
        errno = ENOSYS;
        return MAP_FAILED;
    }
    pthread_mutex_lock(&kernel_rw_lock);
    g_swapped = 1;
    if (kernel_setlong(slot, g_selfpagerops) != 0) {
        /* The write may have landed in part: put the vnode pager back either way. */
        restored = restore_vnode_pager(slot);
        if (restored == 0) g_swapped = 0;
        pthread_mutex_unlock(&kernel_rw_lock);
        if (restored != 0) {
            fprintf(stderr, "app_dump: CRITICAL: the vnode pager was not restored\n");
            g_state = -1;
        }
        errno = EIO;
        return MAP_FAILED;
    }
    res = mmap(addr, len, prot, flags, fd, offset);
    err = errno;
    restored = restore_vnode_pager(slot);
    if (restored == 0) g_swapped = 0;
    pthread_mutex_unlock(&kernel_rw_lock);
    if (restored != 0) {
        /* Not back: no more swaps this run, and nothing read through a mapping made then. */
        fprintf(stderr, "app_dump: CRITICAL: the vnode pager was not restored\n");
        g_state = -1;
        if (res != MAP_FAILED) munmap(res, len);
        errno = EIO;
        return MAP_FAILED;
    }
    errno = err;
    return res;
}

static void *map_self_segment(int fd, const ad_phdr_t *phdr, int segment_index) {
    off_t offset = (off_t)(((uint64_t)segment_index) << 32);
    if (g_fwver >= 0x900) {
        /* The kernel wants the segment's offset inside its superpage in the low 32 bits
         * (self_pager_seg_decode_pindex: off=0, diff=0x1f4000 otherwise). */
        uint64_t aligned_vaddr = phdr->p_vaddr & ~(phdr->p_align - 1);
        offset |= (off_t)(aligned_vaddr & (SP_SUPERPAGE_SIZE - 1));
    }
    /* MAP_ALIGNED(p_align) as ps5-self-pager passes it: kept as is, it is what runs on consoles. */
    return mmap_self(NULL, phdr->p_filesz, PROT_READ, MAP_PRIVATE | MAP_ALIGNED(phdr->p_align), fd, offset);
}

static int is_segment(uint32_t t) {
    return t == AD_PT_LOAD || t == AD_PT_SCE_DYNLIBDATA || t == AD_PT_SCE_RELRO || t == AD_PT_SCE_COMMENT;
}

static int sp_decrypt(int in_fd, int out_fd, int (*cancelled)(void *), void *arg) {
    struct sce_self_header sh;
    ad_ehdr_t eh;
    ad_phdr_t *ph = NULL;
    struct stat st;
    uint64_t out_size = 0, eh_off;
    ssize_t r;
    int i, version = -1, rc = APP_DUMP_SELF_FAILED;

    r = pread(in_fd, &sh, sizeof sh, 0);
    if (r < 0) return APP_DUMP_SELF_FAILED;
    if (r != (ssize_t)sizeof sh) return APP_DUMP_SELF_NOT_SELF; /* smaller than a SELF header */
    if (sh.magic != AD_SELF_ORBIS_MAGIC && sh.magic != AD_SELF_PROSPERO_MAGIC) return APP_DUMP_SELF_NOT_SELF;
    if (sp_init() != 1) return APP_DUMP_SELF_UNSUPPORTED;
    if (fstat(in_fd, &st) != 0 || sh.segment_count > SP_MAX_SEGMENTS) return APP_DUMP_SELF_FAILED;
    eh_off = sizeof sh + sizeof(struct sce_self_segment_header) * (uint64_t)sh.segment_count;
    if (ad_pread_all(in_fd, &eh, sizeof eh, (off_t)eh_off) != 0) return APP_DUMP_SELF_FAILED;
    if (eh.e_ident[0] != 0x7f || eh.e_ident[1] != 'E' || eh.e_ident[2] != 'L' || eh.e_ident[3] != 'F')
        return APP_DUMP_SELF_FAILED;
    if (eh.e_phnum == 0 || eh.e_phnum > SP_MAX_PHNUM) return APP_DUMP_SELF_TOO_BIG;
    if (!(ph = calloc(eh.e_phnum, sizeof *ph))) return APP_DUMP_SELF_FAILED;
    if (ad_pread_all(in_fd, ph, (size_t)eh.e_phnum * sizeof *ph, (off_t)(eh_off + sizeof eh)) != 0) goto out;
    for (i = 0; i < eh.e_phnum; i++) {
        uint64_t end = ph[i].p_offset + ph[i].p_filesz;
        if (end < ph[i].p_offset || end > SP_MAX_ELF) {
            rc = APP_DUMP_SELF_TOO_BIG;
            goto out;
        }
        if (end > out_size) out_size = end;
        if (ph[i].p_type == AD_PT_SCE_VERSION) version = i;
    }
    if (out_size < sizeof eh + (uint64_t)eh.e_phnum * sizeof *ph) goto out;
    /* The holes between segments read as zeros, as in ps5-self-pager's zeroed buffer. */
    if (ftruncate(out_fd, (off_t)out_size) != 0) goto out;

    for (i = 0; i < eh.e_phnum; i++) {
        uint64_t done = 0;
        uint8_t *m;
        if (!is_segment(ph[i].p_type) || ph[i].p_filesz == 0) continue;
        if (cancelled && cancelled(arg)) {
            rc = APP_DUMP_SELF_CANCELLED;
            goto out;
        }
        m = map_self_segment(in_fd, &ph[i], i);
        if (m == MAP_FAILED) {
            rc = errno == ENOSYS ? APP_DUMP_SELF_UNSUPPORTED : APP_DUMP_SELF_FAILED;
            goto out;
        }
        /* A window at a time: mlock() faults the pages in through the self pager and fails (rather
         * than a SIGSEGV on the copy) when they cannot be decrypted (an fself, keys not available). */
        while (done < ph[i].p_filesz) {
            size_t n = ph[i].p_filesz - done > SP_WINDOW ? SP_WINDOW : (size_t)(ph[i].p_filesz - done);
            int bad = mlock(m + done, n) != 0;
            if (!bad) {
                bad = ad_pwrite_all(out_fd, m + done, n, (off_t)(ph[i].p_offset + done)) != 0;
                (void)munlock(m + done, n);
            }
            if (bad || (cancelled && cancelled(arg))) {
                munmap(m, ph[i].p_filesz);
                rc = bad ? APP_DUMP_SELF_FAILED : APP_DUMP_SELF_CANCELLED;
                goto out;
            }
            done += n;
        }
        munmap(m, ph[i].p_filesz);
    }

    if (version >= 0 && ph[version].p_filesz) {
        /* PT_SCE_VERSION is stored in the clear at the end of the SELF. */
        uint8_t *v;
        if (ph[version].p_filesz > SP_MAX_VERSION || (uint64_t)st.st_size < ph[version].p_filesz) goto out;
        if (!(v = malloc(ph[version].p_filesz))) goto out;
        if (ad_pread_all(in_fd, v, ph[version].p_filesz, (off_t)((uint64_t)st.st_size - ph[version].p_filesz)) != 0 ||
            ad_pwrite_all(out_fd, v, ph[version].p_filesz, (off_t)ph[version].p_offset) != 0) {
            free(v);
            goto out;
        }
        free(v);
    }
    /* The ELF header and program headers from the SELF, at the start. */
    if (ad_pwrite_all(out_fd, &eh, sizeof eh, 0) != 0 ||
        ad_pwrite_all(out_fd, ph, (size_t)eh.e_phnum * sizeof *ph, (off_t)sizeof eh) != 0)
        goto out;
    rc = APP_DUMP_SELF_OK;
out:
    free(ph);
    return rc;
}

static uint32_t sp_fw_version(void) { return fw_safe_kernel_version(); }
static int sp_supported(void) { return sp_init() == 1; }

app_dump_platform_t app_dump_platform = {sp_fw_version, sp_supported, sp_decrypt};

#else /* the host build: no kernel, nothing to decrypt with */

void app_dump_pager_emergency_restore(void) {}

static uint32_t sp_fw_version(void) { return 0; }
static int sp_supported(void) { return 0; }
static int sp_decrypt(int in_fd, int out_fd, int (*cancelled)(void *), void *arg) {
    (void)in_fd;
    (void)out_fd;
    (void)cancelled;
    (void)arg;
    return APP_DUMP_SELF_UNSUPPORTED;
}

app_dump_platform_t app_dump_platform = {sp_fw_version, sp_supported, sp_decrypt};

#endif
