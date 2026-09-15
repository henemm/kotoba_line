/**
 * Recordings for kana example words that Kaishi has no recording of (#158, v87).
 *
 * Kaishi recorded almost no katakana words, and v83 lets a word with the sound
 * *inside* it be an example only when she can hear it — so katakana cards had
 * 5 of 104 recorded examples, 3 with the sound inside. These are native
 * speakers' recordings of words from the JLPT lists, from two free sources:
 *
 * - **Lingua Libre** (Wikimedia Commons, CC BY-SA 4.0), only speakers who state
 *   Japanese as their native language on their Wikimedia user pages: 葵心
 *   (ja-N, from Kanagawa) and Higa4 (ja, lives in Japan). Most of Lingua
 *   Libre's Japanese is by learners — CKali's 531 files are self-declared ja-2 —
 *   and those are left out on purpose: a learner saying a whole word teaches
 *   its pronunciation, the reason the app will not let the phone's voice read
 *   one either. Zsrtrgh and LaKoalita state nothing and are left out too.
 * - **Tofugu and WaniKani**'s vocabulary audio (github.com/tofugu/
 *   japanese-vocabulary-pronunciation-audio, CC BY-SA 4.0), which its README
 *   gives as two native voices: a male professional with a Tokyo accent and a
 *   female amateur with a Kansai accent. Its readings are hiragana, so it only
 *   helps hiragana cards — mostly the yōon (ぎゅ in ぎゅうにゅう).
 *
 * Measured against production with these (2026-09-15): katakana 37 of 104
 * cards with a recorded example (23 with the sound inside), hiragana 96 (91).
 *
 * **Which words.** A recorded word may come from any JLPT level, N5 to N1; a
 * silent one stays N5–N3 (lib/examples.js). Hearing the sound in a word is
 * what the example is for, so a recorded N2 word is worth more than a silent
 * N5 one. The rows are the recordings the import's own `pickExamples` chose
 * from every usable one, not every recording there is.
 *
 * **Order is preference.** The import offers the rows in this order after
 * Kaishi's, so an earlier row wins a place on a card. Lingua Libre and
 * Tofugu's lower voice come first, then Tofugu's higher voice; each group runs
 * N5 → N1. The voice is not labelled anywhere, so it was told apart by pitch:
 * the median fundamental frequency (last column, Hz) of each file's voiced
 * frames, decoded in Chromium. It splits cleanly — 14 Tofugu candidates at
 * 120–160 Hz, 71 at 200–300 — and anything above 165 is ranked as the Kansai
 * voice. Henning (2026-09-15): some Osaka accent is "nicht soooo schlimm", so
 * the Tokyo voice is a preference, not a filter; it changed the examples on 4
 * cards. Of the 34 Tofugu rows, 9 are the Tokyo voice.
 *
 * **Loudness.** Levelled like the kana sounds (lib/kana-sounds.js): steps =
 * round(20·log10(0.112 / active level) / 1.5), one step less while the loudest
 * sample would pass 0.98. Before: 0.034–0.206, 15.6 dB apart. After, decoded
 * again: 0.099–0.122 (1.8 dB) in both Chromium and WebKit, loudest sample
 * 0.97, durations unchanged.
 *
 * Each row: source, the word as written, its reading, the file, its hash, the
 * gain steps, and for Tofugu the measured pitch. The hash is Commons' sha1 of
 * the original for Lingua Libre (the audio fetched is Wikimedia's MP3
 * transcode of it) and the git blob sha at TOFUGU_COMMIT for Tofugu; the import
 * stops on any other file, because the steps were measured on these.
 */

export const TOFUGU_COMMIT = "9725e0e7d628ab616e8b14e126d3daa33eba8d36";

const ROWS = [
  ["tofugu", "牛肉", "ぎゅうにく", "lib/mp3/牛肉【ぎゅうにく】.mp3", "193f9ee2d5e66d385a6be4ef18083d7dcdf44781", 3, 134],
  ["lingualibre", "トイレ", "トイレ", "LL-Q5287 (jpn)-葵心-トイレ.wav", "5619e6cf08f8c1dff582780f3cfebb36495e7177", 2],
  ["lingualibre", "カメラ", "カメラ", "LL-Q5287 (jpn)-葵心-カメラ.wav", "94b207ce937656059771321f3fac54b77a63fbd3", 3],
  ["lingualibre", "カレー", "カレー", "LL-Q5287 (jpn)-葵心-カレー.wav", "179ec479bec531121ab114ec26d9d43b3380f484", -3],
  ["lingualibre", "コップ", "コップ", "LL-Q5287 (jpn)-葵心-コップ.wav", "0aca87dec0b64a8eacdf8da77cbc5488b7917c3f", -1],
  ["lingualibre", "ギター", "ギター", "LL-Q5287 (jpn)-葵心-ギター.wav", "888c2baf56372e6366c3934d73323b0bf2e5a8af", 7],
  ["lingualibre", "ボタン", "ボタン", "LL-Q5287 (jpn)-葵心-ボタン.wav", "c8b113560a504a2ca4dd656792ed8f75a9909750", 2],
  ["lingualibre", "シャツ", "シャツ", "LL-Q5287 (jpn)-葵心-シャツ.wav", "edf598b0d47bc5a19412cb534ce17912ef54bb10", 4],
  ["lingualibre", "ホテル", "ホテル", "LL-Q5287 (jpn)-Higa4-ホテル.wav", "92dc3b3c0dec3bf67c6f72ddc24b2cd76412d434", 6],
  ["lingualibre", "ペット", "ペット", "LL-Q5287 (jpn)-葵心-ペット.wav", "e95bd93fef387d0d11f0615a03fff2ba09e404e5", 1],
  ["lingualibre", "ページ", "ページ", "LL-Q5287 (jpn)-葵心-ページ.wav", "f1f8ba19d2b6d868a8ac037329efd0d3857a96f7", -2],
  ["tofugu", "文法", "ぶんぽう", "lib/mp3/文法【ぶんぽう】.mp3", "dbf4ca17915ddde3f6db74b586198217de06766f", 4, 155],
  ["tofugu", "入学", "にゅうがく", "lib/mp3/入学【にゅうがく】.mp3", "dd32e4badac045e72bc84fcd9fe97f99c8512636", 4, 124],
  ["lingualibre", "神社", "じんじゃ", "LL-Q5287 (jpn)-葵心-神社.wav", "88ee9df88c49245db37d532bf5734b43941f85ed", 3],
  ["lingualibre", "ピアノ", "ピアノ", "LL-Q5287 (jpn)-葵心-ピアノ.wav", "f532db6098e48403f09ae6a11d5a2704d5227a88", 5],
  // 葵心 also recorded コンピュータ, the same word; one spelling is enough.
  ["lingualibre", "コンピューター", "コンピューター", "LL-Q5287 (jpn)-葵心-コンピューター.wav", "9a234d715d467dc12b45550b496f5301ff4e99b2", 3],
  ["tofugu", "男の人", "おとこのひと", "lib/mp3/男の人【おとこのひと】.mp3", "57fe8616c5d2f27c7c434b4bc71991a51cbb155a", 4, 150],
  ["tofugu", "流行", "りゅうこう", "lib/mp3/流行【りゅうこう】.mp3", "8b9d82ccdc103d03c8c1706da1a488a22aeb4ac4", 0, 123],
  ["tofugu", "秒", "びょう", "lib/mp3/秒【びょう】.mp3", "6b84c604fcaad204e8d90c0ce5162349d9edbb74", 1, 131],
  ["lingualibre", "ワイン", "ワイン", "LL-Q5287 (jpn)-葵心-ワイン.wav", "18c03fa28eff07c23a050f4e283a819f22810dbb", -4],
  ["lingualibre", "オフィス", "オフィス", "LL-Q5287 (jpn)-葵心-オフィス.wav", "76ee3bef54d5a4493afbd3e2ec1e5c6ab6de76f2", 2],
  ["lingualibre", "クリーム", "クリーム", "LL-Q5287 (jpn)-葵心-クリーム.wav", "189db776216ac3cc2c36b67728f4eeb2f0241d30", -3],
  ["lingualibre", "グラス", "グラス", "LL-Q5287 (jpn)-葵心-グラス.wav", "7206e7eb2cc2364473156a77bdf62a6b2f64c408", 4],
  ["tofugu", "近々", "ちかぢか", "lib/mp3/近々【ちかぢか】.mp3", "6de58ed3670a4b6a2aa92cf5303022cae4ba4b77", 4, 151],
  ["tofugu", "一流", "いちりゅう", "lib/mp3/一流【いちりゅう】.mp3", "5c19c167f0613998145b7546104753caaa0968fd", 2, 128],
  ["lingualibre", "片仮名", "カタカナ", "LL-Q5287 (jpn)-葵心-片仮名.wav", "fd6c18bc723d4a9eb24197ef7f010847b8156a25", 3],
  ["lingualibre", "テンポ", "テンポ", "LL-Q5287 (jpn)-葵心-テンポ.wav", "636ad1634342ba671b0d26cf0b7a07e22441a5b0", 0],
  ["lingualibre", "ガム", "ガム", "LL-Q5287 (jpn)-葵心-ガム.wav", "ab1f753280ef16262d0e5ba9e52cdfb133074a44", -2],
  ["lingualibre", "レジャー", "レジャー", "LL-Q5287 (jpn)-葵心-レジャー.wav", "7d97b8b36a57566f8b274ce327e3d9b29273a61e", 2],
  ["tofugu", "根本", "こんぽん", "lib/mp3/根本【こんぽん】.mp3", "99993d0ff83d3c11f2f7b2faca9f8efa1f0e92fd", 2, 122],
  ["lingualibre", "オレンジ", "オレンジ", "LL-Q5287 (jpn)-葵心-オレンジ.wav", "7ecc2b9ba16f080f2ac9d77dde6dbd19d20cbd32", 3],
  ["lingualibre", "ナンセンス", "ナンセンス", "LL-Q5287 (jpn)-葵心-ナンセンス.wav", "12bc4cf589cac9919f1ae52890b3284dbd7b8a64", 4],
  // Tofugu's higher voice, the Kansai one.
  ["tofugu", "万年筆", "まんねんひつ", "lib/mp3/万年筆【まんねんひつ】.mp3", "cfeecde2e9df23ca7e0e6c2c8e3c3f0b54b810bf", 4, 261],
  ["tofugu", "鉛筆", "えんぴつ", "lib/mp3/鉛筆【えんぴつ】.mp3", "dccdb6313f6e5a81f331ab5fa9720294012c52eb", 3, 274],
  ["tofugu", "切符", "きっぷ", "lib/mp3/切符【きっぷ】.mp3", "750082d87cd9cb3134d46c063e89c4eafd30b92f", 6, 238],
  ["tofugu", "牛乳", "ぎゅうにゅう", "lib/mp3/牛乳【ぎゅうにゅう】.mp3", "cfa9c2bba7a3ebf58ef1f17f970476b6786528fa", -1, 236],
  ["tofugu", "百", "ひゃく", "lib/mp3/百【ひゃく】.mp3", "aa011f25ec8e5be4bf44c2faf096e18f73c1ff89", 5, 198],
  ["tofugu", "留学生", "りゅうがくせい", "lib/mp3/留学生【りゅうがくせい】.mp3", "8ed8d467ada116fea550857b122349866922c027", 4, 222],
  ["tofugu", "留守", "るす", "lib/mp3/留守【るす】.mp3", "27ae9f44874cf87948af34100538e450ae751d1c", 5, 208],
  ["tofugu", "輸入", "ゆにゅう", "lib/mp3/輸入【ゆにゅう】.mp3", "d2cac9f01d5a9049dffe85e4d80f90a2f7adbb1c", -1, 256],
  ["tofugu", "増加", "ぞうか", "lib/mp3/増加【ぞうか】.mp3", "35f6cf84764ebe929a8724846c777445f8b7eb61", 5, 217],
  ["tofugu", "観客", "かんきゃく", "lib/mp3/観客【かんきゃく】.mp3", "b9cecee3cf85c7dbf9d2b46e4fad98e0ea52c840", 4, 251],
  ["tofugu", "奇妙", "きみょう", "lib/mp3/奇妙【きみょう】.mp3", "a5c766b825e0ec93fadaac9e3744e3b5faf01543", 4, 224],
  ["tofugu", "発表", "はっぴょう", "lib/mp3/発表【はっぴょう】.mp3", "06bff56c190d5d3f2c99c3076427f29c68f15455", 4, 256],
  ["tofugu", "破片", "はへん", "lib/mp3/破片【はへん】.mp3", "c41492c620aac6ea8d44a3430b340f456d9b0220", 4, 228],
  ["tofugu", "執筆", "しっぴつ", "lib/mp3/執筆【しっぴつ】.mp3", "11450853a9520a18b357fd714cb4b6a0df0d6b28", 6, 225],
  ["tofugu", "扇風機", "せんぷうき", "lib/mp3/扇風機【せんぷうき】.mp3", "a3d0824655f99b50f6890904084001b7e762f8df", 2, 255],
  ["tofugu", "略す", "りゃくす", "lib/mp3/略す【りゃくす】.mp3", "f81a782b65f7a31a57d640736a1f25a94ab3f25b", 5, 266],
  ["tofugu", "省略", "しょうりゃく", "lib/mp3/省略【しょうりゃく】.mp3", "6b78fca2fe7f7960163ef316b10ba6b3531b37e2", 5, 238],
  ["tofugu", "漁業", "ぎょぎょう", "lib/mp3/漁業【ぎょぎょう】.mp3", "e1671faa1ef5a7dac3874626eb396c0f04c5cb34", 3, 249],
  ["tofugu", "縮まる", "ちぢまる", "lib/mp3/縮まる【ちぢまる】.mp3", "9fbc3e22f5a0feaca1bdc5a114b08086f02860d8", 2, 249],
  ["tofugu", "一遍", "いっぺん", "lib/mp3/一遍【いっぺん】.mp3", "158ffe3aaa180ed505a594d0119f6f1c527e364e", 3, 276],
  ["tofugu", "脚本", "きゃくほん", "lib/mp3/脚本【きゃくほん】.mp3", "32dabfc6c44e2af5847d09e93a7b59095fae3118", 4, 296],
  ["tofugu", "尿", "にょう", "lib/mp3/尿【にょう】.mp3", "4521dc80f8a8627a6687ee8e0fc3f9460be05589", 3, 281],
  ["tofugu", "土俵", "どひょう", "lib/mp3/土俵【どひょう】.mp3", "8bc03042fab3aa0944effdf394d165778d6ad87e", 6, 233],
  ["tofugu", "山脈", "さんみゃく", "lib/mp3/山脈【さんみゃく】.mp3", "aabeb4074ce60c9f73967fcf235a35dffc47a326", 3, 258],
  ["tofugu", "略語", "りゃくご", "lib/mp3/略語【りゃくご】.mp3", "e39050df2ed6476a097ed7d9d3c88ca0d4eacf53", 4, 241],
];

/** The Lingua Libre speaker, from the file name: `LL-Q5287 (jpn)-<speaker>-<word>.wav`. */
export const lingualibreSpeaker = (file) => file.match(/^LL-Q\d+ \(jpn\)-(.+?)-/)?.[1] ?? null;

export const EXAMPLE_SOUNDS = ROWS.map(([source, written, reading, file, hash, steps, pitch]) => ({
  source,
  written,
  reading,
  file,
  hash,
  steps,
  ...(pitch ? { pitch } : {}),
  ...(source === "lingualibre" ? { speaker: lingualibreSpeaker(file) } : {}),
}));

/**
 * Where a recording is written: `example-` and the first 16 hex of its hash —
 * ASCII, one name per recording. Not `kana-`: that prefix is what sw.js keeps
 * outside the media cap and what status.sh counts as the 71 kana sounds, and
 * these are ordinary word recordings, like Kaishi's.
 */
export const exampleSoundName = (sound) => `example-${sound.hash.slice(0, 16)}.mp3`;
