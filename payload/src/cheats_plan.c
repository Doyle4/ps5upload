/* cheats_plan.c — see cheats_plan.h. Pure C, no console calls. */

#include "cheats_plan.h"

#include <errno.h>
#include <stdlib.h>
#include <string.h>

static int hex_val(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

static int is_sep(char c) {
    return c == ' ' || c == ',' || c == '-' || c == ':' || c == '\t' || c == '\n' || c == '\r';
}

int cheat_parse_hex(const char *s, uint8_t *out, int max) {
    if (!s || !out || max <= 0) return -1;
    int n = 0;
    int hi = -1;
    for (const char *p = s; *p; p++) {
        if (is_sep(*p)) continue;
        int v = hex_val(*p);
        if (v < 0) return -1;
        if (hi < 0) {
            hi = v;
        } else {
            if (n >= max) return -1;
            out[n++] = (uint8_t)(hi * 16 + v);
            hi = -1;
        }
    }
    if (hi >= 0) {
        if (n >= max) return -1;
        out[n++] = (uint8_t)hi;
    }
    return n > 0 ? n : -1;
}

int cheat_parse_offset(const char *s, uint64_t *out) {
    if (!s || !out) return -1;
    while (*s == ' ' || *s == '\t') s++;
    if (s[0] == '0' && (s[1] == 'x' || s[1] == 'X')) s += 2;
    if (!*s) return -1;
    const char *p = s;
    while (hex_val(*p) >= 0) p++;
    while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') p++;
    if (*p) return -1;
    errno = 0;
    unsigned long long v = strtoull(s, NULL, 16);
    if (errno != 0) return -1;
    *out = (uint64_t)v;
    return 0;
}

int cheat_loc_state(const cheat_loc_t *l) {
    size_t n = (size_t)l->len;
    if (memcmp(l->cur, l->on, n) == 0) return CHEAT_LOC_ON;
    if (memcmp(l->cur, l->off, n) == 0) return CHEAT_LOC_OFF;
    return CHEAT_LOC_MISMATCH;
}

int cheat_loc_is_cave(const cheat_loc_t *l) {
    if (l->len <= 0) return 0;
    uint8_t first = l->off[0];
    if (first != 0xCC && first != 0x00) return 0;
    for (int i = 1; i < l->len; i++)
        if (l->off[i] != first) return 0;
    return 1;
}

void cheat_plan_order(const cheat_loc_t *locs, int n, int turn_on, int *order) {
    int k = 0;
    for (int i = 0; i < n; i++)
        if (cheat_loc_is_cave(&locs[i])) order[k++] = i;
    for (int i = 0; i < n; i++)
        if (!cheat_loc_is_cave(&locs[i])) order[k++] = i;
    if (!turn_on) {
        for (int i = 0, j = n - 1; i < j; i++, j--) {
            int t = order[i];
            order[i] = order[j];
            order[j] = t;
        }
    }
}

int cheat_addr_ok(intptr_t addr, int len) {
    if (len <= 0) return 0;
    uint64_t a = (uint64_t)addr;
    uint64_t end = a + (uint64_t)len;
    return a >= 0x10000ULL && end > a && end <= 0x800000000000ULL;
}
