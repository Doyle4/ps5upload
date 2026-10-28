#ifndef PS5UPLOAD_GAME_PATCH_H
#define PS5UPLOAD_GAME_PATCH_H

/* game_patch — XML game patches in the PS-Game-Patch format (issue #527), the one GoldHEN's
 * game_patch plugin, etaHEN and CheatRunner read:
 *
 *   <Patch>
 *     <TitleID><ID>PPSA01339</ID>...</TitleID>
 *     <Metadata Title=".." Name=".." Note=".." Author=".." PatchVer=".." AppVer="01.000.000"
 *               ImageBase="0x35b4c000" AppElf="eboot.bin">
 *       <PatchList>
 *         <Line Type="bytes" Address="0x35b4c0bf" Value="cc"/>
 *         <Line Type="mask" Address="c5 f9 ?? 87" Value="9090" Offset="+0"/>
 *       </PatchList>
 *     </Metadata>
 *     ...
 *   </Patch>
 *
 * Each <Metadata> is one patch the player turns on or off. Pure: no console calls, so
 * tests/game_patch_selftest.c runs it on the host against the published repo's files.
 *
 * Addresses. With ImageBase, Address - ImageBase is the offset from the module's load address
 * (ImageBase="0x0" means Address already is that offset). Without it the file follows GoldHEN's
 * PS4 rule: the patch was made against the non-ASLR load address 0x400000.
 *
 * Pattern ("mask") lines are located by scanning the module for the first match of an IDA-style
 * pattern ("aa bb ?? dd"); Offset (+N / -N, decimal) moves from the match to the write. */

#include <stddef.h>
#include <stdint.h>

#define GP_PATTERN_MAX 256
#define GP_VALUE_MAX   1024
#define GP_MAX_ENTRIES 64    /* MAX_MODS_PER_FILE in cheats.c */
#define GP_MAX_LINES   2048
#define GP_NO_ASLR_PS4 0x400000ULL

enum {
    GP_WRITE  = 1, /* write value at an address */
    GP_MASK   = 2, /* write value at a pattern match (+ Offset) */
    GP_JUMP32 = 3, /* detour: jump from a pattern match into a cave found by a second pattern */
    GP_CALL   = 4, /* write value at the target of the call/jmp found at the address */
};

typedef struct {
    char     title[128];
    char     name[128];
    char     note[256];
    char     author[64];
    char     app_ver[32];
    char     app_elf[64];
    int      has_imagebase;
    uint64_t imagebase;
} gp_meta_t;

typedef struct {
    int      kind;
    int      by_pattern;              /* the address comes from a pattern scan */
    uint64_t offset;                  /* !by_pattern: from the module's load address */
    uint8_t  pat[GP_PATTERN_MAX];
    uint8_t  wild[GP_PATTERN_MAX];    /* 1 = any byte */
    int      pat_len;
    int64_t  match_offset;            /* by_pattern: added to the match */
    uint8_t  tpat[GP_PATTERN_MAX];    /* GP_JUMP32: the cave's pattern */
    uint8_t  twild[GP_PATTERN_MAX];
    int      tpat_len;
    int      jump_size;               /* GP_JUMP32: bytes replaced at the hook (>= 5) */
    uint8_t  value[GP_VALUE_MAX];
    int      value_len;
} gp_line_t;

/* Blank out <!-- comments --> in place (the published files carry them inside PatchList). */
void gp_strip_comments(char *xml);

/* How many <Metadata> entries the file has (at most GP_MAX_ENTRIES). */
int gp_count(const char *xml);

/* The attributes of entry `index` (0-based). 0, or -1 when there is no such entry. */
int gp_meta(const char *xml, int index, gp_meta_t *m);

/* The lines of entry `index`, as a malloc'd array the caller frees. Returns the count (> 0), or -1
 * with err set: an entry with a line this engine cannot apply is refused whole, never half
 * applied. Lines with an empty Address or Value are skipped, as GoldHEN does. */
int gp_lines(const char *xml, int index, gp_line_t **out, char *err, size_t err_cap);

/* "aa bb ?? d?" -> bytes and a wildcard mask. Returns the length, or -1. */
int gp_pattern(const char *s, uint8_t *pat, uint8_t *wild, int max);

/* Encode a Value for its Type (byte, bytes16/32/64, bytes, float32/64, utf8, utf16, and the same
 * with a mask_ prefix). Returns the byte count, or -1 for an unknown type or a bad value. */
int gp_value(const char *type, const char *value, uint8_t *out, int cap);

/* First match of the pattern in hay[0..n), or -1. */
long gp_find(const uint8_t *hay, size_t n, const uint8_t *pat, const uint8_t *wild, int len);

/* The offset from the module's load address for an Address of this entry. 0, or -1 when the
 * address lies below the entry's base. */
int gp_rel(const gp_meta_t *m, uint64_t addr, uint64_t *off);

/* Whether the entry is for this game version: AppVer equals either version the console reports
 * (contentVersion "01.004.000" or a PS4 APP_VER "01.00"), or is "mask" / "all". */
int gp_version_ok(const char *app_ver, const char *content_ver, const char *app_ver2);

/* Whether AppElf names a library loaded by the game (.prx / .sprx) rather than its executable. */
int gp_elf_is_module(const char *app_elf);

/* Whether the entry is for the running executable. An empty AppElf or an unknown executable name
 * matches. Compared case-insensitively on the base name. */
int gp_elf_ok(const char *app_elf, const char *exe_path);

/* Build a GP_JUMP32 detour: the hook (jump_size bytes at `site`) becomes jmp cave + NOPs; the cave
 * (value_len + 5 bytes at `cave`) becomes the value followed by jmp site + jump_size. Returns 0, or
 * -1 when a jump does not fit in rel32 or jump_size is out of range. */
int gp_jump32(uint64_t site, uint64_t cave, int jump_size, const uint8_t *value, int value_len,
              uint8_t *site_out, uint8_t *cave_out);

#endif /* PS5UPLOAD_GAME_PATCH_H */
