/* The "ps5upload" home-screen tile: a small registered app whose param.json deeplinkUri makes
 * the PS5 open its browser on the console web UI.
 *
 * The folder is /data/ps5upload/tile/PSUP00001/ (WEBUI_TILE_DIR):
 *   sce_sys/param.json   webui_tile_param_json()
 *   sce_sys/icon0.png    the embedded 512x512 icon (build/webui_tile_icon.c, made by xxd from
 *                        payload/assets/webui_tile_icon0.png)
 *   eboot.bin            a few placeholder bytes: register_title_from_path refuses a folder
 *                        without one (register_src_missing_eboot). The tile never runs it; the
 *                        deeplinkUri opens the browser.
 *
 * Registration calls Sony and can take seconds: webui_tile_request() runs it on a short-lived
 * detached thread, never on a web worker or the accept thread. */
#ifndef PS5UPLOAD_WEBUI_TILE_H
#define PS5UPLOAD_WEBUI_TILE_H

#include <stddef.h>
#include <stdint.h>

#define WEBUI_TILE_PARENT "/data/ps5upload/tile"
#define WEBUI_TILE_DIR WEBUI_TILE_PARENT "/PSUP00001"
/* Written after the helper registered the tile, deleted when the helper removes it: while it is
 * there, a tile app.db no longer has was removed outside the helper (#480). Outside the tile
 * folder, which the nullfs exposes and Sony's own Delete may empty. */
#define WEBUI_TILE_MARKER WEBUI_TILE_PARENT "/registered"

/* The embedded icon (generated at build time). */
extern unsigned char webui_tile_icon0_png[];
extern unsigned int webui_tile_icon0_png_len;

/* {"applicationCategoryType":66048,"titleId":"PSUP00001","deeplinkUri":"http://127.0.0.1:<port>/",
 *  "localizedParameters":{"defaultLanguage":"en-US","en-US":{"titleName":"ps5upload"}}}
 * like snprintf: writes at most cap - 1 bytes + NUL, returns the full length. */
size_t webui_tile_param_json(char *out, size_t cap, uint16_t port);

/* Brings `dir` (created, parents too) to the three files above, writing a file only when its
 * bytes differ; each write is a temp file in the same directory renamed over the old one.
 * Returns how many files were (re)written, or -1. */
int webui_tile_write_files(const char *dir, uint16_t port);

/* Deletes `dir` and everything in it (same-directory unlink/rmdir only). Already gone is 0. */
int webui_tile_remove_files(const char *dir);

/* What ensure does, from what it observed (pure; host-tested):
 *   files_changed  webui_tile_write_files rewrote a file (register copies sce_sys: must re-copy)
 *   mount_live     the nullfs at /system_ex/app/PSUP00001 is mounted
 *   lnk_ours       /user/app/PSUP00001/mount.lnk names WEBUI_TILE_DIR
 *   appmeta        /user/appmeta/PSUP00001 exists
 * NONE: registered this boot, nothing to do. REBIND: registered before, but the bind did not
 * survive a reboot: re-mount only, no Sony call (a full register on FW 13.x runs AppInstallAll,
 * and install records could pile up one per boot). REGISTER: the full register_title_from_path. */
typedef enum { WEBUI_TILE_NONE = 0, WEBUI_TILE_REBIND = 1, WEBUI_TILE_REGISTER = 2 } webui_tile_action_t;
webui_tile_action_t webui_tile_plan(int files_changed, int mount_live, int lnk_ours, int appmeta);

/* At helper start, with the tile setting on: 1 when the tile was registered by this helper
 * (`marker`), app.db can be read and has no row for it (`appdb_row` 1 / 0 / -1 unreadable), and it
 * is not this boot's live registration (`mount_live` && `lnk_ours`, when app.db may still lag
 * behind a register). That is a tile the user deleted on the PS5 itself (or a database rebuild
 * dropped): starting the helper must not bring it back (#480). Pure; host-tested. */
int webui_tile_removed_outside(int marker, int appdb_row, int mount_live, int lnk_ours);

/* Whether a removal took the tile off the home screen, from what app.db says afterwards
 * (`appdb_row` 1 / 0 / -1 unreadable), whether Sony's uninstall confirmed it
 * (unregister_tile_confirmed) and whether the leftover icon could be hidden (`hidden`):
 *   GONE    no row (or app.db unreadable and Sony confirmed): delete the tile's files.
 *   HIDDEN  a row Sony would not remove, now hidden (visible = 0): delete the files too; the
 *           hidden row is all that is left and draws nothing.
 *   KEEP    the icon is still there: keep the files, so it stays a working tile instead of a
 *           greyed-out one whose files are gone (#480). Pure; host-tested. */
typedef enum { WEBUI_TILE_GONE = 0, WEBUI_TILE_HIDDEN = 1, WEBUI_TILE_KEEP = 2 } webui_tile_removal_t;
webui_tile_removal_t webui_tile_removal_verdict(int appdb_row, int sony_confirmed, int hidden);

#ifndef WEBUI_TILE_HOST_TEST
/* At helper start with the tile setting on: when webui_tile_removed_outside, deletes the tile's
 * files and marker (no Sony call) and returns 1: the caller saves tile:false instead of
 * registering it again. Else 0. */
int webui_tile_respect_outside_removal(void);

/* Writes the folder if missing/different, then registers PSUP00001 when it is not registered
 * this boot (or when a file changed: register copies sce_sys, so the copies must be refreshed).
 * After a reboot, when the title is still ours (webui_tile_plan REBIND), only the nullfs is
 * re-mounted; a failed re-mount falls back to the full register. Logs which path ran.
 * Synchronous (Sony calls): call it from webui_tile_request's thread. 0, or -1 (logged). */
int webui_tile_ensure(uint16_t port);

/* unregister_title(PSUP00001), then checks app.db, which is what the home screen draws: while a row
 * is left it asks Sony once more; a leftover whose staged files were already gone (the greyed-out
 * tile of #480) is restaged and registered so Sony's uninstall has its app to remove; a row Sony
 * still keeps is hidden (tbl_iconinfo visible = 0, like hiding an icon from the PC). Then, unless
 * the icon is still showing (webui_tile_removal_verdict KEEP), deletes the folder, the marker and
 * the staged /user/app/PSUP00001 (left there, FW 13.x AppInstallAll would re-install the removed
 * tile on the next folder-game register). Synchronous. 0, or -1 (logged). */
int webui_tile_remove(void);

/* Asks for the tile to be present (tile = 1) or gone (0). Returns at once: one detached worker
 * applies the LATEST request and repeats while new ones arrive, so ensure and remove never run
 * at the same time and a fast on/off/on ends in the last state asked for. Failures are logged. */
int webui_tile_remove_wait(uint16_t port);
void webui_tile_request(int tile, uint16_t port);

/* What the page shows after a tile switch: *busy 1 while the worker still applies a request,
 * *failed 1 when the last ensure/remove it applied failed (the tile is not in the state asked for). */
void webui_tile_state(int *busy, int *failed);
#endif

#endif
