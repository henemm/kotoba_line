/**
 * Turning a Kaishi note into a row of our `cards` table.
 *
 * §8 calls this "a column mapping and nothing more", which is nearly true.
 * The wrinkles:
 *
 *  - Audio fields hold Anki markup, `[sound:file.mp3]`, not a filename.
 *  - The deck carries both "Word Reading" (わたし) and "Word Furigana"
 *    (私[わたし]); the spec has one column. The furigana form is kept, because
 *    it is the one that can be rendered either way.
 *  - Sentences carry <b> around the target word. That is kept: the prototype
 *    guesses at the same thing by stripping a trailing kana and substring
 *    matching, and the deck already knows the answer.
 *  - Note 1 of the deck is a welcome card, not vocabulary.
 */

import { pitchColumn } from "./pitch.js";

/** Anki separates a note's fields with 0x1f. */
export const FIELD_SEPARATOR = "\x1f";

const SOUND = /\[sound:([^\]]+)\]/;

/** `[sound:x.mp3]` → `x.mp3`; anything else → undefined. */
export function soundFilename(value) {
  const m = SOUND.exec(value ?? "");
  return m ? m[1].trim() : undefined;
}

/** Strip tags and decode the handful of entities Anki actually emits. */
export function plainText(value) {
  return (value ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Keep inline emphasis, drop everything else — used for sentences. */
export function keepEmphasis(value) {
  return (value ?? "")
    .replace(/<(?!\/?b\b)[^>]*>/gi, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/**
 * Map one note's raw field string to a card row, or undefined if the note is
 * not vocabulary. `byName` maps a field name to its ordinal, read from the
 * deck's own notetype rather than hard-coded, so a reordered deck still imports.
 */
export function noteToCard(noteId, flds, byName, deck = "kaishi") {
  const parts = flds.split(FIELD_SEPARATOR);
  const at = (name) => parts[byName.get(name)] ?? "";

  const word = plainText(at("Word"));
  const wordMeaning = plainText(at("Word Meaning"));

  // The deck opens with a "Welcome to Kaishi 1.5k!" note carrying no reading,
  // no audio and no meaning. Anything without both a word and a meaning is not
  // a card we can show.
  if (!word || !wordMeaning) return undefined;

  const frequency = Number.parseInt(plainText(at("Frequency")), 10);

  return {
    // Anki's note id, kept as our card id on purpose: it is stable across
    // re-imports, so review_events rows keep pointing at the same card when
    // the deck is updated.
    id: noteId,
    word,
    word_furigana: keepEmphasis(at("Word Furigana")) || null,
    // The plain kana, kept apart from the furigana field: that one is Anki's
    // `食[た]べる` notation, which no search for たべ can match (migration 003).
    word_reading: plainText(at("Word Reading")) || null,
    // The accent as a number, not as the deck's drawing of it (#21).
    word_pitch: pitchColumn(at("Pitch Accent")),
    word_meaning: wordMeaning,
    word_audio: soundFilename(at("Word Audio")) ?? null,
    sentence: keepEmphasis(at("Sentence")) || null,
    sentence_furigana: keepEmphasis(at("Sentence Furigana")) || null,
    sentence_meaning: plainText(at("Sentence Meaning")) || null,
    sentence_audio: soundFilename(at("Sentence Audio")) ?? null,
    frequency_rank: Number.isInteger(frequency) ? frequency : null,
    deck,
  };
}
