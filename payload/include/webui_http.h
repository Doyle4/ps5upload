/* Minimal HTTP/1.x request parser and response head writer for the console
 * web UI server. Plain C, no allocation, no locale-dependent calls. */
#ifndef PS5UPLOAD_WEBUI_HTTP_H
#define PS5UPLOAD_WEBUI_HTTP_H

#include <stddef.h>
#include <stdint.h>

#define WEBUI_HEADER_CAP   8192u    /* request line + headers, incl. blank line */
#define WEBUI_BODY_CAP     65536u   /* max Content-Length */
#define WEBUI_PATH_CAP     1024u    /* max path (and query) length */

typedef struct {
    char method[8];
    char path[1025];
    char query[1025];
    char host[128];
    char origin[256];
    char token[65];
    uint32_t content_length;
    size_t header_len;  /* bytes up to and including the blank line */
} webui_req_t;

enum {
    WEBUI_PARSE_OK = 0,
    WEBUI_PARSE_MORE = 1,
    WEBUI_PARSE_BAD = -1,
    WEBUI_PARSE_TOO_BIG = -2
};

/* Parse a request line + headers from the bytes received so far. Safe to call
 * repeatedly on a growing buffer: MORE means "headers not complete yet and
 * still within the cap". Body bytes after header_len are not consumed. */
int webui_http_parse(const char *buf, size_t len, webui_req_t *out);

/* Write "HTTP/1.1 <status>" + headers + blank line. extra_headers, if given,
 * is zero or more complete "Name: value\r\n" lines; when one of them is a
 * Cache-Control line it replaces the default "Cache-Control: no-store". Returns bytes written
 * (excluding NUL) or -1 if it does not fit. */
int webui_http_head(char *out, size_t cap, int status, const char *content_type,
                    size_t body_len, const char *extra_headers);

#endif
