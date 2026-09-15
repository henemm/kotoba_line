import { romajiQuery, searchRomaji } from "./romaji.js";
import { inScript } from "./script.js";
import { byFrequencyThenId } from "./screens/browse.js";

/**
 * The Kaishi words that are exactly what she typed for a card of hers (v70),
 * to offer their recording — never to give it by themselves.
 *
 * Exactly, not "starts with": the suggestion is for this word, and "hashi"
 * should offer 橋 and 箸 with their meanings, not every word beginning with
 * it. Counted over the 551 words on her Noji lists (2026-09-15): 239 have one
 * Kaishi match and 22 have several (kiku: to hear, to ask, to be effective).
 * One match is not proof either — "Kurasu" (Klasse) matches only 暮らす "to
 * live" — so every offer shows the English meaning and waits for her tap.
 */

/** A form has room for this many; kiku has three. */
export const MAX_OFFERS = 4;

const keysOf = new WeakMap();
const keys = (card) => {
  if (!keysOf.has(card)) keysOf.set(card, searchRomaji(card.word, card.word_reading));
  return keysOf.get(card);
};

export function kaishiMatches(typed, cards) {
  const text = String(typed ?? "").trim();
  if (!text) return [];
  const key = romajiQuery(text);
  const isIt = key
    ? (c) => keys(c).includes(` ${key}|`)
    : inScript(text)
      ? (c) => c.word === text || (c.word_reading ?? "").split("・").includes(text)
      : () => false;
  return cards
    .filter((c) => c.deck === "kaishi" && !c.deleted_at && isIt(c))
    .sort(byFrequencyThenId)
    .slice(0, MAX_OFFERS);
}

/**
 * The Kaishi word a card of hers took its recording from, if any. A card
 * keeps no pointer to it; the recording's file name is the pointer, since only
 * a Kaishi card has recordings to give.
 *
 * Four recordings are shared by two Kaishi cards each — よく "well" and
 * "often", 早い "early" and "fast" (measured 2026-09-15) — so where the file
 * names two, the example sentence the card took says which: those differ.
 */
export function kaishiOf(card, cards) {
  if (!card?.word_audio) return undefined;
  const same = cards.filter((c) => c.deck === "kaishi" && c.word_audio === card.word_audio);
  return same.find((c) => c.sentence === card.sentence) ?? same[0];
}
