/**
 * IndexedDB, in about a hundred lines and with no dependency.
 *
 * §4 is explicit that this may not be `localStorage`: it is synchronous,
 * size-limited, and iOS clears it more readily than IndexedDB. The deck alone
 * is well past what localStorage would hold.
 *
 * Three stores, and they hold different kinds of thing:
 *
 *   deck    the cards, keyed by card id — a cache, rebuildable from the server
 *   outbox  answered cards not yet acknowledged — the only irreplaceable data
 *           on the device, which is why it is written before anything else
 *   meta    small values: the deck's sync timestamp, the last queue seen
 *
 * Everything here resolves rather than throws when the database cannot be
 * opened. Private browsing and a storage-pressure eviction both look like
 * that, and neither should stop her practising — the server holds the truth.
 */

const DB_NAME = "kotoba";
const DB_VERSION = 1;

let opening;

function open() {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);

    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null);
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("deck")) db.createObjectStore("deck", { keyPath: "id" });
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "id" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    // Another tab holding an old version open: don't hang the app on it.
    request.onblocked = () => resolve(null);
  });
  return opening;
}

function run(storeName, mode, work) {
  return open().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve(undefined);
        let tx;
        try {
          tx = db.transaction(storeName, mode);
        } catch {
          return resolve(undefined);
        }
        const store = tx.objectStore(storeName);
        let result;
        try {
          result = work(store);
        } catch {
          return resolve(undefined);
        }
        tx.oncomplete = () => resolve(unwrap(result));
        tx.onerror = () => resolve(undefined);
        tx.onabort = () => resolve(undefined);
      }),
  );
}

/**
 * What a completed transaction actually returned.
 *
 * This was `result?.result ?? result`, which is wrong and quietly so: when a
 * stored value is genuinely `undefined` — a key that was never set — the `??`
 * falls through and hands back the IDBRequest itself, which is truthy.
 * `getMeta("deck.paused")` then reported a paused download on a device that
 * had never started one, and every `?? default` on a missing key was dead.
 *
 * Duck-typed rather than `instanceof IDBRequest`, so it can be tested in Node
 * — which has no IndexedDB at all.
 */
export function unwrap(result) {
  return result && typeof result === "object" && "readyState" in result && "result" in result
    ? result.result
    : result;
}

/** Whether IndexedDB is usable at all — the offline promise depends on it. */
export async function available() {
  return (await open()) !== null;
}

// ── deck ──────────────────────────────────────────────────────────

export async function putCards(cards) {
  return run("deck", "readwrite", (store) => {
    for (const card of cards) store.put(card);
  });
}

export async function allCards() {
  const rows = await run("deck", "readonly", (store) => store.getAll());
  return rows ?? [];
}

/** Cards she deleted; they arrive from `/api/deck` marked, not missing. */
export async function dropCards(ids) {
  return run("deck", "readwrite", (store) => {
    for (const id of ids) store.delete(id);
  });
}

export async function cardCount() {
  return (await run("deck", "readonly", (store) => store.count())) ?? 0;
}

// ── outbox ────────────────────────────────────────────────────────

export async function enqueue(events) {
  return run("outbox", "readwrite", (store) => {
    for (const event of events) store.put(event);
  });
}

export async function outbox() {
  return (await run("outbox", "readonly", (store) => store.getAll())) ?? [];
}

export async function outboxCount() {
  return (await run("outbox", "readonly", (store) => store.count())) ?? 0;
}

/**
 * Remove what the server acknowledged.
 *
 * By id, never "clear the store": a card answered while the flush was in
 * flight would otherwise be deleted without ever having been sent. §4's
 * `INSERT OR IGNORE` means re-sending is free, but losing an event is not.
 */
export async function acknowledge(ids) {
  return run("outbox", "readwrite", (store) => {
    for (const id of ids) store.delete(id);
  });
}

// ── meta ──────────────────────────────────────────────────────────

export async function getMeta(key) {
  return run("meta", "readonly", (store) => store.get(key));
}

export async function setMeta(key, value) {
  return run("meta", "readwrite", (store) => store.put(value, key));
}

/** Sign-out: her data leaves the device, the deck cache may stay. */
export async function clearPersonal() {
  await run("outbox", "readwrite", (store) => store.clear());
  await run("meta", "readwrite", (store) => store.clear());
}
