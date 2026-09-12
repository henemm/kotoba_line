/**
 * Kana → romaji, for the "Show romaji" setting.
 *
 * Wāpuro style, not macron Hepburn: long vowels are written out as they are
 * typed (とうきょう → `toukyou`, not `tōkyō`; コーヒー → `koohii`), because that
 * is what she could type back on a keyboard, and a macron is a diacritic she
 * has no reason to know. ぢ/づ are pronunciation-matched to じ/ず (`ji`/`zu`),
 * same as standard Hepburn — the two are not distinguished in speech, so
 * keyboard fidelity would teach a spelling that misleads rather than helps.
 *
 * Converts whatever kana it is given — it does not know or care whether that
 * came from a word or a sentence reading. Never invents a reading: input
 * containing anything the table does not cover (most commonly leftover
 * kanji, because no furigana was there to resolve it) yields `undefined`
 * rather than a string with gaps in it.
 */

import { moras } from "./pitch.js";

const TABLE = {
  あ: "a", い: "i", う: "u", え: "e", お: "o",
  か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
  さ: "sa", し: "shi", す: "su", せ: "se", そ: "so",
  た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
  な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no",
  は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
  ま: "ma", み: "mi", む: "mu", め: "me", も: "mo",
  や: "ya", ゆ: "yu", よ: "yo",
  ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro",
  わ: "wa", ゐ: "wi", ゑ: "we", を: "wo",
  が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go",
  ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
  だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do",
  ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
  ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po",

  きゃ: "kya", きゅ: "kyu", きょ: "kyo",
  しゃ: "sha", しゅ: "shu", しょ: "sho",
  ちゃ: "cha", ちゅ: "chu", ちょ: "cho",
  にゃ: "nya", にゅ: "nyu", にょ: "nyo",
  ひゃ: "hya", ひゅ: "hyu", ひょ: "hyo",
  みゃ: "mya", みゅ: "myu", みょ: "myo",
  りゃ: "rya", りゅ: "ryu", りょ: "ryo",
  ぎゃ: "gya", ぎゅ: "gyu", ぎょ: "gyo",
  じゃ: "ja", じゅ: "ju", じょ: "jo",
  ぢゃ: "ja", ぢゅ: "ju", ぢょ: "jo",
  びゃ: "bya", びゅ: "byu", びょ: "byo",
  ぴゃ: "pya", ぴゅ: "pyu", ぴょ: "pyo",

  // Extended combinations, mostly for loanwords she'll meet in katakana.
  ふぁ: "fa", ふぃ: "fi", ふぇ: "fe", ふぉ: "fo",
  ゔぁ: "va", ゔぃ: "vi", ゔ: "vu", ゔぇ: "ve", ゔぉ: "vo",
  てぃ: "ti", でぃ: "di", とぅ: "tu", どぅ: "du",
  ちぇ: "che", じぇ: "je", しぇ: "she",
  うぃ: "wi", うぇ: "we", うぉ: "wo",
};

/**
 * Not phonetic content, so carrying it through unchanged is not "inventing a
 * reading" — a sentence keeps its punctuation and the spaces #75 inserts at
 * word boundaries.
 */
const PUNCTUATION = {
  "。": ".", "、": ", ", "！": "!", "？": "?",
  "「": "“", "」": "”", "『": "“", "』": "”",
  "・": " ", "〜": "~", "：": ": ",
  // A dialogue card's own ASCII punctuation (`A:「…」`), carried through
  // unchanged rather than converted to the Japanese-punctuation column above.
  ":": ": ", ".": ".", ",": ", ",
  " ": " ", "　": " ",
};

/**
 * A dialogue card spells `A「…」B「…」`, and a number can carry its own
 * bracket reading (`1[いち]`, handled by `parseFurigana`) or appear bare —
 * `normalizeChar` above has already folded a full-width `３` to `3` by the
 * time this runs. None of that is phonetic content either — same rule as
 * `PUNCTUATION`, just too large a set (all of ASCII) to write out by hand.
 */
function isPlainAscii(mora) {
  if (mora.length !== 1) return false;
  const code = mora.codePointAt(0);
  return (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

/**
 * Katakana → hiragana for the range this table covers (ー is left alone),
 * and full-width digits → ASCII digits, so `３` reads the same as `3`.
 */
function normalizeChar(ch) {
  const code = ch.codePointAt(0);
  if (code >= 0x30a1 && code <= 0x30f6) return String.fromCodePoint(code - 0x60);
  if (code >= 0xff10 && code <= 0xff19) return String.fromCodePoint(code - 0xff10 + 0x30);
  return ch;
}

function normalizeMora(mora) {
  return [...mora].map(normalizeChar).join("");
}

export function toRomaji(kana) {
  if (!kana) return undefined;

  const parts = moras(kana).map(normalizeMora);
  const chunks = parts.map((p) =>
    p === "っ" || p === "ー" || p === "ん"
      ? null
      : (TABLE[p] ?? PUNCTUATION[p] ?? (isPlainAscii(p) ? p : undefined)),
  );

  // Any ordinary mora the table does not resolve fails the whole reading —
  // partial romaji (real syllables next to a bare kanji) would read as a
  // fact, not a gap.
  for (let i = 0; i < parts.length; i++) {
    if (chunks[i] === undefined && parts[i] !== "っ" && parts[i] !== "ー" && parts[i] !== "ん") {
      return undefined;
    }
  }

  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const mora = parts[i];
    if (mora === "っ") {
      // 促音: doubles the next consonant, except before ch — まっちゃ is
      // "matcha", not "macccha".
      const next = chunks[i + 1];
      if (!next) return undefined;
      out.push(next.startsWith("ch") ? "t" : next[0]);
    } else if (mora === "ー") {
      // 長音記号: repeats the vowel it follows, never contracts it.
      const prevVowel = out.length ? out[out.length - 1].slice(-1) : undefined;
      if (!prevVowel || !"aiueo".includes(prevVowel)) return undefined;
      out.push(prevVowel);
    } else if (mora === "ん") {
      // Always "n" (never the traditional Hepburn "m" before b/m/p — see
      // module note), with an apostrophe only where a bare "n" would read as
      // part of the next syllable: しんいち must not look like "shini-chi".
      const next = chunks[i + 1];
      out.push(next && /^[aiueoy]/.test(next) ? "n'" : "n");
    } else {
      out.push(chunks[i]);
    }
  }
  return out.join("");
}
