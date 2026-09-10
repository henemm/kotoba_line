import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TOPICS,
  axisOf,
  glossForMatching,
  parseModelPass,
  parseOverrides,
  tagsForCard,
  tagsFromRules,
} from "../lib/tagging.js";

describe("gloss preparation", () => {
  it("drops parenthesised usage notes before matching", () => {
    // "to take (e.g. time or money)" is about neither time nor money.
    assert.equal(glossForMatching("to take (e.g. time or money)"), "to take");
    assert.equal(glossForMatching("I (polite, general)"), "i");
    assert.deepEqual(tagsFromRules("to take (e.g. time or money)"), []);
  });
});

describe("rules", () => {
  it("tags what genuinely belongs to a topic", () => {
    assert.deepEqual(tagsFromRules("teacher"), ["school"]);
    assert.deepEqual(tagsFromRules("older brother"), ["family"]);
    assert.deepEqual(tagsFromRules("tomorrow"), ["time"]);
    assert.deepEqual(tagsFromRules("to eat"), ["food"]);
    assert.deepEqual(tagsFromRules("arm"), ["health"]);
    assert.deepEqual(tagsFromRules("to sleep"), ["health"]);
    // `travel` became `places` with the two axes (#24). The rule matches the
    // same glosses; a station is a place rather than an activity.
    assert.deepEqual(tagsFromRules("train station"), ["places"]);
  });

  it("can give a card more than one topic", () => {
    const tags = tagsFromRules("school lunch");
    assert.ok(tags.includes("school"));
    assert.ok(tags.includes("food"));
  });

  it("leaves the grammatical core of a frequency deck alone", () => {
    // This is most of Kaishi, and no rule or ontology gives these a topic.
    for (const gloss of [
      "to do, to make",
      "to become, to result in",
      "this one",
      "that over there",
      "nonexistent, not being",
      "in such manner, that way",
      "san",
      "a little",
    ]) {
      assert.deepEqual(tagsFromRules(gloss), [], `${gloss} should carry no topic`);
    }
  });

  it("matches whole words only", () => {
    // "eatery" must not count as "eat", "hourly" must not count as "hour".
    assert.deepEqual(tagsFromRules("theatre"), []);
    assert.deepEqual(tagsFromRules("nobody"), []);
    assert.deepEqual(tagsFromRules("payment"), ["money"]);
  });

  it("only ever produces topics from the agreed list", () => {
    for (const gloss of ["teacher", "arm, leg, hospital", "money and time"]) {
      for (const tag of tagsFromRules(gloss)) assert.ok(TOPICS.includes(tag));
    }
  });
});

describe("override file", () => {
  it("parses assignments, blanks and comments", () => {
    const parsed = parseOverrides(
      [
        "# a comment",
        "",
        "店\tkonbini",
        "値段\tmoney,konbini",
        "武器\t # \"weapon, arms\" — arms",
        "勇気",
      ].join("\n"),
    );
    assert.deepEqual(parsed.get("店"), ["konbini"]);
    assert.deepEqual(parsed.get("値段"), ["money", "konbini"]);
    assert.deepEqual(parsed.get("武器"), [], "a trailing comment still clears the tags");
    assert.deepEqual(parsed.get("勇気"), []);
    assert.equal(parsed.has("# a comment"), false);
  });

  it("refuses a topic that is not on the list", () => {
    assert.throws(() => parseOverrides("店\tgroceries"), /unknown topic "groceries"/);
  });

  it("names the line so a typo is findable", () => {
    assert.throws(() => parseOverrides("# c\n店\tkonbini\n袋\tnonsense"), /line 3/);
  });
});

describe("rules and overrides together", () => {
  const overrides = parseOverrides(["武器\t", "店\tkonbini"].join("\n"));

  it("lets an override cancel a wrong rule match", () => {
    // 武器 is "weapon, arms" — the health rules see the limb, not the weapon.
    // Roughly one health match in five is like this, which is why every match
    // is spot-checked and the wrong ones land in the override file.
    const card = { word: "武器", word_meaning: "weapon, arms" };
    assert.deepEqual(tagsFromRules(card.word_meaning), ["health"], "the rule does fire");
    assert.deepEqual(tagsForCard(card, overrides), [], "and the override cancels it");
  });

  it("lets an override add what no rule can see", () => {
    const card = { word: "店", word_meaning: "shop, store" };
    assert.deepEqual(tagsForCard(card, overrides), ["konbini"]);
  });

  it("falls through to the rules for everything else", () => {
    const card = { word: "先生", word_meaning: "teacher" };
    assert.deepEqual(tagsForCard(card, overrides), ["school"]);
  });

  it("is stable — the same card always gets the same topics", () => {
    const card = { word: "毎日", word_meaning: "every day" };
    const first = tagsForCard(card, overrides);
    for (let i = 0; i < 10; i++) assert.deepEqual(tagsForCard(card, overrides), first);
  });
});

describe("the model pass (#24)", () => {
  const pass = parseModelPass(
    [
      "# a comment line",
      "1708637439919\t聞く\tsenses\t",
      "1708637439920\t聞く\tspeaking\t",
      "1708637440944\t酒\tfood\trestaurant",
      "1708637440082\tただ\tmoney\t",
    ].join("\n"),
  );

  it("keys on the card id, so two senses of one word can differ", () => {
    // The reason it is not keyed on the word like the override file: 24 words
    // appear twice in the deck with different meanings, and a word-keyed file
    // gives both cards the same topics — silently losing one of the senses.
    const hear = { id: 1708637439919, word: "聞く", word_meaning: "to hear" };
    const ask = { id: 1708637439920, word: "聞く", word_meaning: "to ask" };
    assert.deepEqual(tagsForCard(hear, new Map(), pass), ["senses"]);
    assert.deepEqual(tagsForCard(ask, new Map(), pass), ["speaking"]);
  });

  it("reads both axes off one line", () => {
    const card = { id: 1708637440944, word: "酒", word_meaning: "alcoholic drink" };
    assert.deepEqual(tagsForCard(card, new Map(), pass), ["food", "restaurant"]);
  });

  it("refuses a topic that is not on either axis", () => {
    assert.throws(() => parseModelPass("1\t語\tnot-a-field\t"), /unknown topic/);
    assert.throws(() => parseModelPass("1\t語\t\tnot-a-situation"), /unknown topic/);
  });

  it("beats the rules but loses to the override file", () => {
    // ただ is "free (of charge)" in one card and "simply" in the other. The
    // rules see neither; the pass calls the first one money. An override still
    // has the last word, which is what makes a wrong topic a one-line fix.
    const card = { id: 1708637440082, word: "ただ", word_meaning: "free" };
    assert.deepEqual(tagsFromRules(card.word_meaning), [], "no rule fires");
    assert.deepEqual(tagsForCard(card, new Map(), pass), ["money"]);

    const overrides = parseOverrides("ただ\tamount");
    assert.deepEqual(tagsForCard(card, overrides, pass), ["amount"]);
    assert.deepEqual(tagsForCard(card, parseOverrides("ただ\t"), pass), [], "including to clear");
  });

  it("falls back to the rules for a card the pass has never seen", () => {
    // An updated Kaishi release brings cards no pass has covered. A keyword
    // rule is a better answer for those than nothing until it is re-run.
    const card = { id: 999, word: "先生", word_meaning: "teacher" };
    assert.deepEqual(tagsForCard(card, new Map(), pass), ["school"]);
  });
});

describe("the two axes", () => {
  it("keeps fields and situations apart", () => {
    assert.equal(axisOf("feelings"), "field");
    assert.equal(axisOf("konbini"), "situation");
    assert.equal(axisOf("small talk"), undefined, "a retired topic is not a topic");
  });

  it("names every topic on exactly one axis", () => {
    assert.equal(new Set(TOPICS).size, TOPICS.length, "no topic appears twice");
    for (const t of TOPICS) assert.ok(axisOf(t), `${t} belongs to no axis`);
  });
});
