import { api } from "./api.js";
import { allCards, dropCards, getMeta, putCards, setMeta } from "./store.js";

/**
 * The deck: IndexedDB on disk, a Map in memory for the session.
 *
 * `/api/deck?since=` returns only what changed, so after the first sync this
 * costs almost nothing — which matters because §1 says mobile data in Japan is
 * metered. The stored `latest` is the watermark.
 */
let cards = new Map();
let loadedAt = 0;
// The refresh `syncDeck` has in flight, if any.
let syncing;

const SINCE = "deck.since";

/**
 * The deck, from whatever is available.
 *
 * Cache first, then the difference from the server. A failed refresh is not an
 * error while the cache holds cards: that is the offline case, and it is the
 * one this whole phase exists for. It is only an error when there is nothing
 * to fall back on.
 */
export async function loadDeck() {
  // A session started straight after saving a word waits for that word.
  if (syncing) await syncing;
  if (cards.size > 0) return cards;

  const cached = await allCards();
  if (cached.length > 0) cards = new Map(cached.map((c) => [c.id, c]));

  try {
    await fetchDifference();
  } catch (err) {
    if (cards.size === 0) throw err;
    // Offline with a cached deck: exactly what this is for.
  }

  return cards;
}

/**
 * Fetch what changed on the server now, even though the deck is already in
 * memory (#85).
 *
 * `loadDeck` only reaches the server once per run of the app — the first time
 * a session asks. A word she added after that was counted by the server's
 * queue and missing from this Map, so the session dropped it without a word:
 * the sheet said "Start 2" and the session was 1/1. Adding, editing and
 * deleting a word call this, so the change is there for the next session and
 * not only after the app is quit and reopened.
 *
 * Best effort. It runs straight after a request that succeeded, so failing
 * here is rare, and the next start of the app catches up anyway.
 *
 * Nothing to do while the deck is not in memory yet: the first `loadDeck` of
 * this run asks the server for the difference regardless.
 */
export function syncDeck() {
  if (cards.size === 0) return Promise.resolve();
  const run = fetchDifference().catch(() => {
    /* the next start of the app picks it up */
  });
  syncing = run;
  run.then(() => {
    if (syncing === run) syncing = undefined;
  });
  return run;
}

async function fetchDifference() {
  const since = cards.size > 0 ? ((await getMeta(SINCE)) ?? 0) : 0;
  const { cards: rows, latest } = await api.deck(since);
  if (rows.length > 0) {
    // A card she deleted arrives here marked rather than missing — the row
    // stays on the server for the event log to point at (migration 004) —
    // so the difference has to be applied, not just merged. So does someone
    // else's own word, which reaches this device only as a deletion (#84).
    const live = rows.filter((c) => !c.deleted_at);
    const gone = rows.filter((c) => c.deleted_at).map((c) => c.id);
    for (const card of live) cards.set(card.id, card);
    for (const id of gone) cards.delete(id);
    await putCards(live);
    if (gone.length > 0) await dropCards(gone);
  }
  await setMeta(SINCE, latest ?? since);
  loadedAt = Date.now();
}

export const deckCard = (id) => cards.get(id);
export const deckSize = () => cards.size;
export const deckLoadedAt = () => loadedAt;

/** For tests, and for signing out. */
export function resetDeck(seed) {
  cards = seed ? new Map(seed.map((c) => [c.id, c])) : new Map();
  loadedAt = seed ? Date.now() : 0;
}

/**
 * Pick wrong answers that are actually wrong answers.
 *
 * The prototype sampled three cards at random. At twenty cards that is fine;
 * at 1,482 it puts "to eat" against "teacher", "how much" and "tomorrow" —
 * answerable without recognising the word. FSRS then reads a guess as recall
 * and stretches the interval on evidence that was never there, across the two
 * modes that carry half the review load (phase-0-plan §1.1).
 *
 * So the pool is narrowed before sampling: cards sharing a tag first, then
 * cards from a neighbouring frequency band, and only then anything at all.
 * `random` is injectable so the choice can be pinned in a test.
 */
export function pickDistractors(
  answer,
  pool,
  count = 3,
  random = Math.random,
  // 聞く asks what the *sentence* means, so its wrong answers have to differ
  // in the sentence gloss. The tiering is the same either way: a distractor
  // is plausible because it shares a topic or a frequency band, not because
  // of which field is being read out.
  field = "word_meaning",
) {
  const others = pool.filter(
    (c) => c.id !== answer.id && c[field] && c[field] !== answer[field],
  );

  const answerTags = new Set(answer.tags ?? []);
  const sharesTag = (c) => (c.tags ?? []).some((t) => answerTags.has(t));

  const rank = answer.frequency_rank;
  const nearRank = (c) =>
    rank != null &&
    c.frequency_rank != null &&
    Math.abs(c.frequency_rank - rank) <= NEAR_BAND;

  // Tiers, best first. Each is exhausted before the next is touched, so a
  // same-topic distractor always beats a random one.
  const tiers = [
    others.filter((c) => sharesTag(c) && nearRank(c)),
    others.filter((c) => sharesTag(c)),
    others.filter(nearRank),
    others,
  ];

  const chosen = [];
  const taken = new Set();

  for (const tier of tiers) {
    const available = tier.filter((c) => !taken.has(c.id));
    while (chosen.length < count && available.length > 0) {
      const i = Math.floor(random() * available.length);
      const [card] = available.splice(i, 1);
      chosen.push(card);
      taken.add(card.id);
    }
    if (chosen.length >= count) break;
  }

  return chosen;
}

/** How far apart two cards can be in frequency and still count as neighbours. */
const NEAR_BAND = 300;

/** Fisher-Yates, with the randomness injectable for tests. */
export function shuffle(items, random = Math.random) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
