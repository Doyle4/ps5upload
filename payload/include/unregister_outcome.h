#ifndef PS5UPLOAD_UNREGISTER_OUTCOME_H
#define PS5UPLOAD_UNREGISTER_OUTCOME_H

/* What an uninstall request actually achieved, and how the helper reports it (#476).
 *
 * sceAppInstUtilAppUnInstall's return code alone cannot confirm a removal: on FW 13.60 it
 * returns 0 for a title id that was never installed (measured on the Phat, 2026-10-18), and a
 * refusal used to be reported as success anyway, with an "Unregistered" toast on the console
 * while the game stayed. So after the call the helper looks at what the PC app lists as
 * installed (the /user/appmeta folder, an app.pkg on internal or extended storage) and only
 * calls it done when those are gone.
 *
 * Header-only and libc-only so the host self-test can include it. */

#include <inttypes.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

typedef struct {
    int ours;          /* our nullfs registration (a mount.lnk tracker) was torn down */
    int api_called;    /* sceAppInstUtilAppUnInstall ran */
    uint32_t sony_rc;  /* its first return code (0 when it did not run) */
    int still_present; /* the title's folders were still there after the wait */
} unregister_outcome_t;

typedef enum {
    UNREGISTER_DONE = 0,          /* gone */
    UNREGISTER_STILL_PRESENT = 1, /* Sony accepted, the files are still there (may be removing) */
    UNREGISTER_REFUSED = 2,       /* Sony returned an error */
    UNREGISTER_UNAVAILABLE = 3,   /* no uninstall API, and the title is still there */
} unregister_verdict_t;

static inline unregister_verdict_t unregister_verdict(const unregister_outcome_t *o) {
    if (o->api_called && o->sony_rc != 0) return UNREGISTER_REFUSED;
    if (!o->still_present) return UNREGISTER_DONE;
    return o->api_called ? UNREGISTER_STILL_PRESENT : UNREGISTER_UNAVAILABLE;
}

/* The places that make the PC app list a title as installed, for `title_id`. Writes up to
 * `max` paths of `cap` bytes each and returns how many it wrote. A path that does not fit is
 * skipped rather than truncated. */
static inline int unregister_presence_paths(const char *title_id, char paths[][160], int max) {
    static const char *const fmt[] = {
        "/user/appmeta/%s",
        "/user/app/%s/app.pkg",
        "/mnt/ext0/user/app/%s/app.pkg",
        "/mnt/ext1/user/app/%s/app.pkg",
    };
    int n = 0;
    for (size_t i = 0; i < sizeof fmt / sizeof fmt[0] && n < max; i++) {
        int w = snprintf(paths[n], 160, fmt[i], title_id);
        if (w > 0 && w < 160) n++;
    }
    return n;
}

/* The reply for `o`: 1 = ACK body, 0 = ERROR reason, -1 = did not fit. `*written` is its
 * length. An ACK keeps `sony_uninstall_rc` for older engines, which read only that field. */
static inline int unregister_reply(const unregister_outcome_t *o, char *body, size_t cap,
                                   size_t *written) {
    int n;
    int ack = 1;
    *written = 0;
    switch (unregister_verdict(o)) {
    case UNREGISTER_DONE:
        n = snprintf(body, cap, "{\"sony_uninstall_rc\":0,\"still_present\":false}");
        break;
    case UNREGISTER_STILL_PRESENT:
        n = snprintf(body, cap, "{\"sony_uninstall_rc\":0,\"still_present\":true}");
        break;
    case UNREGISTER_REFUSED:
        n = snprintf(body, cap, "uninstall_refused:0x%08" PRIX32, o->sony_rc);
        ack = 0;
        break;
    default:
        n = snprintf(body, cap, "uninstall_unavailable");
        ack = 0;
        break;
    }
    if (n < 0 || (size_t)n >= cap) return -1;
    *written = (size_t)n;
    return ack;
}

/* The console toast for `o`. A pkg install is "uninstalled"; our folder registration is
 * "unregistered" (its source files stay). */
static inline void unregister_toast(const unregister_outcome_t *o, const char *title_id,
                                    char *out, size_t cap) {
    switch (unregister_verdict(o)) {
    case UNREGISTER_DONE:
        snprintf(out, cap, "%s %s", o->ours ? "Unregistered" : "Uninstalled", title_id);
        break;
    case UNREGISTER_STILL_PRESENT:
        snprintf(out, cap, "Removing %s: still on the console", title_id);
        break;
    case UNREGISTER_REFUSED:
        snprintf(out, cap, "PS5 refused to uninstall %s (0x%08" PRIX32 ")", title_id, o->sony_rc);
        break;
    default:
        snprintf(out, cap, "Could not uninstall %s", title_id);
        break;
    }
}

#endif
