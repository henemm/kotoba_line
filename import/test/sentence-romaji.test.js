import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sentenceRomaji } from "../lib/sentence-romaji.js";

/**
 * Sentence romaji (2026-09-19). The tokens are kuromoji's output for these
 * sentences, captured once so this runs without the tokenizer installed; the
 * furigana is Kaishi's own. The full run over the live deck gave 1,492 of
 * 1,500 sentences romaji, with no particle left as ha/wo/he.
 */
const CASES = [
{
"sentence": "この靴はいくらですか。",
"furigana": "この 靴[くつ]は<b>いくら</b>ですか。",
"tokens": [
[
"この",
"連体詞",
"*",
"この"
],
[
"靴",
"名詞",
"一般",
"靴"
],
[
"は",
"助詞",
"係助詞",
"は"
],
[
"いくら",
"名詞",
"一般",
"いくら"
],
[
"です",
"助動詞",
"*",
"です"
],
[
"か",
"助詞",
"副助詞／並立助詞／終助詞",
"か"
],
[
"。",
"記号",
"句点",
"。"
]
]
},
{
"sentence": "駅からはタクシーに乗ってください。",
"furigana": "駅[えき]からはタクシーに<b>乗[の]って</b>ください。",
"tokens": [
[
"駅",
"名詞",
"一般",
"駅"
],
[
"から",
"助詞",
"格助詞",
"から"
],
[
"は",
"助詞",
"係助詞",
"は"
],
[
"タクシー",
"名詞",
"一般",
"タクシー"
],
[
"に",
"助詞",
"格助詞",
"に"
],
[
"乗っ",
"動詞",
"自立",
"乗る"
],
[
"て",
"助詞",
"接続助詞",
"て"
],
[
"ください",
"動詞",
"非自立",
"くださる"
],
[
"。",
"記号",
"句点",
"。"
]
]
},
{
"sentence": "あれは何ですか。",
"furigana": "<b>あれ</b>は 何[なん]ですか。",
"tokens": [
[
"あれ",
"名詞",
"代名詞",
"あれ"
],
[
"は",
"助詞",
"係助詞",
"は"
],
[
"何",
"名詞",
"代名詞",
"何"
],
[
"です",
"助動詞",
"*",
"です"
],
[
"か",
"助詞",
"副助詞／並立助詞／終助詞",
"か"
],
[
"。",
"記号",
"句点",
"。"
]
]
},
{
"sentence": "せっかく来たんだからゆっくりして行きなさい。",
"furigana": "<b>せっかく</b> 来[き]たんだからゆっくりして 行[い]きなさい。",
"tokens": [
[
"せっかく",
"副詞",
"一般",
"せっかく"
],
[
"来",
"動詞",
"自立",
"来る"
],
[
"た",
"助動詞",
"*",
"た"
],
[
"ん",
"名詞",
"非自立",
"ん"
],
[
"だ",
"助動詞",
"*",
"だ"
],
[
"から",
"助詞",
"接続助詞",
"から"
],
[
"ゆっくり",
"副詞",
"助詞類接続",
"ゆっくり"
],
[
"し",
"動詞",
"自立",
"する"
],
[
"て",
"助詞",
"接続助詞",
"て"
],
[
"行き",
"動詞",
"非自立",
"行く"
],
[
"なさい",
"動詞",
"非自立",
"なさる"
],
[
"。",
"記号",
"句点",
"。"
]
]
},
{
"sentence": "あなたはトムさんですか。",
"furigana": "<b>あなた</b>はトムさんですか。",
"tokens": [
[
"あなた",
"名詞",
"代名詞",
"あなた"
],
[
"は",
"助詞",
"係助詞",
"は"
],
[
"トム",
"名詞",
"固有名詞",
"トム"
],
[
"さん",
"名詞",
"接尾",
"さん"
],
[
"です",
"助動詞",
"*",
"です"
],
[
"か",
"助詞",
"副助詞／並立助詞／終助詞",
"か"
],
[
"。",
"記号",
"句点",
"。"
]
]
},
{
"sentence": "A「山田さんですか。」B「はい。」",
"furigana": "A「 山[やま] 田[だ]さんですか。」B「<b>はい</b>。」",
"tokens": [
[
"A",
"名詞",
"一般",
"*"
],
[
"「",
"記号",
"括弧開",
"「"
],
[
"山田",
"名詞",
"固有名詞",
"山田"
],
[
"さん",
"名詞",
"接尾",
"さん"
],
[
"です",
"助動詞",
"*",
"です"
],
[
"か",
"助詞",
"副助詞／並立助詞／終助詞",
"か"
],
[
"。",
"記号",
"句点",
"。"
],
[
"」",
"記号",
"括弧閉",
"」"
],
[
"B",
"名詞",
"固有名詞",
"*"
],
[
"「",
"記号",
"括弧開",
"「"
],
[
"はい",
"感動詞",
"*",
"はい"
],
[
"。",
"記号",
"句点",
"。"
],
[
"」",
"記号",
"括弧閉",
"」"
]
]
},
{
"sentence": "私は去年フランスへ行った。",
"furigana": "私[わたし]は<b>去[きょ] 年[ねん]</b>フランスへ 行[い]った。",
"tokens": [
[
"私",
"名詞",
"代名詞",
"私"
],
[
"は",
"助詞",
"係助詞",
"は"
],
[
"去年",
"名詞",
"副詞可能",
"去年"
],
[
"フランス",
"名詞",
"固有名詞",
"フランス"
],
[
"へ",
"助詞",
"格助詞",
"へ"
],
[
"行っ",
"動詞",
"自立",
"行く"
],
[
"た",
"助動詞",
"*",
"た"
],
[
"。",
"記号",
"句点",
"。"
]
]
}
];

const tokens = (c) => c.tokens.map(([surface_form, pos, pos_detail_1, basic_form]) => ({ surface_form, pos, pos_detail_1, basic_form }));
const romajiOf = (sentence) => {
  const c = CASES.find((x) => x.sentence === sentence);
  return sentenceRomaji(tokens(c), c.sentence, c.furigana).romaji;
};

describe("sentence romaji from Kaishi's furigana and the tokenizer's word boundaries", () => {
  it("says は, を and へ as particles are said, and spaces the words", () => {
    assert.equal(romajiOf("この靴はいくらですか。"), "kono kutsu wa ikura desu ka.");
    assert.equal(romajiOf("駅からはタクシーに乗ってください。"), "eki kara wa takushii ni notte kudasai.");
    assert.equal(romajiOf("私は去年フランスへ行った。"), "watashi wa kyonen furansu e itta.");
  });

  it("takes the reading from Kaishi, not from the tokenizer's dictionary", () => {
    // IPADIC reads 何 here as なに; Kaishi's furigana says なん.
    assert.equal(romajiOf("あれは何ですか。"), "are wa nan desu ka.");
  });

  it("keeps a verb with its endings and ~nasai, and a name with its -san", () => {
    assert.equal(romajiOf("せっかく来たんだからゆっくりして行きなさい。"), "sekkaku kita n da kara yukkuri shite ikinasai.");
    assert.equal(romajiOf("あなたはトムさんですか。"), "anata wa tomu-san desu ka.");
  });

  it("writes a dialogue's speakers", () => {
    assert.equal(romajiOf("A「山田さんですか。」B「はい。」"), "A: yamada-san desu ka. B: hai.");
  });

  it("gives none rather than a wrong one when furigana and sentence disagree", () => {
    const c = CASES[0];
    assert.ok(sentenceRomaji(tokens(c), c.sentence, "この 靴[くつ]は").fail);
    assert.ok(sentenceRomaji(tokens(c), c.sentence, c.furigana.replace("靴[くつ]", "靴")).fail);
  });
});
