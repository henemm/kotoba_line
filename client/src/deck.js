import { api } from "./api.js";

/**
 * The deck, held in memory for the session.
 *
 * Phase 5 moves this into IndexedDB with `since=` fetching only the difference;
 * for now it is one fetch per app start, which is what "online only at this
 * stage" means.
 */
let cards = new Map();
let loadedAt = 0;

export async function loadDeck() {
  if (cards.size > 0) return cards;
  const { cards: rows } = await api.deck(0);
  cards = new Map(rows.map((c) => [c.id, c]));
  loadedAt = Date.now();
  return cards;
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
export function pickDistractors(answer, pool, count = 3, random = Math.random) {
  const others = pool.filter(
    (c) => c.id !== answer.id && c.word_meaning && c.word_meaning !== answer.word_meaning,
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
