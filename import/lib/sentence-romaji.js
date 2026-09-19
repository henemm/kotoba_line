/**
 * A Kaishi example sentence in romaji, written once at import (2026-09-19).
 *
 * The app used to guess it on the phone from the furigana alone
 * (`sentenceKana` in session.js), and the guess could not know where one word
 * ends or that は as a particle is said "wa": この靴はいくらですか came out
 * "kono kutsu haikuradesuka", and 617 of Kaishi's 1,500 sentences carried a
 * particle read as ha/wo/he. So with the script off a sentence showed no
 * text at all (#135) — Henning asked where the romaji was.
 *
 * Two sources, each doing only what it is reliable for:
 *
 * - **Readings are Kaishi's.** The sentence's own furigana, written by the
 *   deck's authors, gives every kana. A dictionary tokenizer's reading is
 *   never used: it says なに where Kaishi says なん, にっぽん for にほん.
 * - **Word boundaries and parts of speech are the tokenizer's** (kuromoji
 *   with IPADIC — a dictionary and fixed rules, not a language model; same
 *   input, same output). They decide where a space goes and which は is a
 *   particle.
 *
 * Where the two cannot be lined up — a token ending inside one furigana
 * group, a kanji with no reading — the sentence gets no romaji, and the card
 * keeps showing its recording only. No romaji is better than a wrong one.
 *
 * `tokens` are kuromoji's: { surface_form, pos, pos_detail_1, basic_form }.
 * This module has no dependency of its own; the tokenizer is run by
 * import/sentence-romaji.js.
 */
import { toRomaji } from "../../client/src/romaji.js";

const PUNCTUATION = { "。": ".", "、": ",", "？": "?", "！": "!", "?": "?", "!": "!", "…": "…" };
const QUOTES = new Set(["「", "」", "『", "』"]);
// Said with a hyphen in romaji: Tomu-san, Rara-chan.
const HONORIFICS = new Set(["さん", "ちゃん", "くん", "君", "さま", "様"]);
const PARTICLE_SOUND = { は: "わ", へ: "え", を: "お" };

/**
 * The furigana as units of reading: an annotated group (`靴[くつ]`) is one
 * unit that cannot be split, a plain character is a unit of its own.
 */
function unitsOf(furigana) {
  const units = [];
  const re = /([一-鿿々〆ヶ0-9０-９]+)\[([^\]]+)\]/g;
  const text = String(furigana ?? "").replace(/<\/?b>/gi, "");
  let last = 0;
  const plain = (s) => {
    for (const ch of s.replace(/\s/g, "")) units.push({ surface: ch, reading: ch });
  };
  let m;
  while ((m = re.exec(text)) !== null) {
    plain(text.slice(last, m.index));
    units.push({ surface: m[1], reading: m[2] });
    last = m.index + m[0].length;
  }
  plain(text.slice(last));
  return units;
}

/**
 * The tokens grouped so each group covers whole furigana units, with the
 * group's reading taken from those units. A token that ends inside a unit
 * (一人[ひとり] tokenized 一/人) is merged with the next until they line up.
 */
function align(tokens, units) {
  const groups = [];
  let u = 0;
  let pending = null;
  let covered = 0; // characters of the current unit run consumed by `pending`
  let runLength = 0; // characters in the units taken so far for `pending`
  let reading = "";
  for (const t of tokens) {
    const surface = t.surface_form.replace(/\s/g, "");
    if (!surface) continue;
    if (!pending) pending = { first: t, surface: "", tokens: [] };
    pending.surface += surface;
    pending.tokens.push(t);
    covered += surface.length;
    while (runLength < covered) {
      const unit = units[u++];
      if (!unit) return undefined;
      runLength += unit.surface.length;
      reading += unit.reading;
    }
    if (runLength === covered) {
      groups.push({ ...pending, reading });
      pending = null;
      covered = 0;
      runLength = 0;
      reading = "";
    }
  }
  if (pending || u !== units.length) return undefined;
  return groups;
}

/** Whether a group is joined to the word before it rather than starting one. */
function attaches(t) {
  if (t.pos === "助動詞") return !["です", "だ", "じゃ"].includes(t.basic_form);
  // 行きなさい is one word, "ikinasai", not "iki nasai".
  if (t.pos === "動詞" && t.pos_detail_1 === "非自立" && t.basic_form === "なさる") return true;
  if (t.pos === "助詞" && t.pos_detail_1 === "接続助詞") return ["て", "で", "ば"].includes(t.surface_form);
  return t.pos_detail_1 === "接尾";
}

/**
 * The romaji, or `{ fail }` saying why there is none. `sentence` is the
 * card's sentence (its <b> marks are ignored), `furigana` its furigana.
 */
export function sentenceRomaji(tokens, sentence, furigana) {
  const plain = String(sentence ?? "").replace(/<\/?b>/gi, "").replace(/\s/g, "");
  const units = unitsOf(furigana);
  if (units.map((x) => x.surface).join("") !== plain) return { fail: "furigana does not spell the sentence" };
  const groups = align(tokens, units);
  if (!groups) return { fail: "tokens and furigana do not line up" };

  const words = [];
  const last = () => words.length - 1;
  for (const g of groups) {
    const t = g.first;
    if (g.tokens.length === 1 && PUNCTUATION[g.surface]) {
      if (words.length === 0) return { fail: `starts with ${g.surface}` };
      words[last()].tail += PUNCTUATION[g.surface];
      continue;
    }
    if (g.tokens.length === 1 && QUOTES.has(g.surface)) {
      // A「…」B「…」 — the speaker's letter, then what they say.
      if ((g.surface === "「" || g.surface === "『") && words.length && /^[A-Z]$/.test(words[last()].kana)) {
        words[last()].tail += ":";
      }
      continue;
    }
    let kana = g.reading;
    if (t.pos === "助詞" && PARTICLE_SOUND[g.surface]) kana = PARTICLE_SOUND[g.surface];
    if (words.length && t.pos_detail_1 === "接尾" && HONORIFICS.has(g.surface)) {
      words[last()].tail += "-" + g.surface;
      words[last()].honorific = kana;
      continue;
    }
    if (words.length && !words[last()].tail && attaches(t)) words[last()].kana += kana;
    else words.push({ kana, tail: "" });
  }

  const out = [];
  for (const w of words) {
    const romaji = /^[A-Z]$/.test(w.kana) ? w.kana : toRomaji(w.kana);
    if (!romaji) return { fail: `no romaji for ${w.kana}` };
    const tail = w.honorific ? w.tail.replace(/-[^:.,?!…]+/, `-${toRomaji(w.honorific)}`) : w.tail;
    out.push(romaji + tail);
  }
  return { romaji: out.join(" ") };
}
