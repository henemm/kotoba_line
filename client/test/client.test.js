import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { query } from "../src/api.js";
import { weakestTopic } from "../src/screens/practise.js";
import { MODES, modeByKey } from "../src/modes.js";
import { endDotOffset, levelProgress, visibleTopics } from "../src/screens/stats.js";
import { formatInterval, kanaReading, leavingCopy, parseFurigana, plainSentence, playableIn, recalled, splitEmphasis } from "../src/screens/session.js";
import { mmss } from "../src/screens/summary.js";
import { pickDistractors, shuffle as deckShuffle } from "../src/deck.js";
import { mediaUrl } from "../src/audio.js";
import { when } from "../src/screens/settings.js";
import { offlineStatus } from "../src/outbox.js";
import { activeLabel, isDefault, summaryLine } from "../src/screens/choose-set.js";

describe("query strings", () => {
  it("omits what is not set, so /api/queue gets no empty filters", () => {
    assert.equal(query({ limit: 20, tag: undefined, deck: "", only: null }), "?limit=20");
    assert.equal(query({}), "");
    assert.equal(query(), "");
  });

  it("keeps a zero", () => {
    assert.equal(query({ since: 0 }), "?since=0");
  });

  it("escapes a value", () => {
    assert.equal(query({ q: "small talk" }), "?q=small+talk");
  });
});

describe("the four lines", () => {
  it("are the four modes, each with its own colour", () => {
    assert.deepEqual(MODES.map((m) => m.key), ["choose", "listen", "speak", "flip"]);
    assert.equal(new Set(MODES.map((m) => m.colour)).size, 4);
    assert.equal(modeByKey("flip").jp, "めくる");
    assert.equal(modeByKey("nope"), undefined);
  });
});

describe("which topic is furthest behind", () => {
  const topics = (...t) => ({ topics: t });

  it("is the smallest share seen, not the smallest count", () => {
    const stats = topics(
      { tag: "health", total: 52, seen: 40 },
      { tag: "time", total: 43, seen: 4 },
      { tag: "family", total: 27, seen: 20 },
    );
    assert.equal(weakestTopic(stats).tag, "time");
  });

  it("ignores a topic too small to make a session", () => {
    // konbini holds three cards in the real deck (docs/tagging.md). Without a
    // floor it would always win "furthest behind" and offer a session of three.
    const stats = topics(
      { tag: "konbini", total: 3, seen: 0 },
      { tag: "health", total: 52, seen: 30 },
    );
    assert.equal(weakestTopic(stats).tag, "health");
  });

  it("is undefined when nothing qualifies", () => {
    assert.equal(weakestTopic(topics({ tag: "konbini", total: 3, seen: 0 })), undefined);
    assert.equal(weakestTopic({ topics: [] }), undefined);
    assert.equal(weakestTopic(undefined), undefined);
  });
});

describe("the level bar", () => {
  it("fills in proportion to progress through the level", () => {
    // Level 10 spans 5,500 to 6,600.
    const at = (xp) => levelProgress({ xp, xpForLevel: 5500, xpForNextLevel: 6600 }).filled;
    assert.equal(at(5500), 0, "just levelled up");
    assert.equal(at(6050), 6, "halfway");
    assert.equal(at(6600), 12, "at the next threshold");
  });

  it("reports what is left to the next level", () => {
    assert.equal(
      levelProgress({ xp: 5764, xpForLevel: 5500, xpForNextLevel: 6600 }).remaining,
      836,
    );
  });

  it("does not divide by zero or overflow the bar", () => {
    assert.equal(levelProgress({ xp: 0, xpForLevel: 0, xpForNextLevel: 0 }).filled, 0);
    assert.equal(levelProgress({ xp: 9999, xpForLevel: 0, xpForNextLevel: 100 }).filled, 12);
    assert.equal(levelProgress({ xp: 9999, xpForLevel: 0, xpForNextLevel: 100 }).remaining, 0);
  });
});

describe("the topic bar's end dot", () => {
  it("is clamped inside the track at both extremes", () => {
    // Half the dot is 7px; at the ends it has to tuck in or hang off the edge.
    assert.equal(endDotOffset(0), "-3px");
    assert.equal(endDotOffset(3), "-3px");
    assert.equal(endDotOffset(50), "-7px");
    assert.equal(endDotOffset(97), "-7px");
    assert.equal(endDotOffset(98), "-11px");
    assert.equal(endDotOffset(100), "-11px");
  });
});

describe("which topics the Stats screen draws", () => {
  const topics = [
    { tag: "family", total: 27, seen: 2 },
    { tag: "food", total: 18, seen: 1 },
    { tag: "health", total: 52, seen: 11 },
    { tag: "money", total: 9, seen: 1 },
    { tag: "school", total: 12, seen: 2 },
    { tag: "small talk", total: 22, seen: 3 },
    { tag: "time", total: 43, seen: 5 },
    { tag: "konbini", total: 3, seen: 0 },
  ];

  it("leaves out a topic she has never met", () => {
    const { seen } = visibleTopics(topics, false);
    assert.ok(!seen.some((t) => t.tag === "konbini"), "0 seen is absence, not progress");
    assert.equal(seen.length, 7);
  });

  it("truncates past five and reports how many are behind the rule", () => {
    const { shown, hidden } = visibleTopics(topics, false);
    assert.equal(shown.length, 5);
    assert.equal(hidden, 2);
  });

  it("shows everything once expanded", () => {
    const { shown, hidden } = visibleTopics(topics, true);
    assert.equal(shown.length, 7);
    assert.equal(hidden, 0);
  });

  it("does not offer a rule when there is nothing behind it", () => {
    assert.equal(visibleTopics(topics.slice(0, 3), false).hidden, 0);
    assert.equal(visibleTopics([], false).shown.length, 0);
    assert.equal(visibleTopics(undefined, false).shown.length, 0);
  });
});

describe("the sentence's emphasis", () => {
  it("splits Kaishi's <b> into runs", () => {
    assert.deepEqual(splitEmphasis("<b>これ</b>は日本語の本です。"), [
      { text: "これ", bold: true },
      { text: "は日本語の本です。", bold: false },
    ]);
  });

  it("handles a conjugated target in the middle — the case a heuristic misses", () => {
    // The prototype guessed at this by stripping a trailing kana and substring
    // matching. The deck already knows: 食べる appears as 食べました.
    assert.deepEqual(splitEmphasis("昨日タイカレーを<b>食べました</b>。"), [
      { text: "昨日タイカレーを", bold: false },
      { text: "食べました", bold: true },
      { text: "。", bold: false },
    ]);
  });

  it("copes with no markup, and with nothing at all", () => {
    assert.deepEqual(splitEmphasis("ただの文。"), [{ text: "ただの文。", bold: false }]);
    assert.deepEqual(splitEmphasis(""), []);
    assert.deepEqual(splitEmphasis(undefined), []);
  });

  it("never yields an empty run", () => {
    for (const s of ["<b></b>あ", "あ<b>い</b>", "<b>あ</b>"]) {
      assert.ok(splitEmphasis(s).every((p) => p.text.length > 0), s);
    }
  });
});

describe("distractors", () => {
  const card = (id, meaning, rank, tags = []) => ({
    id,
    word: `語${id}`,
    word_meaning: meaning,
    frequency_rank: rank,
    tags,
  });

  const answer = card(1, "to eat", 100, ["food"]);
  const pool = [
    answer,
    card(2, "to drink", 110, ["food"]),      // same tag, near rank
    card(3, "delicious", 120, ["food"]),     // same tag, near rank
    card(4, "meal", 900, ["food"]),          // same tag, far rank
    card(5, "teacher", 130, ["school"]),     // near rank only
    card(6, "tomorrow", 5000, ["time"]),     // neither
  ];

  it("prefers cards that share a tag and sit nearby in frequency", () => {
    const picked = pickDistractors(answer, pool, 2, () => 0);
    assert.deepEqual(picked.map((c) => c.word_meaning).sort(), ["delicious", "to drink"]);
  });

  it("never offers the answer itself", () => {
    for (let i = 0; i < 20; i++) {
      assert.ok(!pickDistractors(answer, pool, 3).some((c) => c.id === answer.id));
    }
  });

  it("never repeats a card", () => {
    const picked = pickDistractors(answer, pool, 3);
    assert.equal(new Set(picked.map((c) => c.id)).size, picked.length);
  });

  it("never offers a card whose gloss reads the same as the answer's", () => {
    const twin = card(9, "to eat", 105, ["food"]);
    const picked = pickDistractors(answer, [...pool, twin], 3);
    assert.ok(!picked.some((c) => c.id === twin.id), "two right answers is not a question");
  });

  it("falls back rather than returning nothing when the pool is thin", () => {
    const thin = [answer, card(7, "tomorrow", 9000, ["time"])];
    assert.equal(pickDistractors(answer, thin, 3).length, 1);
    assert.equal(pickDistractors(answer, [answer], 3).length, 0);
  });

  it("fills up from wider tiers when the good ones run out", () => {
    const picked = pickDistractors(answer, pool, 4, () => 0);
    assert.equal(picked.length, 4);
    // The two same-tag near-rank cards must be among them.
    const meanings = picked.map((c) => c.word_meaning);
    assert.ok(meanings.includes("to drink"));
    assert.ok(meanings.includes("delicious"));
  });
});

describe("the summary's clock", () => {
  it("reads as minutes and seconds", () => {
    assert.equal(mmss(0), "0:00");
    assert.equal(mmss(26), "0:26");
    assert.equal(mmss(252), "4:12");
    assert.equal(mmss(605), "10:05");
  });
});

describe("where the audio lives", () => {
  it("sits under the app's own prefix, not above it", () => {
    // §9 serves it at /kotoba/media/. "../media/" would resolve to /media/ and
    // 404 every file — invisibly, because speech synthesis would cover for it.
    assert.equal(
      mediaUrl("JLPT_Tango_N5_0001.mp3", "https://host/kotoba/"),
      "/kotoba/media/JLPT_Tango_N5_0001.mp3",
    );
  });

  it("works when the app is served from the root too", () => {
    assert.equal(mediaUrl("a.mp3", "https://host/"), "/media/a.mp3");
  });

  it("escapes a filename with Japanese in it", () => {
    // Two thirds of the deck's audio is named after the word it reads.
    const url = mediaUrl("私_ワタシ━_0_NHK-2016.mp3", "https://host/kotoba/");
    assert.ok(url.startsWith("/kotoba/media/"));
    assert.ok(!url.includes(" "));
    assert.equal(decodeURIComponent(url), "/kotoba/media/私_ワタシ━_0_NHK-2016.mp3");
  });
});

describe("the diagnostics clock", () => {
  const at = (iso) => Date.parse(iso) / 1000;

  it("shows a time for today and a date for anything older", () => {
    const now = new Date("2026-09-09T20:00:00");
    assert.match(when(at("2026-09-09T09:38:00"), now), /^\d{2}:\d{2}$/);
    assert.match(when(at("2026-09-04T09:38:00"), now), /^\d{2} \w{3,4}$/);
  });

  it("does not call yesterday evening today just because the clock is close", () => {
    // The trap is comparing elapsed hours rather than calendar days: 23:50
    // and 00:10 are ten hours apart in neither direction that matters.
    const now = new Date("2026-09-09T00:10:00");
    assert.match(when(at("2026-09-08T23:50:00"), now), /^\d{2} \w{3,4}$/);
  });
});

describe("the offline strip's three states (design 25)", () => {
  const text = (opts) => offlineStatus(opts)?.text ?? null;

  it("shows nothing at all when online with an empty outbox", () => {
    assert.equal(offlineStatus({ online: true, waiting: 0, justSent: 0 }), null);
  });

  it("states the queue depth when offline", () => {
    assert.equal(text({ online: false, waiting: 14 }), "Offline · 14 reviews waiting");
    assert.equal(text({ online: false, waiting: 0 }), "Offline");
  });

  it("counts what was sent, not what is left", () => {
    // The one arithmetic mistake this strip can make, and the version before
    // this put the waiting count next to the word "sent".
    assert.equal(text({ online: true, waiting: 0, justSent: 14 }), "Synced · 14 reviews sent");
  });

  it("does not claim to be offline when the outbox is merely stuck", () => {
    assert.equal(text({ online: true, waiting: 3 }), "3 reviews waiting to send");
    assert.equal(offlineStatus({ online: true, waiting: 3 }).tone, "offline");
  });

  it("says review, not reviews, for one", () => {
    assert.equal(text({ online: false, waiting: 1 }), "Offline · 1 review waiting");
    assert.equal(text({ online: true, justSent: 1 }), "Synced · 1 review sent");
  });
});

describe("which cards a mode can actually ask about", () => {
  const card = (over = {}) => ({
    id: 1, word: "水", word_meaning: "water",
    sentence: "<b>水</b>をください。", sentence_meaning: "Water, please.",
    sentence_audio: "s.mp3", ...over,
  });

  it("leaves the other three modes alone", () => {
    const cards = [card(), card({ id: 2, sentence: null, sentence_meaning: null })];
    for (const mode of ["choose", "speak", "flip"]) {
      assert.equal(playableIn(mode, cards).length, 2, mode);
    }
  });

  it("drops a 聞く card with nothing to listen to", () => {
    // The audio *is* the question here, so these are unanswerable rather
    // than merely thin.
    assert.deepEqual(playableIn("listen", [card({ sentence: null })]), []);
    assert.deepEqual(playableIn("listen", [card({ sentence_meaning: null })]), []);
  });

  it("keeps a card with no recording when speech can stand in", () => {
    const noAudio = [card({ sentence_audio: null })];
    assert.equal(playableIn("listen", noAudio, true).length, 1);
    // …and drops it on a device that cannot speak either.
    assert.equal(playableIn("listen", noAudio, false).length, 0);
  });
});

describe("comparing what she said", () => {
  it("compares against the sentence without the deck's markup", () => {
    // <b> marks the target word; leaving it in would never match anything.
    assert.equal(plainSentence("<b>水</b>をください。"), "水をください。");
    assert.equal(plainSentence(null), undefined);
  });
});

describe("what counts as recalled", () => {
  it("treats hard as a recall, not a miss", () => {
    // FSRS does: only *again* is a lapse. Counting hard as wrong would put a
    // card she knew into "worth another look".
    assert.deepEqual([1, 2, 3, 4].map(recalled), [false, true, true, true]);
  });
});

describe("Anki's bracket readings", () => {
  it("splits a word into base and reading", () => {
    assert.deepEqual(parseFurigana("事[こと]"), [{ base: "事", reading: "こと" }]);
  });

  it("keeps the plain text between annotated runs", () => {
    // The space before an annotated run is Anki's separator, not a space in
    // the sentence — leaving it in puts a gap before every kanji.
    assert.deepEqual(parseFurigana(" 兄[あに]は 毎日[まいにち]テレビを 見[み]ます。"), [
      { base: "兄", reading: "あに" },
      { text: "は" },
      { base: "毎日", reading: "まいにち" },
      { text: "テレビを" },
      { base: "見", reading: "み" },
      { text: "ます。" },
    ]);
  });

  it("passes through text with no readings at all", () => {
    assert.deepEqual(parseFurigana("ひらがなだけ"), [{ text: "ひらがなだけ" }]);
    assert.deepEqual(parseFurigana(""), []);
    assert.deepEqual(parseFurigana(null), []);
  });
});

describe("the interval under a rating button (41)", () => {
  it("is coarse on purpose", () => {
    // The number exists to be compared with the three beside it. "2.4d" would
    // claim a precision the scheduler does not.
    assert.equal(formatInterval(30), "<1m");
    assert.equal(formatInterval(360), "6m");
    assert.equal(formatInterval(5400), "2h");
    assert.equal(formatInterval(691200), "8d");
    assert.equal(formatInterval(5184000), "2mo");
    assert.equal(formatInterval(40000000), "1y");
  });

  it("is absent rather than invented when the scheduler said nothing", () => {
    assert.equal(formatInterval(undefined), undefined);
    assert.equal(formatInterval(null), undefined);
  });

  it("never rounds a real wait down to zero", () => {
    // 59 seconds is still a wait; "0m" under a button would read as "now".
    assert.equal(formatInterval(59), "<1m");
    assert.equal(formatInterval(60), "1m");
  });
});

describe("what the leaving sheet says (50)", () => {
  it("counts in words that agree with the number", () => {
    assert.equal(
      leavingCopy(1),
      "The card you answered is already saved. The rest go back in the queue.",
    );
    assert.equal(
      leavingCopy(4),
      "The 4 cards you answered are already saved. The rest go back in the queue.",
    );
  });
});

describe("the reading line under めくる's word (41)", () => {
  it("is the whole word in kana, not the bracket notation", () => {
    assert.equal(kanaReading("見[み]る"), "みる");
    assert.equal(kanaReading("大丈夫[だいじょうぶ]"), "だいじょうぶ");
    assert.equal(kanaReading(" 兄[あに]は 毎日[まいにち]"), "あには まいにち".replace(" ", ""));
  });

  it("reads a kana-only word back as itself, so the line can be dropped", () => {
    assert.equal(kanaReading("いい"), "いい");
    assert.equal(kanaReading(null), undefined);
  });
});

describe("what a chosen set is called (36, 39)", () => {
  it("names every dimension on the practise tab, defaults included", () => {
    // The line above the four lines is how she learns the sheet exists, so it
    // states what the scheduler chose rather than going blank.
    assert.equal(summaryLine({}), "Both decks · any topic · due today");
    assert.equal(
      summaryLine({ deck: "personal", tag: "konbini", only: "starred" }),
      "my deck · konbini · starred",
    );
  });

  it("truncates from the left, because the last-set filter is the live one", () => {
    assert.equal(
      summaryLine({ deck: "kaishi", tag: "konbini", only: "starred" }, { max: 2 }),
      "… · konbini · starred",
    );
  });

  it("carries only what she changed onto the session's dashed rule", () => {
    // 39 reads "Your set · konbini". Naming the untouched defaults there would
    // make a one-filter session look like an elaborate one.
    assert.equal(activeLabel({ tag: "konbini" }), "konbini");
    assert.equal(activeLabel({ tag: "konbini", only: "starred" }), "konbini · Starred");
    assert.equal(activeLabel({}), "");
  });

  it("knows when nothing was chosen at all", () => {
    assert.equal(isDefault({}), true);
    assert.equal(isDefault({ tag: "food" }), false);
  });
});
