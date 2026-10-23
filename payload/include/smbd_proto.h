/* The helper <-> SMB daemon contract (payload/smb/, ps5upload-smb.elf).
 *
 * The daemon is a separate process so libsmb2 (a large third-party network parser) never runs
 * inside the helper: a fault in it ends the daemon, not the helper. The helper launches it on
 * demand through the console's ELF loader (:9021) and talks to it over loopback:
 *
 *   one connection per request; the helper writes one JSON object and '\n', the daemon answers one
 *   JSON object and '\n', then closes. Every request carries "key": the hex secret from
 *   SMBD_KEY_PATH (0600, made by the helper), so no other process or web page can drive it.
 *
 * SMBD_KEY_PATH holds two lines: the key, and the id of the daemon build the helper embeds
 * (FNV-1a of its ELF). The daemon reads both when it starts and reports the id in "ping": a helper
 * that finds another id running asks it to quit and launches its own. */
#ifndef PS5UPLOAD_SMBD_PROTO_H
#define PS5UPLOAD_SMBD_PROTO_H

#define SMBD_PORT 9183
#ifndef SMBD_DIR /* a host build of the daemon (tests) points it elsewhere */
#define SMBD_DIR "/data/ps5upload/smb"
#endif
#define SMBD_KEY_PATH SMBD_DIR "/daemon.key"
/* The game library cache (#498, smb/smbd_library.h): the daemon writes <source>.json and icons/ here,
 * the console page reads them through /api/fs/read. */
#ifndef SMBD_LIB_DIR
#define SMBD_LIB_DIR "/data/ps5upload/library"
#endif
/* What a scan of the console's own drives walks, and the folder it never walks into. */
#define SMBD_LIB_CONSOLE_ROOTS "/data\n/mnt/usb0\n/mnt/usb1\n/mnt/usb2\n/mnt/usb3\n/mnt/ext0\n/mnt/ext1"
#define SMBD_LIB_CONSOLE_SKIP "/data/ps5upload"
#define SMBD_LOG_PATH SMBD_DIR "/smbd.log"
#define SMBD_KEY_HEX 64
#define SMBD_REQ_MAX (64u * 1024u)    /* one request line */
#define SMBD_REPLY_MAX (512u * 1024u) /* one reply line */
#define SMBD_LIST_MAX 256u            /* entries per list page */
/* The daemon exits after this long with no request and no running job (the helper relaunches it). */
#define SMBD_IDLE_EXIT_S (15 * 60)

#endif
