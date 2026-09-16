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
 * else, and `ops/deploy.sh` is where it would be forgotten. A bump also needs
 * an entry in `changelog.json`; a test refuses one without.
 *
 * A new version waits (#93). It used to call `skipWaiting()` on install and
 * take over at once, which swapped the cache under a page still running the
 * old modules — so nothing changed on the phone until the app was quit from
 * the app switcher. Now it installs, waits, and the page asks her
 * (`src/update.js`).
 */
const VERSION = "v92";
const SHELL = `kotoba-shell-${VERSION}`;
const MEDIA = "kotoba-media";

/** §7: about three hundred files. A week of study, not the whole deck. */
const MEDIA_MAX = 300;

const scope = new URL("./", self.location).pathname;

/**
 * Every file under client/src, and the list has to stay that way — see the
 * test in client/test/shell-files.test.js, which fails if one is missing.
 *
 * This is not a "nice to have offline" list. `app.js` imports all of them
 * statically, so a module that is absent stops the whole app from evaluating,
 * not just the screen it belongs to. And the gap does not show up in ordinary
 * use: the *first* page load happens before the worker controls the page, so
 * those requests never reach the fetch handler and are never cached by the
 * fallback in `shell()`. Install the app and open it with no network and it
 * came up blank — measured, #app had 0 children, with `browse.js`,
 * `card-topics.js`, `own-deck.js` and four more failing to load (#53). Any
 * later online launch quietly filled the cache in, which is why six features
 * were added here without anyone noticing the list had stopped keeping up.
 */
const SHELL_FILES = [
  "",
  "index.html",
  "manifest.webmanifest",
  // Not under src/, so the test that catches a missing module cannot catch
  // this one. The prompt reads the notes out of the *waiting* version's cache,
  // so a changelog that is not precached is a "More info" with nothing in it.
  "changelog.json",
  "src/app.js",
  "src/api.js",
  "src/audio.js",
  "src/deck.js",
  "src/history.js",
  "src/kaishi-match.js",
  "src/modes.js",
  "src/outbox.js",
  "src/pitch.js",
  "src/queue.js",
  "src/resume.js",
  "src/romaji.js",
  "src/script.js",
  "src/shell-version.js",
  "src/stars.js",
  "src/store.js",
  "src/topics.js",
  "src/typing.js",
  "src/update.js",
  "src/viewport.js",
  "src/whats-new.js",
  "src/screens/browse.js",
  "src/screens/card-history.js",
  "src/screens/card-topics.js",
  "src/screens/choose-set.js",
  "src/screens/deck-options.js",
  "src/screens/deck-cards.js",
  "src/screens/decks.js",
  "src/screens/first-run.js",
  "src/screens/own-deck.js",
  "src/screens/practise.js",
  "src/screens/session.js",
  "src/screens/settings.js",
  "src/screens/signed-out.js",
  "src/screens/signin.js",
  "src/screens/stats.js",
  "src/screens/summary.js",
  "src/screens/update-sheet.js",
  "src/ui/base.css",
  "src/ui/dom.js",
  "src/ui/screens.css",
  "src/ui/tokens.css",
  "assets/icons/icon-192.png",
  "assets/icons/apple-touch-icon-180.png",
].map((f) => scope + f);

/**
 * The first shell whose page can ask. A worker waiting behind an older one
 * would wait for a question that is never asked.
 */
const FIRST_PROMPTING_VERSION = 36;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // One at a time rather than cache.addAll: addAll rejects the whole
      // install if a single file 404s, and a service worker that refuses to
      // install leaves the app with no offline support and no message.
      const missed = await Promise.all(
        SHELL_FILES.map(async (url) => {
          try {
            const res = await fetch(url, { cache: "reload" });
            if (res.ok) await cache.put(url, res);
            return !res.ok;
          } catch {
            return true;
          }
        }),
      );

      // ...but an update is not a first install. "A partial shell beats none"
      // is right when there is nothing else, and wrong when a complete older
      // shell is running and the prompt is about to say the new one is ready:
      // tapping Update would land her on a shell with modules missing, which
      // is a blank screen (#53). Failing here keeps the working one, and the
      // next update check simply tries again.
      //
      // What this catches is a request that fails — the signal dropping part
      // way through, the likely case on a train. Measured in WebKit: v40 with
      // one request cut off was never offered, its cache was gone, v36 kept
      // running, and v41 was offered and installed normally afterwards. A
      // file that does not exist is *not* caught here: nginx's try_files
      // answers it with index.html and a 200. The list test covers that.
      if (self.registration.active && missed.some(Boolean)) {
        await caches.delete(SHELL);
        throw new Error(`${SHELL} is incomplete; keeping the running version`);
      }

      // The one release whose predecessor cannot ask (v35 and older): take
      // over the old way, once. Her phone gets this version by being quit and
      // reopened, as before, and every version after it asks.
      const previous = (await caches.keys())
        .filter((name) => name.startsWith("kotoba-shell-v") && name !== SHELL)
        .map((name) => Number(name.slice("kotoba-shell-v".length)));
      if (previous.length > 0 && Math.max(...previous) < FIRST_PROMPTING_VERSION) {
        await self.skipWaiting();
      }
    })(),
  );
});

/**
 * The page talks to the *waiting* worker: which version it is, so the prompt
 * can read that version's notes out of its cache, and — once she taps
 * Update — to take over.
 */
self.addEventListener("message", (event) => {
  if (event.data?.type === "version") event.ports[0]?.postMessage(VERSION);
  if (event.data?.type === "skip-waiting") self.skipWaiting();
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
 * §7: audio is never bulk-fetched. A card's recordings land here when the card
 * is first shown (#116: `prime()` in src/audio.js), so after a week the cache
 * holds the words she is actually studying and nothing else. Mobile data in
 * Japan is metered (§1).
 */
async function media(request) {
  const res = await wholeFile(request.url);
  const range = request.headers.get("range");
  return range && res.ok ? partial(res, range) : res;
}

/** Downloads in progress, by URL — see `wholeFile`. */
const inflight = new Map();

/**
 * One file, from the cache or else from the network — once, however many ask.
 *
 * The cache always holds the whole file, never a slice, and the network is
 * asked for the whole file too: cache.put() rejects a 206 outright, and a
 * cached partial body would break every later play of that word.
 *
 * A drawn card asks twice at the same moment: `prime()` fetches its
 * recordings and read-aloud starts playing one of them. Both miss the cache,
 * so without this each would download the file. The lookup is registered
 * before the first `await` so the second request cannot slip in between.
 * Every caller gets its own clone; the shared response's body is never read.
 */
function wholeFile(url) {
  let pending = inflight.get(url);
  if (!pending) {
    pending = (async () => {
      const cache = await caches.open(MEDIA);
      const hit = await cache.match(url);
      if (hit) return hit;
      const res = await fetch(url);
      if (res.ok) {
        await cache.put(url, res.clone());
        await evict(cache);
      }
      return res;
    })();
    inflight.set(url, pending);
    const done = () => inflight.delete(url);
    pending.then(done, done);
  }
  return pending.then((res) => res.clone());
}

/**
 * Answer a Range request with the 206 the media element asked for.
 *
 * Not optional, and the reason this file had to change: iOS asks for every
 * media file with a `Range` header and then silently refuses to play a reply
 * that answers one with a plain 200. Desktop Safari plays it regardless, so
 * the bug existed only on the phone -- the whole deck was silent there while
 * every check from a laptop said the audio was fine.
 *
 * Only single `bytes=` ranges, which is all a media element sends. Anything
 * unparseable falls through to the whole file rather than failing the request:
 * a complete answer plays, a rejected one does not.
 */
async function partial(res, range) {
  const asked = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!asked) return res;

  const body = await res.clone().arrayBuffer();
  const total = body.byteLength;
  const from = asked[1] === "" ? undefined : Number(asked[1]);
  const to = asked[2] === "" ? undefined : Number(asked[2]);

  let start;
  let end;
  if (from === undefined) {
    if (!to) return res; // "bytes=-" and "bytes=-0" ask for nothing
    start = Math.max(0, total - to); // a suffix range: the last N bytes
    end = total - 1;
  } else {
    start = from;
    end = to === undefined || to >= total ? total - 1 : to;
  }

  if (start > end || start >= total) {
    return new Response(null, {
      status: 416,
      statusText: "Range Not Satisfiable",
      headers: { "Content-Range": `bytes */${total}` },
    });
  }

  const headers = new Headers(res.headers);
  headers.set("Content-Range", `bytes ${start}-${end}/${total}`);
  headers.set("Content-Length", String(end - start + 1));
  headers.set("Accept-Ranges", "bytes");
  return new Response(body.slice(start, end + 1), {
    status: 206,
    statusText: "Partial Content",
    headers,
  });
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

/**
 * KanjiVG's stroke-order drawings (#158) share this cache but not its cap.
 * There are 148, about 2 KB each, and they never change; counted, they would
 * take half of the 300 places and push out recordings ten times their size,
 * which she would then download again on mobile data.
 */
const isDrawing = (request) => new URL(request.url).pathname.includes("/media/kanjivg-");

/**
 * The kana's own sounds (v84) are left out of the cap for the same reason:
 * 71 files of 13–42 KB, 1.8 MB together, never changing, and played on every
 * kana card she reviews. Counted, a week of Kaishi words would push them out
 * and she would fetch あ again on mobile data. The example words' recordings
 * on a kana card — Kaishi's, and since v87 Lingua Libre's and Tofugu's as
 * `example-*` — are ordinary recordings, and do count.
 */
const isKanaSound = (request) => new URL(request.url).pathname.includes("/media/kana-");

/**
 * The kana pictures (v88, #177) are outside the cap on the same grounds: 92
 * files of about 8 KB, 936 KB together, fixed, and on the back of every basic
 * kana card.
 */
const isMnemonic = (request) => new URL(request.url).pathname.includes("/media/mnemonic-");

async function evict(cache) {
  const recordings = (await cache.keys()).filter((key) => !isDrawing(key) && !isKanaSound(key) && !isMnemonic(key));
  for (const key of overflow(recordings, MEDIA_MAX)) await cache.delete(key);
}
