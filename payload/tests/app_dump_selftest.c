/* Host test for the title dump (app_dump_core.c, app_dump_pkg.c, app_dump_fself.c): the args JSON,
 * the output names, the DLC folder names, the "not running" refusal, a whole PS5 dump of a fake
 * console tree (app0, package sce_sys entries, appmeta, trophy, DLC, dump-info.json), a refusal of
 * an existing folder, a stop part-way (dump-incomplete.txt), decryption through a fake platform
 * (counted failures, the fself and decrypted/ layout, an unsupported firmware), and a PS4 dump
 * through a synthetic PFS image. The kernel half (app_dump_self.c) is its host stub here. */
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include "app_dump.h"
#include "app_dump_int.h"
#include "app_dump_sha256.h"

static int fails;
#define CHECK(cond)                                                                                                    \
    do {                                                                                                               \
        if (!(cond)) {                                                                                                 \
            printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);                                                     \
            fails++;                                                                                                   \
        }                                                                                                              \
    } while (0)

static char g_tmp[512];

static void path_of(char *out, size_t cap, const char *rel) { snprintf(out, cap, "%s/%s", g_tmp, rel); }

static void put(const char *rel, const void *data, size_t n) {
    char p[1024];
    int fd;
    path_of(p, sizeof p, rel);
    if (ad_mkparent(p) != 0) {
        printf("mkparent %s: %s\n", p, strerror(errno));
        exit(2);
    }
    fd = open(p, O_WRONLY | O_CREAT | O_TRUNC, 0644);
    if (fd < 0 || ad_write_all(fd, data, n) != 0 || close(fd) != 0) {
        printf("write %s: %s\n", p, strerror(errno));
        exit(2);
    }
}

static void put_str(const char *rel, const char *s) { put(rel, s, strlen(s)); }

/* The file's contents (NUL-terminated, at most cap - 1 bytes), or -1. */
static long get(const char *rel, char *buf, size_t cap) {
    char p[1024];
    ssize_t n;
    int fd;
    path_of(p, sizeof p, rel);
    if ((fd = open(p, O_RDONLY)) < 0) return -1;
    n = read(fd, buf, cap - 1);
    close(fd);
    if (n < 0) return -1;
    buf[n] = '\0';
    return (long)n;
}

static int exists(const char *rel) {
    char p[1024];
    struct stat st;
    path_of(p, sizeof p, rel);
    return lstat(p, &st) == 0;
}

static void rm_rf(const char *p) {
    DIR *d = opendir(p);
    struct dirent *e;
    char sub[1024];
    if (!d) {
        (void)unlink(p);
        return;
    }
    while ((e = readdir(d)) != NULL) {
        struct stat st;
        if (!strcmp(e->d_name, ".") || !strcmp(e->d_name, "..")) continue;
        snprintf(sub, sizeof sub, "%s/%s", p, e->d_name);
        if (lstat(sub, &st) == 0 && S_ISDIR(st.st_mode)) rm_rf(sub);
        else (void)unlink(sub);
    }
    closedir(d);
    (void)rmdir(p);
}

/* ---- hooks ---- */

typedef struct {
    uint64_t total_files, total_bytes, files, bytes;
    int cancel_after_files; /* 0 = never */
    char last_note[300];
} prog_t;

static int t_cancelled(void *a) {
    prog_t *p = a;
    return p->cancel_after_files && p->files >= (uint64_t)p->cancel_after_files;
}
static void t_total(void *a, uint64_t f, uint64_t b) {
    prog_t *p = a;
    p->total_files = f;
    p->total_bytes = b;
}
static void t_add(void *a, uint64_t f, uint64_t b) {
    prog_t *p = a;
    p->files += f;
    p->bytes += b;
}
static void t_note(void *a, const char *w) { snprintf(((prog_t *)a)->last_note, sizeof ((prog_t *)a)->last_note, "%s", w); }

static app_dump_hooks_t hooks(prog_t *p) {
    app_dump_hooks_t h = {p, t_cancelled, t_total, t_add, t_note};
    memset(p, 0, sizeof *p);
    return h;
}

/* ---- a fake platform: "SELF" files decrypt, "FAIL" files fail, the rest are not SELFs ---- */

static int fake_supported_on = 1;
static uint32_t fake_fw(void) { return 0x13600000u; }
static int fake_supported(void) { return fake_supported_on; }
static int fake_decrypt(int in_fd, int out_fd, int (*cancelled)(void *), void *arg) {
    char magic[4];
    uint8_t elf[0x80];
    ad_ehdr_t *eh = (ad_ehdr_t *)elf;
    ad_phdr_t *ph = (ad_phdr_t *)(elf + sizeof *eh);
    if (cancelled && cancelled(arg)) return APP_DUMP_SELF_CANCELLED;
    if (ad_pread_all(in_fd, magic, 4, 0) != 0) return APP_DUMP_SELF_NOT_SELF;
    if (!memcmp(magic, "FAIL", 4)) return APP_DUMP_SELF_FAILED;
    if (memcmp(magic, "SELF", 4) != 0) return APP_DUMP_SELF_NOT_SELF;
    /* A minimal ELF: one PT_LOAD of 8 bytes at 0x78. */
    memset(elf, 0, sizeof elf);
    memcpy(eh->e_ident, "\x7f" "ELF", 4);
    eh->e_ident[4] = 2;
    eh->e_phoff = sizeof *eh;
    eh->e_phnum = 1;
    eh->e_phentsize = sizeof *ph;
    ph->p_type = AD_PT_LOAD;
    ph->p_offset = 0x78;
    ph->p_filesz = 8;
    ph->p_memsz = 8;
    ph->p_align = 0x4000;
    memcpy(elf + 0x78, "DECRYPTD", 8);
    return ad_pwrite_all(out_fd, elf, sizeof elf, 0) == 0 ? APP_DUMP_SELF_OK : APP_DUMP_SELF_FAILED;
}

/* ---- synthetic packages and a PFS image ---- */

static void be32(uint8_t *p, uint32_t v) {
    p[0] = (uint8_t)(v >> 24);
    p[1] = (uint8_t)(v >> 16);
    p[2] = (uint8_t)(v >> 8);
    p[3] = (uint8_t)v;
}

/* A CNT with a name table and three entries: a named one, an unnamed one (named by its type) and
 * one whose name climbs out of the folder. Written at `base` of a buffer of `size`. */
static void make_cnt(uint8_t *b, size_t base) {
    static const char names[] = "\0icon0.png\0../../evil.txt\0";
    uint8_t *h = b + base, *e;
    memcpy(h, "\x7f" "CNT", 4);
    h[0x12] = 0;
    h[0x13] = 4; /* table_entries_num (big-endian u16 at 0x12) */
    be32(h + 0x18, 0x200);
    e = h + 0x200;
    /* the name table */
    be32(e + 0x00, 0x0200);
    be32(e + 0x10, 0x300);
    be32(e + 0x14, sizeof names - 1);
    memcpy(h + 0x300, names, sizeof names - 1);
    e += 0x20;
    be32(e + 0x00, 0x1200); /* named icon0.png by the table */
    be32(e + 0x04, 1);
    be32(e + 0x10, 0x400);
    be32(e + 0x14, 4);
    memcpy(h + 0x400, "ICON", 4);
    e += 0x20;
    be32(e + 0x00, 0x0403); /* no name in the table (offset 0 is ""): npbind.dat by type */
    be32(e + 0x10, 0x410);
    be32(e + 0x14, 4);
    memcpy(h + 0x410, "NPBD", 4);
    e += 0x20;
    be32(e + 0x00, 0x1000);
    be32(e + 0x04, 11); /* ../../evil.txt */
    be32(e + 0x10, 0x420);
    be32(e + 0x14, 4);
    memcpy(h + 0x420, "EVIL", 4);
}

#pragma pack(push, 1)
typedef struct {
    uint64_t version, magic;
    uint32_t id[2];
    char fmode, clean, ronly, rsv;
    uint16_t mode, unk1;
    uint32_t blocksz, nbackup;
    uint64_t nblock, ndinode, ndblock, ndinodeblock, superroot_ino;
} t_pfs_hdr;
typedef struct {
    uint16_t mode, nlink;
    uint32_t flags;
    uint64_t size, size_compressed, unix_time[4];
    uint32_t time_nsec[4], uid, gid;
    uint64_t spare[2];
    uint32_t blocks, db[12], ib[5];
} t_inode;
typedef struct {
    uint32_t ino, type, namelen, entsize;
} t_dirent;
#pragma pack(pop)

static size_t dirent_at(uint8_t *blk, size_t at, uint32_t ino, uint32_t type, const char *name) {
    t_dirent d;
    size_t n = strlen(name), es = (sizeof d + n + 1 + 7) & ~(size_t)7;
    d.ino = ino;
    d.type = type;
    d.namelen = (uint32_t)n;
    d.entsize = (uint32_t)es;
    memcpy(blk + at, &d, sizeof d);
    memcpy(blk + at + sizeof d, name, n);
    return at + es;
}

/* super-root (0) -> uroot (1) -> file.bin (2, "hello"), dir "sub" (3) -> deep.txt (4, "deep"),
 * and a "../x" entry that must not be written. Block size 0x1000. */
static void make_pfs(const char *rel) {
    const size_t bs = 0x1000;
    uint8_t *img = calloc(8, bs);
    t_pfs_hdr hd;
    t_inode in[5];
    size_t at;
    memset(&hd, 0, sizeof hd);
    memset(in, 0, sizeof in);
    hd.blocksz = (uint32_t)bs;
    hd.ndinode = 5;
    hd.ndinodeblock = 1;
    hd.superroot_ino = 0;
    memcpy(img, &hd, sizeof hd);
    in[0].blocks = 1, in[0].db[0] = 2, in[0].size = bs;
    in[1].blocks = 1, in[1].db[0] = 3, in[1].size = bs;
    in[2].size = 5, in[2].db[0] = 4;
    in[3].blocks = 1, in[3].db[0] = 5, in[3].size = bs;
    in[4].size = 4, in[4].db[0] = 6;
    memcpy(img + bs, in, sizeof in);
    dirent_at(img + 2 * bs, 0, 1, 3, "uroot");
    at = dirent_at(img + 3 * bs, 0, 2, 2, "file.bin");
    at = dirent_at(img + 3 * bs, at, 3, 3, "sub");
    dirent_at(img + 3 * bs, at, 2, 2, "..");
    memcpy(img + 4 * bs, "hello", 5);
    dirent_at(img + 5 * bs, 0, 4, 2, "deep.txt");
    memcpy(img + 6 * bs, "deep", 4);
    put(rel, img, 8 * bs);
    free(img);
}

/* ---- the console tree ---- */

#define PS5_ID "PPSA01234"
#define DLC_NAME "EP0001-PPSA01234_00-SOUNDTRACK000001-ac"

static void make_ps5_console(void) {
    static uint8_t pkg[0x3000];
    static uint8_t big[3 * 1024 * 1024 + 7];
    size_t i;
    for (i = 0; i < sizeof big; i++) big[i] = (uint8_t)(i * 31u);
    put_str("root/mnt/sandbox/pfsmnt/" PS5_ID "-app0/eboot.bin", "SELF-eboot");
    put_str("root/mnt/sandbox/pfsmnt/" PS5_ID "-app0/sce_sys/param.json", "{\"titleId\":\"" PS5_ID "\"}");
    put("root/mnt/sandbox/pfsmnt/" PS5_ID "-app0/data/big.dat", big, sizeof big);
    put_str("root/mnt/sandbox/pfsmnt/" PS5_ID "-app0/sce_module/libc.prx", "FAIL-libc");
    put_str("root/mnt/sandbox/pfsmnt/" PS5_ID "-app0/sce_module/readme.bin", "not a self");
    put_str("root/mnt/sandbox/pfsmnt/" DLC_NAME "/music/track1.at9", "TRACK");
    put_str("root/mnt/sandbox/pfsmnt/" DLC_NAME "-nest/pfs_image.dat", "nest twin, never dumped");
    put_str("root/mnt/sandbox/pfsmnt/EP0001-PPSA09999_00-OTHERGAME0000001-ac/x", "another title's DLC");
    put_str("root/user/appmeta/" PS5_ID "/icon0.png", "APPMETA-ICON");
    put_str("root/system_data/priv/appmeta/" PS5_ID "/trophy2/npbind.dat", "\x01\x02junkNPWR12345_00\x00\x00more");
    put_str("root/user/trophy2/nobackup/conf/NPWR12345_00/TROPHY.UCP", "TROPHY");
    put_str("root/user/appmeta/addcont/" PS5_ID "/SOUNDTRACK000001/icon0.png", "DLC-ICON");
    /* app.pkg with its CNT at 0x1000, found through app.json's _sc.pkg piece */
    make_cnt(pkg, 0x1000);
    put("root/user/app/" PS5_ID "/app.pkg", pkg, sizeof pkg);
    put_str("root/user/app/" PS5_ID "/app.json",
            "{\"pieces\":[{\"fileOffset\":0,\"fileSize\":4096,\"url\":\"a.pkg\"},"
            "{\"fileOffset\":4096,\"fileSize\":8192,\"url\":\"UP0001-" PS5_ID "_00-X_sc.pkg\"}]}");
}

static app_dump_args_t args(const char *id, const char *dest_rel, int decrypt, int fself, int dlc) {
    app_dump_args_t a;
    memset(&a, 0, sizeof a);
    snprintf(a.title_id, sizeof a.title_id, "%s", id);
    snprintf(a.dest, sizeof a.dest, "%s/%s", g_tmp, dest_rel);
    a.decrypt = decrypt;
    a.fself = fself;
    a.dlc = dlc;
    return a;
}

static void test_args(void) {
    app_dump_args_t a;
    const char *j;
    char out[1100];
    j = "{\"title_id\":\"PPSA01234\",\"dest\":\"/mnt/usb0/ps5upload-dumps\",\"decrypt\":true,\"fself\":false,\"dlc\":false}";
    CHECK(app_dump_parse_args(j, strlen(j), &a) == NULL);
    CHECK(!strcmp(a.title_id, "PPSA01234") && !strcmp(a.dest, "/mnt/usb0/ps5upload-dumps"));
    CHECK(a.decrypt == 1 && a.fself == 0 && a.dlc == 0);
    j = "{\"title_id\":\"CUSA00001\",\"dest\":\"/mnt/ext0/d\"}";
    CHECK(app_dump_parse_args(j, strlen(j), &a) == NULL);
    CHECK(a.decrypt == 0 && a.fself == 0 && a.dlc == 1); /* dlc defaults on */
    j = "{\"title_id\":\"../../etc\",\"dest\":\"/mnt/usb0\"}";
    CHECK(app_dump_parse_args(j, strlen(j), &a) && !strcmp(app_dump_parse_args(j, strlen(j), &a), "dump_bad_title_id"));
    j = "{\"title_id\":\"ppsa01234\",\"dest\":\"/mnt/usb0\"}";
    CHECK(app_dump_parse_args(j, strlen(j), &a) != NULL);
    j = "{\"title_id\":\"PPSA0123\",\"dest\":\"/mnt/usb0\"}";
    CHECK(app_dump_parse_args(j, strlen(j), &a) != NULL);
    j = "{\"title_id\":\"PPSA01234\",\"dest\":\"relative/dir\"}";
    CHECK(app_dump_parse_args(j, strlen(j), &a) && !strcmp(app_dump_parse_args(j, strlen(j), &a), "dump_bad_dest"));
    j = "{\"title_id\":\"PPSA01234\",\"dest\":\"/mnt/usb0\",\"decrypt\":\"yes\"}";
    CHECK(app_dump_parse_args(j, strlen(j), &a) && !strcmp(app_dump_parse_args(j, strlen(j), &a), "dump_bad_args"));

    a = args("PPSA01234", "x", 0, 0, 1);
    snprintf(a.dest, sizeof a.dest, "/mnt/usb0/dumps/");
    CHECK(app_dump_out_path(&a, out, sizeof out) == 0 && !strcmp(out, "/mnt/usb0/dumps/PPSA01234-app"));
    snprintf(a.title_id, sizeof a.title_id, "CUSA00001");
    CHECK(app_dump_out_path(&a, out, sizeof out) == 0 && !strcmp(out, "/mnt/usb0/dumps/CUSA00001"));
    CHECK(app_dump_out_path(&a, out, 10) == -1);

    CHECK(app_dump_dlc_name_ok(DLC_NAME, PS5_ID));
    CHECK(!app_dump_dlc_name_ok(DLC_NAME "-nest", PS5_ID));
    CHECK(!app_dump_dlc_name_ok("EP0001-PPSA09999_00-OTHERGAME0000001-ac", PS5_ID));
    CHECK(!app_dump_dlc_name_ok(PS5_ID "-app0", PS5_ID));

    CHECK(ad_safe_relpath("icon0.png") && ad_safe_relpath("changeinfo/changeinfo.xml"));
    CHECK(!ad_safe_relpath("../x") && !ad_safe_relpath("a/../b") && !ad_safe_relpath("/abs") &&
          !ad_safe_relpath("a//b") && !ad_safe_relpath("") && !ad_safe_relpath("a/") && !ad_safe_relpath("."));
}

static void test_not_running(void) {
    app_dump_args_t a = args("PPSA07777", "nr-dest", 0, 0, 1);
    app_dump_result_t r;
    prog_t p;
    app_dump_hooks_t h = hooks(&p);
    CHECK(app_dump_run(&a, &h, &r) == APP_DUMP_E_NOT_RUNNING);
    CHECK(!strcmp(r.cause, "dump_not_running"));
    CHECK(!exists("nr-dest")); /* nothing written */
}

static void test_ps5_dump(void) {
    app_dump_args_t a = args(PS5_ID, "usb/dumps", 0, 0, 1);
    app_dump_result_t r;
    prog_t p;
    app_dump_hooks_t h = hooks(&p);
    char buf[16384], want[1200];
    long n;
    CHECK(app_dump_run(&a, &h, &r) == APP_DUMP_OK);
    snprintf(want, sizeof want, "%s/usb/dumps/" PS5_ID "-app", g_tmp);
    CHECK(!strcmp(r.path, want));
    /* the counted trees: app0's 5 files and the DLC's 1 */
    CHECK(p.total_files == 6 && p.files == 6);
    CHECK(p.total_bytes == p.bytes && p.bytes == sizeof "SELF-eboot" - 1 + sizeof "{\"titleId\":\"" PS5_ID "\"}" - 1 +
                                                      3 * 1024 * 1024 + 7 + sizeof "FAIL-libc" - 1 +
                                                      sizeof "not a self" - 1 + sizeof "TRACK" - 1);
    CHECK(get("usb/dumps/" PS5_ID "-app/data/big.dat", buf, 8) == 7);
    CHECK(get("usb/dumps/" PS5_ID "-app/eboot.bin", buf, sizeof buf) > 0 && !strcmp(buf, "SELF-eboot"));
    /* app0's param.json over the package's; the package's icon replaced by appmeta's */
    CHECK(get("usb/dumps/" PS5_ID "-app/sce_sys/param.json", buf, sizeof buf) > 0 && strstr(buf, PS5_ID));
    CHECK(get("usb/dumps/" PS5_ID "-app/sce_sys/icon0.png", buf, sizeof buf) > 0 && !strcmp(buf, "APPMETA-ICON"));
    CHECK(get("usb/dumps/" PS5_ID "-app/sce_sys/npbind.dat", buf, sizeof buf) > 0 && !strcmp(buf, "NPBD"));
    CHECK(get("usb/dumps/" PS5_ID "-app/sce_sys/trophy2/npbind.dat", buf, sizeof buf) > 0);
    CHECK(get("usb/dumps/" PS5_ID "-app/sce_sys/trophy2/trophy00.ucp", buf, sizeof buf) > 0 && !strcmp(buf, "TROPHY"));
    CHECK(exists("usb/dumps/" PS5_ID "-app/sce_sys/uds"));
    CHECK(!exists("usb/dumps/evil.txt") && !exists("usb/evil.txt") && !exists("usb/dumps/" PS5_ID "-app/evil.txt"));
    /* the DLC beside it, with its appmeta; the -nest twin and another title's DLC left out */
    CHECK(r.dlc_count == 1 && !strcmp(r.dlc[0], DLC_NAME));
    CHECK(get("usb/dumps/" DLC_NAME "/music/track1.at9", buf, sizeof buf) > 0 && !strcmp(buf, "TRACK"));
    CHECK(get("usb/dumps/" DLC_NAME "/sce_sys/icon0.png", buf, sizeof buf) > 0 && !strcmp(buf, "DLC-ICON"));
    CHECK(!exists("usb/dumps/" DLC_NAME "-nest") && !exists("usb/dumps/EP0001-PPSA09999_00-OTHERGAME0000001-ac"));
    CHECK(r.decrypted == 0 && r.decrypt_failed == 0 && !r.decrypt_skipped[0] && !r.fw[0]);
    CHECK(!exists("usb/dumps/" PS5_ID "-app/dump-incomplete.txt"));
    n = get("usb/dumps/" PS5_ID "-app/dump-info.json", buf, sizeof buf);
    CHECK(n > 0 && !strncmp(buf, "{\"title_id\":\"" PS5_ID "\",\"path\":\"", 26));
    CHECK(n > 0 && strstr(buf, "\"dlc\":[\"" DLC_NAME "\"]") && strstr(buf, "\"finished\":") &&
          strstr(buf, "\"decrypt_skipped\":\"\"") && buf[n - 1] == '\n');
    n = app_dump_result_json(&r, PS5_ID, 0, 0, buf, sizeof buf);
    CHECK(n > 0 && !strncmp(buf, "{\"path\":\"", 9) && !strstr(buf, "title_id") && !strstr(buf, "finished"));
    CHECK(strstr(buf, "\"files\":") && strstr(buf, "\"bytes\":") && strstr(buf, "\"decrypted\":0") &&
          strstr(buf, "\"decrypt_failed\":0") && strstr(buf, "\"fw\":\"\"}"));
    CHECK(app_dump_result_json(&r, PS5_ID, 0, 0, buf, 40) == -1);

    /* Again: the folder exists. */
    h = hooks(&p);
    CHECK(app_dump_run(&a, &h, &r) == APP_DUMP_E_EXISTS && !strcmp(r.cause, "dump_exists"));
}

static void test_cancel(void) {
    app_dump_args_t a = args(PS5_ID, "cancel", 0, 0, 1);
    app_dump_result_t r;
    prog_t p;
    app_dump_hooks_t h = hooks(&p);
    char buf[512];
    p.cancel_after_files = 2;
    CHECK(app_dump_run(&a, &h, &r) == APP_DUMP_E_CANCELLED);
    CHECK(!strcmp(r.cause, "dump_cancelled"));
    CHECK(get("cancel/" PS5_ID "-app/dump-incomplete.txt", buf, sizeof buf) > 0 && strstr(buf, "stopped"));
    CHECK(!exists("cancel/" PS5_ID "-app/dump-info.json"));
    CHECK(!exists("cancel/" DLC_NAME)); /* stopped before the DLC */
}

static void test_decrypt(void) {
    app_dump_platform_t keep = app_dump_platform;
    app_dump_args_t a = args(PS5_ID, "dec", 1, 0, 0);
    app_dump_result_t r;
    prog_t p;
    app_dump_hooks_t h = hooks(&p);
    char buf[512];
    app_dump_platform.fw_version = fake_fw;
    app_dump_platform.decrypt_supported = fake_supported;
    app_dump_platform.decrypt_self = fake_decrypt;

    CHECK(app_dump_run(&a, &h, &r) == APP_DUMP_OK);
    CHECK(!strcmp(r.fw, "0x13600000"));
    CHECK(r.decrypted == 1 && r.decrypt_failed == 1 && !r.decrypt_skipped[0]);
    CHECK(r.dlc_count == 0 && !exists("dec/" DLC_NAME));
    /* 5 copied + 3 SELF candidates (eboot.bin, libc.prx, readme.bin) */
    CHECK(p.total_files == 8 && p.files == 8 && p.bytes == p.total_bytes);
    CHECK(get("dec/" PS5_ID "-app/eboot.bin", buf, sizeof buf) == 0x80 && !memcmp(buf, "\x7f" "ELF", 4));
    CHECK(get("dec/" PS5_ID "-app/sce_module/libc.prx", buf, sizeof buf) > 0 && !strcmp(buf, "FAIL-libc"));
    CHECK(get("dec/" PS5_ID "-app/sce_module/readme.bin", buf, sizeof buf) > 0 && !strcmp(buf, "not a self"));
    CHECK(!exists("dec/" PS5_ID "-app/eboot.bin.ps5u-part") && !exists("dec/" PS5_ID "-app/decrypted"));

    /* fself: the fake-signed SELF in the dump, the ELF under decrypted/ */
    a = args(PS5_ID, "fself", 1, 1, 0);
    h = hooks(&p);
    CHECK(app_dump_run(&a, &h, &r) == APP_DUMP_OK && r.decrypted == 1);
    CHECK(get("fself/" PS5_ID "-app/decrypted/eboot.bin", buf, sizeof buf) == 0x80 && !memcmp(buf, "\x7f" "ELF", 4));
    CHECK(get("fself/" PS5_ID "-app/eboot.bin", buf, sizeof buf) > 0x80 && !memcmp(buf, "\x54\x14\xf5\xee", 4));
    CHECK(!exists("fself/" PS5_ID "-app/decrypted/sce_module/libc.prx"));

    /* A firmware without a pager entry: the plain copy, and a success that says why. */
    fake_supported_on = 0;
    a = args(PS5_ID, "nofw", 1, 1, 0);
    h = hooks(&p);
    CHECK(app_dump_run(&a, &h, &r) == APP_DUMP_OK);
    CHECK(!strcmp(r.decrypt_skipped, "dump_decrypt_unsupported_fw") && r.decrypted == 0);
    CHECK(get("nofw/" PS5_ID "-app/eboot.bin", buf, sizeof buf) > 0 && !strcmp(buf, "SELF-eboot"));
    CHECK(p.total_files == 5);
    fake_supported_on = 1;
    app_dump_platform = keep;

    /* The host stub never decrypts. */
    CHECK(app_dump_platform.decrypt_supported() == 0 && app_dump_platform.fw_version() == 0);
}

static void test_elf2fself(void) {
    uint8_t elf[0x100];
    ad_ehdr_t *eh = (ad_ehdr_t *)elf;
    ad_phdr_t *ph = (ad_phdr_t *)(elf + sizeof *eh);
    char in[1024], out[1024], buf[4096];
    long n;
    SHA256_CTX ctx;
    uint8_t dig[SHA256_BLOCK_SIZE];
    static const uint8_t abc[SHA256_BLOCK_SIZE] = {0xba, 0x78, 0x16, 0xbf, 0x8f, 0x01, 0xcf, 0xea, 0x41, 0x41, 0x40,
                                                   0xde, 0x5d, 0xae, 0x22, 0x23, 0xb0, 0x03, 0x61, 0xa3, 0x96, 0x17,
                                                   0x7a, 0x9c, 0xb4, 0x10, 0xff, 0x61, 0xf2, 0x00, 0x15, 0xad};
    sha256_init(&ctx);
    sha256_update(&ctx, (const uint8_t *)"abc", 3);
    sha256_final(&ctx, dig);
    CHECK(!memcmp(dig, abc, sizeof abc));
    memset(elf, 0, sizeof elf);
    memcpy(eh->e_ident, "\x7f" "ELF", 4);
    eh->e_phoff = sizeof *eh;
    eh->e_phnum = 2;
    ph[0].p_type = AD_PT_LOAD;
    ph[0].p_offset = 0xC0;
    ph[0].p_filesz = 0x40;
    ph[1].p_type = AD_PT_SCE_VERSION;
    ph[1].p_offset = 0xF0;
    ph[1].p_filesz = 0x10;
    put("fs/in.elf", elf, sizeof elf);
    path_of(in, sizeof in, "fs/in.elf");
    path_of(out, sizeof out, "fs/out.self");
    CHECK(app_dump_elf2fself(in, out) == 0);
    n = get("fs/out.self", buf, sizeof buf);
    CHECK(n > 0x100 && !memcmp(buf, "\x54\x14\xf5\xee", 4));
    put_str("fs/notelf", "nope");
    path_of(in, sizeof in, "fs/notelf");
    path_of(out, sizeof out, "fs/notelf.self");
    CHECK(app_dump_elf2fself(in, out) == -1 && !exists("fs/notelf.self"));
}

static void test_ps4_dump(void) {
    static uint8_t pkg[0x1000];
    app_dump_args_t a = args("CUSA00001", "ps4", 0, 0, 1);
    app_dump_result_t r;
    prog_t p;
    app_dump_hooks_t h = hooks(&p);
    char buf[512];
    uint64_t f = 0, b = 0;
    char img[1024];
    put_str("root/mnt/sandbox/pfsmnt/CUSA00001-app0/eboot.bin", "mounted, not copied: the image is");
    make_pfs("root/mnt/sandbox/pfsmnt/CUSA00001-app0-nest/pfs_image.dat");
    put_str("root/system_data/priv/appmeta/CUSA00001/nptitle.dat", "NPTITLE");
    make_cnt(pkg, 0);
    put("root/user/app/CUSA00001/app.pkg", pkg, sizeof pkg);

    path_of(img, sizeof img, "root/mnt/sandbox/pfsmnt/CUSA00001-app0-nest/pfs_image.dat");
    CHECK(app_dump_unpfs(img, NULL, 1, NULL, &f, &b) == 0 && f == 2 && b == 9);

    CHECK(app_dump_run(&a, &h, &r) == APP_DUMP_OK);
    CHECK(p.total_files == 2 && p.files == 2 && p.bytes == 9);
    CHECK(get("ps4/CUSA00001/file.bin", buf, sizeof buf) == 5 && !strcmp(buf, "hello"));
    CHECK(get("ps4/CUSA00001/sub/deep.txt", buf, sizeof buf) == 4 && !strcmp(buf, "deep"));
    CHECK(!exists("ps4/CUSA00001/eboot.bin")); /* the image, not the mount */
    CHECK(get("ps4/CUSA00001/sce_sys/icon0.png", buf, sizeof buf) == 4 && !strcmp(buf, "ICON"));
    CHECK(get("ps4/CUSA00001/sce_sys/nptitle.dat", buf, sizeof buf) > 0 && !strcmp(buf, "NPTITLE"));
    CHECK(!exists("ps4/evil.txt") && !exists("evil.txt"));
    CHECK(exists("ps4/CUSA00001/dump-info.json"));
}

int main(void) {
    char root[600];
    snprintf(g_tmp, sizeof g_tmp, "/tmp/ps5upload-app-dump-selftest-%d", (int)getpid());
    rm_rf(g_tmp);
    if (ad_mkdirs(g_tmp) != 0) {
        printf("mkdir %s failed\n", g_tmp);
        return 2;
    }
    snprintf(root, sizeof root, "%s/root", g_tmp);
    app_dump_root = root;
    make_ps5_console();

    test_args();
    test_not_running();
    test_ps5_dump();
    test_cancel();
    test_decrypt();
    test_elf2fself();
    test_ps4_dump();

    if (!fails) rm_rf(g_tmp);
    else printf("left %s for a look\n", g_tmp);
    printf("%s: %d failure(s)\n", fails ? "FAIL" : "ok", fails);
    return fails ? 1 : 0;
}
