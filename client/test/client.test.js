import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_RESHOWS, comesRoundAgain, reshowPosition } from "../src/reshow.js";
import { ApiError, isSessionExpired, query } from "../src/api.js";
import { weakestTopic } from "../src/screens/practise.js";
import { MODES, modeByKey } from "../src/modes.js";
import { endDotOffset, jokerNoticeCopy, levelProgress, noticeSlots, streakResetCopy, visibleTopics } from "../src/screens/stats.js";
import { breakHintCheck, formatInterval, kanaReading, leavingCopy, parseFurigana, plainSentence, playableIn, readingsOf, recalled, sentenceKana, speakUsesSentence, splitEmphasis, typingAnswers } from "../src/screens/session.js";
import { toRomaji } from "../src/romaji.js";
import { chosenSentence, mmss } from "../src/screens/summary.js";
import { isSentence, pickDistractors, shuffle as deckShuffle } from "../src/deck.js";
import { mediaUrl } from "../src/audio.js";
import { serverBuildLine, when } from "../src/screens/settings.js";
import { byFrequencyThenId, matchesQuery } from "../src/screens/browse.js";
import { offlineStatus } from "../src/outbox.js";
import { unwrap } from "../src/store.js";
import { describe as describeResume, isResumable, localDay } from "../src/resume.js";
import { activeLabel, isDefault, scopeOf, summaryLine } from "../src/screens/choose-set.js";
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

describe("the lines", () => {
  it("are the five modes, each with its own colour", () => {
    assert.deepEqual(MODES.map((m) => m.key), ["choose", "listen", "speak", "type", "flip"]);
    assert.equal(new Set(MODES.map((m) => m.colour)).size, 5);
    assert.equal(modeByKey("type").jp, "書く");
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

describe("the joker-spent notice (designs 04/19, #86)", () => {
  it("says what the design says for one day", () => {
    const { headline, body } = jokerNoticeCopy({ days: 1, streak: 13, jokers: 2 });
    // German since v75; design 04/19's sentences, translated.
    assert.equal(headline, "Gestern hast du nichts wiederholt. Ein Joker hat den Tag abgedeckt.");
    assert.equal(body, "Deine Serie hält: 13 Tage. Zwei Joker übrig; fünf Tage am Stück bringen einen neuen.");
  });

  it("names several days, and a balance of one or none", () => {
    assert.equal(
      jokerNoticeCopy({ days: 3, streak: 20, jokers: 0 }).headline,
      "Drei Tage ohne Wiederholung. Drei Joker haben sie abgedeckt.",
    );
    assert.match(jokerNoticeCopy({ days: 2, streak: 11, jokers: 1 }).body, /Ein Joker übrig;/);
    assert.match(jokerNoticeCopy({ days: 1, streak: 5, jokers: 0 }).body, /^Deine Serie hält: 5 Tage\. Kein Joker mehr übrig;/);
    assert.match(jokerNoticeCopy({ days: 1, streak: 1, jokers: 0 }).body, /: 1 Tag\./);
  });

  it("says design 08's sentences when a gap ended the streak (#89)", () => {
    const four = streakResetCopy({ days: 4, cards: 486, level: 7, streak: 0 });
    assert.equal(four.headline, "Vier Tage ohne Wiederholung, und kein Joker mehr, der sie abdeckt.");
    assert.equal(four.body, "Die Serie ist wieder bei null. Sonst hat sich nichts geändert: 486 Karten, Level 7, und dein Lernplan macht weiter, wo er war.");
    assert.equal(four.next, "Zehn Wiederholungen heute starten die nächste. Fünf Tage am Stück bringen einen Joker zurück.");
    // 08's note: "1 day → 'A day without reviews'".
    assert.equal(streakResetCopy({ days: 1, cards: 10, level: 2, streak: 0 }).headline, "Ein Tag ohne Wiederholung, und kein Joker mehr, der ihn abdeckt.");
    assert.match(streakResetCopy({ days: 12, cards: 1, level: 1, streak: 0 }).headline, /^12 Tage/);
    assert.match(streakResetCopy({ days: 2, cards: 1, level: 1, streak: 0 }).body, /1 Karte,/);
    assert.match(streakResetCopy({ days: 2, cards: 10, level: 2, streak: 1 }).next, /^Heute zählt schon als Tag eins\./);
  });

  it("draws held, then spent, then empty slots — three in all", () => {
    assert.deepEqual(noticeSlots({ jokers: 2, days: 1 }), ["filled", "filled", "spent"]);
    assert.deepEqual(noticeSlots({ jokers: 0, days: 1 }), ["spent", "empty", "empty"]);
    assert.deepEqual(noticeSlots({ jokers: 1, days: 2 }), ["filled", "spent", "spent"]);
    assert.deepEqual(noticeSlots({ jokers: 3, days: 3 }), ["filled", "filled", "filled"]);
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

  it("offers sentences against a sentence and words against a word (#237)", () => {
    const phrase = card(20, "It was delicious. (when finishing a meal)", null, ["food", "travel 1"]);
    const mixed = [
      ...pool,
      phrase,
      card(21, "The check, please.", null, ["restaurant", "travel 1"]),
      card(22, "Where is the toilet?", null, ["travel 1"]),
      card(23, "I need your help.", null, ["travel 1"]),
    ];
    const forPhrase = pickDistractors(phrase, mixed, 3).map((c) => c.word_meaning);
    assert.deepEqual(forPhrase.sort(), ["I need your help.", "The check, please.", "Where is the toilet?"]);
    // …and the other way round: a word does not get a sentence while words remain.
    const forWord = pickDistractors(answer, mixed, 3).map((c) => c.word_meaning);
    assert.ok(forWord.every((m) => !isSentence(m)), forWord.join(" | "));
  });

  it("tells a sentence from a word's gloss the way the live deck needs", () => {
    for (const s of ["Good afternoon.", "Where is the toilet?", "Please help!", "It was delicious. (when finishing a meal)"]) {
      assert.ok(isSentence(s), s);
    }
    // Kaishi glosses: lower case, ellipses, abbreviations.
    for (const w of ["to eat", "what kind of...", "afternoon, p.m.", "by no means, never!", "I'm not sure, Hmm..."]) {
      assert.ok(!isSentence(w), w);
    }
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

  it("keeps a recording's practice/ subdirectory as a path, not an escaped slash (#183 follow-up)", () => {
    const url = mediaUrl("practice/own-11112222-3333-4444-5555-666677778888.mp3", "https://host/kotoba/");
    assert.equal(url, "/kotoba/media/practice/own-11112222-3333-4444-5555-666677778888.mp3");
    assert.ok(!url.includes("%2F"));
  });
});

describe("the diagnostics clock", () => {
  const at = (iso) => Date.parse(iso) / 1000;

  it("shows a time for today and a date for anything older", () => {
    const now = new Date("2026-09-09T20:00:00");
    assert.match(when(at("2026-09-09T09:38:00"), now), /^\d{2}:\d{2}$/);
    // German since v75: "04. Sept."
    assert.match(when(at("2026-09-04T09:38:00"), now), /^\d{2}\. \p{L}{3,4}\.?$/u);
  });

  it("does not call yesterday evening today just because the clock is close", () => {
    // The trap is comparing elapsed hours rather than calendar days: 23:50
    // and 00:10 are ten hours apart in neither direction that matters.
    const now = new Date("2026-09-09T00:10:00");
    assert.match(when(at("2026-09-08T23:50:00"), now), /^\d{2}\. \p{L}{3,4}\.?$/u);
  });
});

describe("the Server diagnostic (Henning, 2026-09-17: it read 1.0.0 forever)", () => {
  it("says when the server was deployed and from which commit", () => {
    const line = serverBuildLine({ commit: "d1772f7", builtAt: Date.parse("2026-09-17T11:52:00") / 1000 });
    assert.match(line, /^17\.09\.2026, 11:52 · d1772f7$/);
  });

  it("says unknown rather than a number that means nothing, for a server built without ops/deploy.sh", () => {
    assert.equal(serverBuildLine({ commit: null, builtAt: null }), "unbekannt");
    assert.equal(serverBuildLine(undefined), "unbekannt");
  });
});

describe("the offline strip's three states (design 25)", () => {
  const text = (opts) => offlineStatus(opts)?.text ?? null;

  it("shows nothing at all when online with an empty outbox", () => {
    assert.equal(offlineStatus({ online: true, waiting: 0, justSent: 0 }), null);
  });

  it("states the queue depth when offline", () => {
    assert.equal(text({ online: false, waiting: 14 }), "Offline · 14 Wiederholungen warten");
    assert.equal(text({ online: false, waiting: 0 }), "Offline");
  });

  it("counts what was sent, not what is left", () => {
    // The one arithmetic mistake this strip can make, and the version before
    // this put the waiting count next to the word "sent".
    assert.equal(text({ online: true, waiting: 0, justSent: 14 }), "Synchronisiert · 14 Wiederholungen gesendet");
  });

  it("does not claim to be offline when the outbox is merely stuck", () => {
    assert.equal(text({ online: true, waiting: 3 }), "3 Wiederholungen warten aufs Senden");
    assert.equal(offlineStatus({ online: true, waiting: 3 }).tone, "offline");
  });

  it("says review, not reviews, for one", () => {
    assert.equal(text({ online: false, waiting: 1 }), "Offline · 1 Wiederholung wartet");
    assert.equal(text({ online: true, justSent: 1 }), "Synchronisiert · 1 Wiederholung gesendet");
  });
});

describe("signed out by the server (design 52)", () => {
  const text = (opts) => offlineStatus(opts)?.text ?? null;

  it("says signed out, not offline — the server is reachable", () => {
    assert.equal(
      text({ online: true, waiting: 14, signedOut: true }),
      "Abgemeldet · 14 Wiederholungen warten",
    );
  });

  it("states what is waiting, never what was last sent", () => {
    // Both places 52 prints a number print this one. The bar's own history
    // (the "Synced · N sent" case above) is why this is worth a test.
    assert.equal(
      text({ online: true, waiting: 3, justSent: 14, signedOut: true }),
      "Abgemeldet · 3 Wiederholungen warten",
    );
  });

  it("drops the count when there is nothing waiting", () => {
    assert.equal(text({ online: true, waiting: 0, signedOut: true }), "Abgemeldet");
  });

  it("says review, not reviews, for one", () => {
    assert.equal(text({ online: true, waiting: 1, signedOut: true }), "Abgemeldet · 1 Wiederholung wartet");
  });

  it("prefers offline, because she cannot sign in without a connection", () => {
    assert.equal(
      text({ online: false, waiting: 14, signedOut: true }),
      "Offline · 14 Wiederholungen warten",
    );
  });

  it("puts the same waiting count in the paragraph as in the bar", () => {
    const { title, body } = signedOutCopy(14);
    assert.equal(title, "Melde dich wieder an, damit weiter synchronisiert wird");
    assert.match(body, /^Deine Anmeldung auf dem Server ist abgelaufen\./);
    assert.match(body, /Die 14 Antworten, die hier warten, sind auf diesem Gerät sicher und werden gesendet/);
    assert.match(body, /sobald du wieder angemeldet bist\.$/);
  });

  it("reads as correct German for a single answer", () => {
    // "ist … und wird", not "ist … und werden" — the first German draft said that.
    assert.match(signedOutCopy(1).body, /Die eine Antwort, die hier wartet, ist auf diesem Gerät sicher und wird gesendet,/);
  });

  it("promises nothing it cannot keep when the outbox is empty", () => {
    const { body } = signedOutCopy(0);
    assert.equal(body, "Deine Anmeldung auf dem Server ist abgelaufen. Es wartet nichts darauf, gesendet zu werden.");
    // No count, and nothing about answers being safe: there are none.
    assert.doesNotMatch(body, /Antwort/);
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

  it("leaves the modes that need no more than a word alone", () => {
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
    // A sentence with no translation has no prompt to show (#137).
    assert.equal(speakUsesSentence(card({ sentence_meaning: null }), "sentence"), false);
    const wouldPickWord = () => 0.9; // >= 0.5
    assert.equal(speakUsesSentence(card(), "random", wouldPickWord), false);
  });

  it("drops a 聞く card with nothing to listen to", () => {
    // The audio *is* the question here, so these are unanswerable rather
    // than merely thin.
    assert.deepEqual(playableIn("listen", [card({ sentence: null })]), []);
    assert.deepEqual(playableIn("listen", [card({ sentence_meaning: null })]), []);
  });

  it("drops a 書く card with no reading to check an answer against (#97)", () => {
    const deckCard = card({ word_furigana: "水[みず]" });
    const ownWithReading = card({ id: -1, word: "食べる", word_furigana: null, word_reading: "たべる" });
    const ownKana = card({ id: -2, word: "もう", word_furigana: null, word_reading: null });
    const ownKanjiOnly = card({ id: -3, word: "猫", word_furigana: null, word_reading: null });
    assert.deepEqual(
      playableIn("type", [deckCard, ownWithReading, ownKana, ownKanjiOnly]).map((c) => c.id),
      [1, -1, -2],
    );
  });

  it("reads both of 何's readings, and nothing that is not kana", () => {
    assert.deepEqual(readingsOf(card({ word: "何", word_furigana: "何[なに・なん]" })), ["なに", "なん"]);
    assert.deepEqual(readingsOf(card({ word: "コーヒー", word_furigana: "コーヒー" })), ["こーひー"]);
    assert.deepEqual(readingsOf(card({ word: "猫", word_furigana: null, word_reading: "neko" })), []);
  });

  it("accepts another card for a 書く prompt only when the meaning is the same words", () => {
    const big = card({ id: 10, word: "大きい", word_furigana: "大[おお]きい", word_meaning: "big, large" });
    const pool = [
      big,
      card({ id: 11, word: "大きな", word_furigana: "大[おお]きな", word_meaning: "Big, large " }),
      card({ id: 12, word: "巨大", word_furigana: "巨大[きょだい]", word_meaning: "huge, big" }),
    ];
    assert.deepEqual(typingAnswers(big, pool).map((a) => a.id), [10, 11]);
  });

  it("keeps a card with no recording when speech can stand in", () => {
    const noAudio = [card({ sentence_audio: null })];
    assert.equal(playableIn("listen", noAudio, true).length, 1);
    // …and drops it on a device that cannot speak either.
    assert.equal(playableIn("listen", noAudio, false).length, 0);
  });

  it("drops a 聞く card whose only sound would be a voice reading romaji (v66)", () => {
    const romaji = card({ sentence: "Totemo oishii desu", sentence_audio: null });
    assert.equal(playableIn("listen", [romaji], true).length, 0);
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

  // It did not until v69; search.test.js has the rest.
  it("searches romaji, from the start of a word", () => {
    assert.equal(matchesQuery(card(), "taberu"), true);
    assert.equal(matchesQuery(card(), "beru"), false);
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
    assert.equal(formatInterval(30), "<1 Min");
    assert.equal(formatInterval(360), "6 Min");
    assert.equal(formatInterval(5400), "2 Std");
    assert.equal(formatInterval(86400), "1 Tag");
    assert.equal(formatInterval(691200), "8 Tage");
    assert.equal(formatInterval(5184000), "2 Monate");
    assert.equal(formatInterval(40000000), "1 Jahr");
  });

  it("is absent rather than invented when the scheduler said nothing", () => {
    assert.equal(formatInterval(undefined), undefined);
    assert.equal(formatInterval(null), undefined);
  });

  it("never rounds a real wait down to zero", () => {
    // 59 seconds is still a wait; "0m" under a button would read as "now".
    assert.equal(formatInterval(59), "<1 Min");
    assert.equal(formatInterval(60), "1 Min");
  });
});

describe("what the leaving sheet says (50)", () => {
  it("counts in words that agree with the number", () => {
    assert.equal(
      leavingCopy(1),
      "Die Karte, die du beantwortet hast, ist schon gespeichert. Der Rest kommt wieder in die Reihe.",
    );
    assert.equal(
      leavingCopy(4),
      "Die 4 Karten, die du beantwortet hast, sind schon gespeichert. Der Rest kommt wieder in die Reihe.",
    );
  });
});

describe("the gentle break hint (#218)", () => {
  const MIN = 60 * 1000;

  // Cards drawn at the given minutes, none of them a real away-from-screen
  // gap. Returns the last `due` and the state to carry on with.
  function practice(state, ...minutes) {
    let due;
    for (const m of minutes) ({ due, state } = breakHintCheck(state, m * MIN));
    return { due, state };
  }

  it("stays quiet before the first 20 minutes", () => {
    assert.equal(practice(undefined, 0, 19).due, false);
  });

  it("fires once the 20 minute threshold is crossed", () => {
    assert.equal(practice(undefined, 0, 20).due, true);
  });

  it("does not fire twice for the same threshold", () => {
    const { state } = practice(undefined, 0, 20);
    assert.equal(practice(state, 24).due, false);
  });

  it("fires again after another 20 minutes of the same stretch", () => {
    const { state } = practice(undefined, 0, 20);
    assert.equal(practice(state, 40).due, true);
  });

  it("counts two sessions back to back as one stretch", () => {
    const { state } = practice(undefined, 0, 16); // session 1
    // Session 2 starts a minute later — nowhere near the 20-minute mark on
    // its own, but the streak carries over, so 21 total minutes is over it.
    assert.equal(practice(state, 17, 21).due, true);
  });

  it("#221: a single long card does not reset the streak — only a real away-from-screen gap does", () => {
    // A 21-minute card (a recording, a hard 書く) with no backgrounding in
    // between: the streak must still be the one that started at 0, so 21
    // minutes in is over the threshold, not the start of a fresh one.
    assert.equal(practice(undefined, 0, 21).due, true);
  });

  it("starts a fresh stretch when the app was actually away too long", () => {
    const { state } = practice(undefined, 0, 16); // 16 minutes in
    // Ten minutes in the background, then back: the earlier 16 minutes no
    // longer count, so 5 minutes into the new stretch is nowhere near it.
    const away = breakHintCheck(state, 26 * MIN, true);
    assert.equal(away.due, false);
  });

  it("#222: a device clock stepping backward never goes below the streak's own start", () => {
    const { state } = breakHintCheck(undefined, 10 * MIN);
    // The clock steps back 3 minutes before the next card, without the app
    // ever leaving the foreground (awayTooLong stays false).
    const after = breakHintCheck(state, 7 * MIN);
    assert.equal(after.due, false);
    assert.equal(after.state.streakStart, state.streakStart, "the streak itself must not restart");
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
  it("names every dimension inside a deck, defaults included (#137)", () => {
    // The sheet's own line states what the scheduler chose rather than going
    // blank. The deck is not one of them: it was chosen on the deck list.
    assert.equal(summaryLine({ deckKey: "kaishi" }), "jedes Thema · heute fällig");
    // A set saved by v60–v62 still says where it was. The topic is drawn in
    // German (client/src/topics.js) and stays "konbini" in the data.
    assert.equal(
      summaryLine({ deck: "personal", tag: "konbini", only: "starred" }),
      "mein Deck · Konbini · markiert",
    );
    assert.equal(summaryLine({ deckKey: "kaishi", tag: "food" }), "Essen · heute fällig");
  });

  it("truncates from the left, because the last-set filter is the live one", () => {
    assert.equal(
      summaryLine({ deck: "kaishi", tag: "konbini", only: "starred" }, { max: 2 }),
      "… · Konbini · markiert",
    );
  });

  it("carries only what she changed onto the session's dashed rule", () => {
    // 39 reads "Your set · konbini". Naming the untouched defaults there would
    // make a one-filter session look like an elaborate one.
    assert.equal(activeLabel({ tag: "konbini" }), "Konbini");
    assert.equal(activeLabel({ tag: "host family", only: "starred" }), "Gastfamilie · Markiert");
    assert.equal(activeLabel({}), "");
  });

  it("names a session of cards due in the next two days, which the sheet cannot choose (#90)", () => {
    assert.equal(activeLabel({ only: "ahead" }), "In zwei Tagen fällig");
    assert.equal(summaryLine({ only: "ahead" }), "jedes Thema · in zwei Tagen fällig");
    assert.equal(summaryLine({ only: "lapsed" }), "jedes Thema · vergessen");
  });

  it("knows when nothing was chosen at all", () => {
    assert.equal(isDefault({}), true);
    assert.equal(isDefault({ tag: "food" }), false);
    assert.equal(isDefault({ deck: "personal", list: "100 vokabeln" }), false);
  });

  it("calls one of her lists by its own name (#137)", () => {
    const list = { deck: "personal", list: "100 vokabeln" };
    assert.equal(summaryLine(list), "100 vokabeln · jedes Thema · heute fällig");
    assert.equal(activeLabel({ ...list, only: "new" }), "100 vokabeln · Neu");
  });

  it("keeps the deck, and lets the topic and the only go (#137)", () => {
    assert.deepEqual(scopeOf({ deckKey: "list:1000", tag: "food", only: "starred" }), { deckKey: "list:1000" });
    assert.equal(isDefault({ deckKey: "list:1000" }), true, "being in a deck is not a narrowing");
  });
});

describe("a chosen set's summary (40)", () => {
  it("says which it was, and what is still waiting", () => {
    assert.equal(
      chosenSentence({ chosenLabel: "Konbini", stillDue: 22 }),
      "Deine Auswahl „Konbini“, nicht die Wiederholungen von heute. 22 Karten sind noch fällig.",
    );
    assert.equal(
      chosenSentence({ chosenLabel: "Konbini", stillDue: 1 }),
      "Deine Auswahl „Konbini“, nicht die Wiederholungen von heute. 1 Karte ist noch fällig.",
    );
  });

  it("becomes 'nothing else is due' at zero", () => {
    // At which point the two buttons collapse into one, because there is
    // nothing to carry on to.
    assert.equal(
      chosenSentence({ chosenLabel: "Konbini", stillDue: 0 }),
      "Deine Auswahl „Konbini“, nicht die Wiederholungen von heute. Heute ist nichts anderes mehr fällig.",
    );
  });

  it("says nothing about the queue when it could not be asked", () => {
    // Offline the count is unknowable, and inventing one would be worse than
    // leaving the sentence short.
    assert.equal(
      chosenSentence({ chosenLabel: "Konbini" }),
      "Deine Auswahl „Konbini“, nicht die Wiederholungen von heute.",
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

  // The app leaves the zone to the device; the tests name one, because the
  // machine running them is not in Tokyo.
  const TOKYO = "Asia/Tokyo";

  it("is offered inside four hours, on the same day", () => {
    assert.equal(isResumable(saved(), at(`${DAY}T12:00:00+09:00`), TOKYO), true);
  });

  it("expires after four hours", () => {
    assert.equal(isResumable(saved(), at(`${DAY}T13:30:00+09:00`), TOKYO), false);
  });

  it("expires at midnight even when four hours have not passed", () => {
    // Started at 23:00, reopened at 01:00: two hours later, but the streak
    // has already turned over and the queue with it.
    const late = saved({ at: at(`${DAY}T23:00:00+09:00`) });
    assert.equal(isResumable(late, at("2026-09-11T01:00:00+09:00"), TOKYO), false);
    // The same two moments in Berlin are 16:00 and 18:00 on one day.
    assert.equal(isResumable(late, at("2026-09-11T01:00:00+09:00"), "Europe/Berlin"), true);
  });

  it("is not offered when there is nothing left of it", () => {
    assert.equal(isResumable(saved({ index: 4 }), at(`${DAY}T09:30:00+09:00`), TOKYO), false);
    assert.equal(isResumable(saved({ cardIds: [] }), at(`${DAY}T09:30:00+09:00`), TOKYO), false);
    assert.equal(isResumable(undefined), false);
  });

  it("says how far she got and how long ago", () => {
    assert.equal(describeResume(saved(), at(`${DAY}T09:20:00+09:00`)), "1 von 4 geschafft, vor 20 Minuten");
    assert.equal(describeResume(saved(), at(`${DAY}T09:00:30+09:00`)), "1 von 4 geschafft, gerade eben");
    assert.equal(describeResume(saved(), at(`${DAY}T09:01:00+09:00`)), "1 von 4 geschafft, vor 1 Minute");
    assert.equal(describeResume(saved(), at(`${DAY}T11:00:00+09:00`)), "1 von 4 geschafft, vor 2 Stunden");
  });

  it("uses the same day boundary as the streak", () => {
    // The server counts days from midnight in the zone api.js sends it (#122).
    // A session and the day it counts towards must not disagree about when
    // the day ended.
    assert.equal(localDay(at("2026-09-10T14:59:00Z"), TOKYO), "2026-09-10");
    assert.equal(localDay(at("2026-09-10T15:00:00Z"), TOKYO), "2026-09-11");
    assert.equal(localDay(at("2026-09-10T21:59:00Z"), "Europe/Berlin"), "2026-09-10");
    assert.equal(localDay(at("2026-09-10T22:00:00Z"), "Europe/Berlin"), "2026-09-11");
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
    assert.equal(accentLabel({ word_pitch: "0,2" }), "[0 oder 2]");
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

describe("comesRoundAgain (#214, shared with the multi-day simulation, #242)", () => {
  it("sends a Nochmal card round again, three times at most", () => {
    assert.deepEqual([0, 1, 2, 3].map((n) => comesRoundAgain(1, n)), [true, true, true, false]);
    assert.equal(MAX_RESHOWS, 3);
  });

  it("never sends a card round again for Schwer, Gut or Leicht", () => {
    for (const rating of [2, 3, 4]) assert.equal(comesRoundAgain(rating, 0), false);
  });
});

describe("reshowPosition (#242)", () => {
  it("puts a Nochmal card three cards on, or at the end when fewer are left", () => {
    assert.equal(reshowPosition(0, 60), 4);
    assert.equal(reshowPosition(10, 12), 12);
    assert.equal(reshowPosition(59, 60), 60);
  });
});
