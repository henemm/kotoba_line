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
 * `kaishi` are Kaishi cards (their reading already worked out), most common
 * first; `jlpt` are JLPT rows in N5, N4, N3 order. A hiragana card looks at
 * readings in hiragana, a katakana card at readings in katakana, so テレビ is
 * never an example for て.
 */
export function pickExamples(card, { kaishi = [], jlpt = [], meaningOf }, count = 2) {
  const kana = card.word;
  const chosen = [];
  const seen = new Set();
  const take = (reading, meaning, source) => {
    if (chosen.length >= count || !meaning || seen.has(reading) || !startsWithSound(reading, kana)) return;
    seen.add(reading);
    chosen.push({ kana: reading, meaning, source });
  };
  for (const k of kaishi) take(k.reading, k.meaning, "kaishi");
  for (const row of jlpt) {
    if (chosen.length >= count) break;
    if (!startsWithSound(row.reading, kana)) continue;
    take(row.reading, meaningOf(row), `jlpt-n${row.level}`);
  }
  return chosen;
}
