/* Host-side tests for game_patch.c (issue #527): PS-Game-Patch XML parsing, value encoding,
 * pattern scanning and the jump32 detour. The fixtures are cut from the published repo
 * (github.com/illusionyy/PS-Game-Patch). With GP_REPO=<checkout>/patches set, every file of the
 * repo is also parsed and each entry must either parse or name the line type it refuses. */
#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "../src/game_patch.c"

static int failures = 0;

#define CHECK(expr)                                                 \
    do {                                                            \
        if (!(expr)) {                                              \
            fprintf(stderr, "FAIL line %d: %s\n", __LINE__, #expr); \
            failures++;                                             \
        }                                                           \
    } while (0)

/* patches/xml_prospero/DemonSouls.xml (first two entries), with a comment inside PatchList. */
static const char DEMONS[] =
    "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
    "<Patch>\n"
    "    <TitleID>\n        <ID>PPSA01339</ID>\n        <ID>PPSA01340</ID>\n    </TitleID>\n"
    "    <Metadata Title=\"Demons Souls\"\n              Name=\"Debug Menu\"\n"
    "              Author=\"illusion\"\n              PatchVer=\"1.0\"\n"
    "              AppVer=\"01.000.000\"\n              ImageBase=\"0x35b4c000\"\n"
    "              AppElf=\"eboot.bin\">\n"
    "        <PatchList>\n"
    "            <!-- <Line Type=\"bytes\" Address=\"0x0\" Value=\"ff\"/> commented out -->\n"
    "            <Line Type=\"bytes\" Address=\"0x35b4c0bf\" Value=\"cc\"/>\n"
    "            <Line Type=\"bytes\" Address=\"0x35b4c0c0\" Value=\"488b03\"/>\n"
    "            <Line Type=\"bytes\" Address=\"0x36630cae\" Value=\"e90db451ff\"/>\n"
    "        </PatchList>\n"
    "    </Metadata>\n"
    "    <Metadata Title=\"Demons Souls\" Name=\"Debug Menu\" Author=\"illusion\" PatchVer=\"1.0\"\n"
    "              AppVer=\"01.004.000\" ImageBase=\"0x584a8000\" AppElf=\"eboot.bin\">\n"
    "        <PatchList>\n"
    "            <Line Type=\"bytes\" Address=\"0x58cfbb49\" Value=\"e937010000\"/>\n"
    "        </PatchList>\n"
    "    </Metadata>\n"
    "</Patch>\n";

/* A PS4 entry without ImageBase (GoldHEN's 0x400000 rule), typed values, and an entity. */
static const char PS4[] =
    "<Patch><Metadata Title=\"Bloodborne\" Name=\"60 FPS &amp; more\" Note=\"a &lt;b&gt; &quot;c&quot;\"\n"
    "  Author=\"Lance\" PatchVer=\"1.0\" AppVer=\"01.09\" AppElf=\"eboot.bin\">\n"
    "  <PatchList>\n"
    "    <Line Type=\"float32\" Address=\"0x02434883\" Value=\"0.016666667\"/>\n"
    "    <Line Type=\"byte\" Address=\"0x00400010\" Value=\"0x7f\"/>\n"
    "    <Line Type=\"bytes16\" Address=\"0x00400020\" Value=\"1234\"/>\n"
    "    <Line Type=\"bytes32\" Address=\"0x00400030\" Value=\"#deadbeef\"/>\n"
    "    <Line Type=\"bytes64\" Address=\"0x00400040\" Value=\"$0102030405060708\"/>\n"
    "    <Line Type=\"utf8\" Address=\"0x00430a63\" Value=\"CROW\"/>\n"
    "    <Line Type=\"utf16\" Address=\"0x00430b00\" Value=\"Hi\"/>\n"
    "    <Line Type=\"bytes\" Address=\"0x00400050\" Value=\"\"/>\n"
    "  </PatchList></Metadata></Patch>";

/* Pattern lines: a multi-line mask tag (as in xml_prospero) and a mask_jump32 from xml/. */
static const char MASKS[] =
    "<Patch><Metadata Title=\"T\" Name=\"Unlock\" AppVer=\"mask\" AppElf=\"eboot.bin\">\n"
    "  <PatchList>\n"
    "      <Line Type=\"mask\"\n"
    "            Address=\"c5 f9 d6 87 ?? 08 00 00\"\n"
    "            Value=\"9090909090909090\"\n"
    "            Offset=\"+0\"/>\n"
    "      <Line Type=\"mask_jump32\" Address=\"c5 fa 10 04 8b 48 8b 1d ?? ?? ?? ?? c5 fa 11 45 f4\""
    " Value=\"c7048b0000c842c5fa10048b\" Target=\"90 90 90 90 90 90 90 90 90 90 90 90 90 90 90 90 90\""
    " Size=\"5\"/>\n"
    "      <Line Type=\"mask_bytes32\" Address=\"aa bb\" Value=\"0x01020304\" Offset=\"-2\"/>\n"
    "  </PatchList></Metadata>\n"
    "  <Metadata Title=\"T\" Name=\"Bad\" AppVer=\"mask\"><PatchList>\n"
    "      <Line Type=\"teleport\" Address=\"0x400000\" Value=\"00\"/>\n"
    "  </PatchList></Metadata></Patch>";

static void test_entries(void) {
    char *x = strdup(DEMONS);
    gp_strip_comments(x);
    CHECK(gp_count(x) == 2);
    gp_meta_t m;
    CHECK(gp_meta(x, 0, &m) == 0);
    CHECK(strcmp(m.title, "Demons Souls") == 0);
    CHECK(strcmp(m.name, "Debug Menu") == 0);
    CHECK(strcmp(m.app_ver, "01.000.000") == 0);
    CHECK(strcmp(m.app_elf, "eboot.bin") == 0);
    CHECK(m.has_imagebase && m.imagebase == 0x35b4c000ULL);
    CHECK(gp_meta(x, 1, &m) == 0 && strcmp(m.app_ver, "01.004.000") == 0 && m.imagebase == 0x584a8000ULL);
    CHECK(gp_meta(x, 2, &m) == -1);

    gp_line_t *l = NULL;
    char err[160];
    int n = gp_lines(x, 0, &l, err, sizeof err);
    CHECK(n == 3); /* the commented-out line is gone */
    if (n == 3) {
        CHECK(l[0].kind == GP_WRITE && !l[0].by_pattern && l[0].offset == 0xbf);
        CHECK(l[0].value_len == 1 && l[0].value[0] == 0xcc);
        CHECK(l[1].offset == 0xc0 && l[1].value_len == 3 && l[1].value[2] == 0x03);
        CHECK(l[2].offset == 0x36630caeULL - 0x35b4c000ULL);
    }
    free(l);
    n = gp_lines(x, 1, &l, err, sizeof err);
    CHECK(n == 1 && l[0].offset == 0x58cfbb49ULL - 0x584a8000ULL);
    free(l);
    free(x);
}

static void test_ps4_values(void) {
    gp_meta_t m;
    CHECK(gp_meta(PS4, 0, &m) == 0);
    CHECK(strcmp(m.name, "60 FPS & more") == 0);
    CHECK(strcmp(m.note, "a <b> \"c\"") == 0);
    CHECK(!m.has_imagebase);
    gp_line_t *l = NULL;
    char err[160];
    int n = gp_lines(PS4, 0, &l, err, sizeof err);
    CHECK(n == 7); /* the empty Value line is skipped */
    if (n == 7) {
        float f;
        CHECK(l[0].offset == 0x02434883ULL - 0x400000ULL && l[0].value_len == 4);
        memcpy(&f, l[0].value, 4);
        CHECK(f > 0.0166f && f < 0.0167f);
        CHECK(l[1].offset == 0x10 && l[1].value_len == 1 && l[1].value[0] == 0x7f);
        CHECK(l[2].value_len == 2 && l[2].value[0] == (1234 & 0xff) && l[2].value[1] == (1234 >> 8));
        CHECK(l[3].value_len == 4 && l[3].value[0] == 0xef && l[3].value[3] == 0xde);
        CHECK(l[4].value_len == 8 && l[4].value[0] == 0x08 && l[4].value[7] == 0x01);
        CHECK(l[5].value_len == 5 && memcmp(l[5].value, "CROW", 5) == 0);
        CHECK(l[6].value_len == 6 && l[6].value[0] == 'H' && l[6].value[1] == 0 && l[6].value[2] == 'i' &&
              l[6].value[4] == 0 && l[6].value[5] == 0);
    }
    free(l);

    uint8_t b[16];
    CHECK(gp_value("bytes", "abc", b, 16) == 2 && b[0] == 0x0a && b[1] == 0xbc); /* GoldHEN odd rule */
    CHECK(gp_value("bytes", "zz", b, 16) == -1);
    CHECK(gp_value("byte", "-1", b, 16) == 1 && b[0] == 0xff);
    CHECK(gp_value("utf8", "a\\nb\\x41", b, 16) == 5 && b[1] == '\n' && b[3] == 'A' && b[4] == 0);
    CHECK(gp_value("float64", "1.5", b, 16) == 8);
    CHECK(gp_value("teleport", "00", b, 16) == -1);
}

static void test_masks(void) {
    gp_line_t *l = NULL;
    char err[160];
    int n = gp_lines(MASKS, 0, &l, err, sizeof err);
    CHECK(n == 3);
    if (n == 3) {
        CHECK(l[0].kind == GP_MASK && l[0].by_pattern && l[0].pat_len == 8);
        CHECK(l[0].wild[4] == 1 && l[0].wild[3] == 0 && l[0].pat[3] == 0x87);
        CHECK(l[0].match_offset == 0 && l[0].value_len == 8);
        CHECK(l[1].kind == GP_JUMP32 && l[1].pat_len == 17 && l[1].tpat_len == 17 && l[1].jump_size == 5);
        CHECK(l[1].value_len == 12);
        CHECK(l[2].kind == GP_MASK && l[2].match_offset == -2 && l[2].value_len == 4 && l[2].value[0] == 0x04);
    }
    free(l);
    n = gp_lines(MASKS, 1, &l, err, sizeof err);
    CHECK(n == -1 && strstr(err, "teleport") != NULL);

    uint8_t pat[8], wild[8];
    int pl = gp_pattern("aa ?? cc", pat, wild, 8);
    CHECK(pl == 3);
    const uint8_t hay[] = {0x00, 0xaa, 0x01, 0xcd, 0xaa, 0x02, 0xcc, 0xff};
    CHECK(gp_find(hay, sizeof hay, pat, wild, pl) == 4);
    CHECK(gp_find(hay, 5, pat, wild, pl) == -1);
    CHECK(gp_pattern("aa zz", pat, wild, 8) == -1);
}

static void test_rules(void) {
    gp_meta_t m;
    memset(&m, 0, sizeof m);
    uint64_t off = 0;
    CHECK(gp_rel(&m, 0x401000, &off) == 0 && off == 0x1000);
    CHECK(gp_rel(&m, 0x1000, &off) == -1);
    m.has_imagebase = 1;
    m.imagebase = 0; /* ImageBase="0x0": the address is the offset */
    CHECK(gp_rel(&m, 0x1000, &off) == 0 && off == 0x1000);

    CHECK(gp_version_ok("01.004.000", "01.004.000", ""));
    CHECK(gp_version_ok("01.09", "01.090.000", "01.09"));
    CHECK(!gp_version_ok("01.000.000", "01.004.000", "01.04"));
    CHECK(gp_version_ok("mask", "", ""));
    CHECK(gp_version_ok("all", "", ""));
    CHECK(!gp_version_ok("", "01.00", ""));

    CHECK(gp_elf_ok("eboot.bin", "/app0/eboot.bin"));
    CHECK(gp_elf_ok("EBOOT.BIN", "/app0/eboot.bin"));
    CHECK(!gp_elf_ok("ScimitarACB.elf", "/app0/ScimitarAC2.elf"));
    CHECK(gp_elf_ok("eboot.bin", ""));
    CHECK(gp_elf_is_module("libfoo.sprx") && gp_elf_is_module("x.PRX") && !gp_elf_is_module("eboot.bin"));

    uint8_t site[8], cave[32];
    const uint8_t v[3] = {0x11, 0x22, 0x33};
    CHECK(gp_jump32(0x1000, 0x2000, 7, v, 3, site, cave) == 0);
    int32_t r;
    CHECK(site[0] == 0xE9 && site[5] == 0x90 && site[6] == 0x90);
    memcpy(&r, site + 1, 4);
    CHECK(0x1000 + 5 + r == 0x2000);
    CHECK(cave[0] == 0x11 && cave[3] == 0xE9);
    memcpy(&r, cave + 4, 4);
    CHECK((int64_t)0x2000 + 3 + 5 + r == 0x1000 + 7); /* back to after the hook */
    CHECK(gp_jump32(0x1000, 0x2000, 4, v, 3, site, cave) == -1);
    CHECK(gp_jump32(0x1000, 0x1000 + 0x100000000ULL, 5, v, 3, site, cave) == -1);
}

/* Every file of a PS-Game-Patch checkout: each entry parses, or is refused naming a line type. */
static void test_repo(const char *root) {
    const char *subs[] = {"xml", "xml_prospero"};
    int files = 0, entries = 0, ok = 0, refused = 0;
    for (int s = 0; s < 2; s++) {
        char dirp[512];
        snprintf(dirp, sizeof dirp, "%s/%s", root, subs[s]);
        DIR *d = opendir(dirp);
        if (!d) continue;
        struct dirent *de;
        while ((de = readdir(d))) {
            if (!strstr(de->d_name, ".xml")) continue;
            char path[1024];
            snprintf(path, sizeof path, "%s/%s", dirp, de->d_name);
            FILE *f = fopen(path, "rb");
            if (!f) continue;
            fseek(f, 0, SEEK_END);
            long sz = ftell(f);
            fseek(f, 0, SEEK_SET);
            char *x = malloc((size_t)sz + 1);
            size_t rd = fread(x, 1, (size_t)sz, f);
            x[rd] = '\0';
            fclose(f);
            gp_strip_comments(x);
            files++;
            int n = gp_count(x);
            CHECK(n > 0);
            for (int i = 0; i < n; i++) {
                gp_meta_t m;
                gp_line_t *l = NULL;
                char err[160];
                entries++;
                CHECK(gp_meta(x, i, &m) == 0 && m.name[0]);
                int nl = gp_lines(x, i, &l, err, sizeof err);
                if (nl > 0) ok++;
                else {
                    refused++;
                    if (!strstr(err, "not supported")) {
                        fprintf(stderr, "FAIL %s entry %d (%s): %s\n", de->d_name, i, m.name, err);
                        failures++;
                    }
                }
                free(l);
            }
            free(x);
        }
        closedir(d);
    }
    printf("  repo: %d files, %d entries, %d parse, %d refused for an unsupported type\n", files,
           entries, ok, refused);
    CHECK(files > 0);
}

int main(void) {
    test_entries();
    test_ps4_values();
    test_masks();
    test_rules();
    const char *repo = getenv("GP_REPO");
    if (repo && repo[0]) test_repo(repo);
    if (failures) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    return 0;
}
