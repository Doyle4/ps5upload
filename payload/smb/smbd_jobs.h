/* The daemon's job table: copies (share -> console, console -> share), removals on a share and
 * library scans (smbd_library.h), each on its own thread, read and cancelled by id. */
#ifndef PS5UPLOAD_SMBD_JOBS_H
#define PS5UPLOAD_SMBD_JOBS_H

#include "smbd_fs.h"
#include "smbd_json.h"

#define SMBD_JOBS_MAX 16
#define SMBD_JOBS_RUNNING_MAX 4
#define SMBD_JOB_KEEP_S 600 /* a finished job is listed this long (or until its slot is needed) */

typedef enum { JOB_DOWN = 1, JOB_UP = 2, JOB_REMOVE = 3, JOB_SCAN_SMB = 4, JOB_SCAN_LOCAL = 5 } job_kind_t;

/* Start a job. `src` / `dst` are a share path and a console path (DOWN: share -> console; UP:
 * console -> share; REMOVE: `src` on the share, `dst` unused; SCAN_SMB: `src` the folder on the
 * share to walk, `dst` the library source id; SCAN_LOCAL: the console's drives, `c` unused,
 * `dst` the source id). A scan of a source that is being scanned is XE_BUSY. The password in `c` is copied and
 * wiped when the job ends. 0 with `id` (33 bytes) set, or a negative xerr_t (XE_BUSY: too many). */
int jobs_start(job_kind_t kind, const smbconn_t *c, const char *src, const char *dst, int overwrite, char id[33]);
/* Appends the job's status object to `b`; XE_NOT_FOUND when there is no such job. */
int jobs_status(const char *id, sj_buf_t *b);
/* {"jobs":[...]} of every listed job. */
void jobs_list(sj_buf_t *b);
int jobs_cancel(const char *id);
void jobs_cancel_all(void);
int jobs_running(void);

#endif
