/* Host self-test for unregister_outcome.h (#476): what an uninstall reports. */
#include <assert.h>
#include <stdio.h>
#include <string.h>

#include "unregister_outcome.h"

static int reply(const unregister_outcome_t *o, char *body, size_t cap) {
    size_t w = 99;
    int r = unregister_reply(o, body, cap, &w);
    if (r >= 0) assert(w == strlen(body));
    else assert(w == 0);
    return r;
}

int main(void) {
    char body[96];
    char toast[160];

    /* A package uninstall Sony accepted and that left nothing behind. */
    unregister_outcome_t done = {.ours = 0, .api_called = 1, .sony_rc = 0, .still_present = 0};
    assert(unregister_verdict(&done) == UNREGISTER_DONE);
    assert(reply(&done, body, sizeof body) == 1);
    assert(strcmp(body, "{\"sony_uninstall_rc\":0,\"still_present\":false}") == 0);
    unregister_toast(&done, "CUSA33878", toast, sizeof toast);
    assert(strcmp(toast, "Uninstalled CUSA33878") == 0);

    /* Our folder registration keeps saying "Unregistered": its source files stay. */
    unregister_outcome_t ours = done;
    ours.ours = 1;
    unregister_toast(&ours, "PPSA01234", toast, sizeof toast);
    assert(strcmp(toast, "Unregistered PPSA01234") == 0);

    /* The reported case: Sony refused. Never an ACK, never "Unregistered". */
    unregister_outcome_t refused = {.ours = 0, .api_called = 1, .sony_rc = 0x80B21B02u,
                                    .still_present = 0};
    assert(unregister_verdict(&refused) == UNREGISTER_REFUSED);
    assert(reply(&refused, body, sizeof body) == 0);
    assert(strcmp(body, "uninstall_refused:0x80B21B02") == 0);
    unregister_toast(&refused, "CUSA33878", toast, sizeof toast);
    assert(strstr(toast, "Unregistered") == NULL && strstr(toast, "0x80B21B02") != NULL);

    /* Sony said 0 but the game is still there: an ACK that says so, no success toast. */
    unregister_outcome_t left = {.ours = 0, .api_called = 1, .sony_rc = 0, .still_present = 1};
    assert(unregister_verdict(&left) == UNREGISTER_STILL_PRESENT);
    assert(reply(&left, body, sizeof body) == 1);
    assert(strcmp(body, "{\"sony_uninstall_rc\":0,\"still_present\":true}") == 0);
    unregister_toast(&left, "CUSA33878", toast, sizeof toast);
    assert(strstr(toast, "Unregistered") == NULL && strstr(toast, "Uninstalled") == NULL);

    /* No uninstall API: fine when our teardown was all there was, an error otherwise. */
    unregister_outcome_t no_api_gone = {.ours = 1, .api_called = 0, .sony_rc = 0, .still_present = 0};
    assert(unregister_verdict(&no_api_gone) == UNREGISTER_DONE);
    unregister_outcome_t no_api_left = {.ours = 0, .api_called = 0, .sony_rc = 0, .still_present = 1};
    assert(unregister_verdict(&no_api_left) == UNREGISTER_UNAVAILABLE);
    assert(reply(&no_api_left, body, sizeof body) == 0);
    assert(strcmp(body, "uninstall_unavailable") == 0);

    /* A reply that does not fit is refused, not truncated. */
    assert(reply(&done, body, 8) == -1);

    /* The presence paths are the ones the PC app lists a title from. */
    char paths[4][160];
    int n = unregister_presence_paths("CUSA33878", paths, 4);
    assert(n == 4);
    assert(strcmp(paths[0], "/user/appmeta/CUSA33878") == 0);
    assert(strcmp(paths[1], "/user/app/CUSA33878/app.pkg") == 0);
    assert(strcmp(paths[2], "/mnt/ext0/user/app/CUSA33878/app.pkg") == 0);
    assert(strcmp(paths[3], "/mnt/ext1/user/app/CUSA33878/app.pkg") == 0);
    assert(unregister_presence_paths("CUSA33878", paths, 2) == 2);

    puts("unregister outcome self-test passed");
    return 0;
}
