import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError, isSessionExpired, query } from "../src/api.js";
import { weakestTopic } from "../src/screens/practise.js";
import { MODES, modeByKey } from "../src/modes.js";
import { endDotOffset, levelProgress, visibleTopics } from "../src/screens/stats.js";
import { formatInterval, kanaReading, leavingCopy, parseFurigana, plainSentence, playableIn, recalled, sentenceKana, speakUsesSentence, splitEmphasis } from "../src/screens/session.js";
import { toRomaji } from "../src/romaji.js";
import { chosenSentence, mmss } from "../src/screens/summary.js";
import { pickDistractors, shuffle as deckShuffle } from "../src/deck.js";
import { mediaUrl } from "../src/audio.js";
import { when } from "../src/screens/settings.js";
import { byFrequencyThenId, matchesQuery } from "../src/screens/browse.js";
import { offlineStatus } from "../src/outbox.js";
import { unwrap } from "../src/store.js";
import { describe as describeResume, isResumable, tokyoDay } from "../src/resume.js";
import { activeLabel, isDefault, summaryLine } from "../src/screens/choose-set.js";
import { accentLabel, accentsOf, contour } from "../src/pitch.js";
import { signedOutCopy } from "../src/screens/signed-out.js";
import { fold } from "../src/viewport.js";

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

describe("signed out by the server (design 52)", () => {
  const text = (opts) => offlineStatus(opts)?.text ?? null;

  it("says signed out, not offline — the server is reachable", () => {
    assert.equal(
      text({ online: true, waiting: 14, signedOut: true }),
      "Signed out · 14 reviews waiting",
    );
  });

  it("states what is waiting, never what was last sent", () => {
    // Both places 52 prints a number print this one. The bar's own history
    // (the "Synced · N sent" case above) is why this is worth a test.
    assert.equal(
      text({ online: true, waiting: 3, justSent: 14, signedOut: true }),
      "Signed out · 3 reviews waiting",
    );
  });

  it("drops the count when there is nothing waiting", () => {
    assert.equal(text({ online: true, waiting: 0, signedOut: true }), "Signed out");
  });

  it("says review, not reviews, for one", () => {
    assert.equal(text({ online: true, waiting: 1, signedOut: true }), "Signed out · 1 review waiting");
  });

  it("prefers offline, because she cannot sign in without a connection", () => {
    assert.equal(
      text({ online: false, waiting: 14, signedOut: true }),
      "Offline · 14 reviews waiting",
    );
  });

  it("puts the same waiting count in the paragraph as in the bar", () => {
    const { title, body } = signedOutCopy(14);
    assert.equal(title, "Sign in again to keep syncing");
    assert.match(body, /^Your session on the server ran out\./);
    assert.match(body, /The 14 answers waiting here are safe on this device/);
    assert.match(body, /will send as soon as you are back in\.$/);
  });

  it("reads as English for a single answer", () => {
    assert.match(signedOutCopy(1).body, /The one answer waiting here is safe/);
  });

  it("promises nothing it cannot keep when the outbox is empty", () => {
    const { body } = signedOutCopy(0);
    assert.equal(body, "Your session on the server ran out. Nothing is waiting to send.");
    // No count, and nothing about answers being safe: there are none.
    assert.doesNotMatch(body, /answer/);
  });

  it("does not claim to know when she practised", () => {
    // The drawing says "the 14 answers from this morning"; the screen has no
    // idea what time it is, and at night that would be a small lie inside a
    // reassurance.
    assert.doesNotMatch(signedOutCopy(14).body, /morning|afternoon|evening|today/i);
  });
});

describe("the two kinds of 401", () => {
  it("tells an expired cookie from a wrong PIN", () => {
    // Same status; only the body separates them. Getting this wrong would make
    // a wrong PIN typed into 52 re-fire the screen it was typed into, clearing
    // the cells and the rate-limit countdown with it.
    assert.equal(isSessionExpired(new ApiError(401, { error: "unauthenticated" })), true);
    assert.equal(isSessionExpired(new ApiError(401, { error: "invalid_credentials" })), false);
  });

  it("is not fooled by another status or a bodyless response", () => {
    assert.equal(isSessionExpired(new ApiError(429, { error: "unauthenticated" })), false);
    assert.equal(isSessionExpired(new ApiError(401, undefined)), false);
    assert.equal(isSessionExpired(new Error("nope")), false);
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

  it("keeps her own cards unaffected by any of the three speak sources", () => {
    // No sentence at all — her own cards, and the pre-#77 fallback everyone
    // else already relied on.
    const noSentence = card({ sentence: null, sentence_meaning: null });
    for (const speakSource of ["word", "sentence", "random"]) {
      assert.equal(speakUsesSentence(noSentence, speakSource), false, speakSource);
    }
  });

  it("draws from the sentence except when told to draw from the word", () => {
    assert.equal(speakUsesSentence(card(), "sentence"), true);
    assert.equal(speakUsesSentence(card(), "word"), false);
  });

  it("only spends the coin flip where there is an actual choice", () => {
    const wouldPickSentence = () => 0.1; // < 0.5
    assert.equal(speakUsesSentence(card(), "random", wouldPickSentence), true);
    // A card with nothing to choose between never asks the coin at all — it
    // would have said "sentence" here if it had, which is the bug this guards.
    assert.equal(speakUsesSentence(card({ sentence: null }), "random", wouldPickSentence), false);
    const wouldPickWord = () => 0.9; // >= 0.5
    assert.equal(speakUsesSentence(card(), "random", wouldPickWord), false);
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

describe("browsing the deck cached on the device (#22)", () => {
  const card = (over = {}) => ({
    id: 1,
    word: "食べる",
    word_reading: "たべる",
    word_furigana: "食[た]べる",
    word_meaning: "to eat, to consume",
    frequency_rank: 100,
    ...over,
  });

  it("matches nothing to an empty query — the same as no filter at all", () => {
    assert.equal(matchesQuery(card(), ""), true);
    assert.equal(matchesQuery(card(), undefined), true);
  });

  it("matches the word, its reading or its furigana as a plain substring", () => {
    assert.equal(matchesQuery(card(), "べる"), true);
    assert.equal(matchesQuery(card(), "たべ"), true);
    assert.equal(matchesQuery(card(), "食[た]"), true);
    assert.equal(matchesQuery(card(), "のむ"), false);
  });

  it("anchors the gloss match to a word start, so a substring is not enough", () => {
    // Same case a plain LIKE '%eat%' would get wrong: "great" and "weather"
    // both contain "eat" but neither one means it.
    assert.equal(matchesQuery(card({ word_meaning: "great weather" }), "eat"), false);
    assert.equal(matchesQuery(card(), "eat"), true);
    // …but a word starting with the query still counts, same as the server.
    assert.equal(matchesQuery(card({ word_meaning: "eating out" }), "eat"), true);
  });

  it("treats the gloss's punctuation as a word boundary too", () => {
    assert.equal(matchesQuery(card({ word_meaning: "(to consume)" }), "consume"), true);
  });

  it("is case-insensitive on the gloss", () => {
    assert.equal(matchesQuery(card(), "EAT"), true);
  });

  it("does not search romaji — the note under an empty result says so", () => {
    assert.equal(matchesQuery(card(), "taberu"), false);
  });

  it("orders like the server does: ranked cards first, unranked last, ties by id", () => {
    const ranked5 = card({ id: 5, frequency_rank: 5 });
    const ranked2 = card({ id: 2, frequency_rank: 2 });
    const unranked1 = card({ id: 1, frequency_rank: null });
    const unranked9 = card({ id: 9, frequency_rank: null });
    const tie = card({ id: 3, frequency_rank: 5 });
    const sorted = [unranked9, ranked5, unranked1, tie, ranked2].sort(byFrequencyThenId);
    assert.deepEqual(sorted.map((c) => c.id), [2, 3, 5, 1, 9]);
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

  it("stops the base at the kanji, even with no space to mark the boundary (#75)", () => {
    // A real sentence from the deck: Anki's leading space is not reliable —
    // the bolded occurrence of a word gets none, the plain one does, in the
    // very same sentence. The base used to be "anything that is not a
    // bracket or a space", which swallowed the whole clause before 人[ひと]
    // as part of its "base" (silently discarded) whenever there was no space
    // to stop it at.
    assert.deepEqual(parseFurigana("あの人[ひと]はいい 人[ひと]です。"), [
      { text: "あの" },
      { base: "人", reading: "ひと" },
      { text: "はいい" },
      { base: "人", reading: "ひと" },
      { text: "です。" },
    ]);
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

describe("sentence romaji's word-boundary guess (#75)", () => {
  it("nothing without a sentence reading", () => {
    assert.equal(sentenceKana(undefined), undefined);
    assert.equal(sentenceKana(null), undefined);
  });

  it("puts a space at the furigana boundary next to a particle", () => {
    assert.equal(
      sentenceKana("<b>図書館[としょかん]</b>でにほんごのべんきょうをします。"),
      "としょかん でにほんごのべんきょうをします。",
    );
    assert.equal(toRomaji(sentenceKana("<b>図書館[としょかん]</b>でにほんごをします。"))
      , "toshokan denihongowoshimasu.");
  });

  it("never breaks a plain-kana word open, even one that contains a particle character", () => {
    // でも and とても are common words whose *second* mora is a particle
    // character. Nothing here should ever put a space inside them — only at
    // a furigana boundary, which these sentences do have (時間[じかん]), right
    // before the run that happens to start with でも/とても.
    assert.equal(toRomaji(sentenceKana("<b>時間[じかん]</b>でもたりません。")), "jikan demotarimasen.");
    assert.equal(
      toRomaji(sentenceKana("<b>時間[じかん]</b>がとてもかかります。")),
      "jikan gatotemokakarimasu.",
    );
    // No furigana at all: nothing to anchor a boundary on, so the whole
    // thing stays one fused run rather than a guess that could be wrong.
    assert.equal(toRomaji(sentenceKana("それでもいいです。")), "soredemoiidesu.");
  });

  it("never splits a multi-kanji word's own bracket groups, even when one ends in a particle character", () => {
    // 友達 (friend) is split by Anki into two brackets, 友[とも] and 達[だち] —
    // とも happens to end in も, one of the particle characters. The two
    // brackets are still one word and must stay fused: "tomodachi", never
    // "tomo dachi". No boundary is ever guessed between two annotated
    // brackets in a row, on either side of them — 時間[じかん] and 友[とも]
    // are two different words with nothing between them in the data, and
    // that pair fuses too ("jikantomodachi"), same trade-off as a sentence
    // with no furigana at all: left fused rather than guessed apart wrong.
    assert.equal(
      toRomaji(sentenceKana("1[いち] 時[じ] 間[かん] 友[とも] 達[だち]を 待[ま]ちました。")),
      "ichijikantomodachi wo machimashita.",
    );
  });

  it("strips the deck's <b> emphasis markup before reading the kana", () => {
    assert.equal(sentenceKana("<b>私[わたし]</b>はアンです。").startsWith("わたし"), true);
    assert.equal(sentenceKana("<b>私[わたし]</b>はアンです。").includes("<b>"), false);
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

describe("a chosen set's summary (40)", () => {
  it("says which it was, and what is still waiting", () => {
    assert.equal(
      chosenSentence({ chosenLabel: "konbini", stillDue: 22 }),
      "Your konbini set, not today's reviews. 22 cards are still due.",
    );
    assert.equal(
      chosenSentence({ chosenLabel: "konbini", stillDue: 1 }),
      "Your konbini set, not today's reviews. 1 card is still due.",
    );
  });

  it("becomes 'nothing else is due' at zero", () => {
    // At which point the two buttons collapse into one, because there is
    // nothing to carry on to.
    assert.equal(
      chosenSentence({ chosenLabel: "konbini", stillDue: 0 }),
      "Your konbini set, not today's reviews. Nothing else is due today.",
    );
  });

  it("says nothing about the queue when it could not be asked", () => {
    // Offline the count is unknowable, and inventing one would be worse than
    // leaving the sentence short.
    assert.equal(
      chosenSentence({ chosenLabel: "konbini" }),
      "Your konbini set, not today's reviews.",
    );
  });
});

describe("an unfinished session (51)", () => {
  const DAY = "2026-09-10";
  const at = (iso) => Date.parse(iso);
  const saved = (over = {}) => ({
    mode: "choose",
    cardIds: [1, 2, 3, 4],
    index: 1,
    at: at(`${DAY}T09:00:00+09:00`),
    ...over,
  });

  it("is offered inside four hours, on the same Tokyo day", () => {
    assert.equal(isResumable(saved(), at(`${DAY}T12:00:00+09:00`)), true);
  });

  it("expires after four hours", () => {
    assert.equal(isResumable(saved(), at(`${DAY}T13:30:00+09:00`)), false);
  });

  it("expires at the Tokyo day boundary even when four hours have not passed", () => {
    // Started at 23:00 Tokyo, reopened at 01:00: two hours later, but the
    // streak has already turned over and the queue with it.
    const late = saved({ at: at(`${DAY}T23:00:00+09:00`) });
    assert.equal(isResumable(late, at("2026-09-11T01:00:00+09:00")), false);
  });

  it("is not offered when there is nothing left of it", () => {
    assert.equal(isResumable(saved({ index: 4 }), at(`${DAY}T09:30:00+09:00`)), false);
    assert.equal(isResumable(saved({ cardIds: [] }), at(`${DAY}T09:30:00+09:00`)), false);
    assert.equal(isResumable(undefined), false);
  });

  it("says how far she got and how long ago", () => {
    assert.equal(describeResume(saved(), at(`${DAY}T09:20:00+09:00`)), "1 of 4 done, 20 minutes ago");
    assert.equal(describeResume(saved(), at(`${DAY}T09:00:30+09:00`)), "1 of 4 done, just now");
    assert.equal(describeResume(saved(), at(`${DAY}T11:00:00+09:00`)), "1 of 4 done, 2 hours ago");
  });

  it("uses the same day boundary as the streak", () => {
    // §8a counts days in Asia/Tokyo. A session and the day it counts towards
    // must not disagree about when the day ended.
    assert.equal(tokyoDay(at("2026-09-10T14:59:00Z")), "2026-09-10");
    assert.equal(tokyoDay(at("2026-09-10T15:00:00Z")), "2026-09-11");
  });
});

describe("what the store hands back for a key that was never set", () => {
  // Regression: `result?.result ?? result` returned the IDBRequest itself when
  // the stored value was undefined, because ?? only falls through on undefined
  // — and an IDBRequest is truthy. A device that had never paused a download
  // was told it had.
  const request = (value) => ({ readyState: "done", result: value });

  it("unwraps a request whose result is undefined, rather than returning the request", () => {
    assert.equal(unwrap(request(undefined)), undefined);
    assert.equal(unwrap(request(0)), 0);
    assert.equal(unwrap(request(false)), false);
    assert.equal(unwrap(request({ handle: "mira" })).handle, "mira");
  });

  it("passes a plain value through, which is what a write returns", () => {
    assert.equal(unwrap(undefined), undefined);
    assert.deepEqual(unwrap({ handle: "mira" }), { handle: "mira" });
  });
});

describe("the pitch contour (#21)", () => {
  const shape = (reading, accent) => {
    const c = contour(reading, accent);
    return c && c.moras.map((m, i) => (c.high[i] ? "‾" : "_")).join("") + (c.particleHigh ? "‾" : "_");
  };

  it("draws the three patterns, particle included", () => {
    // The particle is the last character: it is the only thing that separates
    // 花 [2] from 鼻 [0], both はな, both low-high.
    assert.equal(shape("はな", 0), "_‾‾", "鼻 — stays up");
    assert.equal(shape("はな", 2), "_‾_", "花 — falls after the word");
    assert.equal(shape("あめ", 1), "‾__", "雨 — falls at once");
    assert.equal(shape("せんせい", 3), "_‾‾__", "先生");
    assert.equal(shape("わたし", 0), "_‾‾‾", "私");
  });

  it("keeps a small kana with the mora it rides on", () => {
    // べんきょう is four moras, not five: べ-ん-きょ-う.
    assert.equal(contour("べんきょう", 0).moras.length, 4);
    assert.equal(shape("べんきょう", 0), "_‾‾‾‾");
  });

  it("has nothing to draw where the deck said nothing", () => {
    // Her own cards carry no accent, and the deck draws none on ten
    // single-mora words. An invented contour would be a guess shown as a fact.
    assert.equal(contour("はな", undefined), undefined);
    assert.equal(contour("はな", null), undefined);
    assert.equal(contour("", 0), undefined);
    assert.equal(contour("はな", 5), undefined, "an accent past the last mora is not a contour");
  });

  it("reports both accents where the deck gives two", () => {
    assert.deepEqual(accentsOf({ word_pitch: "0,2" }), [0, 2]);
    assert.equal(accentLabel({ word_pitch: "0,2" }), "[0 or 2]");
    assert.equal(accentLabel({ word_pitch: "2" }), "[2]");
    assert.equal(accentLabel({}), undefined);
    assert.deepEqual(accentsOf({ word_pitch: null }), []);
  });
});

describe("the remembered viewport height", () => {
  // iOS hands back a viewport 61px shorter than the screen after a resume or a
  // dismissed keyboard, and the tab bar floats above the bottom edge until the
  // app is force quit. Stale readings are always *too small*, so keeping the
  // tallest one seen makes the timing of the reading irrelevant — which is the
  // whole reason this is a fold over readings and not a re-measure on resume.
  it("keeps the tallest height and ignores a short reading", () => {
    let seen = fold({}, { width: 394, height: 859 });
    assert.equal(seen.tallest, 859);
    seen = fold(seen, { width: 394, height: 798 });
    assert.equal(seen.tallest, 859, "the short reading is the stale one");
    assert.equal(seen.lowest, 798, "but it is still worth reporting");
  });

  it("recovers on its own if the first reading was the short one", () => {
    let seen = fold({}, { width: 394, height: 798 });
    assert.equal(seen.tallest, 798);
    seen = fold(seen, { width: 394, height: 859 });
    assert.equal(seen.tallest, 859);
  });

  it("ignores a measurement taken while the page is hidden", () => {
    // A backgrounded page can report 0, and 0 is not a height.
    const seen = fold({ tallest: 859, lowest: 859 }, { width: 0, height: 0 });
    assert.equal(seen.tallest, 859);
    assert.equal(seen.lowest, 859);
  });
});
