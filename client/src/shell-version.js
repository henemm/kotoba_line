/**
 * Which shell this *code* belongs to.
 *
 * Not the same as the newest cache on the device, and the difference is the
 * whole point. The service worker calls `skipWaiting()` and `clients.claim()`,
 * so a new version takes control the moment it installs and deletes the old
 * cache — while the page that is open goes on running the modules it loaded at
 * startup. So the device can hold cache `kotoba-shell-v16` and be executing
 * v15, which is exactly what happened on 2026-09-11: Settings reported "App
 * v16" and the diagnostics were missing a field that only v16 has.
 *
 * Reading the cache name answered "what is downloaded". This answers "what is
 * running", which is the question actually being asked whenever a fix appears
 * not to have arrived. Both are shown, because the two disagreeing *is* the
 * message: quit the app and reopen it.
 *
 * Kept in step with `sw.js` by a test, not by discipline — see
 * `client/test/shell-files.test.js`.
 */
export const SHELL_VERSION = "v32";
