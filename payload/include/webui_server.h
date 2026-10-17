/* Bounded HTTP server for the console web UI, running inside the helper.
 *
 * One accept thread and WEBUI_WORKERS workers. Accepted sockets go through a
 * bounded queue (depth 32; a connection that does not fit is closed at once).
 * Every connection carries a deadline of accept time + 5 s: reads and writes
 * stop there, and a worker that dequeues an already-expired connection closes
 * it without reading. A slow, silent or hostile client therefore holds one
 * worker for at most 5 s and can never stall the accept thread. */
#ifndef PS5UPLOAD_WEBUI_SERVER_H
#define PS5UPLOAD_WEBUI_SERVER_H

#include <stddef.h>
#include <stdint.h>
#include "webui_http.h"

/* Writes a complete response to fd (use webui_send / webui_send_json).
 * Runs on a worker after the Host/Origin/token checks passed. Unknown paths
 * answer 404 and wrong methods 405. The return value is ignored. */
typedef int (*webui_route_fn)(const webui_req_t *r, const uint8_t *body, size_t body_len, int fd);

typedef struct {
    uint16_t port;
    int lan;              /* 0: bind 127.0.0.1; 1: bind 0.0.0.0 */
    webui_route_fn route;
} webui_cfg_t;

/* New token, bind, start the threads. Returns 0, or -1 when already running or
 * the threads cannot start. A bind failure is NOT an error: it is logged and
 * retried every 5 s by the accept thread (a helper takeover means the old
 * instance may still hold the port for a moment). */
int webui_start(const webui_cfg_t *cfg);

/* Close the listener and the queued connections, wake the workers and join
 * them within 2 s. A worker still inside route() after that is detached and
 * finishes on its own; it keeps the server state it needs alive. */
void webui_stop(void);

/* Rebind the listener for a LAN setting change. Safe to call from a route
 * handler (it never waits on the workers). The token is kept. Returns 0 when
 * the new listener is bound, -1 when it is not (yet): the accept thread keeps
 * retrying every 5 s. */
int webui_restart(int lan);

/* The token for this start ("" when the server is not running). */
const char *webui_token(void);
/* The token copied under the server's lock (webui_token() reads it unsynchronized): use this one
 * from any thread that may race a start, stop or restart. */
void webui_token_copy(char out[65]);

/* Write a complete response (head + body) within the connection deadline. */
void webui_send(int fd, int status, const char *ctype, const void *body, size_t len);
void webui_send_json(int fd, int status, const char *json);
/* webui_send with extra header lines (each a complete "Name: value\r\n"), e.g. a CSP. */
void webui_send_ex(int fd, int status, const char *ctype, const void *body, size_t len, const char *extra_headers);

#endif
