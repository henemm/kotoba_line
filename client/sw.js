/**
 * The service worker (§7).
 *
 * Served from /kotoba/sw.js so its scope is /kotoba/ — a worker at the domain
 * root cannot reliably control a subpath app, and when it fails it fails
 * silently, which is the worst way for this to go wrong.
 *
 * Three strategies, and the reasoning behind each is in §7:
 *
 *   app shell   precache on install, cache-first, versioned cache name
 *   /api/*      network-only — the outbox handles offline, not the cache
 *   /media/*    cache on first use, capped, oldest evicted
 *
 * Bump VERSION whenever a shell file changes. There is no build step to do it
 * automatically (phase-0-plan §1.5), so it is a line in a diff like everything
 * else, and `ops/deploy.sh` is where it would be forgotten.
 */
const VERSION = "v2";
const SHELL = `kotoba-shell-${VERSION}`;
const MEDIA = "kotoba-media";

/** §7: about three hundred files. A week of study, not the whole deck. */
const MEDIA_MAX = 300;

const scope = new URL("./", self.location).pathname;

const SHELL_FILES = [
  "",
  "index.html",
  "manifest.webmanifest",
  "src/app.js",
  "src/api.js",
  "src/audio.js",
  "src/deck.js",
  "src/modes.js",
  "src/outbox.js",
  "src/queue.js",
  "src/store.js",
  "src/screens/practise.js",
  "src/screens/session.js",
  "src/screens/settings.js",
  "src/screens/signin.js",
  "src/screens/stats.js",
  "src/screens/summary.js",
  "src/ui/base.css",
  "src/ui/dom.js",
  "src/ui/screens.css",
  "src/ui/tokens.css",
  "assets/icons/icon-192.png",
  "assets/icons/apple-touch-icon-180.png",
].map((f) => scope + f);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // One at a time rather than cache.addAll: addAll rejects the whole
      // install if a single file 404s, and a service worker that refuses to
      // install leaves the app with no offline support and no message.
      await Promise.all(
        SHELL_FILES.map(async (url) => {
          try {
            const res = await fetch(url, { cache: "reload" });
            if (res.ok) await cache.put(url, res);
          } catch {
            /* a missing shell file is worth less than a working install */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("kotoba-shell-") && name !== SHELL) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // §7: network-only. A cached /api/stats would show her yesterday's streak
  // and look like the app was wrong rather than offline.
  if (url.pathname.startsWith(scope + "api/")) return;

  if (url.pathname.startsWith(scope + "media/")) {
    event.respondWith(media(request));
    return;
  }

  event.respondWith(shell(request));
});

/** Cache-first, and a navigation that misses falls back to the app shell. */
async function shell(request) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;

  try {
    const res = await fetch(request);
    if (res.ok && res.type === "basic") cache.put(request, res.clone());
    return res;
  } catch (err) {
    // A deep link opened offline: /kotoba/stats is the app, not a document.
    if (request.mode === "navigate") {
      const index = await cache.match(scope + "index.html");
      if (index) return index;
    }
    throw err;
  }
}

/**
 * Cache on first use, capped, oldest evicted.
 *
 * §7: audio is never bulk-fetched. A word's recording lands here the first
 * time it is played, so after a week the cache holds the words she is actually
 * studying and nothing else. Mobile data in Japan is metered (§1).
 */
async function media(request) {
  const cache = await caches.open(MEDIA);
  const hit = await cache.match(request);
  if (hit) return hit;

  const res = await fetch(request);
  if (res.ok) {
    await cache.put(request, res.clone());
    await evict(cache);
  }
  return res;
}

/**
 * Which entries to drop to get back to `max`.
 *
 * `cache.keys()` returns insertion order, so the oldest are at the front — an
 * approximation of LRU that costs nothing, and the right one here: a word she
 * keeps hearing is re-fetched and re-inserted at the back the one time it
 * falls out.
 *
 * An off-by-one here either keeps one file too many forever or deletes the
 * file that was just added, and neither shows up in ordinary use — so this is
 * exercised against a real cache of 310 entries rather than reasoned about.
 */
function overflow(keys, max) {
  return keys.length <= max ? [] : keys.slice(0, keys.length - max);
}

async function evict(cache) {
  for (const key of overflow(await cache.keys(), MEDIA_MAX)) await cache.delete(key);
}
