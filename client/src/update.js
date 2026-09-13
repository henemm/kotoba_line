/**
 * Updates that announce themselves (#93).
 *
 * The worker no longer takes over on install (`sw.js`); it downloads the new
 * shell completely and waits. This module notices that, asks the waiting
 * worker which version it is, and hands the app what it needs to ask her —
 * and, once she says yes, makes the swap and reloads into it.
 *
 * Two things had to change for "quit and reopen" to stop being the procedure,
 * and this is the first of them: an installed app brought back from the
 * background is resumed, not navigated, so iOS never looks for a new worker on
 * its own. So this looks: on every return to the foreground and every half
 * hour while open. Each check is a revalidation of `sw.js` — a conditional
 * request answered 304 when nothing changed — and only a changed worker
 * downloads anything.
 */
import { SHELL_VERSION } from "./shell-version.js";
import { versionNumber } from "./whats-new.js";

const WHILE_OPEN_MS = 30 * 60 * 1000;
/** Switching apps twice in a minute is not two reasons to ask. */
const AT_MOST_EVERY_MS = 60 * 1000;
/** How long a silent worker gets before the question is dropped. */
const REPLY_MS = 3000;
/** How long Update waits for the swap before reloading regardless. */
const TAKEOVER_MS = 4000;

const SEEN_KEY = "kotoba.shell.seen";
const changelogUrl = new URL("../changelog.json", import.meta.url).href;

/**
 * Register the worker and call `onReady({ worker, version })` whenever a
 * newer shell is installed and waiting.
 *
 * §7: the worker has to come from /kotoba/sw.js so its scope is /kotoba/. A
 * worker at the domain root cannot reliably control a subpath app, and the
 * failure is silent — so the path here is relative to the app, deliberately.
 */
export function watchForUpdates(onReady) {
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker
    .register(new URL("../sw.js", import.meta.url))
    .then((registration) => {
      const announce = async (worker) => {
        // No controller means this is the app's very first install, not an
        // update to anything.
        if (!navigator.serviceWorker.controller || registration.waiting !== worker) return;
        const version = await askVersion(worker);
        if (versionNumber(version) > versionNumber(SHELL_VERSION)) onReady({ worker, version });
      };

      if (registration.waiting) announce(registration.waiting);
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed") announce(worker);
        });
      });

      let lastCheck = Date.now();
      const check = () => {
        if (document.visibilityState !== "visible") return;
        if (Date.now() - lastCheck < AT_MOST_EVERY_MS) return;
        lastCheck = Date.now();
        // Offline is the normal reason this fails, and not worth a word.
        registration.update().catch(() => {});
      };
      document.addEventListener("visibilitychange", check);
      // A page restored from the back/forward cache fires this and not always
      // the one above; covering both costs a throttled no-op.
      window.addEventListener("pageshow", check);
      setInterval(check, WHILE_OPEN_MS);
    })
    .catch((err) => {
      // No offline support, but the app works. Worth a line in the console
      // rather than a message she cannot act on.
      console.warn("service worker did not register", err);
    });
}

/** The waiting worker's own VERSION, or undefined if it does not say. */
function askVersion(worker) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(undefined), REPLY_MS);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data);
    };
    worker.postMessage({ type: "version" }, [channel.port2]);
  });
}

/**
 * Let the waiting worker take over, then reload into the shell it serves.
 *
 * `controllerchange` is the signal; the timer is for the device on which it
 * never fires, which is the known way this pattern leaves a tap doing nothing.
 * A reload without the swap just comes back to the old shell and the prompt —
 * a second tap, not a stuck screen.
 */
export function applyUpdate(worker, version) {
  let reloading = false;
  const reload = () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  };
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // She has just read these notes; the new shell must not show them again.
    markSeen(version);
    reload();
  });
  setTimeout(reload, TAKEOVER_MS);
  worker.postMessage({ type: "skip-waiting" });
}

/**
 * A version's changelog, read from that version's own cache.
 *
 * Not `fetch()`: while a new worker waits, the old one still answers every
 * request, cache-first and ignoring the query string, so fetching the
 * changelog returns the *old* notes however it is asked for. The waiting
 * worker's cache is the only place the new ones are.
 */
export async function readChangelog(version) {
  try {
    if (typeof caches !== "undefined") {
      const cache = await caches.open(`kotoba-shell-${version}`);
      const hit = await cache.match(changelogUrl);
      if (hit) return await hit.json();
    }
    // Only the running version can come from the network, and only then is
    // the network the same thing — a page with no worker, in development.
    if (version === SHELL_VERSION) return await (await fetch(changelogUrl)).json();
  } catch {
    /* no notes is a prompt without "More info", not a broken prompt */
  }
  return [];
}

/**
 * The last shell whose notes this device has been shown.
 *
 * In localStorage rather than the IndexedDB meta store on purpose: signing out
 * clears meta, and an app that has not changed does not have news for the
 * next person to sign in. It is a convenience — losing it costs one repeated
 * "Updated" sheet at most.
 */
export function lastSeen() {
  try {
    return localStorage.getItem(SEEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function markSeen(version) {
  try {
    localStorage.setItem(SEEN_KEY, version);
  } catch {
    /* see lastSeen */
  }
}
