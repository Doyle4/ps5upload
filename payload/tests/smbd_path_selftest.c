/* Host self-test: the SMB daemon's path, address and JSON rules (payload/smb/smbd_path.c,
 * smbd_json.c). */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "smbd_json.h"
#include "smbd_path.h"

static int g_fail;
#define CHECK(c)                                                         \
    do {                                                                 \
        if (!(c)) {                                                      \
            fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #c); \
            g_fail++;                                                    \
        }                                                                \
    } while (0)

static void t_rel(void) {
    char out[SMBP_PATH_MAX];
    CHECK(smbp_rel_normalize("", out, sizeof out) == 0 && strcmp(out, "") == 0);
    CHECK(smbp_rel_normalize("/", out, sizeof out) == 0 && strcmp(out, "") == 0);
    CHECK(smbp_rel_normalize("Movies/2024", out, sizeof out) == 0 && strcmp(out, "Movies/2024") == 0);
    CHECK(smbp_rel_normalize("/Movies/2024/", out, sizeof out) == 0 && strcmp(out, "Movies/2024") == 0);
    /* non-ASCII names pass through as UTF-8 */
    CHECK(smbp_rel_normalize("游戏/中文 文件夹", out, sizeof out) == 0 && strcmp(out, "游戏/中文 文件夹") == 0);
    CHECK(smbp_rel_normalize("Ünïcødé/日本語.bin", out, sizeof out) == 0);
    CHECK(smbp_rel_normalize("emoji/\xF0\x9F\x8E\xAE.txt", out, sizeof out) == 0);
    /* names a Linux / macOS server holds and Windows would not: readable, so listable and copyable */
    CHECK(smbp_rel_normalize("Games/God of War: Ragnarok", out, sizeof out) == 0 &&
          strcmp(out, "Games/God of War: Ragnarok") == 0);
    CHECK(smbp_rel_normalize("a*", out, sizeof out) == 0 && strcmp(out, "a*") == 0);
    CHECK(smbp_rel_normalize("what?", out, sizeof out) == 0);
    /* refused */
    CHECK(smbp_rel_normalize("a//b", out, sizeof out) != 0 && out[0] == '\0');
    CHECK(smbp_rel_normalize("a/../b", out, sizeof out) != 0);
    CHECK(smbp_rel_normalize("..", out, sizeof out) != 0);
    CHECK(smbp_rel_normalize("./a", out, sizeof out) != 0);
    CHECK(smbp_rel_normalize("a\\b", out, sizeof out) != 0);
    CHECK(smbp_rel_normalize("a\tb", out, sizeof out) != 0);
    CHECK(smbp_rel_normalize("a\x01", out, sizeof out) != 0);
    CHECK(smbp_rel_normalize("bad\xC3", out, sizeof out) != 0);          /* cut UTF-8 */
    CHECK(smbp_rel_normalize("over\xC0\xAF", out, sizeof out) != 0);     /* overlong '/' */
    CHECK(smbp_rel_normalize("sur\xED\xA0\x80", out, sizeof out) != 0); /* a surrogate */
    {
        char longname[300];
        memset(longname, 'a', 299);
        longname[299] = '\0';
        CHECK(smbp_rel_normalize(longname, out, sizeof out) != 0); /* a component over 255 bytes */
    }
    {
        char small[8];
        CHECK(smbp_rel_normalize("abcdefgh", small, sizeof small) != 0);
    }
}

static void t_names(void) {
    CHECK(smbp_name_ok("a.txt"));
    CHECK(smbp_name_ok("名前"));
    CHECK(!smbp_name_ok(""));
    CHECK(!smbp_name_ok("."));
    CHECK(!smbp_name_ok(".."));
    CHECK(!smbp_name_ok("a/b"));
    CHECK(!smbp_name_ok("a|b"));
    CHECK(!smbp_name_ok("a\"b"));
    CHECK(!smbp_name_ok("a\x7f"));
    /* a name we create on a share stays Windows-safe; one we only read may carry : * ? " < > | */
    CHECK(!smbp_name_ok("God of War: Ragnarok") && smbp_name_readable("God of War: Ragnarok"));
    CHECK(!smbp_name_ok("a*") && smbp_name_readable("a*"));
    CHECK(!smbp_name_readable("a/b") && !smbp_name_readable("a\\b") && !smbp_name_readable("a\x01") &&
          !smbp_name_readable("..") && !smbp_name_readable("") && !smbp_name_readable("bad\xC3"));
    CHECK(smbp_share_ok("Movies"));
    CHECK(smbp_share_ok("共享"));
    CHECK(!smbp_share_ok("IPC$"));
    CHECK(!smbp_share_ok("ipc$"));
    CHECK(smbp_share_ok("C$")); /* an admin share is still a folder */
    CHECK(smbp_skip_download("._Movie.mkv"));
    CHECK(smbp_skip_download(".DS_Store"));
    CHECK(!smbp_skip_download(".hidden"));
    CHECK(!smbp_skip_download("Movie.mkv"));
}

static void t_join(void) {
    char out[SMBP_PATH_MAX], tiny[6];
    CHECK(smbp_join("", "a", out, sizeof out) == 0 && strcmp(out, "a") == 0);
    CHECK(smbp_join("x/y", "a", out, sizeof out) == 0 && strcmp(out, "x/y/a") == 0);
    CHECK(smbp_join("/", "data", out, sizeof out) == 0 && strcmp(out, "/data") == 0);
    CHECK(smbp_join("/data", "a", out, sizeof out) == 0 && strcmp(out, "/data/a") == 0);
    CHECK(smbp_join("abc", "def", tiny, sizeof tiny) != 0 && tiny[0] == '\0');
    smbp_parent("a/b/c", out, sizeof out);
    CHECK(strcmp(out, "a/b") == 0);
    smbp_parent("a", out, sizeof out);
    CHECK(strcmp(out, "") == 0);
    smbp_parent("/data/x", out, sizeof out);
    CHECK(strcmp(out, "/data") == 0);
    smbp_parent("/x", out, sizeof out);
    CHECK(strcmp(out, "/") == 0);
    CHECK(strcmp(smbp_base("a/b/c.txt"), "c.txt") == 0);
    CHECK(strcmp(smbp_base("c.txt"), "c.txt") == 0);
    CHECK(smbp_part_name("/data/x.bin", out, sizeof out) == 0 && strcmp(out, "/data/x.bin.ps5u-part") == 0);
}

static void t_local(void) {
    CHECK(smbp_local_ok("/data/ps5upload-smb-test"));
    CHECK(smbp_local_ok("/mnt/usb0/游戏"));
    CHECK(smbp_local_ok("/"));
    CHECK(!smbp_local_ok("data/x"));
    CHECK(!smbp_local_ok("/data/../system"));
    CHECK(!smbp_local_ok("/data/./x"));
    CHECK(!smbp_local_ok("/data//x"));
    CHECK(!smbp_local_ok("/data/x/"));
    CHECK(!smbp_local_ok("/data/x\n"));
    CHECK(!smbp_local_ok(NULL));
}

static void t_server(void) {
    char host[SMBP_HOST_MAX], share[SMBP_SHARE_MAX], path[SMBP_PATH_MAX];
    uint16_t port = 0;
    CHECK(smbp_parse_server("192.168.1.10", host, sizeof host, &port, share, sizeof share, path, sizeof path) == 0);
    CHECK(strcmp(host, "192.168.1.10") == 0 && port == 445 && !share[0] && !path[0]);
    CHECK(smbp_parse_server("  nas.local:4450 ", host, sizeof host, &port, share, sizeof share, path, sizeof path) == 0);
    CHECK(strcmp(host, "nas.local") == 0 && port == 4450);
    CHECK(smbp_parse_server("smb://nas/Movies/2024/", host, sizeof host, &port, share, sizeof share, path, sizeof path) ==
          0);
    CHECK(strcmp(host, "nas") == 0 && strcmp(share, "Movies") == 0 && strcmp(path, "2024") == 0 && port == 445);
    CHECK(smbp_parse_server("\\\\NAS\\共享\\游戏", host, sizeof host, &port, share, sizeof share, path, sizeof path) == 0);
    CHECK(strcmp(host, "NAS") == 0 && strcmp(share, "共享") == 0 && strcmp(path, "游戏") == 0);
    CHECK(smbp_parse_server("[fe80::1%en0]:445", host, sizeof host, &port, share, sizeof share, path, sizeof path) == 0);
    CHECK(strcmp(host, "fe80::1%en0") == 0 && port == 445);
    CHECK(smbp_parse_server("fe80::2", host, sizeof host, &port, share, sizeof share, path, sizeof path) == 0);
    CHECK(strcmp(host, "fe80::2") == 0);
    CHECK(smbp_parse_server("//10.0.0.2/share", host, sizeof host, &port, share, sizeof share, path, sizeof path) == 0);
    CHECK(strcmp(share, "share") == 0);
    /* refused */
    CHECK(smbp_parse_server("", host, sizeof host, &port, share, sizeof share, path, sizeof path) != 0);
    CHECK(smbp_parse_server("smb://user:pw@nas/x", host, sizeof host, &port, share, sizeof share, path, sizeof path) != 0);
    CHECK(smbp_parse_server("nas:0", host, sizeof host, &port, share, sizeof share, path, sizeof path) != 0);
    CHECK(smbp_parse_server("nas:65536", host, sizeof host, &port, share, sizeof share, path, sizeof path) != 0);
    CHECK(smbp_parse_server("nas:44x", host, sizeof host, &port, share, sizeof share, path, sizeof path) != 0);
    CHECK(smbp_parse_server("na s", host, sizeof host, &port, share, sizeof share, path, sizeof path) != 0);
    CHECK(smbp_parse_server("smb://nas/IPC$", host, sizeof host, &port, share, sizeof share, path, sizeof path) != 0);
    CHECK(smbp_parse_server("smb://nas/x/../y", host, sizeof host, &port, share, sizeof share, path, sizeof path) != 0);
    CHECK(smbp_parse_server("-nas", host, sizeof host, &port, share, sizeof share, path, sizeof path) != 0);
    CHECK(smbp_parse_server("[fe80::1", host, sizeof host, &port, share, sizeof share, path, sizeof path) != 0);
    CHECK(smbp_host_ok("nas") && smbp_host_ok("10.0.0.1") && smbp_host_ok("fe80::1"));
    CHECK(!smbp_host_ok("nas:445") && !smbp_host_ok("") && !smbp_host_ok("a/b"));
    {
        char arg[300];
        CHECK(smbp_server_arg("nas", 445, arg, sizeof arg) == 0 && strcmp(arg, "nas:445") == 0);
        CHECK(smbp_server_arg("fe80::1", 4450, arg, sizeof arg) == 0 && strcmp(arg, "[fe80::1]:4450") == 0);
    }
}

static void t_json(void) {
    const char *j = "{\"op\":\"list\",\"host\":\"nas\",\"port\":4450,\"path\":\"\\u6e38\\u620f/\\ud83c\\udfae\","
                    "\"overwrite\":true,\"nested\":{\"path\":\"x\"},\"pw\":\"a\\\"b\"}";
    size_t n = strlen(j);
    char s[64];
    uint64_t u = 0;
    int b = 0;
    CHECK(sj_str(j, n, "op", s, sizeof s) == 1 && strcmp(s, "list") == 0);
    CHECK(sj_str(j, n, "path", s, sizeof s) == 1 && strcmp(s, "游戏/\xF0\x9F\x8E\xAE") == 0);
    CHECK(sj_str(j, n, "pw", s, sizeof s) == 1 && strcmp(s, "a\"b") == 0);
    CHECK(sj_u64(j, n, "port", &u) == 1 && u == 4450);
    CHECK(sj_bool(j, n, "overwrite", &b) == 1 && b == 1);
    CHECK(sj_str(j, n, "missing", s, sizeof s) == 0);
    CHECK(sj_str(j, n, "port", s, sizeof s) == -1);
    CHECK(sj_str("{\"a\":\"\\u0000\"}", 13, "a", s, sizeof s) == -1);
    CHECK(sj_str("{\"a\":\"abcdefgh\"}", 15, "a", s, 4) == -1);
    {
        sj_buf_t b2;
        sj_init(&b2, 0);
        sj_strlit(&b2, "名\"\n\xff");
        CHECK(b2.buf && strcmp(b2.buf, "\"名\\\"\\u000a\\ufffd\"") == 0);
        sj_free(&b2);
        sj_init(&b2, 16);
        sj_raw(&b2, "0123456789abcdefXYZ");
        CHECK(b2.err == 1);
        sj_free(&b2);
    }
    CHECK(strcmp(smbp_err_token(XE_AUTH), "smb_auth") == 0);
    CHECK(strcmp(smbp_err_token(XE_DISCONNECTED), "smb_disconnected") == 0);
    CHECK(strcmp(smbp_err_token(-999), "io_error") == 0);
}

int main(void) {
    t_rel();
    t_names();
    t_join();
    t_local();
    t_server();
    t_json();
    if (g_fail) {
        fprintf(stderr, "%d check(s) failed\n", g_fail);
        return 1;
    }
    printf("smbd path/json self-test: ok\n");
    return 0;
}
