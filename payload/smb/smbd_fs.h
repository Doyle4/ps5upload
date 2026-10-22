/* The two sides of a copy: a share through libsmb2 (smbd_smbfs.c) and the console's own disks
 * (smbd_localfs.c). */
#ifndef PS5UPLOAD_SMBD_FS_H
#define PS5UPLOAD_SMBD_FS_H

#include <stdint.h>

#include "smbd_copy.h"
#include "smbd_path.h"

typedef struct {
    char host[SMBP_HOST_MAX];
    uint16_t port;
    char share[SMBP_SHARE_MAX]; /* "IPC$" only for a share listing */
    char user[256];             /* "" = guest */
    char password[256];
    char domain[256];
    int timeout_s;              /* per request; 0 = 10 */
} smbconn_t;

/* Wipes the password. */
void smbconn_clear(smbconn_t *c);

/* ---- SMB ---- */

/* Connect (negotiating SMB 2.0.2 to 3.1.1, signing enabled) and fill `fs`. A guest (no user) signs
 * in as Guest with an empty password, then anonymously. 0 or a negative xerr_t; `detail` gets
 * libsmb2's message (never a password). The connection keeps a copy of `c`. */
int smbfs_open(xfs_t *fs, const smbconn_t *c, char *detail, size_t detail_cap);
void smbfs_close(xfs_t *fs);
/* The negotiated dialect (0x0202 ... 0x0311), 0 when not connected. */
unsigned smbfs_dialect(xfs_t *fs);

typedef struct {
    char name[SMBP_SHARE_MAX];
    char remark[256];
} smb_share_info_t;

/* The disk shares `c` (its share is ignored; IPC$ is used) offers, hidden ones ("x$") left out.
 * Returns the count (at most `max`), or a negative xerr_t. */
int smbfs_list_shares(const smbconn_t *c, smb_share_info_t *out, int max, char *detail, size_t detail_cap);

/* ---- the console ---- */

/* The console's own filesystem. Writes: folders 0777, files 0777 (the helper's convention: the
 * app loader needs the bits). Never follows a link: a link is XK_OTHER. */
void localfs_init(xfs_t *fs);

#endif
