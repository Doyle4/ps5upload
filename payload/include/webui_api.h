/* The console web UI's JSON API (Home, Files): the webui_route_fn main.c hands to webui_start.
 *
 * Every route is POST with a JSON body and adapts it to a method the helper already serves
 * (management through mgmt_rpc_dispatch, the data layer through ava1_data_rpc, both reached the
 * way the AVA1 server reaches them), under one fixed identity: the console page owns the jobs it
 * starts as "ps5upload-console-webui". The route table in webui_api.c is the allowlist: any other
 * path answers 404, a known path with another method 405.
 *
 * Two GET routes sit outside the table: GET / serves the embedded page (webui_page.h) and
 * GET /api/token answers {"token":"<hex>"}, both after the server's Host/Origin check only. */
#ifndef PS5UPLOAD_WEBUI_API_H
#define PS5UPLOAD_WEBUI_API_H

#include <stddef.h>
#include <stdint.h>

#include "webui_http.h"
#include "webui_settings.h"

/* The settings the helper started with (main.c loads WEBUI_SETTINGS_PATH before webui_start):
 * /api/settings answers them and /api/settings/set changes them. Call once, before webui_start. */
void webui_api_settings_init(const webui_settings_t *s);

int webui_api_route(const webui_req_t *r, const uint8_t *body, size_t body_len, int fd);

#endif
