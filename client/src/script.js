import { MODES } from "./modes.js";
import { toRomaji } from "./romaji.js";
import { kanaReading } from "./screens/session.js";

/**
 * "Japanese script" off (#135): what a screen shows instead.
 *
 * She learns vocabulary in romaji — German on the front, romaji on the back,
 * in Noji — and learns kana on its own. Japanese characters on cards and
 * buttons confused her (Henning, 2026-09-14). So with the switch off:
 *
 * - a **word** is shown in romaji. All 1,500 Kaishi words convert (measured
 *   2026-09-14). Where one cannot — a kanji word with no reading, which is
 *   most of her own words — the Japanese is shown: no reading beats a guess,
 *   the rule `romajiLine` in session.js already follows.
 * - an example **sentence** is not shown as text at all, only as its
 *   recording and its translation. Its romaji is not good enough to be the
 *   only text on a card: は comes out as "ha" in 787 of the 1,500 sentences
 *   (私はアンです → "watashi haandesu."), and the word boundaries are a guess.
 *   A wrong romaji line under the kana is a hint; as the only line it teaches
 *   a wrong pronunciation. Kana instead would bring back what she asked to
 *   hide.
 * - characters used as **decoration** — 選ぶ, ちょっと, おつかれさま — give way
 *   to the English beside them.
 *
 * This switch outranks "Show romaji" and "Show pitch accent": both annotate
 * Japanese script, so with the script off neither has anything to annotate,
 * and Settings does not offer them.
 */

/** The word in romaji, or undefined where no reading can be produced. */
export function wordRomaji(card) {
  return toRomaji(kanaReading(card.word_furigana) ?? card.word_reading ?? card.word);
}

/** What to show for a card's word. */
export function shownWord(card, japanese) {
  if (japanese) return card.word;
  return wordRomaji(card) ?? card.word;
}

/** Whether `shownWord` gave Japanese script — for the font class. */
export function showsScript(card, japanese) {
  return japanese || wordRomaji(card) === undefined;
}

/** A mode's name: 選ぶ, or "Pick the meaning". */
export function modeName(mode, japanese) {
  return japanese ? mode.jp : mode.en;
}

/**
 * The practice lines she has not hidden (#133). Never none: the server refuses
 * to store all five, and a list from anywhere else that hides everything shows
 * everything rather than an empty tab.
 */
export function visibleModes(hidden = []) {
  const shown = MODES.filter((m) => !hidden.includes(m.key));
  return shown.length > 0 ? shown : MODES;
}
