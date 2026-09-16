import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openDatabase } from "../../server/src/db.js";
import { strokeMediaName, writeKanaCards } from "../import-kana.js";
import { kanaCards, kanaId, strokeCharacters, strokeFile, toKatakana } from "../lib/kana.js";
import { KANA_SOUNDS, kanaSoundFile, soundMediaName } from "../lib/kana-sounds.js";
import { yoonSoundFile, yoonSoundMediaName } from "../lib/kana-yoon-sounds.js";
import { toRomaji } from "../../client/src/romaji.js";

describe("the kana decks (#158)", () => {
  const cards = kanaCards();
  const deck = (name) => cards.filter((c) => c.deck === name);

  it("has 104 cards in each script: 46 basic, 25 with dakuten, 33 yōon", () => {
    assert.equal(deck("hiragana").length, 104);
    assert.equal(deck("katakana").length, 104);
    assert.deepEqual(deck("hiragana").slice(0, 5).map((c) => c.word), ["あ", "い", "う", "え", "お"]);
    assert.equal(deck("hiragana")[45].word, "ん");
    assert.equal(deck("hiragana")[46].word, "が");
    assert.equal(deck("hiragana")[71].word, "きゃ");
    assert.equal(deck("katakana")[45].word, "ン");
  });

  it("teaches them in order: the rank is the place in the table", () => {
    for (const name of ["hiragana", "katakana"]) {
      assert.deepEqual(deck(name).map((c) => c.frequency_rank), Array.from({ length: 104 }, (_, i) => i + 1));
    }
  });

  it("gives every card an id of its own, in a range nothing else uses", () => {
    const ids = cards.map((c) => c.id);
    assert.equal(new Set(ids).size, 208);
    for (const id of ids) assert.ok(id >= 10_000_000 && id <= 10_255_255, `${id}`);
    assert.equal(kanaId("あ"), 10_066_000);
    assert.equal(kanaId("ア"), 10_162_000);
    assert.equal(kanaId("きゃ"), 10_077_131);
  });

  it("reads each kana the way the app's own romaji does", () => {
    // Two independent tables agreeing is the check: a typo in either shows.
    const differ = cards.filter((c) => toRomaji(c.word_reading) !== c.word_meaning);
    // を is "wo" here on purpose (it is taught apart from お); ぢ and づ are
    // written the Hepburn way, "ji" and "zu".
    assert.deepEqual(
      differ.map((c) => `${c.word} ${c.word_meaning} ${toRomaji(c.word_reading)}`).filter((s) => !/^[をヲ] wo/.test(s) && !/^[ぢづヂヅ] /.test(s)),
      [],
    );
  });

  it("turns hiragana into katakana character for character", () => {
    assert.equal(toKatakana("きゃ"), "キャ");
    assert.equal(toKatakana("を"), "ヲ");
  });

  it("needs a drawing for 148 characters: 71 kana and the small ゃゅょ, in each script", () => {
    assert.equal(strokeCharacters().length, 148);
    assert.equal(strokeFile("あ"), "03042.svg");
    assert.equal(strokeMediaName("ア"), "kanjivg-030a2.svg");
  });

  it("writes the cards once, and a second run changes nothing", () => {
    const db = openDatabase(":memory:");
    assert.equal(writeKanaCards(db, 1000), 208);
    assert.equal(writeKanaCards(db, 2000), 0);
    assert.equal(db.prepare("SELECT count(*) n FROM cards WHERE updated_at = 2000").get().n, 0, "unchanged rows keep their stamp");

    db.prepare("UPDATE cards SET word_meaning = 'o' WHERE id = ?").run(kanaId("を"));
    assert.equal(writeKanaCards(db, 3000), 1, "a changed row is put right, and stamped so phones hear of it");
    assert.equal(db.prepare("SELECT word_meaning FROM cards WHERE id = ?").get(kanaId("を")).word_meaning, "wo");
    db.close();
  });
});

describe("the kana's own recordings (v84)", () => {
  const single = kanaCards().filter((c) => c.deck === "hiragana" && [...c.word].length === 1);

  it("pins one Commons recording for each of the 71 sounds that are not yōon, and none for a yōon", () => {
    assert.deepEqual(KANA_SOUNDS.map((s) => s.kana), single.map((c) => c.word));
    for (const s of KANA_SOUNDS) {
      assert.match(s.sha1, /^[0-9a-f]{40}$/, s.kana);
      // The transcodes' global_gain runs 130–188 (measured on all 71), so any
      // step within this range stays inside 0–255.
      assert.ok(Number.isInteger(s.steps) && s.steps >= -20 && s.steps <= 20, `${s.kana} ${s.steps}`);
    }
    assert.equal(new Set(KANA_SOUNDS.map((s) => s.commons)).size, 71);
  });

  it("gives hiragana and katakana the same file, named by code point because じ and ぢ read the same", () => {
    assert.equal(kanaSoundFile("あ"), "kana-03042.mp3");
    assert.equal(kanaSoundFile("ア"), "kana-03042.mp3");
    assert.equal(kanaSoundFile("ぢ"), "kana-03062.mp3");
    assert.notEqual(kanaSoundFile("ぢ"), kanaSoundFile("じ"));
    assert.equal(kanaSoundFile("ヲ"), "kana-03092.mp3");
    assert.equal(soundMediaName("ン"), "kana-03093.mp3");
  });

  it("falls back to a yōon's generated recording, hiragana and katakana sharing one file (#183)", () => {
    assert.equal(kanaSoundFile("きゃ"), yoonSoundMediaName("きゃ"));
    assert.equal(kanaSoundFile("キャ"), yoonSoundFile("きゃ"));
    assert.equal(kanaSoundFile("きゃ"), kanaSoundFile("キャ"));
    assert.notEqual(kanaSoundFile("きゃ"), kanaSoundFile("きゅ"));
  });

  it("writes the recording onto 208 cards, and a second run changes nothing", () => {
    const db = openDatabase(":memory:");
    writeKanaCards(db, 1000);
    const withSound = () =>
      db.prepare("SELECT count(*) n FROM cards WHERE deck IN ('hiragana', 'katakana') AND word_audio IS NOT NULL").get().n;
    assert.equal(withSound(), 0);
    assert.equal(writeKanaCards(db, 2000, undefined, { sounds: true }), 208);
    assert.equal(withSound(), 208);
    assert.equal(db.prepare("SELECT word_audio FROM cards WHERE id = ?").get(kanaId("ア")).word_audio, "kana-03042.mp3");
    assert.equal(
      db.prepare("SELECT word_audio FROM cards WHERE id = ?").get(kanaId("キャ")).word_audio,
      yoonSoundMediaName("きゃ"),
    );
    assert.equal(writeKanaCards(db, 3000, undefined, { sounds: true }), 0);
    assert.equal(writeKanaCards(db, 4000), 0, "--no-sounds leaves them where they are");
    assert.equal(withSound(), 208);
    db.close();
  });
});
