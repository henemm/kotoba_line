/**
 * Example words for the kana decks (#158, v78).
 *
 * Up to two words per kana card, each a word she could meet that starts with
 * the kana, read in kana, with a short meaning. From two human-made sources and
 * nothing else — no word or meaning here is generated:
 *
 * 1. Kaishi, the deck she has, most common first.
 * 2. The JLPT vocabulary lists by Jonathan Waller (tanos.co.uk, CC BY), N5
 *    before N4 before N3: lists made for beginners. They exist because Kaishi
 *    has almost no katakana words — 3 of 104 katakana cards had an example;
 *    with the lists, 62 (measured 2026-09-15). Their meaning is the first sense
 *    of the word's entry in JMdict (EDRDG, CC BY-SA 4.0), which lists the most
 *    common sense first.
 *
 * English for now, like Kaishi's glosses; German comes with #134.
 */

const SMALL_YOON = /[ゃゅょャュョ]/;

/**
 * Whether a word, read in kana, can stand for this kana's sound.
 *
 * Only at the start. Inside a word a kana is often not its own sound: う in
 * きょう is the long ō, い in せんせい the long ē. At the start it is — except
 * before a small ゃゅょ, which makes it a yōon (き in きょう is きょ). ん never
 * starts a word, so it is the one kana matched anywhere.
 */
export function startsWithSound(reading, kana) {
  if (!reading || !kana) return false;
  if (kana === "ん" || kana === "ン") return reading.includes(kana);
  return reading.startsWith(kana) && !SMALL_YOON.test(reading[kana.length] ?? "");
}

/** The JLPT CSV as rows: `Kanji,Reading` — the word as written, and its reading. */
export function parseJlptCsv(text, level) {
  return text
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.split(","))
    .filter((cols) => cols.length >= 2 && cols[0] && cols[1])
    .map(([written, reading]) => ({ written: written.trim(), reading: reading.trim(), level }));
}

const toHiragana = (text) => text.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/** The vowel a kana ends on, in hiragana — enough to see a long vowel coming. */
const VOWEL = new Map(
  Object.entries({
    a: "あかさたなはまやらわがざだばぱぁゃ",
    i: "いきしちにひみりぎじぢびぴぃ",
    u: "うくすつぬふむゆるぐずづぶぷぅゅ",
    e: "えけせてねへめれげぜでべぺぇ",
    o: "おこそとのほもよろをごぞどぼぽぉょ",
  }).flatMap(([vowel, chars]) => [...chars].map((c) => [c, vowel])),
);

/**
 * Where in a word, read in kana, this kana is heard as its own sound — the
 * index, or -1 (v83, #158).
 *
 * The start of the word first: there a kana is always its own sound, unless a
 * small ゃゅょ follows and makes it a yōon (き in きょう is きょ). Henning
 * asked why an example has to *start* with the kana rather than contain it;
 * for a word she can hear, it does not — so a later place counts too, except
 * where the kana is not heard as itself:
 *
 *   a vowel after itself   the long vowel: まあ, おおきい, おねえさん, くうき
 *   う after an o          the long ō: そう, きょう
 *   い after an e          the long ē: せんせい, えいが
 *   す at the very end     whispered away: です, ます
 *   は at the very end     the particle, said wa: じつは, では
 *   う in いう             said ゆう
 *
 * Whispered vowels elsewhere (the し in そして, the く in きく) stay: the
 * consonant is still there to hear, and a sound that changes with its
 * neighbours is what Henning found worth hearing.
 */
export function soundAt(reading, kana) {
  if (!reading || !kana) return -1;
  // Matched in the card's own script — a katakana card is practice in reading
  // katakana, so ハ is never shown in はな — and folded to hiragana only to
  // look up the vowel before it.
  const word = toHiragana(reading);
  const sound = toHiragana(kana);
  for (let i = reading.indexOf(kana); i !== -1; i = reading.indexOf(kana, i + 1)) {
    if (SMALL_YOON.test(word[i + sound.length] ?? "")) continue;
    if (i === 0 || sound.length > 1) return i;
    const before = VOWEL.get(word[i - 1]);
    const own = { あ: "a", い: "i", う: "u", え: "e", お: "o" }[sound];
    if (own && before === own) continue;
    if (sound === "う" && before === "o") continue;
    if (sound === "い" && before === "e") continue;
    if ((sound === "す" || sound === "は") && i === word.length - 1) continue;
    if (sound === "う" && word === "いう") continue;
    return i;
  }
  return -1;
}

/**
 * Words the lists offer whose first JMdict sense would teach the wrong thing.
 * Reviewed by hand over every example the import chose (2026-09-15): the list
 * is the exception, not a place to tune taste.
 */
const SKIP = new Map([
  // JMdict's first sense is the plaid pattern; the word she will meet is "to check".
  ["チェック", "first sense is check (pattern), plaid"],
]);

/**
 * One gloss, short enough for a line on a card: an explanation in brackets
 * that lists or qualifies — "cup (drinking vessel, measure, brassiere, prize,
 * etc.)", "restaurant (esp. Western-style)" — is dropped; a bracket that is
 * part of the meaning, "(swimming) pool" or "match (for lighting a fire)",
 * stays.
 */
export function shortGloss(text) {
  return text
    .replace(/\s*\(([^()]*)\)/g, (whole, inner) => (/,|\betc\b|\besp\.|\be\.g\.|\bspp\./.test(inner) ? "" : whole))
    .trim();
}

/**
 * A word's meaning from JMdict (jmdict-simplified's JSON): the first gloss of
 * the first sense of the entry written and read this way — the second gloss
 * was mostly a spelling ("hospitalization, hospitalisation"). An entry written
 * in kanji has to match the kanji too, so 橋 "bridge" is not given 箸's
 * "chopsticks". Where several entries match, a common one first, then the
 * dictionary's own order. Undefined where nothing matches — then the word is
 * not used, rather than shown with a guess.
 */
export function makeMeaningLookup(jmdictWords) {
  const byReading = new Map();
  for (const w of jmdictWords) {
    for (const k of w.kana) {
      if (!byReading.has(k.text)) byReading.set(k.text, []);
      byReading.get(k.text).push(w);
    }
  }
  return ({ written, reading }) => {
    if (SKIP.has(written)) return undefined;
    const kanaOnly = written === reading;
    const matches = (byReading.get(reading) ?? []).filter((w) =>
      kanaOnly ? true : w.kanji.some((k) => k.text === written),
    );
    const common = (w) => w.kana.some((k) => k.text === reading && k.common) || w.kanji.some((k) => k.common);
    const best = matches.find(common) ?? matches[0];
    const first = best?.sense?.[0]?.gloss?.[0]?.text;
    return first ? shortGloss(first) || undefined : undefined;
  };
}

/**
 * The examples for one kana card.
 *
 * `kaishi` are Kaishi cards (their reading already worked out, and `audio`,
 * the file of the card's own recording, where it has one), most common first;
 * `jlpt` are JLPT rows in N5, N4, N3 order. A hiragana card looks at readings
 * in hiragana, a katakana card at readings in katakana, so テレビ is never an
 * example for て.
 *
 * v83: a word she can hear comes first (Henning: "gibt es dieses Wort
 * nirgendwo von einem Muttersprachler gesprochen?" — for hiragana it was
 * already on the server, unplayed), and the sound in the middle of a word
 * counts too (Henning: two or three of those "could be very revealing, just
 * because it sounds different"). Up to three, in this order:
 *
 *   1. a Kaishi word with a recording that starts with the kana
 *   2. up to two Kaishi words with a recording that have it later (`soundAt`)
 *   3. more recorded words that start with it
 *   4. any other word that starts with it, Kaishi before the lists — as v78
 *
 * A word without a recording still has to start with the kana: a silent word
 * with the sound somewhere inside shows less than one that begins with it.
 * `at` is where the sound is, so the card can mark it.
 */
export function pickExamples(card, { kaishi = [], jlpt = [], meaningOf }, count = 3) {
  const kana = card.word;
  const candidates = [];
  let starts = 0;
  let middles = 0;
  kaishi.forEach((k, order) => {
    // A reading that is two readings (なに・なん) is not one word to read.
    if (/[・/]/.test(k.reading ?? "")) return;
    const at = soundAt(k.reading, kana);
    if (at === -1 || !k.meaning) return;
    const entry = { order, kana: k.reading, meaning: k.meaning, source: "kaishi", at };
    if (k.audio && at === 0) candidates.push({ ...entry, audio: k.audio, rank: starts++ === 0 ? 0 : 2 });
    else if (k.audio) candidates.push({ ...entry, audio: k.audio, rank: middles++ < 2 ? 1 : 2 });
    else if (startsWithSound(k.reading, kana)) candidates.push({ ...entry, rank: 3 });
  });
  jlpt.forEach((row, order) => {
    if (!startsWithSound(row.reading, kana)) return;
    candidates.push({ rank: 4, order, row, kana: row.reading, source: `jlpt-n${row.level}`, at: row.reading.indexOf(kana) });
  });
  candidates.sort((a, b) => a.rank - b.rank || a.order - b.order);

  const chosen = [];
  const seen = new Set();
  for (const c of candidates) {
    if (chosen.length >= count) break;
    if (seen.has(c.kana)) continue;
    // Looked up only for a list word that would be taken: JMdict is large.
    const meaning = c.row ? meaningOf(c.row) : c.meaning;
    if (!meaning) continue;
    seen.add(c.kana);
    chosen.push({ kana: c.kana, meaning, source: c.source, ...(c.audio ? { audio: c.audio } : {}), at: c.at });
  }
  return chosen;
}
