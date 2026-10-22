/* The console page's package preview and install, and its payload loading (webui_pkg.c).
 *
 * Preview: POST /api/pkg/info {"path"} reads the package's header on the console (pkg_info.c) and
 * answers its title, ids, version, kind, platform, size and required firmware; POST /api/pkg/icon
 * {"path"} answers its icon0.png.
 *
 * Install: POST /api/pkg/install {"path"[,"replace":true]} runs AVA1_JOB_OP_PKG_INSTALL, one at a
 * time, the way the PC app installs a package already on the console (engine install/mod.rs,
 * client pkgLibrary _execConsolePath / _execExternal):
 *   - a package on a USB drive or extended storage (/mnt/usbN, /mnt/extN) is first copied to
 *     WEBUI_PKG_STAGE_DIR as <ContentID>.pkg (Sony's installer treats a /mnt/usb path as a slow
 *     download task), and the copy is removed once Sony has read all of it;
 *   - the PS5Upload installer daemon (127.0.0.1:9115, embedded in the helper: webui_installer.h) is
 *     brought up through the ELF loader on 127.0.0.1:9021 when it is not answering, or is older;
 *   - the daemon serves the package to Sony's installer over loopback; the job follows its bytes,
 *     then (a game) waits for the title's app.pkg to appear. A full game that is already installed
 *     is refused unless "replace" (Sony removes the installed copy first, and a failure leaves
 *     neither); a title running from a disk image is refused.
 * Progress: bytes (the staging copy, then the bytes Sony read); the message is the phase
 * ("pkg_install_staging", "_starting", "_installing", "_finishing") or, on a failure, the cause.
 * Result: {"title_id","content_id","kind","verdict":"installed"|"delivered"}.
 *
 * Payloads: POST /api/payload/load {"path"} sends a .elf/.bin (an ELF, at most WEBUI_PAYLOAD_MAX)
 * to the loader on 127.0.0.1:9021, never while an install runs, never a ps5upload helper (that
 * would replace the helper serving this page), and serialized with the install's daemon send. */
#ifndef PS5UPLOAD_WEBUI_PKG_H
#define PS5UPLOAD_WEBUI_PKG_H

#include <stddef.h>
#include <stdint.h>

#define WEBUI_PKG_STAGE_DIR "/user/data/ps5upload/pkg_temp"
#define WEBUI_LOADER_PORT 9021
#define WEBUI_INSTALLER_PORT 9115
#define WEBUI_PAYLOAD_MAX (64u * 1024u * 1024u)
/* Free space the staging copy leaves on internal storage. */
#define WEBUI_PKG_STAGE_MARGIN (1024ull * 1024ull * 1024ull)

/* /api/pkg/info's JSON into out. 200, or an HTTP status with *cause set (a token). */
int webui_pkg_info_json(const char *path, char *out, size_t cap, const char **cause);

/* The package's icon0.png, malloc'd into *png. 200, or an HTTP status with *cause set. */
int webui_pkg_icon(const char *path, uint8_t **png, size_t *len, const char **cause);

/* Whether an install of `path` may start now (the checks the job repeats): 200, or 400/403/404/409
 * with *cause ("pkg_install_busy", "pkg_install_already_installed", "pkg_install_image_mounted",
 * "pkg_not_pkg", ...). */
int webui_pkg_install_check(const char *path, int replace, const char **cause);

/* Registers AVA1_JOB_OP_PKG_INSTALL with ava1_op.c. */
void webui_pkg_register_ops(void);

/* 1 while a package install runs. */
int webui_pkg_installing(void);

/* Sends the payload at `path` to the loader. 200 with *sent, or an HTTP status with *cause
 * ("payload_not_elf", "payload_too_large", "payload_is_helper", "pkg_install_busy",
 * "loader_unreachable", "loader_send_failed", ...). */
int webui_payload_load(const char *path, uint64_t *sent, const char **cause);

#endif
