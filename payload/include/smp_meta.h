/*
 * Home-screen metadata repair.
 *
 * A game whose folder is placed at /user/app/<TITLE_ID>/ by an external mounter can run
 * fine yet show a blank home-screen tile, because the console's per-title metadata folder
 * /user/appmeta/<TITLE_ID>/ is missing its tile image (or other art, or param.json).
 *
 * When started, a background worker periodically walks /user/app and, for each title,
 * copies whichever of icon0.png, pic0.png, pic1.png, icon1.png, snd0.at9 and param.json is
 * missing into /user/appmeta/<TITLE_ID>/, taking each from the title's sce_sys/ folder (the
 * art may also come from the title folder itself). Existing non-empty files are never
 * replaced, links are never followed, nothing is chmod'ed, and /user/app is only read.
 * Each copy goes through a temporary file renamed into place in the same folder.
 *
 * Off until smp_meta_init() is called (the desktop app does so when the user opts in).
 */
#ifndef PS5UPLOAD2_SMP_META_H
#define PS5UPLOAD2_SMP_META_H

#include <stdint.h>

/* A snapshot of the worker's state, as returned by smp_meta_get_stats(). runtime.c turns
 * it into the JSON stats reply, one field per member. */
typedef struct {
    int      running;            /* 1 while the worker thread exists */
    int      poll_seconds;       /* seconds between sweeps (5..600) */
    uint64_t last_run_unix;      /* time() when the latest sweep finished; 0 = none yet */
    int      games_scanned;      /* title folders looked at by the latest sweep */
    int      icons_healed;       /* icon0.png files copied since start */
    int      pics_healed;        /* other art files (pic0/pic1/icon1/snd0) copied since start */
    int      json_healed;        /* param.json files copied since start */
    int      still_missing;      /* titles the latest sweep left without icon0.png */
    char     last_missing[64];   /* most recent title left without icon0.png ("" = none) */
} smp_meta_stats_t;

/* Start the worker. Safe to call repeatedly: only the first successful call creates the
 * (detached) thread, named "ps5upload-smp". 0 = running; -1 = the thread could not be
 * created, and a later call tries again. */
int smp_meta_init(void);

/* Fill `out` (zeroed first) with a consistent copy of the stats. Callable from any thread. */
void smp_meta_get_stats(smp_meta_stats_t *out);

/* Ask for a sweep now rather than at the next interval. Only sets a flag the worker looks
 * at every second, so it returns 0 at once; a request made during a sweep yields one more
 * sweep afterwards. */
int smp_meta_run_now(void);

/* Set the seconds between sweeps, clamped to 5..600; returns the value stored. */
int smp_meta_set_poll_seconds(int seconds);

/* The seconds between sweeps (30 until changed). */
int smp_meta_get_poll_seconds(void);

#ifdef SMP_META_HOST_TEST
/* Host-test hooks (ps5upload-ctest only; never in the payload build): point the worker's
 * /user/app and /user/appmeta at other folders, run one sweep on the calling thread, and
 * zero the counters. */
void smp_meta_set_roots_for_test(const char *app_dir, const char *appmeta_dir);
void smp_meta_sweep_for_test(void);
void smp_meta_reset_stats_for_test(void);
#endif

#endif /* PS5UPLOAD2_SMP_META_H */
