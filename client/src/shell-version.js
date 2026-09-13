/**
 * Which shell this *code* belongs to.
 *
 * Not the same as the newest cache on the device, and the difference is the
 * whole point. The service worker used to call `skipWaiting()` and
 * `clients.claim()`, so a new version took control the moment it installed and
 * deleted the old cache — while the page that was open went on running the
 * modules it loaded at startup. So the device could hold cache
 * `kotoba-shell-v16` and be executing v15, which is exactly what happened on
 * 2026-09-11: Settings reported "App v16" and the diagnostics were missing a
 * field that only v16 has.
 *
 * Reading the cache name answered "what is downloaded". This answers "what is
 * running", which is the question actually being asked whenever a fix appears
 * not to have arrived. Since #93 a new version waits to be asked for, and this
 * is also the number the update prompt counts from.
 *
 * Kept in step with `sw.js` by a test, not by discipline — see
 * `client/test/shell-files.test.js`.
 */
export const SHELL_VERSION = "v36";
