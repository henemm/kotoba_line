/**
 * A picture for every basic kana (#177, v88).
 *
 * Learning a syllabary goes faster with a picture that holds the shape: き is a
 * key, ぬ is noodles round a chopstick. The evidence is thin but points one way
 * (Manalo, Trafford & Mizutani 2004, JALT Journal 26(1): the pass rate of the
 * students who came to the mnemonic tutorials rose significantly, their marks
 * did not), and Henning's call was that pictures do no harm where they are not
 * needed.
 *
 * **Where they come from.** B. Domangue's "Japanese Kana Mnemonic Chart" on
 * Wikimedia Commons (2016), CC BY-SA 4.0 — one drawing per kana with the kana
 * laid over it in grey, for all 46 basic hiragana and all 46 basic katakana.
 * Nothing here is generated: the drawings are hers and the hooks are her words,
 * transcribed. Tofugu's are better known and better drawn, but they are not
 * licensed for reuse (asked before choosing: no licence is published).
 *
 * **Why the files are in the repository** — the one place this project commits
 * media. The chart is a single 7600 × 4200 PNG, so each tile is a crop of it,
 * and cutting it needs a PNG decoder and connected-component labelling that
 * `import/` (no dependencies of its own) has no way to do. The tiles were cut
 * once, by the script recorded in the pull request, and the result is 92 files
 * of about 8 KB, 936 KB together. The import copies them into the media
 * directory, as it downloads KanjiVG's drawings.
 *
 * The hook is the chart's own caption, kept in English like Kaishi's glosses:
 * it works by the sound of an English word ("Cod" for か), which a translation
 * would break. The captions are not drawn into the tiles — they are typed here
 * — so a caption that overhangs its neighbour on the chart cannot end up on the
 * wrong kana, and the text stays legible at card size.
 *
 * Dakuten and yōon (が, きゃ) have no picture: the chart does not draw them, and
 * か's cod would be a poor hook for が.
 */

export const MNEMONIC_SOURCE = {
  artist: "B. Domangue",
  work: "Japanese Kana Mnemonic Chart",
  page: "https://commons.wikimedia.org/wiki/File:Japanese_Kana_Mnemonic_Chart.png",
  licence: "CC BY-SA 4.0",
};

const ROWS = [
  ["あ", "Attention! Says the drill sergeant."],
  ["い", "Easter egg."],
  ["う", "Ukulele."],
  ["え", "Edge of the cliff is here."],
  ["お", "Oak tree drops a leaf."],
  ["か", "Cod."],
  ["き", "Key."],
  ["く", "Cuckoo bird."],
  ["け", "Ketchup bottle."],
  ["こ", "Comb."],
  ["さ", "Socks."],
  ["し", "Sheep."],
  ["す", "Soup ladle in a pot."],
  ["せ", "Security guard."],
  ["そ", "Sew a stitch."],
  ["た", '"ta."'],
  ["ち", '"Cheep, cheep," says the chick.'],
  ["つ", "Tsunami wave."],
  ["て", "Telescope."],
  ["と", "Toaster."],
  ["な", "Nostril."],
  ["に", "Knee."],
  ["ぬ", "Noodles and chopsticks."],
  ["ね", "Next train arrives at 12:00."],
  ["の", "No smoking."],
  ["は", "Hiking boot."],
  ["ひ", "Heel."],
  ["ふ", "Mount Fuji."],
  ["へ", "Headband."],
  ["ほ", "Hotel room."],
  ["ま", "Mop and bucket."],
  ["み", "Mean number is 21."],
  ["む", "Moose chewing leaves."],
  ["め", "Medallion."],
  ["も", "Motor boat."],
  ["や", "Yawl."],
  ["ゆ", "Utensils for eating."],
  ["よ", "Yoga."],
  ["ら", "Rod and reel."],
  ["り", "Reach high."],
  ["る", "Rooster."],
  ["れ", "Wrench."],
  ["ろ", 'I wrote the number "3."'],
  ["わ", "Wallaby."],
  ["を", "Oh! Water is too cold."],
  ["ん", 'The letter "n."'],
  ["ア", "Eye of Horus."],
  ["イ", "Eaves on a house."],
  ["ウ", "Ukulele."],
  ["エ", "Empire State Building."],
  ["オ", "Olympic torch."],
  ["カ", "Cod."],
  ["キ", "Key."],
  // The chart's hook here is "Coonskin cap." — the drawing is the Davy Crockett
  // hat, and the word is innocuous in that sense, but "coon" is a slur in
  // others. Henning's call (2026-09-16): keep the drawing, drop the words. A
  // row with no hook shows the picture alone.
  ["ク", null],
  ["ケ", 'The letter "K."'],
  ["コ", "Comb."],
  ["サ", "Sock."],
  ["シ", "Shield."],
  ["ス", "Suit and tie."],
  ["セ", "Security guard."],
  ["ソ", "Sew a button."],
  ["タ", "Tomcat."],
  ["チ", "Cheese wedge."],
  ["ツ", "Tsunami wave. That's a big one!"],
  ["テ", "Tent."],
  ["ト", "Topiary."],
  ["ナ", "Knife."],
  ["ニ", "Knee."],
  ["ヌ", "Newborn baby in a stroller."],
  ["ネ", "Neck brace."],
  ["ノ", "No smoking."],
  ["ハ", "Hot lava."],
  ["ヒ", "Heel."],
  ["フ", "Fool's hat."],
  ["ヘ", "Headband."],
  ["ホ", "Holy cross."],
  ["マ", "Mockingbird."],
  ["ミ", "Median in the road."],
  ["ム", "Moon looks down from above."],
  ["メ", "Metal knife."],
  ["モ", "Motor boat."],
  ["ヤ", "Yawl."],
  ["ユ", "U-turn."],
  ["ヨ", "Yoga shorts."],
  ["ラ", "Robber."],
  ["リ", "Reach high."],
  ["ル", "Rhubarb stalk."],
  ["レ", "Referee whistle."],
  ["ロ", "Road sign."],
  ["ワ", "Watermelon slice."],
  ["ヲ", "Oatmeal in a bowl."],
  ["ン", "Envelope."],
];

export const MNEMONICS = ROWS.map(([kana, hook]) => ({ kana, hook }));

/** The file a kana's picture is written as — its own code point, like the drawings. */
export const mnemonicMediaName = (kana) => `mnemonic-${kana.codePointAt(0).toString(16).padStart(5, "0")}.png`;

/** The picture as the repository keeps it: import/assets/mnemonics/<code point>.png. */
export const mnemonicAssetName = (kana) => `${kana.codePointAt(0).toString(16).padStart(5, "0")}.png`;

const byKana = new Map(MNEMONICS.map((m) => [m.kana, m]));

/**
 * A kana card's picture, or null where there is none (dakuten, yōon). The hook
 * is left out where the card has a picture but no words to go with it.
 */
export function mnemonicFor(kana) {
  const found = byKana.get(kana);
  if (!found) return null;
  return { file: mnemonicMediaName(kana), ...(found.hook ? { hook: found.hook } : {}) };
}
