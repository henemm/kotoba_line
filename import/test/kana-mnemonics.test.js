import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";
import { openDatabase } from "../../server/src/db.js";
import { writeKanaCards } from "../import-kana.js";
import { MNEMONICS, MNEMONIC_SOURCE, mnemonicAssetName, mnemonicFor, mnemonicMediaName } from "../lib/kana-mnemonics.js";
import { kanaCards, kanaId } from "../lib/kana.js";

describe("the kana pictures (#177, v88)", () => {
  it("cover the basic kana of both scripts, and nothing else", () => {
    assert.equal(MNEMONICS.length, 92);
    const kana = new Set(MNEMONICS.map((m) => m.kana));
    assert.equal(kana.size, 92);
    const cards = kanaCards().map((c) => c.word);
    for (const k of kana) assert.ok(cards.includes(k), `${k} is a card`);
    assert.equal(cards.filter((w) => mnemonicFor(w)).length, 92, "of the 208 cards, the 46 basic ones per script");
    assert.equal(mnemonicFor("きゃ"), null, "a yōon has none");
    assert.equal(mnemonicFor("が"), null, "nor a dakuten");
  });

  it("each carry the chart's own hook, except the one dropped on purpose", () => {
    for (const { kana, hook } of MNEMONICS) {
      if (hook === null) continue;
      assert.ok(hook.length > 2 && hook.length < 60, `${kana}: ${hook}`);
      assert.match(hook, /[.!"]$/, `${kana}: ${hook} ends as the chart writes it`);
    }
    assert.equal(mnemonicFor("き").hook, "Key.");
    assert.equal(MNEMONIC_SOURCE.licence, "CC BY-SA 4.0");
    // ク keeps the drawing and loses the words (Henning, 2026-09-16).
    assert.deepEqual(mnemonicFor("ク"), { file: "mnemonic-030af.png" });
    assert.equal(MNEMONICS.filter((m) => m.hook === null).length, 1);
  });

  it("have their file in the repository, named by code point", () => {
    assert.equal(mnemonicMediaName("あ"), "mnemonic-03042.png");
    assert.equal(mnemonicFor("ア").file, "mnemonic-030a2.png");
    for (const { kana } of MNEMONICS) {
      const path = new URL(`../assets/mnemonics/${mnemonicAssetName(kana)}`, import.meta.url);
      assert.ok(existsSync(path), `${kana}: ${mnemonicAssetName(kana)}`);
    }
  });

  it("go onto the cards, and a second run changes nothing", () => {
    const db = openDatabase(":memory:");
    assert.equal(writeKanaCards(db, 1000, undefined, { mnemonics: true }), 208);
    const stored = (kana) => db.prepare("SELECT word_mnemonic FROM cards WHERE id = ?").get(kanaId(kana)).word_mnemonic;
    assert.deepEqual(JSON.parse(stored("き")), { file: "mnemonic-0304d.png", hook: "Key." });
    assert.equal(stored("きゃ"), null);
    assert.equal(writeKanaCards(db, 2000, undefined, { mnemonics: true }), 0);
    assert.equal(writeKanaCards(db, 3000), 0, "without the flag the stored pictures are kept");
    assert.ok(stored("き"));
    db.close();
  });
});
