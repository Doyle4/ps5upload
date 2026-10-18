/* Host-side tests for cheats_plan.c: parsing a cheat's locations, telling which state each is
 * in, and the order the writes go in. The data is the real Marvel's Wolverine (PPSA03671,
 * 01.001.005) cheat pack the app downloads, whose cheats crashed the console with the old
 * engine (fix/cheats-wolverine). */
#include <stdio.h>
#include <string.h>

#include "../src/cheats_plan.c"

static int failures = 0;

#define CHECK(expr)                                                 \
    do {                                                            \
        if (!(expr)) {                                              \
            fprintf(stderr, "FAIL line %d: %s\n", __LINE__, #expr); \
            failures++;                                             \
        }                                                           \
    } while (0)

typedef struct { const char *off, *on, *orig; } raw_t;

/* "Max Resources / XP" from PPSA03671_01.001.005_50d8b46b.json, in file order: 16 code caves
 * (original bytes are int3 padding) and 4 hooks that jump into them. */
static const raw_t MAX_RES[] = {
    {"05CC0A91", "4C8B184D8B5B30E9E4060000", "CCCCCCCCCCCCCCCCCCCCCCCC"},
    {"05CC1181", "4D85DB0F84D72D0000E932060000", "CCCCCCCCCCCCCCCCCCCCCCCCCCCC"},
    {"05CC17C1", "450FB65370E9F6050000", "CCCCCCCCCCCCCCCCCCCC"},
    {"05CC1DC1", "4584D20F8497210000E942010000", "CCCCCCCCCCCCCCCCCCCCCCCCCCCC"},
    {"05CC1F11", "837808000F8E46200000E9111E0000", "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCC"},
    {"05CC3D31", "C740089F860100C3", "CCCCCCCCCCCCCCCC"},
    {"05CC3F61", "C3", "CC"},
    {"05CC4091", "E8FBC9FFFF8B4808E97D7F0100", "CCCCCCCCCCCCCCCCCCCCCCCCCC"},
    {"05CDC014", "E97880FEFF", "8B4808EB02"},
    {"05CC5041", "E84BBAFFFF8B4808E99D700100", "CCCCCCCCCCCCCCCCCCCCCCCCCC"},
    {"05CDC0E4", "E9588FFEFF", "8B4808EB02"},
    {"05CC50A1", "E8EBB9FFFF8B7008E91E710100", "CCCCCCCCCCCCCCCCCCCCCCCCCC"},
    {"05CDC1C5", "E9D78EFEFF", "8B7008EB02"},
    {"05CC7A81", "4C8B5B30E907000000", "CCCCCCCCCCCCCCCCCC"},
    {"05CC7A91", "4D85DB0F84570F0000E922020000", "CCCCCCCCCCCCCCCCCCCCCCCCCCCC"},
    {"05CC7CC1", "450FB65370E926030000", "CCCCCCCCCCCCCCCCCCCC"},
    {"05CC7FF1", "4584D20F84F7090000E952000000", "CCCCCCCCCCCCCCCCCCCCCCCCCCCC"},
    {"05CC8051", "41BD9F860100E995090000", "CCCCCCCCCCCCCCCCCCCCCC"},
    {"05CC89F1", "4489EB45896F08E9F73F0100", "CCCCCCCCCCCCCCCCCCCCCCCC"},
    {"05CDC9ED", "E98FB0FEFF9090", "4489EB45896F08"},
};
#define N_MAX_RES ((int)(sizeof MAX_RES / sizeof MAX_RES[0]))

/* "Infinite Health" from PPSA03671_01.001.005_d02e93c8.mc4: the hook comes SECOND in the file,
 * the cave is zero padding at the end of .text, and the values use dash separators. */
static const raw_t MC4_HEALTH[] = {
    {"4803568", "E9-D3-04-72-01-90-90-90", "C5-FA-11-83-D0-00-00-00"},
    {"5F23A40",
     "80-BB-4C-01-00-00-00-75-0F-C7-83-D0-00-00-00-00-00-96-43-E9-18-FB-8D-FE-C5-FA-11-83-D0-00-00-00-E9-0B-FB-8D-FE",
     "00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00-00"},
};

static int build(const raw_t *raw, int n, intptr_t base, cheat_loc_t *locs) {
    for (int i = 0; i < n; i++) {
        uint64_t off = 0;
        if (cheat_parse_offset(raw[i].off, &off) != 0) return -1;
        int a = cheat_parse_hex(raw[i].on, locs[i].on, CHEAT_PLAN_MAX_BYTES);
        int b = cheat_parse_hex(raw[i].orig, locs[i].off, CHEAT_PLAN_MAX_BYTES);
        if (a <= 0 || a != b) return -1;
        locs[i].len = a;
        locs[i].addr = base + (intptr_t)off;
        memcpy(locs[i].cur, locs[i].off, (size_t)a); /* the game as it boots */
    }
    return 0;
}

/* Position of location `idx` in a write order. */
static int pos_of(const int *order, int n, int idx) {
    for (int k = 0; k < n; k++)
        if (order[k] == idx) return k;
    return -1;
}

static void test_parse(void) {
    uint8_t b[8];
    CHECK(cheat_parse_hex("90 1F-00,00", b, 8) == 4 && b[0] == 0x90 && b[1] == 0x1F && b[3] == 0);
    CHECK(cheat_parse_hex("C3", b, 8) == 1 && b[0] == 0xC3);
    CHECK(cheat_parse_hex("ABC", b, 8) == 2 && b[0] == 0xAB && b[1] == 0x0C);
    CHECK(cheat_parse_hex("", b, 8) == -1);
    CHECK(cheat_parse_hex("9G", b, 8) == -1);
    CHECK(cheat_parse_hex("0102030405", b, 4) == -1); /* longer than the buffer: refused, not cut */

    uint64_t o = 0;
    CHECK(cheat_parse_offset("01BAD908", &o) == 0 && o == 0x1BAD908);
    CHECK(cheat_parse_offset("0x1bad908", &o) == 0 && o == 0x1BAD908);
    CHECK(cheat_parse_offset(" 5F23A40\n", &o) == 0 && o == 0x5F23A40);
    CHECK(cheat_parse_offset("5C0-executable[0]-5", &o) == -1); /* MC4 <PS5Offset> form */
    CHECK(cheat_parse_offset("", &o) == -1);
}

static void test_state(void) {
    cheat_loc_t l[2];
    /* God Mode, the JSON pack: base 0x400000 measured on the Pro (FW 13.60). */
    static const raw_t god[] = {
        {"01BAD908", "909090909090909090", "C4E2719D8FF0010000"},
        {"01BAD911", "C5F828C1", "C5F25DC0"},
    };
    CHECK(build(god, 2, 0x400000, l) == 0);
    CHECK(l[0].addr == 0x1FAD908 && l[0].len == 9 && l[1].len == 4);
    CHECK(cheat_loc_state(&l[0]) == CHEAT_LOC_OFF);
    memcpy(l[0].cur, l[0].on, 9);
    CHECK(cheat_loc_state(&l[0]) == CHEAT_LOC_ON);
    l[0].cur[3] ^= 0xFF; /* another build, or another cheat's jump already there */
    CHECK(cheat_loc_state(&l[0]) == CHEAT_LOC_MISMATCH);
    CHECK(!cheat_loc_is_cave(&l[0]) && !cheat_loc_is_cave(&l[1]));
}

static void test_order_max_resources(void) {
    cheat_loc_t locs[N_MAX_RES];
    CHECK(build(MAX_RES, N_MAX_RES, 0x400000, locs) == 0);
    int hooks[] = {8, 10, 12, 19};
    int caves = 0;
    for (int i = 0; i < N_MAX_RES; i++) caves += cheat_loc_is_cave(&locs[i]);
    CHECK(caves == 16);
    for (int h = 0; h < 4; h++) CHECK(!cheat_loc_is_cave(&locs[hooks[h]]));

    int on[N_MAX_RES], off[N_MAX_RES];
    cheat_plan_order(locs, N_MAX_RES, 1, on);
    cheat_plan_order(locs, N_MAX_RES, 0, off);
    /* Every location exactly once. */
    int seen[N_MAX_RES] = {0};
    for (int k = 0; k < N_MAX_RES; k++) seen[on[k]]++;
    for (int i = 0; i < N_MAX_RES; i++) CHECK(seen[i] == 1);
    /* Turning on: every cave is written before any hook. In file order, the hook at
     * 05CDC014 (index 8) came before the cave at 05CC5041 (index 9). */
    for (int h = 0; h < 4; h++)
        for (int i = 0; i < N_MAX_RES; i++)
            if (cheat_loc_is_cave(&locs[i])) CHECK(pos_of(on, N_MAX_RES, i) < pos_of(on, N_MAX_RES, hooks[h]));
    /* Turning off: every hook is restored before any cave goes back to int3. In file order
     * the cave at 05CC4091 (index 7) was cleared while the hook into it (index 8) was live. */
    for (int h = 0; h < 4; h++)
        for (int i = 0; i < N_MAX_RES; i++)
            if (cheat_loc_is_cave(&locs[i])) CHECK(pos_of(off, N_MAX_RES, hooks[h]) < pos_of(off, N_MAX_RES, i));
    for (int k = 0; k < N_MAX_RES; k++) CHECK(off[k] == on[N_MAX_RES - 1 - k]);
}

static void test_order_mc4_zero_cave(void) {
    cheat_loc_t locs[2];
    CHECK(build(MC4_HEALTH, 2, 0x400000, locs) == 0);
    CHECK(locs[0].len == 8 && locs[1].len == 37);
    CHECK(!cheat_loc_is_cave(&locs[0]) && cheat_loc_is_cave(&locs[1]));
    int on[2], off[2];
    cheat_plan_order(locs, 2, 1, on);
    cheat_plan_order(locs, 2, 0, off);
    CHECK(on[0] == 1 && on[1] == 0);   /* cave, then the jump into it */
    CHECK(off[0] == 0 && off[1] == 1); /* jump restored, then the cave cleared */
    /* The cave ends inside .text: 0x400000 + 0x5F23A40 + 37 < 0x6324000 (measured end). */
    CHECK(locs[1].addr + locs[1].len <= 0x6324000);
}

static void test_addr_ok(void) {
    CHECK(cheat_addr_ok(0x1FAD908, 9));
    CHECK(!cheat_addr_ok(0, 4));
    CHECK(!cheat_addr_ok(0x1BAD908 - 0x1BAD908 + 0x100, 4)); /* null page */
    CHECK(!cheat_addr_ok((intptr_t)0xFFFFF04080F57368ULL, 4)); /* kernel address */
    CHECK(!cheat_addr_ok(0x7FFFFFFFFFFE, 4));                   /* crosses the user limit */
    CHECK(!cheat_addr_ok(0x400000, 0));
}

int main(void) {
    test_parse();
    test_state();
    test_order_max_resources();
    test_order_mc4_zero_cave();
    test_addr_ok();
    if (failures) {
        fprintf(stderr, "cheats_plan_selftest: %d failure(s)\n", failures);
        return 1;
    }
    printf("cheats_plan_selftest: ok\n");
    return 0;
}
