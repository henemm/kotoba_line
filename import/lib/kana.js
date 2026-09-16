/**
 * The kana decks (#158): hiragana and katakana, one card per sound.
 *
 * Fact data, not a downloaded deck: the gojūon table and its Hepburn readings
 * are the same in every textbook, so they are written out here rather than
 * taken from anyone's flashcards — and nothing here is generated (no
 * mnemonics: the good ones are Tofugu's and copyrighted, and invented ones are
 * ruled out).
 *
 * The order is the order they are taught, and it is the new-card order
 * (`frequency_rank`): the basic rows a i u e o, ka ki ku ke ko … n, then the
 * same rows with dakuten and handakuten (が, ぱ), then the yōon (きゃ). With a
 * deck's "New cards per day" at 5 that is one row a day.
 *
 * Left out on purpose: a lone small っ or ゃ (no sound of its own; they are
 * taught inside the words and yōon that use them), ゐ and ゑ (obsolete), and
 * ぢゃ-style yōon (not in modern use).
 */

const BASIC = [
  ["あ", "a"], ["い", "i"], ["う", "u"], ["え", "e"], ["お", "o"],
  ["か", "ka"], ["き", "ki"], ["く", "ku"], ["け", "ke"], ["こ", "ko"],
  ["さ", "sa"], ["し", "shi"], ["す", "su"], ["せ", "se"], ["そ", "so"],
  ["た", "ta"], ["ち", "chi"], ["つ", "tsu"], ["て", "te"], ["と", "to"],
  ["な", "na"], ["に", "ni"], ["ぬ", "nu"], ["ね", "ne"], ["の", "no"],
  ["は", "ha"], ["ひ", "hi"], ["ふ", "fu"], ["へ", "he"], ["ほ", "ho"],
  ["ま", "ma"], ["み", "mi"], ["む", "mu"], ["め", "me"], ["も", "mo"],
  ["や", "ya"], ["ゆ", "yu"], ["よ", "yo"],
  ["ら", "ra"], ["り", "ri"], ["る", "ru"], ["れ", "re"], ["ろ", "ro"],
  // を is taught as "wo": pronounced o, and written apart from お so the two
  // are not the same answer.
  ["わ", "wa"], ["を", "wo"], ["ん", "n"],
];

// ぢ and づ sound like じ and ず, and Hepburn writes them the same way. A wrong
// answer never carries the right answer's reading (client/src/deck.js), so
// じ is never offered against ぢ as if it were wrong.
const DAKUTEN = [
  ["が", "ga"], ["ぎ", "gi"], ["ぐ", "gu"], ["げ", "ge"], ["ご", "go"],
  ["ざ", "za"], ["じ", "ji"], ["ず", "zu"], ["ぜ", "ze"], ["ぞ", "zo"],
  ["だ", "da"], ["ぢ", "ji"], ["づ", "zu"], ["で", "de"], ["ど", "do"],
  ["ば", "ba"], ["び", "bi"], ["ぶ", "bu"], ["べ", "be"], ["ぼ", "bo"],
  ["ぱ", "pa"], ["ぴ", "pi"], ["ぷ", "pu"], ["ぺ", "pe"], ["ぽ", "po"],
];

export const YOON = [
  ["きゃ", "kya"], ["きゅ", "kyu"], ["きょ", "kyo"],
  ["しゃ", "sha"], ["しゅ", "shu"], ["しょ", "sho"],
  ["ちゃ", "cha"], ["ちゅ", "chu"], ["ちょ", "cho"],
  ["にゃ", "nya"], ["にゅ", "nyu"], ["にょ", "nyo"],
  ["ひゃ", "hya"], ["ひゅ", "hyu"], ["ひょ", "hyo"],
  ["みゃ", "mya"], ["みゅ", "myu"], ["みょ", "myo"],
  ["りゃ", "rya"], ["りゅ", "ryu"], ["りょ", "ryo"],
  ["ぎゃ", "gya"], ["ぎゅ", "gyu"], ["ぎょ", "gyo"],
  ["じゃ", "ja"], ["じゅ", "ju"], ["じょ", "jo"],
  ["びゃ", "bya"], ["びゅ", "byu"], ["びょ", "byo"],
  ["ぴゃ", "pya"], ["ぴゅ", "pyu"], ["ぴょ", "pyo"],
];

/** Hiragana to katakana: the two blocks sit 0x60 apart, character for character. */
export const toKatakana = (text) =>
  [...text].map((c) => String.fromCodePoint(c.codePointAt(0) + 0x60)).join("");

/** Katakana to hiragana, character for character; a hiragana input is unchanged. */
export const toHiragana = (text) =>
  [...text].map((c) => (c >= "ァ" && c <= "ヶ" ? String.fromCodePoint(c.codePointAt(0) - 0x60) : c)).join("");

/**
 * A kana card's id, from its characters (#158; rule 4 in CLAUDE.md).
 *
 * 10,000,000 plus each character's place in the kana block: the first ×1000,
 * a small ゃゅょ as the last three digits. Hiragana あ is 10,066,000, katakana
 * ア 10,162,000, きゃ 10,077,131. Derived rather than numbered in order, so
 * adding a card never moves another one's id — review_events points at it.
 *
 * Why this range: Kaishi's ids are Anki note ids, epoch milliseconds (1.7
 * trillion in the live deck); her own cards are negative; test fixtures use
 * 1 to a few hundred. 10,000,000–10,255,255 is none of those.
 */
export function kanaId(kana) {
  const [first, second] = [...kana].map((c) => c.codePointAt(0) - 0x3000);
  return 10_000_000 + first * 1000 + (second ?? 0);
}

/** The file KanjiVG draws a character in: its code point, five hex digits. */
export const strokeFile = (char) => `${char.codePointAt(0).toString(16).padStart(5, "0")}.svg`;

/**
 * Every card of both decks, as rows for `cards`. `word` is the kana,
 * `word_reading` the same kana (書く and the romaji line read it), and
 * `word_meaning` the Hepburn reading — what 選ぶ offers as the answer.
 */
export function kanaCards() {
  const table = [...BASIC, ...DAKUTEN, ...YOON];
  return ["hiragana", "katakana"].flatMap((deck) =>
    table.map(([hiragana, romaji], i) => {
      const kana = deck === "hiragana" ? hiragana : toKatakana(hiragana);
      return {
        id: kanaId(kana),
        word: kana,
        word_reading: kana,
        word_meaning: romaji,
        frequency_rank: i + 1,
        deck,
      };
    }),
  );
}

/** The distinct characters the stroke-order drawings are needed for. */
export function strokeCharacters() {
  return [...new Set(kanaCards().flatMap((c) => [...c.word]))];
}
