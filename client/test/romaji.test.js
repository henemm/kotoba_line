import { test } from "node:test";
import assert from "node:assert/strict";
import { baseFormHint, plainRomaji, romajiParts, toRomaji } from "../src/romaji.js";

test("plain gojuon", () => {
  assert.equal(toRomaji("あい"), "ai");
  assert.equal(toRomaji("さくら"), "sakura");
});

test("dakuten and handakuten", () => {
  assert.equal(toRomaji("がっこう"), "gakkou");
  assert.equal(toRomaji("さんぽ"), "sanpo");
});

test("youon digraphs, including じゃ", () => {
  assert.equal(toRomaji("だいじょうぶ"), "daijoubu");
  assert.equal(toRomaji("きゃく"), "kyaku");
});

test("long vowels are written out, not contracted", () => {
  assert.equal(toRomaji("とうきょう"), "toukyou");
  assert.equal(toRomaji("せんせい"), "sensei");
  assert.equal(toRomaji("おおきい"), "ookii");
});

test("sokuon doubles the next consonant", () => {
  assert.equal(toRomaji("きって"), "kitte");
  assert.equal(toRomaji("がっこう"), "gakkou");
});

test("sokuon before ち is tch, not a doubled c", () => {
  assert.equal(toRomaji("まっちゃ"), "matcha");
});

test("ん is always n, with an apostrophe before a vowel or y", () => {
  assert.equal(toRomaji("しんぶん"), "shinbun");
  assert.equal(toRomaji("しんいち"), "shin'ichi");
  assert.equal(toRomaji("ほんや"), "hon'ya");
});

test("づ and ぢ match じ and ず, not keyboard input", () => {
  assert.equal(toRomaji("つづく"), "tsuzuku");
  assert.equal(toRomaji("はなぢ"), "hanaji");
});

test("katakana and the long-vowel mark", () => {
  assert.equal(toRomaji("コーヒー"), "koohii");
  assert.equal(toRomaji("コンビニ"), "konbini");
});

test("a word already fully in kana, unchanged in shape", () => {
  assert.equal(toRomaji("もう"), "mou");
  assert.equal(toRomaji("いい"), "ii");
});

test("no input yields no romaji", () => {
  assert.equal(toRomaji(undefined), undefined);
  assert.equal(toRomaji(""), undefined);
});

test("kanji with no furigana resolves nothing, rather than a partial string", () => {
  assert.equal(toRomaji("大丈夫"), undefined);
  assert.equal(toRomaji("だい丈夫"), undefined);
});

test("sentence punctuation passes through unchanged", () => {
  assert.equal(toRomaji("げんきですか。"), "genkidesuka.");
});

test("a space in the input is preserved — toRomaji has no word-boundary logic of its own", () => {
  assert.equal(toRomaji("としょかん でにほんごの"), "toshokan denihongono");
});


test("#322 splits out the marked word", () => {
  assert.deepEqual(romajiParts("ani ga <b>imasu</b>."), [
    { text: "ani ga ", marked: false },
    { text: "imasu", marked: true },
    { text: ".", marked: false },
  ]);
});

test("#322 reads one without a mark as plain text, as before the import kept it", () => {
  assert.deepEqual(romajiParts("kono kutsu wa ikura desu ka."), [{ text: "kono kutsu wa ikura desu ka.", marked: false }]);
});

test("#322 drops the mark where only the words are wanted", () => {
  assert.equal(plainRomaji("ani ga <b>imasu</b>."), "ani ga imasu.");
  assert.equal(plainRomaji(undefined), "");
});

test("#322 names the card's form only when the sentence bends the word", () => {
  assert.equal(baseFormHint("imasu", "iru"), "iru");
  assert.equal(baseFormHint("oshiete", "oshieru"), "oshieru");
  assert.equal(baseFormHint("ikura", "ikura"), undefined);
  // Written the same, case and hyphens aside.
  assert.equal(baseFormHint("Tomu-san", "tomusan"), undefined);
  assert.equal(baseFormHint("imasu", undefined), undefined);
  // Read two ways: the sentence's way is not a different form.
  assert.equal(baseFormHint("nan", "nani / nan"), undefined);
});
