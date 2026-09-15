import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { foldLatin, romajiQuery, searchRomaji } from "../src/romaji.js";
import { shownWord } from "../src/script.js";
import { byFrequencyThenId, exactFirst, matchesQuery } from "../src/screens/browse.js";

/**
 * v69 — a card is found by the romaji the app shows with the script off.
 *
 * Henning, 2026-09-14: "naru" found nothing in the Kaishi deck, and "kore" in
 * 100 vokabeln found only "Kore dake", not the single word. Both are stored in
 * Japanese script (the import matched "kore" to Kaishi's これ for its
 * recording) and shown in romaji, and search compared the romaji with これ.
 * Measured against today's copy of the live data: 212 of the 551 cards from
 * the Noji lists could not be found by what the app showed, and 0 after this
 * (scratchpad `repro-kore.mjs`; the deck data is not committed).
 */

const kaishi = (id, word, reading, meaning, rank) => ({ id, deck: "kaishi", word, word_reading: reading, word_meaning: meaning, frequency_rank: rank });
const hers = (id, word, reading, meaning) => ({ id, deck: "personal", word, word_reading: reading, word_meaning: meaning, frequency_rank: null });

const naru = kaishi(1, "なる", "なる", "to become", 30);
const naruRing = kaishi(2, "鳴る", "なる", "to ring", 900);
const naruhodo = kaishi(3, "なるほど", "なるほど", "I see", 400);
const nakunaru = kaishi(4, "無くなる", "なくなる", "to be lost", 500);
const dekiru = kaishi(5, "出来る", "できる", "to be able to do", 20);
const nani = kaishi(6, "何", "なに・なん", "what", 10);
const koohii = kaishi(7, "コーヒー", "コーヒー", "coffee", 700);
const kore = hers(-10, "これ", "これ", "Das");
const koreDake = hers(-11, "Kore dake", null, "Nur das");
const ookiiNoji = hers(-12, "Ōkii", null, "Groß");
const ookii = hers(-13, "大きい", "おおきい", "Groß");
const ocha = hers(-14, "Ocha", null, "Tee");
const te = kaishi(8, "手", "て", "hand", 50);
const all = [naru, naruRing, naruhodo, nakunaru, dekiru, nani, koohii, kore, koreDake, ookiiNoji, ookii, ocha, te];

const find = (q) => all.filter((c) => matchesQuery(c, q)).sort(exactFirst(q, byFrequencyThenId)).map((c) => c.id);

describe("search by romaji (v69)", () => {
  it("finds what the app shows: naru, kore", () => {
    assert.deepEqual(find("naru"), [1, 2, 3]);
    assert.deepEqual(find("kore"), [-10, -11]);
  });

  it("finds every card by the romaji it is shown with", () => {
    for (const card of all) {
      const shown = shownWord(card, false).split(" / ")[0];
      assert.ok(find(shown).includes(card.id), `${shown} finds ${card.word}`);
    }
  });

  it("matches where a word starts, not inside one", () => {
    assert.ok(!find("kiru").includes(5), "dekiru is not found by kiru");
    assert.ok(!find("naru").includes(4), "nakunaru is not found by naru");
    assert.ok(find("dake").includes(-11), "dake starts a word in Kore dake");
  });

  it("puts a card that is exactly the search first", () => {
    assert.deepEqual(find("naru").slice(0, 2), [1, 2]);
    assert.equal(find("kore")[0], -10);
  });

  it("finds each of a word's two readings", () => {
    assert.ok(find("nan").includes(6));
    assert.ok(find("nani").includes(6));
  });

  it("finds a long vowel written long, short, or with a macron", () => {
    for (const q of ["ookii", "okii", "Ōkii", "ōkii"]) {
      assert.deepEqual(find(q).sort((a, b) => a - b), [-13, -12], q);
    }
    assert.ok(find("koohii").includes(7));
    assert.ok(find("kohii").includes(7));
  });

  it("leaves a German search German", () => {
    // "Tee" short would be "te": 手 and every word after it.
    assert.deepEqual(find("Tee"), [-14]);
    assert.equal(romajiQuery("fuß"), undefined, "ß is not romaji");
    assert.equal(romajiQuery("なる"), undefined, "script is searched as written");
  });

  it("folds text the same way on both sides", () => {
    assert.equal(foldLatin("Sumimasen ,wakarimasen"), "sumimasen wakarimasen");
    assert.equal(foldLatin("shin'ichi"), "shinichi");
    assert.equal(searchRomaji("これ", "これ"), " kore|");
    assert.equal(searchRomaji("何", "なに・なん"), " nani nan| nani| nan|");
  });
});
