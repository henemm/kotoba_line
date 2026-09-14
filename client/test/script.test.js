import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MODES } from "../src/modes.js";
import { toRomaji } from "../src/romaji.js";
import { appName, modeName, showsScript, shownWord, visibleModes, wordRomaji } from "../src/script.js";
import { canVoice, flipsMeaningFirst, isInHerDeck, meaningPool, showsSentence } from "../src/screens/session.js";
import { cardsOfDeck } from "../src/screens/deck-cards.js";

describe("Japanese script off (#135)", () => {
  const kaishi = { word: "大丈夫", word_furigana: "大丈夫[だいじょうぶ]", word_reading: "だいじょうぶ" };
  // Her own card: `word_furigana` is always NULL there (server/src/cards.js).
  const ownWithReading = { word: "食べる", word_furigana: null, word_reading: "たべる" };
  const ownWithoutReading = { word: "食べる", word_furigana: null, word_reading: null };

  it("shows the word in romaji, written the way it is typed", () => {
    assert.equal(shownWord(kaishi, false), "daijoubu");
    assert.equal(shownWord(ownWithReading, false), "taberu");
    assert.equal(showsScript(kaishi, false), false);
  });

  it("keeps a word's two readings apart (v67)", () => {
    const nani = { word: "何", word_furigana: "何[なに・なん]", word_reading: "なに・なん" };
    assert.equal(shownWord(nani, false), "nani / nan");
    assert.equal(wordRomaji({ word: "七", word_furigana: "七[なな・しち]" }), "nana / shichi");
    // One reading that cannot be read makes the whole line a guess: none.
    assert.equal(wordRomaji({ word: "何", word_furigana: null, word_reading: "なに・何" }), undefined);
    // A ・ that is part of the word itself is a word break, not a choice.
    assert.equal(wordRomaji({ word: "コーヒー・ショップ", word_furigana: null, word_reading: null }), toRomaji("コーヒー・ショップ"));
  });

  it("shows the Japanese rather than a guess where no reading exists", () => {
    assert.equal(wordRomaji(ownWithoutReading), undefined);
    assert.equal(shownWord(ownWithoutReading, false), "食べる");
    // …and says it did, so the word keeps its Japanese font.
    assert.equal(showsScript(ownWithoutReading, false), true);
  });

  it("changes nothing with the script on", () => {
    assert.equal(shownWord(kaishi, true), "大丈夫");
    assert.equal(showsScript(kaishi, true), true);
  });

  it("sets a word from her Noji lists in Latin type, whatever the switch (#139)", () => {
    // What Kaishi could not fill in arrives as the romaji she typed into Noji.
    const fromNoji = { word: "Ōkii", word_furigana: null, word_reading: null };
    assert.equal(showsScript(fromNoji, true), false);
    assert.equal(showsScript(fromNoji, false), false);
  });

  it("names the app in Latin letters with the script off (#139)", () => {
    assert.equal(appName(true), "ことばライン");
    assert.equal(appName(false), "Kotoba Line");
  });

  it("names a mode in English instead of Japanese", () => {
    const choose = MODES.find((m) => m.key === "choose");
    assert.equal(modeName(choose, true), "選ぶ");
    assert.equal(modeName(choose, false), "Pick the meaning");
  });
});

describe("hidden practice lines (#133)", () => {
  it("leaves out the hidden lines, in the lines' own order", () => {
    assert.deepEqual(
      visibleModes(["listen", "type"]).map((m) => m.key),
      ["choose", "speak", "flip"],
    );
  });

  it("shows every line rather than none", () => {
    assert.equal(visibleModes(MODES.map((m) => m.key)).length, MODES.length);
    assert.equal(visibleModes(undefined).length, MODES.length);
  });
});

describe("選ぶ's wrong answers (#135, #137)", () => {
  // Furigana the way the deck writes it: the bracket follows the kanji only.
  const kaishi = (id, word, furigana, reading, meaning) => ({ id, word, word_furigana: furigana, word_reading: reading, word_meaning: meaning });
  const iru = kaishi(1, "居る", "居[い]る", "いる", "to exist");
  const iruNeed = kaishi(2, "要る", "要[い]る", "いる", "to need");
  const taberu = kaishi(3, "食べる", "食[た]べる", "たべる", "to eat");
  const mine = (id, word, meaning) => ({ id, word, word_reading: null, word_meaning: meaning, list_name: "100 vokabeln" });
  const densha = mine(-3, "Densha", "Zug");
  const basu = mine(-2, "Basu", "Bus");
  const pool = [iru, iruNeed, taberu, densha, basu];

  it("never offers a look-alike word's meaning with the script off", () => {
    assert.deepEqual(meaningPool(iru, pool, false).map((c) => c.id), [3]);
  });

  it("asks めくる from her Noji lists German first, and the Kaishi deck word first (#137)", () => {
    assert.equal(flipsMeaningFirst(densha), true);
    assert.equal(flipsMeaningFirst(taberu), false);
    // A word she added in the app herself belongs to no list.
    assert.equal(flipsMeaningFirst({ ...taberu, list_name: null }), false);
  });

  it("keeps her German lists and the English deck apart", () => {
    assert.deepEqual(meaningPool(densha, pool, false).map((c) => c.id), [-2]);
    assert.ok(!meaningPool(taberu, pool, true).some((c) => c.list_name));
  });
  it("gives a sentence sentences and a word words, on her lists (v66)", () => {
    const lecker = mine(-10, "Totemo oishii desu", "Es ist sehr lecker");
    const phrases = [
      mine(-11, "Nihongo o benkyou shiteimasu", "Ich lerne Japanisch"),
      mine(-12, "Shashin o totte mo ii desu ka?", "Darf ich ein Foto machen?"),
      mine(-13, "Kimi to hanasu no tanoshii", "Es macht Spaß mit dir zu reden"),
    ];
    const words = [mine(-20, "Kore dake", "Nur das"), mine(-21, "Kata", "Schulter"), mine(-22, "Naze", "Warum")];
    const lists = [lecker, ...phrases, ...words, densha, basu];
    assert.deepEqual(meaningPool(lecker, lists, false).map((c) => c.id), [-11, -12, -13]);
    // Two words is still a word: "Nur das" gets "Zug", not "Ich lerne Japanisch".
    assert.ok(meaningPool(words[0], lists, false).every((c) => c.word_meaning.split(" ").length < 3));
    // Fewer than three alike: the whole list, rather than too few wrong answers.
    assert.equal(meaningPool(lecker, [lecker, phrases[0], ...words], false).length, 4);
    // Kaishi keeps its pool whatever the length of a gloss.
    const long = kaishi(4, "なる", "なる", "なる", "to become, to result in");
    assert.deepEqual(meaningPool(long, [long, iru, taberu], true).map((c) => c.id), [1, 3]);
  });
});

describe("what a card plays and shows (v66)", () => {
  it("synthesises Japanese, never romaji", () => {
    assert.equal(canVoice("Totemo oishii desu", null), false);
    assert.equal(canVoice("これ", null), true);
    assert.equal(canVoice("Totemo oishii desu", "x.mp3"), true);
    assert.equal(canVoice(null, null), false);
  });

  it("offers a sentence only with something to read beside it", () => {
    const kore = { sentence: "<b>これ</b>は日本語の本です。", sentence_meaning: null };
    assert.equal(showsSentence(kore, false), false);
    assert.equal(showsSentence(kore, true), true);
    assert.equal(showsSentence({ ...kore, sentence_meaning: "This is a Japanese book." }, false), true);
    assert.equal(showsSentence({ sentence: null, sentence_meaning: "x" }, true), false);
  });
});

describe("the cards on a deck's page (#137, v68)", () => {
  const kaishi = (id, word, meaning, rank) => ({ id, word, word_meaning: meaning, deck: "kaishi", frequency_rank: rank });
  const hers = (id, word, meaning, deckId, extra = {}) => ({ id, word, word_meaning: meaning, deck: "personal", deck_id: deckId, ...extra });
  const cards = [
    kaishi(2, "食べる", "to eat", 20),
    kaishi(1, "する", "to do", 1),
    hers(-100, "Eki wa doko desu ka", "Wo ist der Bahnhof", 3),
    hers(-300, "Densha", "Zug", 3),
    hers(-200, "Basu", "Bus", 4),
    hers(-400, "Kuruma", "Auto", 3, { deleted_at: 5 }),
    // Cached before migration 016 reached this phone: no deck_id yet.
    hers(-500, "Yomu", "Lesen", undefined, { list_name: "1000" }),
  ];
  const imZug = { key: "deck:3", id: 3, name: "Im Zug" };

  it("lists one of her decks newest first, and never a Kaishi card (v69)", () => {
    assert.deepEqual(cardsOfDeck(imZug, cards).map((c) => c.id), [-300, -100]);
    assert.ok(cardsOfDeck(imZug, cards, "suru").every((c) => c.deck === "personal"));
  });

  it("finds a card by its German or its romaji", () => {
    assert.deepEqual(cardsOfDeck(imZug, cards, "bahnhof").map((c) => c.id), [-100]);
    assert.deepEqual(cardsOfDeck(imZug, cards, "densha").map((c) => c.id), [-300]);
  });

  it("finds a card cached before its deck had a number by the list it came from", () => {
    assert.deepEqual(cardsOfDeck({ key: "deck:9", id: 9, name: "1000" }, cards).map((c) => c.id), [-500]);
    assert.equal(isInHerDeck(cards[6]), true);
    assert.equal(isInHerDeck(cards[0]), false);
    assert.equal(flipsMeaningFirst(hers(-1, "Densha", "Zug", 3)), true);
  });
});
