#ifndef PS5UPLOAD_CHEATS_PLAN_H
#define PS5UPLOAD_CHEATS_PLAN_H

/* cheats_plan — the pure part of applying one cheat: what each location holds now, which
 * locations are code caves, and the order the writes go in. No console calls, so the host
 * self-test (tests/cheats_plan_selftest.c) runs it on real cheat files.
 *
 * A cheat is applied as a whole or not at all. The old engine wrote whichever locations
 * matched and skipped the rest, so a cheat whose jump landed but whose code cave did not
 * sent the game into int3 padding. */

#include <stddef.h>
#include <stdint.h>

#define CHEAT_PLAN_MAX_BYTES 256

/* One location of a cheat, with the bytes read from the game before anything is written. */
typedef struct {
    intptr_t addr;
    int      len;                       /* on, off and cur are all this long */
    uint8_t  on[CHEAT_PLAN_MAX_BYTES];
    uint8_t  off[CHEAT_PLAN_MAX_BYTES];
    uint8_t  cur[CHEAT_PLAN_MAX_BYTES];
} cheat_loc_t;

enum {
    CHEAT_LOC_MISMATCH = -1, /* neither the cheat's bytes nor the original: wrong game build */
    CHEAT_LOC_OFF      = 0,  /* holds the original bytes */
    CHEAT_LOC_ON       = 1,  /* holds the cheat's bytes */
};

/* Parse "90 1F-00,00" / "901F0000" into bytes. Separators: space , - : tab CR LF. A trailing
 * odd nibble becomes the low nibble of a last byte. Returns the byte count, or -1 on a
 * non-hex character, an empty string, or more than `max` bytes. */
int cheat_parse_hex(const char *s, uint8_t *out, int max);

/* Bare or 0x-prefixed hex offset. Returns 0 and fills *out, or -1 when it is not hex. */
int cheat_parse_offset(const char *s, uint64_t *out);

/* Which state a location is in, from the bytes read before writing. */
int cheat_loc_state(const cheat_loc_t *l);

/* A code cave: the original bytes are all int3 (0xCC) or all zero padding, so nothing in the
 * game runs there until the cheat's own jump sends it there. */
int cheat_loc_is_cave(const cheat_loc_t *l);

/* The order to write the n locations in. Turning on: caves first, then everything else, each
 * group in file order, so no jump is live before the code it jumps to. Turning off is the exact
 * reverse, so the jumps are restored before their caves go back to padding. The game keeps
 * running while we write, so this order is what keeps it from executing half a cheat.
 * Fills order[0..n-1] with indices into locs. */
void cheat_plan_order(const cheat_loc_t *locs, int n, int turn_on, int *order);

/* A user-space address the engine is willing to write: above the null page, below the
 * canonical user limit, and not wrapping. */
int cheat_addr_ok(intptr_t addr, int len);

#endif /* PS5UPLOAD_CHEATS_PLAN_H */
