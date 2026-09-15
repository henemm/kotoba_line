/**
 * The kana's own sounds (#158, v84): one recording per sound, from Wikimedia
 * Commons, for the 71 sounds that have one.
 *
 * All 71 are by one uploader, Hakatanoshio117117, released {{PD-self}}
 * (2009); each file's description is 「X」の発音 for its own kana (checked
 * through the Commons API, 2026-09-15). Henning listened to あ し つ ふ ぱ ん
 * and found them human. Each says its kana three times, about a second apart,
 * and they are kept that way — Henning: "die Wiederholungen sehr sinnvoll".
 *
 * Not here: the 33 yōon (きゃ …). No free human recording of them exists, so
 * the phone's voice reads them and the card says so (47).
 *
 * Each row: the hiragana, the Commons file, the sha1 Commons reports for
 * that original, and the gain steps (×1.5 dB, lib/mp3gain.js) it gets.
 *
 * **Why the steps.** The recordings come from several sessions and their
 * loudness differs by 28.6 dB — the ka/sa/ta/ga rows at the bottom, the
 * ma/ya/ra/wa and za/da rows at the top — so あ would be a whisper after ま.
 * Measured by decoding Wikimedia's MP3 transcodes in Chromium's Web Audio:
 * the active level is the RMS over the 20 ms frames within 30 dB of a file's
 * loudest, which ignores the silence between the three repetitions. The
 * target is 0.112, the median of the same measure over every 25th Kaishi word
 * recording (60 files) — the level of the example words she hears on the same
 * card. steps = round(20·log10(0.112 / level) / 1.5).
 *
 * After applying them, decoded again: active levels 0.103–0.122 (1.5 dB) in
 * Chromium and 0.101–0.125 (1.9 dB) in WebKit, durations unchanged, loudest
 * sample 0.77 — none clipped, where seven files reached 1.0 before.
 *
 * The steps belong to these recordings, which is why each is pinned by its
 * sha1 and the import stops if Commons reports a different one. They are not
 * tied to the transcode's bytes: Wikimedia may re-encode it, and the level of
 * the same recording stays the same.
 */

export const COMMONS_UPLOADER = "Hakatanoshio117117";

const ROWS = [
  ["あ", "Ja-A.oga", "d4d046efa05c12229407d2a97d5a422ce97649be", 5],
  ["い", "Japanese I.ogg", "04403a419b37b1bc96615e2ab735b5b74b9ff5bb", 7],
  ["う", "Japanese U.ogg", "ccd1bb7a9871a934edf01ea7f1dac6999072643c", 7],
  ["え", "Ja-E.oga", "1cc7b64eb3b9f43a9d0888ea51e55b5fd4261951", 6],
  ["お", "Japanese O.ogg", "25610a7bb11b015b2f5e9bfc4519c99ae5b2c584", 6],
  ["か", "Ja-Ka.oga", "bd5fc79022274d1bcd10dfb38656ac79d292260f", 6],
  ["き", "Japanese ki.ogg", "1feb9c670dc858cd610390512b1f5bb1c5007628", 11],
  ["く", "Japanese ku.ogg", "ca7c8670d57c48cafa02cb074b8bcc018c992a98", 11],
  ["け", "Japanese ke.ogg", "61a5715b5063b8beaeeddcb37e9b0dd765b63fef", 9],
  ["こ", "Japanese ko.ogg", "74745669bc823de2f077e27af895d74faff406b5", 10],
  ["さ", "Japanese sa.ogg", "e197f36870679032a95ef636b9d35efc5a7b59b6", 9],
  ["し", "Japanese shi.ogg", "5d31c584e2d45ecea91ea65f450372d740946ce5", 7],
  ["す", "Japanese su.ogg", "ba0de49ea01ba72ce21d082dd768210484fc57b2", 10],
  ["せ", "Japanese se.ogg", "d3e42c58b32352b34e500d068bfda24e91fefbfd", 10],
  ["そ", "Ja-So.oga", "65c81da3f0d0b290c9a6e456ada668a3ab042536", 9],
  ["た", "Japanese ta.ogg", "0b21a89231943cf6549a295f09f912d2253db57a", 9],
  ["ち", "Japanese ti.ogg", "80af761170424eb91b00983c138198c205caea15", 10],
  ["つ", "Japanese tsu.ogg", "a5e972eadfdd5bb7780b930538a807fa88c43071", 12],
  ["て", "Japanese te.ogg", "e4f87664ad4a88d1d82f496ea75f2c71891ec896", 10],
  ["と", "Japanese to.ogg", "e4125865f2889657a9e0ff3152796379da39bdfc", 10],
  ["な", "Japanese na.ogg", "d1b8cdefdd8bc9041d8e833d8c56b63ca9b02d8b", 0],
  ["に", "Japanese ni.ogg", "9c3f3dbab48c74c95399768b8bba21ffd794b2cb", 1],
  ["ぬ", "Japanese nu.ogg", "46248cfd364e11c279cdd2c92a8ba32e62dcbb88", 1],
  ["ね", "Japanese ne.ogg", "776bcf90296a87c6aae0bcaaa6c0ee967156e545", 0],
  ["の", "Japanese no.ogg", "86a43aa3b2985fc516302d7fa626d77a134fd774", 0],
  ["は", "Japanese ha.ogg", "96a56ec71fa90afbddcc2a08d648d5f9d965f092", -1],
  ["ひ", "Japanese hi.ogg", "1b3ecc7ff505fcf631cbfc1b5c3a4a5a28064af8", 1],
  ["ふ", "Japanese hu.ogg", "b5620efa7a53646ec1fe0e64f1deb887e708b8e1", 1],
  ["へ", "Japanese he.ogg", "5dbd3d0edb28e5e92583a4fe6ee38f598e95746f", 1],
  ["ほ", "Japanese ho.ogg", "0d508dcc24008d7563365e58020f755b56a3fc2c", 1],
  ["ま", "Japanese ma.ogg", "a191558e30d6bb3cb0f0611566f7ebb6cc4057cd", -7],
  ["み", "Japanese mi.ogg", "81441bcaf89a7e19039ab339df26a84db120d3e9", -6],
  ["む", "Japanese mu.ogg", "d9e9f75aaae34fb9c37e2af8ec7224edc7296344", -5],
  ["め", "Japanese me.ogg", "be3381d5a1903ae246aa07000dff1f2a7546ba54", -6],
  ["も", "Japanese mo.ogg", "6e2b5f38519b69a8da21035d7fa58e7f1ff5f2d6", -6],
  ["や", "Japanese ya.ogg", "26f89fb1513de44f37c9a73723797dcf5c775985", -7],
  ["ゆ", "Japanese yu.ogg", "31da028b7f96898aed28767f5b51f64260b6367d", -5],
  ["よ", "Japanese yo.ogg", "e780768080ebb2a9fd325d692c6e1edbd85a9d00", -6],
  ["ら", "Japanese ra.ogg", "b612cb2c95ed34e233301af8a6255370cfd460ff", -7],
  ["り", "Japanese ri.ogg", "6fb39e48e53e807ae7faef6a9799c11d6adefdf0", -5],
  ["る", "Japanese ru.ogg", "4215d95d56740d4f7c9f9df9a013ac5d52446839", -5],
  ["れ", "Japanese re.ogg", "bcb30ddc21513631575f2588fd82c40787c63ec1", -6],
  ["ろ", "Japanese ro.ogg", "68d7cb7799a590922af4638f173702e532b1be76", -6],
  ["わ", "Japanese wa.ogg", "90e9a14258daf4401b2a7c67c8c7472b26722231", -6],
  ["を", "Japanese wo.ogg", "295bd84ba9051c7e13fbaa87521756edea83f8f4", -5],
  ["ん", "Japanese N.ogg", "97d271a3d72a209ceb221128bca8a4d66907621f", -5],
  ["が", "Japanese ga.ogg", "3f38bbce8c459c1453be0a4ad28464b14c005632", 9],
  ["ぎ", "Japanese gi.ogg", "cfc9ab24036aac7efa51da2aa6f451afd30a09bc", 11],
  ["ぐ", "Japanese gu.ogg", "9779525b47936eb862406ee62f946c2aa4f1e991", 11],
  ["げ", "Japanese ge.ogg", "3caf0ab9dc6aa8b8d3a1ad57945e0bab9b4021d8", 10],
  ["ご", "Japanese go.ogg", "30442e4178d7bdfdc9afcce57b5ac4aa99dc2f75", 10],
  ["ざ", "Japanese za.ogg", "ec60e4ebb862f4e8e9b5d978f970e3d540d6a395", -7],
  ["じ", "Japanese zi.ogg", "44f5999e59f37cdc0fc9dc9bfeec18d764b76baa", -7],
  ["ず", "Japanese zu.ogg", "2243cf247599119746664334fff9a2ebc4e08c0e", -7],
  ["ぜ", "Japanese ze.ogg", "e2d3cc558f4b813667d16b1102b99a6c1dff8f4d", -6],
  ["ぞ", "Japanese zo.ogg", "252d83140c0067306036281f30812c90a40b4f7e", -7],
  ["だ", "Japanese da.ogg", "c535a5fd9409959f55e141acb9c452feb18d22d5", -5],
  ["ぢ", "Japanese di.ogg", "c30c6062eff828e6ecb8ccbe463121f2d1d9be78", -5],
  ["づ", "Japanese du.ogg", "c130b0ddc07725f7e0953998460bf56955a1d239", -5],
  ["で", "Japanese de.ogg", "28e479010d64deb19fe9b8e977397f68e0a1ec19", -5],
  ["ど", "Japanese do.ogg", "518897fbbbb35e37f37a298d514bb15e4d590886", -6],
  ["ば", "Japanese ba.ogg", "c16b3d3d523d7034425351181ffb1ab74f0d842a", -1],
  ["び", "Japanese bi.ogg", "3dcb20b6f1441d71bb03c75db26d4efa5b2de72e", -1],
  ["ぶ", "Japanese bu.ogg", "5f028eb32b821be19b67860c078138e4a11049c4", -1],
  ["べ", "Japanese be.ogg", "2d7a6aae312687911236ad4890bef84dbb709537", -1],
  ["ぼ", "Japanese bo.ogg", "1fdd664799205105d89fcd547e03e2e67a033d1d", -2],
  ["ぱ", "Japanese pa.ogg", "ca9f9f2789ef51cae29c7c612064bb5dc0096bdf", 0],
  ["ぴ", "Japanese pi.ogg", "93d44e25df4c3c507179b8ca093acb4c706df8df", 0],
  ["ぷ", "Japanese pu.ogg", "138a81ad3543b164f9004c518116626adc3a8b55", 1],
  ["ぺ", "Japanese pe.ogg", "3c09f0793c75b52f66ce1acce1201066d8dba315", 0],
  ["ぽ", "Japanese po.ogg", "25b02a13fe4fb0a54f2c1f3db39d26cb3dac20fc", -1],
];

export const KANA_SOUNDS = ROWS.map(([kana, commons, sha1, steps]) => ({ kana, commons, sha1, steps }));

const recorded = new Set(ROWS.map(([kana]) => kana));

/** Hiragana for a kana of either script: the katakana block sits 0x60 above. */
const toHiragana = (text) =>
  [...text].map((c) => (c >= "ァ" && c <= "ヶ" ? String.fromCodePoint(c.codePointAt(0) - 0x60) : c)).join("");

/**
 * Where a sound's recording is written: the hiragana's code point, like the
 * drawings (`kanjivg-03042.svg`), so あ and ア share `kana-03042.mp3`. Not the
 * romaji — じ and ぢ are both "ji". The `kana-` prefix is also what sw.js
 * recognises the file by.
 */
export const soundMediaName = (kana) => `kana-${toHiragana(kana).codePointAt(0).toString(16).padStart(5, "0")}.mp3`;

/** A kana card's recording, or null for a sound with none (the yōon). */
export function kanaSoundFile(kana) {
  const hiragana = toHiragana(kana);
  return recorded.has(hiragana) ? soundMediaName(hiragana) : null;
}
