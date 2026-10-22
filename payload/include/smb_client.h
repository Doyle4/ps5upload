/* The helper's side of the SMB daemon (include/smbd_proto.h): starts it when it is not running (the
 * embedded ps5upload-smb.elf, sent to the console's ELF loader on 127.0.0.1:9021), replaces a
 * daemon from another build, and carries one request to it. */
#ifndef PS5UPLOAD_SMB_CLIENT_H
#define PS5UPLOAD_SMB_CLIENT_H

#include <stddef.h>

/* The embedded daemon (build/smbd_elf.c, made by the payload Makefile from payload/smb). */
extern unsigned char smbd_elf[];
extern unsigned int smbd_elf_len;

/* Send `fields` (the request object's members without braces, e.g. "\"op\":\"ping\"") and read the
 * answer, starting the daemon first when `may_start` is set and it is not running. 0 with *reply
 * (heap, NUL-terminated JSON without the newline; free it) set, or -1 with `err` naming why the
 * daemon could not be asked:
 *   smb_daemon_not_running  may_start was 0 and nothing listens
 *   smb_loader_unavailable  nothing answered on :9021 to start the daemon
 *   smb_daemon_unavailable  started, but it never answered (or the port belongs to something else)
 *   smb_daemon_timeout      it took longer than `timeout_ms` to answer
 *   out_of_memory
 * The request buffer is wiped before it is freed (it may carry a password). */
int smbc_request(const char *fields, size_t len, int timeout_ms, int may_start, char **reply, char *err, size_t err_cap);

/* FNV-1a 64 of the embedded ELF, as 16 hex digits (the daemon reports it back in "ping"). */
const char *smbc_elf_id(void);

#endif
