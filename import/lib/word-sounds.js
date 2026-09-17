/**
 * Generated audio for every card whose word has no recording (#183, Henning,
 * 2026-09-17: "Ich möchte überall Computer-Audio haben") — her own romaji
 * cards above all: 339 of her 551 had none when this was written.
 *
 * What this decides, per card, is the text VOICEVOX is given and whether the
 * accent it will speak can be vouched for. Neither is ever shown: `word`
 * stays what she typed. That is how this stays inside the no-generated-
 * content rule — nothing here writes learning content; it only picks among
 * human-written dictionary entries (Wadoku, Kanjium) for the engine's input.
 *
 * Romaji → kana is `kanaPreview`, the app's own converter from 書く. For
 * sound, not for reading: it turns the particle "wa" into わ and "e" into
 * え, which sound exactly like は and へ. That is why the import still never
 * derives a *reading* from romaji (CLAUDE.md, pitch accent) — a derived
 * spelling is wrong on screen and right in the ear. Where a token is a
 * particle inside a phrase it is given as は/を/へ all the same, because the
 * engine parses a phrase better with its particles in their usual spelling.
 *
 * A content word goes to the engine in its dictionary spelling when Wadoku
 * has an entry whose reading is exactly that kana and whose German overlaps
 * her meaning: 歯 rather than は (which the engine reads as the particle
 * "wa"), エレベーター rather than えれべえたあ. Only an exact reading match
 * is taken, so the spelling can never change what is said.
 *
 * The asterisk (Henning, point 2): the accent is `checked` only when two
 * independent sources agree — VOICEVOX's own guess (Open JTalk's
 * dictionary) and Kanjium's (CC BY-SA 4.0) — on a single uninflected word,
 * the same bar as v93's example words. Measured on her 201 words that have a
 * real recording: VOICEVOX alone gets 87% right. A phrase, an inflected form
 * or a word Kanjium lacks can never clear that bar and keeps its asterisk.
 * Where the two disagree and Kanjium names one accent, Kanjium's is spoken —
 * a human-curated dictionary over a statistical guess — and it still carries
 * the asterisk, because then only one source vouches for it.
 */

import { kanaPreview } from "../../client/src/typing.js";

/** Particles, and the spelling the engine expects inside a phrase. */
const PARTICLES = new Map([
  ["wa", "は"], ["o", "を"], ["wo", "を"], ["e", "へ"], ["ga", "が"], ["ni", "に"], ["de", "で"], ["to", "と"],
  ["no", "の"], ["mo", "も"], ["ka", "か"], ["ne", "ね"], ["yo", "よ"], ["ya", "や"], ["kara", "から"], ["made", "まで"],
]);

// Her German, reduced far enough that "Müde"/"müde" and "Essen"/"essen" meet
// a Wadoku gloss. Deliberately crude: it only has to find overlap, and a
// spelling is only ever taken on an *exact* reading match on top of it.
const STOP = new Set(
  "der die das den dem des ein eine einen einem einer zu zum zur ist sind sein und oder im in am an auf es ich du er sie wir ihr man mit von für wie was wer sehr so etwas auch noch bin bist hab habe hat nicht kein keine mich dich sich mir dir".split(" "),
);
const stem = (t) => t.replace(/(ungen|ung|en|er|es|em|e|n|s)$/, "");
function germanTokens(text) {
  return (String(text ?? "").toLowerCase().match(/[a-zäöüß]+/g) ?? [])
    .filter((t) => t.length > 2 && !STOP.has(t))
    .map(stem)
    .filter((t) => t.length > 2);
}
export function glossMatches(meaning, glosses) {
  const want = new Set(germanTokens(meaning));
  return glosses.some((g) => germanTokens(g).some((t) => want.has(t)));
}

/** Wadoku's EDICT-style file → Map(reading → [{ words, glosses }]). */
export function parseWadoku(text) {
  const map = new Map();
  for (const line of text.split("\n")) {
    // WORD;ALT [READING] <optional text>/gloss/gloss/ — the text between "]"
    // and the first "/" is not always empty (まずい, お腹 …); a parser that
    // demanded " /" there lost those entries silently.
    const m = /^(.+?) \[([^\]]*)\](.*)$/.exec(line.trim());
    if (!m || !m[2]) continue;
    const glosses = m[3]
      .split("/")
      .map((g) => g.replace(/[　-鿿＀-￯]+/g, " ").trim())
      .filter(Boolean);
    if (!glosses.length) continue;
    if (!map.has(m[2])) map.set(m[2], []);
    map.get(m[2]).push({ words: m[1].split(";"), glosses });
  }
  return map;
}

/** Kanjium's accents.txt → Map("word\treading" → [accents]) and Map(reading → same). */
export function parseKanjium(text) {
  const byWord = new Map();
  for (const line of text.split("\n")) {
    const [word, reading, accents] = line.split("\t");
    if (!word || !accents) continue;
    const list = accents.split(",").map((a) => Number.parseInt(a, 10)).filter(Number.isInteger);
    byWord.set(`${word}\t${reading || word}`, list);
  }
  return byWord;
}

// A loanword's long vowel is ー in Wadoku (タクシー = たくしー); she writes it
// doubled ("Takushii") or as "ou". Tried after the literal spelling.
const spellings = (romaji) => [
  ...new Set([romaji, romaji.replace(/([aeiou])\1/g, "$1-"), romaji.replace(/ou/g, "o-"), romaji.replace(/ei/g, "e-")]),
];

/**
 * The dictionary spelling of one romaji token, when Wadoku has an entry with
 * exactly this reading and a German gloss that overlaps hers.
 */
export function dictionaryForm(romaji, meaning, wadoku, common = new Set()) {
  for (const variant of spellings(romaji)) {
    const kana = kanaPreview(variant);
    if (/[a-z]/i.test(kana)) continue;
    const matching = (wadoku.get(kana) ?? []).filter((entry) => glossMatches(meaning, entry.glosses));
    if (!matching.length) continue;
    // Several entries can share a reading and a German word: いぬ is 犬 and
    // 戌 (the zodiac sign), あつい is 暑い and 熱い, and each has its own
    // accent. A spelling the Kaishi deck itself uses wins (the common word);
    // otherwise Wadoku's own first spelling of its first matching entry —
    // never the first kanji form found, which picked 戌, 酉 and 其れから in a
    // dry run over her cards (2026-09-17).
    for (const entry of matching) {
      const usual = entry.words.find((w) => common.has(w));
      if (usual) return { kana, written: usual };
    }
    return { kana, written: matching[0].words[0] };
  }
  return null;
}

/** Her card text as tokens and the punctuation that separates them. */
export function tokenize(word) {
  const text = String(word)
    .normalize("NFKC")
    .replace(/[‘’`´]/g, "'")
    .replace(/…/g, " ");
  const out = [];
  for (const m of text.matchAll(/([a-zA-Z'-]+)|([?!.,/])/g)) {
    if (m[1]) out.push({ romaji: m[1].toLowerCase() });
    else out.push({ punct: m[2] });
  }
  return out;
}

const PUNCT = { "?": "？", "!": "！", ".": "。", ",": "、", "/": "、" };

/**
 * Hand overrides, keyed by her exact card text: cards that are several forms
 * of one word written side by side ("Fun Pun" is ふん and ぷん, not ふんぷん),
 * which nothing in the text marks. `import/word-sound-overrides.tsv`.
 */
export function parseOverrides(text) {
  const map = new Map();
  for (const line of text.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [word, engine] = line.split("\t");
    if (word && engine) map.set(word.trim(), engine.trim());
  }
  return map;
}

/**
 * The plan for one card, or null when nothing sensible can be said (no
 * letters at all). A deck or override plan carries its final `text`; a romaji
 * plan carries `parts` for `resolveText` to settle against the engine.
 *
 * `checkWith` is the Kanjium entry for the single-word case; the accent
 * itself is only known once VOICEVOX has answered, so `decideAccent`
 * finishes it.
 */
export function planCard(card, { wadoku, kanjium, overrides = new Map(), common = new Set() }) {
  // A card in Japanese script with a reading and one pitch from the deck (the
  // one Kaishi word without a recording, 失礼します): the deck's own pitch,
  // forced — the same authority the app draws its contour from.
  if (card.word_reading && /[぀-ヿ一-鿿]/.test(card.word)) {
    const pitches = String(card.word_pitch ?? "").split(",").filter(Boolean);
    const readings = card.word_reading.split("・");
    if (pitches.length === 1 && readings.length === 1) {
      return { text: card.word, forceAccent: Number(pitches[0]), checked: true };
    }
    return { text: card.word, checked: false };
  }

  const override = overrides.get(String(card.word).trim());
  if (override) return { text: override, checked: false };

  const tokens = tokenize(card.word);
  const words = tokens.filter((t) => t.romaji);
  if (!words.length) return null;
  const phrase = words.length > 1;

  const parts = tokens.map((t) => {
    if (t.punct) return { fixed: PUNCT[t.punct] ?? "" };
    const kana = kanaPreview(t.romaji);
    // A particle on a card of its own ("Wa", Thema-Partikel) is said as
    // written; inside a phrase it gets its usual spelling for the parser.
    if (phrase && PARTICLES.has(t.romaji)) return { fixed: PARTICLES.get(t.romaji), said: kana };
    const form = dictionaryForm(t.romaji, card.word_meaning, wadoku, common);
    return form ? { written: form.written, kana: form.kana } : { fixed: kana };
  });
  // The same card with every word as kana: what she said, and the fallback.
  const kanaText = parts.map((p) => p.fixed ?? p.kana).join("");
  // …and how that sounds: は as the particle is said わ.
  const saidText = parts.map((p) => p.said ?? p.fixed ?? p.kana).join("");
  const plan = { parts, kanaText, saidText, checked: false };
  const single = !phrase && parts.find((p) => p.written);
  if (single) {
    const accents = kanjium.get(`${single.written}\t${single.kana}`) ?? kanjium.get(`${single.kana}\t${single.kana}`);
    if (accents?.length) plan.checkWith = { written: single.written, kana: single.kana, accents };
  }
  return plan;
}

const VOWEL_OF = Object.fromEntries(
  [
    ["ア", "アカサタナハマヤラワガザダバパャ"],
    ["イ", "イキシチニヒミリギジヂビピ"],
    ["ウ", "ウクスツヌフムユルグズヅブプュ"],
    ["エ", "エケセテネヘメレゲゼデベペ"],
    ["オ", "オコソトノホモヨロヲゴゾドボポョ"],
  ].flatMap(([v, row]) => [...row].map((c) => [c, v])),
);

/**
 * Whether two kana strings are said the same: katakana, a long-vowel mark
 * spelled out as its vowel, and おう/えい folded the way VOICEVOX's moras
 * write them (キョオ for きょう, yet ホントウ for ほんとう — so both sides fold).
 */
export function sameSound(a, b) {
  const fold = (s) =>
    String(s)
      .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
      .replace(/[、。？！?!.,\s]/g, "")
      .replace(/(.)ー/g, (m, c) => c + (VOWEL_OF[c] ?? ""))
      .replace(/([オコソトノホモヨロゴゾドボポョ])ウ/g, "$1オ")
      .replace(/([エケセテネヘメレゲゼデベペ])イ/g, "$1エ")
      // いう is said ゆう (どういう → ドオユウ).
      .replace(/イウ/g, "ユウ");
  return fold(a) === fold(b);
}

/**
 * The text the engine gets. `readingOf(text)` is VOICEVOX's own reading of a
 * text, as mora text. A dictionary spelling is kept only when that reading is
 * her kana — Wadoku files いつ under 何時, which VOICEVOX reads なんじ, and
 * いい under 良い, read よい (both measured 2026-09-17). A plan from the deck
 * or an override already has its `text`.
 */
export async function resolveText(plan, readingOf) {
  if (plan.text) return plan;
  const out = [];
  let checkWith = plan.checkWith;
  for (const p of plan.parts) {
    if (!p.written) {
      out.push(p.fixed);
      continue;
    }
    if (sameSound(await readingOf(p.written), p.kana)) out.push(p.written);
    else {
      out.push(p.kana);
      // Kanjium's accent was looked up for the spelling just refused.
      if (checkWith?.written === p.written) checkWith = undefined;
    }
  }
  const tidy = (s) => s.replace(/^[、。]+|[、]+$/g, "");
  const text = tidy(out.join(""));
  // Each spelling was right on its own; in a phrase a reading can still
  // shift. The whole is checked once more, and a mismatch goes out as kana.
  if (text !== tidy(plan.kanaText) && !sameSound(await readingOf(text), plan.saidText)) {
    return { text: tidy(plan.kanaText), checked: false };
  }
  return { text, checked: false, ...(checkWith ? { checkWith } : {}) };
}

/**
 * Finish a plan against VOICEVOX's own reading of it (`accentPhrases` from
 * audio_query): whether the accent is vouched for, and the accent to force.
 *
 * Heiban (0) and odaka (the mora count) sound the same in an isolated word,
 * and VOICEVOX reports heiban as the mora count, so the two are one pattern
 * here — the same comparison the 87% measurement used.
 */
export function decideAccent(plan, accentPhrases) {
  if (plan.forceAccent !== undefined) {
    const phrase = accentPhrases.length === 1 ? accentPhrases[0] : null;
    if (!phrase || plan.forceAccent > phrase.moras.length) return { checked: false, accent: null };
    return { checked: plan.checked, accent: plan.forceAccent === 0 ? phrase.moras.length : plan.forceAccent };
  }
  if (!plan.checkWith || accentPhrases.length !== 1) {
    // One mora cannot be mis-accented in isolation: there is no contour.
    const oneMora = accentPhrases.length === 1 && accentPhrases[0].moras.length === 1;
    return { checked: Boolean(plan.checked) || oneMora, accent: null };
  }
  const n = accentPhrases[0].moras.length;
  const norm = (a) => (a === 0 ? n : a);
  const guess = norm(accentPhrases[0].accent);
  const known = plan.checkWith.accents.filter((a) => a <= n).map(norm);
  if (n === 1) return { checked: true, accent: null };
  if (known.includes(guess)) return { checked: true, accent: null };
  if (known.length === 1) return { checked: false, accent: known[0] };
  return { checked: false, accent: null };
}

/** File name: the card and a hash of what was said, so an edit gets a new file. */
export function wordSoundName(cardId, text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.codePointAt(i)) | 0;
  return `word-generated-${Math.abs(cardId)}-${(h >>> 0).toString(16).padStart(8, "0")}.mp3`;
}
