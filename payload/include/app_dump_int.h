/* Shared by the app_dump_*.c files only (see app_dump.h). */
#ifndef PS5UPLOAD_APP_DUMP_INT_H
#define PS5UPLOAD_APP_DUMP_INT_H

#include <stddef.h>
#include <stdint.h>
#include <sys/types.h>

#include "app_dump.h"

/* The copy buffer: one per dump (one dump runs at a time), on the heap. */
#define AD_BUF_SIZE (8u * 1024u * 1024u)
uint8_t *ad_buf(void);
void ad_buf_release(void);

int ad_cancelled(const app_dump_hooks_t *h);
void ad_add(const app_dump_hooks_t *h, uint64_t files, uint64_t bytes);
/* mkdir -p. 0 or -1. */
int ad_mkdirs(const char *path);
/* The parent folder of `file`, made. 0 or -1. */
int ad_mkparent(const char *file);
int ad_write_all(int fd, const void *buf, size_t n);
int ad_pwrite_all(int fd, const void *buf, size_t n, off_t off);
/* 0 when all n bytes were read, -1 otherwise. */
int ad_pread_all(int fd, void *buf, size_t n, off_t off);
/* `size` bytes of in_fd from `off` into a new `dst` (truncated). track: progress via h->add (bytes
 * only; the caller adds the file). 0, -1 an error (errno), -2 cancelled. */
int ad_copy_range(int in_fd, uint64_t off, uint64_t size, const char *dst, const app_dump_hooks_t *h, int track);
/* A name from a package or an image is a plain relative path with no `..`, `.` or empty part. */
int ad_safe_relpath(const char *name);

/* ELF64 headers, spelled out so the host build needs no <elf.h>. */
typedef struct {
    unsigned char e_ident[16];
    uint16_t e_type;
    uint16_t e_machine;
    uint32_t e_version;
    uint64_t e_entry;
    uint64_t e_phoff;
    uint64_t e_shoff;
    uint32_t e_flags;
    uint16_t e_ehsize;
    uint16_t e_phentsize;
    uint16_t e_phnum;
    uint16_t e_shentsize;
    uint16_t e_shnum;
    uint16_t e_shstrndx;
} ad_ehdr_t;

typedef struct {
    uint32_t p_type;
    uint32_t p_flags;
    uint64_t p_offset;
    uint64_t p_vaddr;
    uint64_t p_paddr;
    uint64_t p_filesz;
    uint64_t p_memsz;
    uint64_t p_align;
} ad_phdr_t;

_Static_assert(sizeof(ad_ehdr_t) == 64, "Elf64_Ehdr layout");
_Static_assert(sizeof(ad_phdr_t) == 56, "Elf64_Phdr layout");

#define AD_PT_LOAD 1u
#define AD_PT_SCE_DYNLIBDATA 0x61000000u
#define AD_PT_SCE_RELRO 0x61000010u
#define AD_PT_SCE_COMMENT 0x6FFFFF00u
#define AD_PT_SCE_VERSION 0x6FFFFF01u
#define AD_SELF_ORBIS_MAGIC 0x1D3D154Fu
#define AD_SELF_PROSPERO_MAGIC 0xEEF51454u

#endif
