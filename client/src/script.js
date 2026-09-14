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
 * The price: 116 of the 1,500 Kaishi cards share their romaji with a
 * different word (いる "to exist" and 要る "to need" are both "iru"; measured
 * 2026-09-14). 選ぶ keeps those out of each other's wrong answers
 * (`chooseFrom`); on めくる's front "iru" can simply mean either.
 *
 * This switch outranks "Show romaji" and "Show pitch accent": both annotate
 * Japanese script, so with the script off neither has anything to annotate,
 * and Settings does not offer them.
 */

/**
 * The word in romaji, or undefined where no reading can be produced.
 *
 * Two readings stay two (v67): the deck writes 何 as なに・なん, and `toRomaji`
 * turns ・ into a space, so the card said "nani nan" as if that were one
 * phrase (Henning, 2026-09-14). They are "nani / nan" now. Three Kaishi words
 * list alternatives this way — 何, 四 and 七 — and no word has ・ in the word
 * itself (both measured 2026-09-14), but a ・ inside the word would be part of
 * it and keeps its space.
 */
export function wordRomaji(card) {
  const kana = kanaReading(card.word_furigana) ?? card.word_reading ?? card.word;
  if (!kana?.includes("・") || card.word?.includes("・")) return toRomaji(kana);
  const each = kana.split("・").filter(Boolean).map(toRomaji);
  return each.every(Boolean) ? each.join(" / ") : undefined;
}

/** What to show for a card's word. */
export function shownWord(card, japanese) {
  if (japanese) return card.word;
  return wordRomaji(card) ?? card.word;
}

const SCRIPT = /[぀-ヿ㐀-鿿々]/;

/** Whether a text has Japanese characters in it at all. */
export const inScript = (text) => SCRIPT.test(text ?? "");

/**
 * Whether `shownWord` gave Japanese script — for the font class.
 *
 * Read off the characters rather than off the switch: the words from her Noji
 * lists that Kaishi could not fill in are romaji already ("Densha", #137), and
 * `toRomaji` leaves a macron like "Ōkii" undone, so neither the switch nor a
 * missing romaji says what is actually on the card.
 */
export function showsScript(card, japanese) {
  return inScript(shownWord(card, japanese));
}

/** The app's name as a heading (#139): the Latin one Henning chose, with the script off. */
export function appName(japanese) {
  return japanese ? "ことばライン" : "Kotoba Line";
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
