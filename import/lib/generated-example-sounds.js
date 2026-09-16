/**
 * Generated recordings for 92 kana-card example words that had none (#183,
 * gap (a)): 91 katakana loanwords and one hiragana adverb, all from the
 * JLPT lists, chosen by `lib/examples.js`'s own `pickExamples` before this —
 * this only gives the words it already picked a voice.
 *
 * Why a whole word is defensible here where it was not for the phone to
 * guess live (#183's core finding: an isolated word can carry the wrong
 * pitch accent, and nobody could hear that it was wrong): each pitch below
 * is not a guess. It is the mora `pyopenjtalk`'s own accent dictionary and
 * Kanjium's (124,137 words, CC BY-SA 4.0, mifunetoshiro/kanjium) *agree* on,
 * checked against all 99 candidates. 92 passed; the other 7 did not (2 are
 * compounds whose accent-phrase chaining was not attempted, 5 are missing
 * from Kanjium) and are left as silent, JLPT-only examples, unchanged.
 *
 * Generated once through the same local VOICEVOX as the yōon
 * (`lib/kana-yoon-sounds.js`), speaker "No.7" — but the accent is forced to
 * the value below rather than left to VOICEVOX's own guess, because a guess
 * is exactly what this table exists to avoid. One utterance, not three: this
 * is an ordinary word recording, like Kaishi's or Lingua Libre's, not a kana
 * sound played back as the answer itself.
 */

import { exampleSoundName } from "./example-sounds.js";

export const VOICEVOX_SPEAKER = 30; // No.7, アナウンス
export const VOICEVOX_CREDIT = "VOICEVOX:No.7";

// [reading, pitch] - reading is also the written form (a kana loanword has
// no separate kanji spelling); pitch is the mora the accent drops after, 0
// for a word that never drops - same convention as the app's own word_pitch.
const ROWS = [
  ["ぴったり", 3],
  ["アパート", 2],
  ["アクセサリー", 1],
  ["インク", 0],
  ["ウイスキー", 2],
  ["エレベーター", 3],
  ["エスカレーター", 4],
  ["エネルギー", 2],
  ["オートバイ", 3],
  ["ガソリン", 0],
  ["キロ", 1],
  ["キャプテン", 1],
  ["キャンプ", 1],
  ["クラス", 1],
  ["クラシック", 3],
  ["グランド", 0],
  ["ケーキ", 1],
  ["ケース", 1],
  ["ゲーム", 1],
  ["コート", 1],
  ["ゴール", 1],
  ["サラダ", 1],
  ["サンダル", 0],
  ["サンドイッチ", 4],
  ["シャワー", 1],
  ["ジーンズ", 1],
  ["ジャム", 1],
  ["ジュース", 1],
  ["スカート", 2],
  ["ストーブ", 2],
  ["スプーン", 2],
  ["ズボン", 1],
  ["セーター", 1],
  ["セット", 1],
  ["ゼロ", 1],
  ["ソフト", 1],
  ["ソファー", 1],
  ["ダイヤ", 1],
  ["ダンス", 1],
  ["チーズ", 1],
  ["チーム", 1],
  ["チャンス", 1],
  ["デパート", 2],
  ["デート", 1],
  ["デモ", 1],
  ["トップ", 1],
  ["ドア", 1],
  ["ドライブ", 2],
  ["ドラマ", 1],
  ["ナイフ", 1],
  ["ニュース", 1],
  ["ネクタイ", 1],
  ["ノート", 1],
  ["ノック", 1],
  ["ハンカチ", 0],
  ["ハンドバッグ", 4],
  ["ハイキング", 1],
  ["バス", 1],
  ["バター", 1],
  ["バイオリン", 0],
  ["パーティー", 1],
  ["パート", 1],
  ["ビル", 1],
  ["ビール", 1],
  ["ピクニック", 1],
  ["ピン", 1],
  ["フィルム", 1],
  ["フォーク", 1],
  ["ブレーキ", 2],
  ["プール", 1],
  ["プレゼント", 2],
  ["ベッド", 1],
  ["ベル", 1],
  ["ベルト", 0],
  ["ペン", 1],
  ["ホーム", 1],
  ["ボールペン", 0],
  ["ボーイ", 0],
  ["ポケット", 2],
  ["ポスト", 1],
  ["マッチ", 1],
  ["マーケット", 1],
  ["マイク", 1],
  ["ミス", 1],
  ["ミルク", 1],
  ["メモ", 1],
  ["ユーモア", 1],
  ["ヨット", 1],
  ["ラジオ", 1],
  ["リポート", 2],
  ["ロケット", 2],
  ["ワープロ", 0],
];

/**
 * `exampleSoundName` (example-sounds.js) names a file after `sound.hash`,
 * the source file's own sha1 for a downloaded recording. There is no source
 * file here, so this stands in: a hash of the reading, long enough that 92
 * words do not collide (checked in kana-yoon-sounds.test.js's sibling test).
 */
function nameHash(reading) {
  let h = 0;
  for (let i = 0; i < reading.length; i++) h = (Math.imul(h, 31) + reading.codePointAt(i)) | 0;
  return (h >>> 0).toString(16).padStart(8, "0");
}

export const GENERATED_EXAMPLE_SOUNDS = ROWS.map(([reading, pitch]) => ({
  source: "generated",
  written: reading,
  reading,
  pitch,
  hash: nameHash(reading),
}));

export const generatedExampleSoundName = (sound) => exampleSoundName(sound);

/**
 * The audio_query for one word, with VOICEVOX's own accent guess overridden
 * by the pitch this table pins (`sound.pitch`) — the guess is exactly what
 * this table exists to avoid. Refuses rather than mis-forces anything: a word
 * VOICEVOX splits into more than one accent phrase, or a pitch outside its
 * own mora count, means the assumption behind "one accent phrase, one
 * override" does not hold for this word.
 */
export async function generatedAudioQuery(sound, voicevoxUrl) {
  const url = `${voicevoxUrl}/audio_query?text=${encodeURIComponent(sound.reading)}&speaker=${VOICEVOX_SPEAKER}`;
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) throw new Error(`VOICEVOX audio_query for ${sound.reading}: HTTP ${res.status} (${url})`);
  const query = await res.json();
  if (query.accent_phrases.length !== 1) {
    throw new Error(`${sound.reading}: VOICEVOX reads this as ${query.accent_phrases.length} accent phrases, not 1`);
  }
  const moraCount = query.accent_phrases[0].moras.length;
  if (sound.pitch < 0 || sound.pitch > moraCount) {
    throw new Error(`${sound.reading}: pitch ${sound.pitch} is out of range for its ${moraCount} moras`);
  }
  query.accent_phrases[0].accent = sound.pitch;
  return query;
}

/** The synthesised WAV for an audio_query, as a Buffer. */
export async function generatedSynthesize(query, voicevoxUrl) {
  const url = `${voicevoxUrl}/synthesis?speaker=${VOICEVOX_SPEAKER}`;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(query) });
  if (!res.ok) throw new Error(`VOICEVOX synthesis: HTTP ${res.status} (${url})`);
  return Buffer.from(await res.arrayBuffer());
}
