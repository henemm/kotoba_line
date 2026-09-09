import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TOPICS,
  glossForMatching,
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
    assert.deepEqual(tagsFromRules("train station"), ["travel"]);
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
