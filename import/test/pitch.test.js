import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accentsFrom, moras, pitchColumn } from "../lib/pitch.js";

/**
 * The deck's own markup, trimmed to the parts that carry meaning. The real
 * field also sets display, position, user-select and pointer-events; none of
 * those say anything about pitch, and repeating them here would only make the
 * fixtures harder to read than the thing they stand for.
 */
const DRAWING = 'border-top-width:0.1em;border-top-style:solid;';
const DRAWING_DROP = `${DRAWING}border-right-width:0.1em;border-right-style:solid;`;

/** One accent span: text, plus the empty sibling that paints the line. */
const high = (text, drops = false) =>
  `<span style="position:relative;${drops ? "padding-right:0.1em;" : ""}">` +
  `<span style="display:inline;">${text}</span>` +
  `<span style="${drops ? DRAWING_DROP : DRAWING}"></span>` +
  `</span>`;

describe("moras", () => {
  it("joins a small kana to the mora before it", () => {
    assert.deepEqual(moras("キョウ"), ["キョ", "ウ"]);
    assert.deepEqual(moras("シャシン"), ["シャ", "シ", "ン"]);
  });

  it("counts ー and ッ as moras of their own", () => {
    // 先生 セ-ン-セ-ー drops after the third. Merging ー into the ー before it
    // would put the fall in the wrong place.
    assert.equal(moras("センセー").length, 4);
    assert.equal(moras("キッテ").length, 3);
  });

  it("counts nothing that is not kana", () => {
    // A stray tag, a footnote mark, a Latin letter: silently counting one is
    // how a drop lands a mora late, which is worse than showing no accent.
    assert.deepEqual(moras("ア<br>イ"), ["ア", "イ"]);
    assert.deepEqual(moras("ス*"), ["ス"]);
  });
});

describe("reading Kaishi's pitch drawing (#21)", () => {
  it("gives 0 when the line runs to the end", () => {
    // 私 ワ + タシ overlined, no drop: heiban.
    assert.deepEqual(accentsFrom(`ワ${high("タシ")}`), [0]);
  });

  it("gives the mora the line falls after", () => {
    assert.deepEqual(accentsFrom(`${high("ア", true)}メ`), [1], "雨");
    assert.deepEqual(accentsFrom(`ハ${high("ナ", true)}`), [2], "花");
    assert.deepEqual(accentsFrom(`セ${high("ンセ", true)}ー`), [3], "先生");
  });

  it("reads the deck's other spelling of an overline", () => {
    // 勉強 is written with text-decoration rather than a drawn border.
    assert.deepEqual(accentsFrom('ベ<span style="text-decoration:overline;">ンキョー</span>'), [0]);
  });

  it("ignores a mark that belongs to the mora before it", () => {
    // 次 arrives as ツ · キ · ° — the nasal-ng ° in a red span of its own.
    // Counted as a mora it would make this a three-mora word.
    const field = `ツ${high('キ<span style="color: red;">°</span>', true)}`;
    assert.deepEqual(accentsFrom(field), [2]);
  });

  it("keeps both accents where the deck gives two", () => {
    // 硬い is カタイ and カタ\イ, both current.
    const field = `カ${high("タイ")}・カ${high("タ", true)}イ`;
    assert.deepEqual(accentsFrom(field), [0, 2]);
    assert.equal(pitchColumn(field), "0,2");
  });

  it("splits alternatives after parsing, not before", () => {
    // The ・ sits inside the markup. Splitting the string first cuts a span in
    // half and leaves two fragments neither of which parses — which produced
    // an accent of 6 for a three-mora word.
    const field = `カ${high("タイ")}・カ${high("タ", true)}イ`;
    assert.equal(field.indexOf("・") > field.indexOf("<span"), true, "the ・ is inside the markup");
    assert.deepEqual(accentsFrom(field), [0, 2]);
  });

  it("does not let a wrapper span swallow the spans inside it", () => {
    // 失礼します is シツ\レイシマ\ス: one wrapper holding two accent spans.
    // Judging the wrapper by everything inside it makes it high, and then its
    // text — which includes the inner text — counts those moras twice.
    const field = `<span style="position:relative;padding-right:0.1em;">シ${high("ツ", true)}レイシ${high("マ", true)}ス</span>`;
    const [accent] = accentsFrom(field);
    assert.ok(accent <= moras("シツレイシマス").length, `${accent} is within seven moras`);
  });

  it("says nothing where the deck draws nothing", () => {
    // Ten single-mora words carry a bare kana and no line at all. An accent
    // invented for those would be a guess presented as a fact.
    assert.deepEqual(accentsFrom("コ"), []);
    assert.equal(pitchColumn("コ"), null);
    assert.equal(pitchColumn(""), null);
    assert.equal(pitchColumn(undefined), null);
  });
});
