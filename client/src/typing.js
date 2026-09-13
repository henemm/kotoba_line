/**
 * 書く — whether what she typed is the Japanese for the meaning shown (#97).
 *
 * She types on whatever keyboard her phone has. The iPhone's Japanese keyboard
 * may not be set up, so romaji is the ordinary case and kana is the other one;
 * kanji only arrives if that keyboard is there. All three are accepted.
 *
 * Romaji is not converted to kana and then compared, because there is no one
 * right conversion to compare with. The spellings disagree with each other:
 * `ti` is ち on every keyboard, but `romaji.js` writes てぃ as `ti`; `konnyaku`
 * is こんにゃく in the romaji line and こんやく on a keyboard that reads `nn`
 * as ん. So the question is asked the other way round — *can* this string
 * spell the reading on the card? — mora by mora, with every spelling of each
 * mora allowed. The card is known, which is what makes that possible.
 *
 * What is *not* forgiven is a different word. とうきょう is `toukyou`; `tokyo`
 * is a spelling mistake in Japanese, not a variant, and the reveal shows her
 * the romaji she should have typed. A slip of the finger is hers to call (see
 * the reveal in `screens/session.js`), not this module's to guess at.
 */

import { moras } from "./pitch.js";

const VOWELS = "aiueo";

/** Katakana → hiragana, so コーヒー and こーひー are one reading. */
function hiragana(text) {
  return [...text]
    .map((ch) => {
      const code = ch.codePointAt(0);
      return code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : ch;
    })
    .join("");
}

/**
 * What she typed, before it is read.
 *
 * NFKC folds a full-width `ｔａｂｅｒｕ` and half-width ｶﾀｶﾅ. The rest is iOS:
 * it capitalises the first letter, and "smart punctuation" turns `n'` into
 * `n’` and `-` into a dash — none of which she typed on purpose.
 */
export function normalizeTyped(text) {
  return hiragana(
    (text ?? "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[‘’`´]/g, "'")
      .replace(/[‐‑‒–—―−]/g, "-")
      .replace(/\s+/g, "")
      .replace(/^[。．.、,!?！？]+|[。．.、,!?！？]+$/g, ""),
  );
}

/** The card's side: a reading or a word, folded the same way. */
function normalizeAnswer(text) {
  return hiragana((text ?? "").normalize("NFKC").replace(/\s+/g, ""));
}

/**
 * 何 is なに・なん in the deck: either is the word.
 */
export function splitReadings(reading) {
  return normalizeAnswer(reading)
    .split("・")
    .filter((r) => r.length > 0);
}

// ── spellings ─────────────────────────────────────────────────────

const ROWS = {
  "": ["a", "i", "u", "e", "o"],
  k: ["ka", "ki", "ku", "ke", "ko"],
  s: ["sa", ["shi", "si"], "su", "se", "so"],
  t: ["ta", ["chi", "ti"], ["tsu", "tu"], "te", "to"],
  n: ["na", "ni", "nu", "ne", "no"],
  h: ["ha", "hi", ["fu", "hu"], "he", "ho"],
  m: ["ma", "mi", "mu", "me", "mo"],
  r: ["ra", "ri", "ru", "re", "ro"],
  g: ["ga", "gi", "gu", "ge", "go"],
  z: ["za", ["ji", "zi"], "zu", "ze", "zo"],
  d: ["da", ["ji", "di", "zi"], ["zu", "du"], "de", "do"],
  b: ["ba", "bi", "bu", "be", "bo"],
  p: ["pa", "pi", "pu", "pe", "po"],
};
const KANA_ROWS = {
  "": "あいうえお", k: "かきくけこ", s: "さしすせそ", t: "たちつてと", n: "なにぬねの",
  h: "はひふへほ", m: "まみむめも", r: "らりるれろ", g: "がぎぐげご", z: "ざじずぜぞ",
  d: "だぢづでど", b: "ばびぶべぼ", p: "ぱぴぷぺぽ",
};

/** Every accepted romaji spelling of one mora, keyed by the hiragana mora. */
const SPELLINGS = new Map();
const add = (kana, ...spellings) =>
  SPELLINGS.set(kana, [...new Set([...(SPELLINGS.get(kana) ?? []), ...spellings])]);

for (const [row, cells] of Object.entries(ROWS)) {
  [...KANA_ROWS[row]].forEach((kana, i) => add(kana, ...[cells[i]].flat()));
}
add("や", "ya"); add("ゆ", "yu"); add("よ", "yo");
add("わ", "wa"); add("を", "wo", "o"); add("ゐ", "wi"); add("ゑ", "we");
add("ゔ", "vu");

// ゃ ゅ ょ after an い-column kana: each prefix below, plus a, u, o.
const YOON = {
  き: ["ky"], し: ["sh", "sy"], ち: ["ch", "ty", "cy"], に: ["ny"], ひ: ["hy"],
  み: ["my"], り: ["ry"], ぎ: ["gy"], じ: ["j", "zy", "jy"], ぢ: ["j", "dy", "zy"],
  び: ["by"], ぴ: ["py"],
};
for (const [kana, prefixes] of Object.entries(YOON)) {
  for (const [small, vowel] of [["ゃ", "a"], ["ゅ", "u"], ["ょ", "o"]]) {
    add(kana + small, ...prefixes.map((p) => p + vowel));
  }
}
add("しぇ", "she", "sye"); add("ちぇ", "che", "tye"); add("じぇ", "je", "jye", "zye");

// Loanword sounds. Each has the spelling `romaji.js` shows her first, then
// what a keyboard wants for it.
add("ふぁ", "fa"); add("ふぃ", "fi"); add("ふぇ", "fe"); add("ふぉ", "fo"); add("ふゅ", "fyu");
add("ゔぁ", "va"); add("ゔぃ", "vi"); add("ゔぇ", "ve"); add("ゔぉ", "vo");
add("てぃ", "ti", "thi"); add("でぃ", "di", "dhi");
add("とぅ", "tu", "twu"); add("どぅ", "du", "dwu");
add("うぃ", "wi"); add("うぇ", "we"); add("うぉ", "wo");

const SMALL = { ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o", ゃ: "ya", ゅ: "yu", ょ: "yo", ゎ: "wa" };
for (const [small, sound] of Object.entries(SMALL)) add(small, "x" + sound, "l" + sound);

/**
 * A mora the table does not name — き with a small ぇ, say — is spelled as
 * its parts. Rare enough that nothing smarter is worth it, and never wrong.
 */
function spellingsOf(mora) {
  if (SPELLINGS.has(mora)) return SPELLINGS.get(mora);
  const chars = [...mora];
  if (chars.length < 2) return [];
  let out = [""];
  for (const ch of chars) {
    const next = SPELLINGS.get(ch) ?? [];
    out = out.flatMap((prefix) => next.map((s) => prefix + s));
  }
  return out;
}

/** The vowel a mora ends on, for ー: コー is `koo` or `ko-`. */
function vowelOf(mora) {
  const spelling = spellingsOf(mora)[0];
  const last = spelling?.slice(-1);
  return last && VOWELS.includes(last) ? last : undefined;
}

/**
 * Whether `typed` spells `reading`, all of it and nothing more.
 *
 * Both are already normalised. Any mora may also be typed as its kana, so a
 * half-kana, half-romaji answer counts too — that is what a phone keyboard
 * mid-switch produces.
 */
export function spells(typed, reading) {
  const parts = moras(reading);
  const memo = new Map();

  const from = (i, j) => {
    if (j === parts.length) return i === typed.length;
    if (i >= typed.length) return false;
    const key = i * 1000 + j;
    if (memo.has(key)) return memo.get(key);
    const result = options(j).some((s) => {
      if (!typed.startsWith(s, i)) return false;
      // A plain `n` before a vowel or y is not ん: `kinyoubi` reads きにょうび.
      // `kin'youbi` and `kinnyoubi` say ん on purpose, so both stay allowed.
      if (parts[j] === "ん" && s === "n" && /^[aiueoy]/.test(typed.slice(i + 1))) return false;
      return from(i + s.length, j + 1);
    });
    memo.set(key, result);
    return result;
  };

  function options(j) {
    const mora = parts[j];
    const own = [mora];
    if (mora === "ん") return [...own, "n'", "nn", "n"];
    if (mora === "ー") {
      const vowel = j > 0 ? vowelOf(parts[j - 1]) : undefined;
      return vowel ? [...own, "-", vowel, KANA_ROWS[""][VOWELS.indexOf(vowel)]] : [...own, "-"];
    }
    if (mora === "っ") {
      // 促音 doubles whatever consonant comes next: `kitte`, and `matcha` or
      // `maccha` for まっちゃ. Or it is typed on its own, as a keyboard does.
      const doubled = new Set(["xtu", "ltu", "xtsu", "ltsu"]);
      for (const s of j + 1 < parts.length ? spellingsOf(parts[j + 1]) : []) {
        if (!VOWELS.includes(s[0]) && s[0] !== "n") doubled.add(s[0]);
        if (s.startsWith("ch")) doubled.add("t");
      }
      return [...own, ...doubled];
    }
    return [...own, ...spellingsOf(mora)];
  }

  return typed.length > 0 && parts.length > 0 && from(0, 0);
}

/**
 * Judge one answer.
 *
 * `answers` are the cards that count as right — the one asked about, and any
 * other card whose English meaning is the same words, because the prompt
 * cannot tell them apart: "big, large" is both 大きい and 大きな in the deck,
 * and 33 meanings are shared that way (measured 2026-09-13). Each is
 * `{ id, word, readings }`.
 *
 * Returns the answer she gave, or undefined.
 */
export function judge(typed, answers) {
  const input = normalizeTyped(typed);
  if (!input) return undefined;
  return answers.find(
    (answer) =>
      normalizeAnswer(answer.word) === input ||
      answer.readings.some((reading) => spells(input, reading)),
  );
}

// ── the kana under the field ──────────────────────────────────────

/**
 * One spelling per romaji string, for turning what she types into kana as
 * she types it. Where spellings collide the keyboard's reading wins — `ti` is
 * ち here — because the line under the field is a keyboard's job. Judging
 * does not use this: see `spells`.
 */
const PREVIEW = new Map();
for (const [kana, spellings] of SPELLINGS) {
  for (const s of spellings) {
    const current = PREVIEW.get(s);
    if (current === undefined || [...kana].length < [...current].length) PREVIEW.set(s, kana);
  }
}
// The shortest kana wins everywhere else; these four are where it would be
// the archaic one (ゐ, ゑ) or the particle (を for a plain `o`).
PREVIEW.set("o", "お");
PREVIEW.set("wo", "を");
PREVIEW.set("wi", "うぃ");
PREVIEW.set("we", "うぇ");

/**
 * What she has typed so far, as kana.
 *
 * Letters that do not make a sound yet stay letters — `tabe` then `r` reads
 * たべr until the `u` arrives, which is what a keyboard shows too.
 *
 * A last `n` is shown as ん, although it might yet become な. A keyboard keeps
 * it a letter, but here the line is still there when she taps Check, and
 * `san` reading さn at that moment looks like a mistake she has not made —
 * measured: 117 of the deck's 1,500 words end in ん.
 *
 * `zu` is ず, never づ, as on a keyboard. つづく typed `tsuzuku` shows つずく
 * and is still right (`spells` allows it); the reveal shows the kana.
 */
export function kanaPreview(text) {
  const input = normalizeTyped(text);
  let out = "";
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    const next = input[i + 1];
    if (!/[a-z'-]/.test(ch)) {
      out += ch;
      i += 1;
    } else if (ch === "-") {
      out += "ー";
      i += 1;
    } else if (ch === "n" && (next === "'" || (next === "n" && !/[aiueoy]/.test(input[i + 2] ?? "")))) {
      // `n'` and a doubled `nn` that nothing follows are one ん: `honn` is
      // ほん, not ほんん. `konnichiha` keeps its second n for に.
      out += "ん";
      i += 2;
    } else if (ch === "n" && !/[aiueoy]/.test(next ?? "")) {
      out += "ん";
      i += 1;
    } else if (ch === next && !VOWELS.includes(ch) && /[a-z]/.test(ch)) {
      out += "っ";
      i += 1;
    } else if (ch === "t" && input.startsWith("ch", i + 1)) {
      out += "っ";
      i += 1;
    } else {
      let matched = false;
      for (let len = 4; len >= 1; len--) {
        const kana = PREVIEW.get(input.slice(i, i + len));
        if (kana) {
          out += kana;
          i += len;
          matched = true;
          break;
        }
      }
      if (!matched) {
        out += ch;
        i += 1;
      }
    }
  }
  return out;
}
