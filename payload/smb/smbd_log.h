/* The daemon's log (/data/ps5upload/smb/smbd.log, one older generation kept) and thread naming.
 * Nothing logged ever carries a password: requests are logged by op, host and share only. */
#ifndef PS5UPLOAD_SMBD_LOG_H
#define PS5UPLOAD_SMBD_LOG_H

void smbd_log(const char *fmt, ...) __attribute__((format(printf, 1, 2)));

/* Name the calling thread "ps5u-smbd". Deliberately not "ps5upload-…": the helper SIGKILLs every
 * process wearing its own prefix as a stale instance of itself (proc_identity.h). */
void smbd_name_thread(void);

#endif
