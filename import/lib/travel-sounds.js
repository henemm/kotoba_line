/**
 * Human recordings for the phrases Reise adds (#252, 2026-09-20).
 *
 * The 26 phrases of `travel.tsv` are not in Kaishi, so they have no recording
 * of their own and the nightly generator gives them the computer voice
 * (#183). Henning heard さようなら and asked why such a common word has no
 * human one. It has: Wiktionary's recordings on Wikimedia Commons are named
 * after the *romaji* (`Ja-sayōnara.ogg`), and the first search here looked
 * only for the Japanese script, which is why it came back empty.
 *
 * Measured afterwards, over both collections in full rather than by sample
 * (2026-09-20): of Commons' 513 `Ja-…` files, two match a phrase of ours;
 * of Lingua Libre's 1,057 Japanese recordings (985 distinct words), none
 * does — nor for the 27 Kaishi cards that lack a recording. Whole sentences
 * ("Where is the toilet?") are not what either collection holds, so those 24
 * keep the generated voice until a person speaks them into the app.
 *
 * Each row is pinned by the sha1 Commons reports and by its uploader, the
 * same as `kana-sounds.js`: the levelling below was measured on that
 * recording, and a different upload under the same name is a different one.
 * Both are CC BY-SA, so the speakers are named in Settings → Quellen.
 */

/** The phrases' card ids are fixed in travel.tsv (TRAVEL_ID_FLOOR + n). */
export const TRAVEL_SOUNDS = [
  {
    cardId: 9000000000001,
    word: "こんにちは。",
    commons: "Ja-konnichiwa.ogg",
    sha1: "429c9aa56f36dd3b7ffcb6d0aa2a2a0398088b4d",
    user: "Spesco",
    licence: "CC BY-SA 4.0",
  },
  {
    cardId: 9000000000002,
    word: "さようなら。",
    commons: "Ja-sayōnara.ogg",
    sha1: "df00338a5717069478173f0894a4c05162f92374",
    user: "TAKASUGI Shinji",
    licence: "CC BY-SA 3.0",
  },
];

/** What the file is called in the media directory, keyed on the card it belongs to. */
export const travelSoundMediaName = ({ cardId }) => `travel-${cardId}.mp3`;
