import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { toRomaji } from "../../client/src/romaji.js";
import { TOPIC_KEYS } from "../../client/src/topics.js";
import { TRAVEL_ID_FLOOR, TRAVEL_TOPICS, parseTravel, travelAssignments } from "../lib/travel.js";
import { TOPICS } from "../lib/tagging.js";

/** Reise 1 and 2 (#237): the file the import and tag-cards.js both read. */
const rows = parseTravel(readFileSync(new URL("../travel.tsv", import.meta.url), "utf8"));

describe("import/travel.tsv (#237)", () => {
  it("has two rounds: a first one small enough to finish, and a second", () => {
    const one = rows.filter((r) => r.round === 1).length;
    const two = rows.filter((r) => r.round === 2).length;
    assert.ok(one >= 10 && one <= 25, `Reise 1 has ${one}`);
    assert.ok(two >= 30 && two <= 60, `Reise 2 has ${two}`);
  });

  it("keeps added phrases out of every other id space", () => {
    for (const r of rows) {
      if (r.kaishi) assert.ok(r.id > 1e12 && r.id < TRAVEL_ID_FLOOR, `${r.word}: ${r.id} is no Kaishi note id`);
      else assert.ok(r.id >= TRAVEL_ID_FLOOR && Number.isSafeInteger(r.id), `${r.word}: ${r.id}`);
    }
  });

  it("gives every added phrase romaji she can read, particles as said", () => {
    const romaji = Object.fromEntries(rows.filter((r) => !r.kaishi).map((r) => [r.word, toRomaji(r.reading)]));
    for (const [word, r] of Object.entries(romaji)) assert.ok(r && !/undefined/.test(r), `${word} has no romaji`);
    assert.equal(romaji["トイレはどこですか？"], "toire wa doko desu ka");
    assert.equal(romaji["こんにちは。"], "konnichiwa");
    assert.equal(romaji["メニューを下さい。"], "menyuu o kudasai");
  });

  it("files every row under a topic the app names in German", () => {
    for (const topic of Object.values(TRAVEL_TOPICS)) {
      assert.ok(TOPICS.includes(topic), `${topic} is not a topic`);
      assert.ok(TOPIC_KEYS.includes(topic), `${topic} has no German name`);
    }
    const rounds = travelAssignments(rows).filter((a) => a.tag.startsWith("travel"));
    assert.equal(rounds.length, rows.length, "every row carries its round");
  });

  it("refuses a row it cannot trust", () => {
    assert.throws(() => parseTravel("3\t1708637440067\tすみません"), /round/);
    assert.throws(() => parseTravel("1\t1708637440067\tすみません\n1\t1708637440067\tすみません"), /twice/);
    assert.throws(() => parseTravel("1\t9000000000001\tこんにちは。\tkonnichiwa\tHello\t"), /reading/);
    assert.throws(() => parseTravel("1\t9000000000001\tこんにちは。"), /needs round/);
    assert.throws(() => parseTravel("1\t9000000000001\tこんにちは。\tこんにちわ\tHello\tbeach"), /not a topic/);
  });
});
