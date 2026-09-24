/**
 * Her own cards take the topics of the Kaishi word they are (#209).
 *
 * Charlotte practises almost only her own words (116 of her first 126
 * reviews), and until this none of her 551 cards carried a topic — so a topic
 * filter had nothing to offer her, wherever it sat. The topics come from the
 * Kaishi deck's existing assignment (`import/lib/tagging.js`); nothing about
 * the card itself is generated or changed.
 *
 * Which Kaishi word a card is:
 * 1. the one it took its recording from (v70, or the list import), by the
 *    recording's file name — where two Kaishi cards share one, the example
 *    sentence says which (`client/src/kaishi-match.js`, `kaishiOf`);
 * 2. otherwise the Kaishi words that are exactly what she wrote, the same
 *    exact match the card form offers: romaji against every way of writing a
 *    Kaishi reading, kana or kanji against the word and its readings.
 *
 * One match gives its topics. Several give only the topics they all share:
 * "kiku" is 聞く "to hear", 聞く "to ask" and 効く "to be effective", and a
 * topic only one sense has would be a guess. No match gives nothing.
 *
 * Offered once per card (`topics_offered_at`, migration 027), and added to
 * what the card already has rather than replacing it. A topic she takes off in
 * the card form stays off, because the card is never offered again.
 */

import { MAX_TAGS } from "./cards.js";
import { mirror } from "./reverse.js";
// The client's own module, as in queue.js: the same keys the search uses.
import { romajiQuery, searchRomaji } from "../../client/src/romaji.js";

const KANA_OR_KANJI = /[぀-ヿ㐀-鿿]/u;

function kaishiIndex(db) {
  const cards = db
    .prepare(
      `SELECT id, word, word_reading, word_audio, sentence FROM cards
        WHERE deck = 'kaishi' AND deleted_at IS NULL`,
    )
    .all();
  const tags = new Map();
  for (const { card_id, tag } of db
    .prepare(
      `SELECT t.card_id, t.tag FROM tags t JOIN cards c ON c.id = t.card_id
        WHERE c.deck = 'kaishi' AND c.deleted_at IS NULL`,
    )
    .all()) {
    if (!tags.has(card_id)) tags.set(card_id, []);
    tags.get(card_id).push(tag);
  }
  for (const c of cards) c.keys = searchRomaji(c.word, c.word_reading);
  return { cards, tags };
}

/** The Kaishi cards one of her cards is, by the two rules above. */
export function kaishiFor(card, { cards }) {
  if (card.word_audio) {
    const same = cards.filter((k) => k.word_audio === card.word_audio);
    if (same.length > 0) return [same.find((k) => k.sentence === card.sentence) ?? same[0]];
  }
  const text = String(card.word ?? "").trim();
  if (!text) return [];
  const key = romajiQuery(text);
  if (key) return cards.filter((k) => k.keys.includes(` ${key}|`));
  if (!KANA_OR_KANJI.test(text)) return [];
  return cards.filter((k) => k.word === text || (k.word_reading ?? "").split("・").includes(text));
}

/** The topics those cards all share, in a stable order. */
export function sharedTopics(matches, { tags }) {
  if (matches.length === 0) return [];
  const [first, ...rest] = matches.map((k) => new Set(tags.get(k.id) ?? []));
  return [...first].filter((t) => rest.every((s) => s.has(t))).sort();
}

/**
 * Offer every personal card that has not been offered yet (or only the ones
 * named) its Kaishi topics. Returns how many cards gained at least one.
 * Runs at start, after a list import and after a card is added; cheap enough
 * for that (551 cards against 1,500: a few milliseconds).
 */
export function offerKaishiTopics(db, { cardIds, now = Date.now() } = {}) {
  const pending = db
    .prepare(
      `SELECT id, word, word_reading, word_audio, sentence FROM cards
        WHERE deck = 'personal' AND topics_offered_at IS NULL AND deleted_at IS NULL
          -- A reverse (#284) takes its original's topics by \`mirror\`.
          AND reverse_of IS NULL`,
    )
    .all()
    .filter((c) => !cardIds || cardIds.includes(c.id));
  if (pending.length === 0) return 0;

  const index = kaishiIndex(db);
  const has = db.prepare("SELECT tag FROM tags WHERE card_id = ?");
  const insert = db.prepare("INSERT OR IGNORE INTO tags (card_id, tag) VALUES (?, ?)");
  const mark = db.prepare("UPDATE cards SET topics_offered_at = ? WHERE id = ?");
  // The phone's copy of the deck is refreshed by `updated_at`; a card that
  // gained a topic has to look changed or the phone never sees it.
  const touch = db.prepare("UPDATE cards SET updated_at = ? WHERE id = ?");
  const seconds = Math.floor(now / 1000);
  let gained = 0;

  db.transaction(() => {
    for (const card of pending) {
      const own = has.all(card.id).map((r) => r.tag);
      const add = sharedTopics(kaishiFor(card, index), index)
        .filter((t) => !own.includes(t))
        .slice(0, Math.max(0, MAX_TAGS - own.length));
      for (const t of add) insert.run(card.id, t);
      mark.run(seconds, card.id);
      if (add.length > 0) {
        touch.run(seconds, card.id);
        gained += 1;
      }
      mirror(db, card.id, seconds);
    }
  })();
  return gained;
}
