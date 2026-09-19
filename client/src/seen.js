/**
 * What appeared on her screen, and what she did with it (#228).
 *
 * An offer that leaves no trace can only be judged by asking her: for #179
 * nobody could tell whether "Mehr neue Wörter" had ever been on her screen.
 * So an offer or hint whose effect matters says so here, and the server keeps
 * it in `ui_events` (routes/ui-events.js has the list of names), where
 * `ops/seen.sh` reads it back.
 *
 * Deliberately not the review outbox. That queue's count is what the offline
 * strip calls "Wiederholungen", and these are not reviews. It is also less
 * careful on purpose: a moment the server refuses is dropped, not kept for
 * ever, because nothing she learns depends on it.
 *
 * "Shown" means drawn into the page, not measured as visible on the glass.
 * For an offer at the top of a short page and a hint above the card that is
 * the same thing, and it needs no observer running on her phone.
 */
import { ApiError, OfflineError, api } from "./api.js";
import { localDay } from "./resume.js";
import { getMeta, setMeta } from "./store.js";

const PENDING = "ui.pending";
const LAST_DAY = "ui.lastDay";
/** A device offline for weeks keeps the newest moments, not all of them. */
export const PENDING_MAX = 200;

const uuid = () =>
  crypto.randomUUID?.() ??
  `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-4000-8000-${Math.random()
    .toString(16)
    .slice(2, 14)}`;

/**
 * Whether a once-a-day moment is new today, and the record to keep. Pure.
 *
 * The deck page redraws on every sync, tab switch and return to the app, so
 * "shown" logged per draw would count redraws, not days she met the offer.
 * `lastDays` maps `name|detail` to the local day it was last recorded.
 */
export function onceToday(lastDays, name, detail, day) {
  const key = `${name}|${detail ?? ""}`;
  if ((lastDays ?? {})[key] === day) return { record: false, lastDays: lastDays ?? {} };
  return { record: true, lastDays: { ...(lastDays ?? {}), [key]: day } };
}

/** The pending list after adding one moment, newest kept when it is full. Pure. */
export function withMoment(pending, moment, max = PENDING_MAX) {
  const next = [...(pending ?? []), moment];
  return next.length > max ? next.slice(next.length - max) : next;
}

// IndexedDB read-modify-write, one at a time: "shown" and "tapped" can come
// within the same tick, and two unserialised writes would lose one.
let chain = Promise.resolve();
const serial = (fn) => {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
};

/**
 * Note a moment. Never throws and never waits on the network: a failure here
 * must not be able to break the screen that called it.
 */
export function seen(name, detail, { oncePerDay = false } = {}) {
  const now = Date.now();
  return serial(async () => {
    if (oncePerDay) {
      const once = onceToday(await getMeta(LAST_DAY), name, detail, localDay(now));
      if (!once.record) return;
      await setMeta(LAST_DAY, once.lastDays);
    }
    const moment = { id: uuid(), name, at: Math.floor(now / 1000) };
    if (detail != null) moment.detail = String(detail);
    await setMeta(PENDING, withMoment(await getMeta(PENDING), moment));
  })
    .then(() => flushSeen())
    .catch(() => {});
}

let flushing;
let again = false;

/**
 * Send what is waiting. Called beside the review outbox's flush.
 *
 * A moment noted while a send is under way is not in that send, so the send
 * goes once more when it is done (#248: "push_granted" stayed on the device
 * for minutes, because it came right behind "push_offer_yes").
 */
export function flushSeen() {
  if (flushing) {
    again = true;
    return flushing;
  }
  flushing = doFlush().finally(() => {
    flushing = undefined;
    if (again) {
      again = false;
      flushSeen().catch(() => {});
    }
  });
  return flushing;
}

async function doFlush() {
  const pending = (await getMeta(PENDING)) ?? [];
  if (pending.length === 0) return;
  let drop = true;
  try {
    await api.uiEvents(pending);
  } catch (err) {
    // Offline or signed out: they go up later. Any other refusal would refuse
    // them again every time, so they are let go.
    if (err instanceof OfflineError || (err instanceof ApiError && err.status === 401)) drop = false;
    else if (!(err instanceof ApiError)) throw err;
  }
  if (!drop) return;
  const sent = new Set(pending.map((m) => m.id));
  await serial(async () => {
    const now = (await getMeta(PENDING)) ?? [];
    await setMeta(PENDING, now.filter((m) => !sent.has(m.id)));
  });
}
