/* The "ps5upload" home-screen tile: see include/webui_tile.h.
 *
 * The file half (param.json, writing the folder, deleting it) is host-tested with
 * -DWEBUI_TILE_HOST_TEST (payload/tests/webui_settings_selftest.c); the Sony half (register,
 * unregister, the worker thread) is built for the console only. */
#include "webui_tile.h"

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include "config.h"

/* The tile's eboot.bin. register_title_from_path refuses a folder without one
 * (register_src_missing_eboot; measured on the Phat, ruling R6); a few placeholder bytes
 * register fine. Nothing ever runs it: the param.json deeplinkUri opens the browser. */
static const char k_eboot[] = "ps5upload home-screen tile: opens the browser on the console web UI\n";

size_t webui_tile_param_json(char *out, size_t cap, uint16_t port) {
    int k = snprintf(out, cap,
                     "{\"applicationCategoryType\":66048,\"titleId\":\"%s\","
                     "\"deeplinkUri\":\"http://127.0.0.1:%u/\","
                     "\"localizedParameters\":{\"defaultLanguage\":\"en-US\",\"en-US\":{\"titleName\":\"ps5upload\"}}}",
                     WEBUI_TILE_TITLE_ID, (unsigned)port);
    return k < 0 ? 0 : (size_t)k;
}

/* mkdir -p, 0777 like every folder the helper creates. */
static int mkdir_parents(const char *dir) {
    char p[1024];
    size_t i, n = strlen(dir);
    if (n == 0 || n >= sizeof p) return -1;
    memcpy(p, dir, n + 1);
    for (i = 1; i <= n; i++) {
        if (p[i] != '/' && p[i] != '\0') continue;
        p[i] = '\0';
        if (mkdir(p, 0777) != 0 && errno != EEXIST) return -1;
        p[i] = i < n ? '/' : '\0';
    }
    return 0;
}

/* 1 when `path` holds exactly these bytes, 0 otherwise (missing, other size or content). */
static int same_bytes(const char *path, const unsigned char *data, size_t len) {
    unsigned char buf[4096];
    struct stat st;
    size_t at = 0;
    int fd = open(path, O_RDONLY), same = 0;
    if (fd < 0) return 0;
    if (fstat(fd, &st) != 0 || !S_ISREG(st.st_mode) || (size_t)st.st_size != len) goto out;
    while (at < len) {
        size_t want = len - at < sizeof buf ? len - at : sizeof buf;
        ssize_t r = read(fd, buf, want);
        if (r < 0 && errno == EINTR) continue;
        if (r <= 0 || memcmp(buf, data + at, (size_t)r) != 0) goto out;
        at += (size_t)r;
    }
    same = 1;
out:
    close(fd);
    return same;
}

/* `<path>.tmp` in the same directory, fsync, rename over `path` (never across a mount). */
static int write_atomic(const char *path, const unsigned char *data, size_t len) {
    char tmp[1100];
    size_t done = 0;
    int fd, k = snprintf(tmp, sizeof tmp, "%s.tmp", path);
    if (k < 0 || (size_t)k >= sizeof tmp) return -1;
    fd = open(tmp, O_WRONLY | O_CREAT | O_TRUNC, 0666);
    if (fd < 0) return -1;
    while (done < len) {
        ssize_t w = write(fd, data + done, len - done);
        if (w < 0 && errno == EINTR) continue;
        if (w <= 0) break;
        done += (size_t)w;
    }
    if (done != len || fsync(fd) != 0) {
        close(fd);
        unlink(tmp);
        return -1;
    }
    if (close(fd) != 0 || rename(tmp, path) != 0) {
        unlink(tmp);
        return -1;
    }
    return 0;
}

/* 1 written, 0 already equal, -1 failed. */
static int sync_file(const char *dir, const char *name, const unsigned char *data, size_t len) {
    char p[1024];
    int k = snprintf(p, sizeof p, "%s/%s", dir, name);
    if (k < 0 || (size_t)k >= sizeof p) return -1;
    if (same_bytes(p, data, len)) return 0;
    return write_atomic(p, data, len) == 0 ? 1 : -1;
}

int webui_tile_write_files(const char *dir, uint16_t port) {
    char sce_sys[1024], param[512];
    size_t plen = webui_tile_param_json(param, sizeof param, port);
    int k, r, changed = 0;
    if (plen == 0 || plen >= sizeof param) return -1;
    k = snprintf(sce_sys, sizeof sce_sys, "%s/sce_sys", dir);
    if (k < 0 || (size_t)k >= sizeof sce_sys) return -1;
    if (mkdir_parents(sce_sys) != 0) return -1;
    r = sync_file(sce_sys, "param.json", (const unsigned char *)param, plen);
    if (r < 0) return -1;
    changed += r;
    r = sync_file(sce_sys, "icon0.png", webui_tile_icon0_png, webui_tile_icon0_png_len);
    if (r < 0) return -1;
    changed += r;
    r = sync_file(dir, "eboot.bin", (const unsigned char *)k_eboot, sizeof k_eboot - 1);
    if (r < 0) return -1;
    changed += r;
    return changed;
}

/* rm -r, bounded depth (the tile folder is two levels deep). */
static int remove_tree(const char *path, int depth) {
    struct stat st;
    DIR *d;
    struct dirent *e;
    int rc = 0;
    if (lstat(path, &st) != 0) return errno == ENOENT ? 0 : -1;
    if (!S_ISDIR(st.st_mode)) return unlink(path) == 0 || errno == ENOENT ? 0 : -1;
    if (depth > 4) return -1;
    d = opendir(path);
    if (!d) return -1;
    while ((e = readdir(d)) != NULL) {
        char child[1024];
        int k;
        if (!strcmp(e->d_name, ".") || !strcmp(e->d_name, "..")) continue;
        k = snprintf(child, sizeof child, "%s/%s", path, e->d_name);
        if (k < 0 || (size_t)k >= sizeof child || remove_tree(child, depth + 1) != 0) rc = -1;
    }
    closedir(d);
    if (rmdir(path) != 0 && errno != ENOENT) rc = -1;
    return rc;
}

int webui_tile_remove_files(const char *dir) { return remove_tree(dir, 0); }

#ifndef WEBUI_TILE_HOST_TEST

#include <pthread.h>
#include <sys/mount.h>
#include <sys/param.h>

#include "proc_identity.h"
#include "register.h"

#define TILE_STACK (256u * 1024u)
#define TILE_THREAD_NAME "ps5upload-tile"
#define TILE_SYSTEM_EX "/system_ex/app/" WEBUI_TILE_TITLE_ID
#define TILE_MOUNT_LNK "/user/app/" WEBUI_TILE_TITLE_ID "/mount.lnk"

/* Serializes ensure and remove (Sony calls, the folder) whoever calls them. */
static pthread_mutex_t g_op_mu = PTHREAD_MUTEX_INITIALIZER;

/* Registered this boot by us, from this folder: the nullfs register_title_from_path binds at
 * /system_ex/app/PSUP00001 is live (it is rolled back when Sony's install call fails, and does not
 * survive a reboot) and /user/app/PSUP00001/mount.lnk names WEBUI_TILE_DIR. One statfs and one
 * small read: no Sony call, no app.db open. */
static int tile_registered(void) {
    struct statfs sfs;
    char lnk[256];
    ssize_t n;
    int fd;
    if (statfs(TILE_SYSTEM_EX, &sfs) != 0 || strcmp(sfs.f_mntonname, TILE_SYSTEM_EX) != 0) return 0;
    fd = open(TILE_MOUNT_LNK, O_RDONLY);
    if (fd < 0) return 0;
    n = read(fd, lnk, sizeof lnk - 1);
    close(fd);
    if (n <= 0) return 0;
    lnk[n] = '\0';
    while (n > 0 && (lnk[n - 1] == '\n' || lnk[n - 1] == '\r' || lnk[n - 1] == '/')) lnk[--n] = '\0';
    return strcmp(lnk, WEBUI_TILE_DIR) == 0;
}

int webui_tile_ensure(uint16_t port) {
    char tid[REGISTER_MAX_TITLE_ID], tname[REGISTER_MAX_TITLE_NAME];
    const char *err = NULL;
    int changed, used = 0, rc = 0;
    pthread_mutex_lock(&g_op_mu);
    changed = webui_tile_write_files(WEBUI_TILE_DIR, port);
    if (changed < 0) {
        fprintf(stderr, "webui tile: cannot write %s: %s\n", WEBUI_TILE_DIR, strerror(errno));
        rc = -1;
    } else if (changed > 0 || !tile_registered()) {
        /* register copies sce_sys into /user/app and /user/appmeta: a changed file needs a re-register
         * even while the title is registered (Sony answers 0x80990002 "restored": success). */
        if (register_title_from_path(WEBUI_TILE_DIR, 0, tid, tname, &used, &err) != 0) {
            fprintf(stderr, "webui tile: register failed: %s\n", err ? err : "unknown");
            rc = -1;
        } else {
            fprintf(stderr, "webui tile: registered %s\n", tid);
        }
    }
    pthread_mutex_unlock(&g_op_mu);
    return rc;
}

int webui_tile_remove(void) {
    const char *err = NULL;
    unsigned sony_rc = 0;
    int rc = 0;
    pthread_mutex_lock(&g_op_mu);
    /* The nullfs must be gone before the folder under it is deleted: on an unregister failure the
     * folder stays (a tile pointing at nothing is worse than a tile that still works). */
    if (unregister_title(WEBUI_TILE_TITLE_ID, &err, &sony_rc) != 0) {
        fprintf(stderr, "webui tile: unregister failed: %s; keeping %s\n", err ? err : "unknown", WEBUI_TILE_DIR);
        rc = -1;
    } else {
        if (sony_rc) fprintf(stderr, "webui tile: Sony uninstall rc=0x%08x (the tile may linger)\n", sony_rc);
        if (webui_tile_remove_files(WEBUI_TILE_DIR) != 0) {
            fprintf(stderr, "webui tile: cannot delete %s: %s\n", WEBUI_TILE_DIR, strerror(errno));
            rc = -1;
        }
    }
    pthread_mutex_unlock(&g_op_mu);
    return rc;
}

/* One worker at a time applies the latest request: g_req_gen counts requests, the worker loops
 * until it has applied the newest one. */
static pthread_mutex_t g_req_mu = PTHREAD_MUTEX_INITIALIZER;
static unsigned g_req_gen;
static int g_req_tile;
static uint16_t g_req_port;
static int g_worker_running;

static void *tile_worker(void *arg) {
    unsigned done = 0;
    (void)arg;
    proc_name_set_self(TILE_THREAD_NAME);
    pthread_mutex_lock(&g_req_mu);
    for (;;) {
        unsigned gen = g_req_gen;
        int tile = g_req_tile;
        uint16_t port = g_req_port;
        if (done == gen) break;
        pthread_mutex_unlock(&g_req_mu);
        if (tile) (void)webui_tile_ensure(port);
        else (void)webui_tile_remove();
        done = gen;
        pthread_mutex_lock(&g_req_mu);
    }
    g_worker_running = 0;
    pthread_mutex_unlock(&g_req_mu);
    return NULL;
}

void webui_tile_request(int tile, uint16_t port) {
    pthread_attr_t attr;
    pthread_t t;
    int rc = -1;
    pthread_mutex_lock(&g_req_mu);
    g_req_gen++;
    if (g_req_gen == 0) g_req_gen = 1; /* 0 is the worker's "nothing applied yet" */
    g_req_tile = tile ? 1 : 0;
    g_req_port = port;
    if (g_worker_running) {
        pthread_mutex_unlock(&g_req_mu); /* the running worker picks this request up */
        return;
    }
    if (pthread_attr_init(&attr) == 0) {
        if (pthread_attr_setstacksize(&attr, TILE_STACK) == 0 &&
            pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED) == 0)
            rc = pthread_create(&t, &attr, tile_worker, NULL);
        pthread_attr_destroy(&attr);
    }
    if (rc == 0) g_worker_running = 1;
    else fprintf(stderr, "webui tile: cannot start the tile thread (%d)\n", rc);
    pthread_mutex_unlock(&g_req_mu);
}

#endif /* WEBUI_TILE_HOST_TEST */
