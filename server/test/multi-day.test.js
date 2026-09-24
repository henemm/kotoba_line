import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openDatabase } from "../src/db.js";
import { PATTERNS, PROFILES, experience, logFingerprint, rebuildMatches, simulate } from "./simulate-days.js";
import { seedUser } from "./helpers.js";

/**
 * Thirty days of practice, simulated (#242): new words keep coming, and every
 * card comes back when the label under the button said it would.
 *
 * The cards here are made up — 1,500, ranked like Kaishi — because CI has no
 * deck. `simulate-report.js` runs the same simulation on a `.backup` copy of
 * a real database: on Charlotte's, 2026-09-19, from her own history on, in
 * Kaishi and in "100 vokabeln", three profiles each — 0 violations (#242).
 *
 * Each check in simulate-days.js was shown to bite before this was merged, by
 * putting an old bug back and counting what it reported (2026-09-19): #210's
 * lapsed group by `lapses > 0` 1,579 cards early; #215's exact-time due 1,399
 * cards late; the daily new-card limit per session instead of per day 30 new
 * words a day; Nochmal coming round once instead of three times 42 sessions.
 */

const DAYS = 30;
const START = "2026-09-20";

async function learner() {
  const db = openDatabase(":memory:");
  const user = await seedUser(db);
  const card = db.prepare(
    "INSERT INTO cards (id, word, word_meaning, frequency_rank, deck) VALUES (?, ?, ?, ?, 'kaishi')",
  );
  for (let i = 1; i <= 1500; i++) card.run(i, `語${i}`, `word ${i}`, i);
  return { db, userId: user.id };
}

async function run(profile, seed = 1) {
  const { db, userId } = await learner();
  const result = await simulate(db, userId, { start: START, days: DAYS, profile, seed });
  return { db, userId, ...result };
}

describe("thirty days of practice (#242)", () => {
  for (const [name, profile] of Object.entries(PROFILES)) {
    it(`keeps every promise for a learner who is ${name}`, async () => {
      const { violations } = await run(profile);
      assert.deepEqual(violations.slice(0, 10), [], `${violations.length} violations`);
    });
  }

  it("brings the deck's daily number of new words every day she keeps up", async () => {
    const { rows, newPerDay } = await run(PROFILES.fleissig);
    assert.equal(newPerDay, 15);
    // Two sessions a day, and still fifteen: the limit is on the day.
    assert.deepEqual(rows.map((r) => r.fresh), Array(DAYS).fill(15));
  });

  it("brings new words again on the first day back after three days away", async () => {
    const { rows } = await run(PROFILES.luecke);
    assert.deepEqual(rows.slice(9, 12).map((r) => r.sessions), [0, 0, 0]);
    assert.equal(rows[12].fresh, 15);
  });

  it("brings a Nochmal card round again in the same session", async () => {
    const { showings } = await run(PROFILES.schwach);
    const { ratings } = experience(showings);
    // She finishes every session here, so every Nochmal comes round.
    assert.equal(ratings["neu:1"].sameSession, 100);
    // Ten cards on (#272) at this simulation's 20 s an answer. At Charlotte's
    // own pace, 6 s, the same ten cards measured 105 s over her log.
    assert.equal(ratings["neu:1"].median, "4 Min");
  });

  it("brings Schwer and Gut back in the same session when their minutes run out in it (#242)", async () => {
    // One evening session, not the default two. Since the session cap went
    // (#242, 2026-09-21) the first session of the day takes *all* of the
    // day's cards, new ones included — as in Noji — so with a morning 選ぶ
    // session the evening めくる one never meets a new card, and Schwer and
    // Leicht on a new card (`neu:2`, `neu:4`) stop occurring at all. That is
    // the change working, not a regression: measured on the same simulation,
    // the "zweimal" pattern now reports "Neu, Schwer –".
    const { db, userId } = await learner();
    const { showings } = await simulate(db, userId, {
      start: START,
      days: DAYS,
      profile: PROFILES.fleissig,
      pattern: PATTERNS["einmal-abends"],
    });
    const { ratings } = experience(showings);
    // A day's cards and their Nochmal take longer than 8 or 15 minutes, so a
    // new word answered early in a session comes back before it ends.
    assert.ok(ratings["neu:2"].sameSession > 0, `Schwer ${ratings["neu:2"].sameSession} %`);
    assert.ok(ratings["neu:3"].sameSession > 0, `Gut ${ratings["neu:3"].sameSession} %`);
  });

  it("gives the whole day's cards in one session, as Noji does (#242)", async () => {
    // The cap was 60. A day of `fleissig` is 15 new words plus their reshows
    // and everything due — this asserts the session is no longer cut at 60,
    // which is what "bis alle Karten erledigt sind" means.
    const { showings } = await run(PROFILES.fleissig);
    const perSession = new Map();
    for (const s of showings) perSession.set(s.session, (perSession.get(s.session) ?? 0) + 1);
    const biggest = Math.max(...perSession.values());
    assert.ok(biggest > 60, `größte Übung ${biggest} Karten`);
  });

  it("brings a Nochmal card back within the session even when she stops after twenty (#242)", async () => {
    const { db, userId } = await learner();
    const { violations, showings } = await simulate(db, userId, { start: START, days: DAYS, profile: PROFILES.realistisch, pattern: PATTERNS.pendeln });
    assert.deepEqual(violations.slice(0, 10), [], `${violations.length} violations`);
    const { ratings } = experience(showings);
    // At the end of the queue it was 7 % (measured 2026-09-19); three cards
    // on, 83 % (100 of 121). Since #250 the 07:40 train counts as the day it
    // is on, not the one before, which changes which cards are due in it:
    // 79 % (92 of 117) — measured 2026-09-19, and of the misses, 4 were not
    // among a session's last three cards, where before #250 it was 7.
    //
    // #272 moved it ten cards on, because three was 24 s at her pace and she
    // stopped pressing Nochmal. The price is paid here, in twenty-card
    // sessions she abandons: 47 % (measured 2026-09-24). The rest are due a
    // minute later and open the next session; nothing is lost, it is only
    // not seen again on the same train.
    assert.ok(ratings["neu:1"].sameSession >= 40, `${ratings["neu:1"].sameSession} %`);
    // What the buttons say for a new card is Noji's.
    assert.deepEqual(
      [1, 2, 3, 4].map((r) => ratings[`neu:${r}`]?.label),
      ["1 Min", "8 Min", "15 Min", "4 Tage"],
    );
  });

  // #246, #250: a session that runs past midnight, and one on the train
  // that runs past 09:00 in Tokyo — where the UTC date, which ts-fsrs counts
  // days by, changes. Every label printed in them is checked against what
  // was scheduled (`labelOff` in simulate-days.js). Before the fix the 08:50
  // session printed, measured on "100 vokabeln": "2 Tage" under Gut for a
  // card then scheduled for 7.
  //
  // Only the labels: a session from 23:50 also spends tomorrow's new words
  // after midnight, which the day-by-day count of new words reads as a day
  // short of them — true, and not what this is about.
  for (const [name, session, boundary] of [
    ["midnight", { hour: 23, minute: 50, mode: "flip" }, 15 * 3600],
    ["09:00 in Tokyo", { hour: 8, minute: 50, mode: "flip" }, 0],
  ]) {
    it(`keeps the label under every button in a session across ${name} (#246)`, async () => {
      const { db, userId } = await learner();
      const { violations, showings } = await simulate(db, userId, {
        start: START,
        days: DAYS,
        profile: PROFILES.realistisch,
        sessions: [session],
      });
      const labelOff = violations.filter((v) => v.includes("Knopf sagte"));
      assert.deepEqual(labelOff.slice(0, 10), [], `${labelOff.length} labels off`);
      // …and there were labels past the boundary to check: a session whose
      // cards after it all showed none would pass by checking nothing.
      // `boundary` is the UTC second of the day it falls on.
      const crossed = showings.filter((x) => x.label !== undefined && !x.fresh && (x.t - boundary + 86400) % 86400 < 1800);
      assert.ok(crossed.length > 30, `${crossed.length} labelled answers on seen cards after the boundary`);
    });
  }

  it("counts a deck's daily maximum as a full session, not as cards gone missing", async () => {
    const { db, userId } = await learner();
    db.prepare(
      "INSERT INTO deck_settings (user_id, deck_key, new_per_day, max_per_day, updated_at) VALUES (?, 'kaishi', 15, 40, 0)",
    ).run(userId);
    const { rows, violations, maxPerDay } = await simulate(db, userId, { start: START, days: DAYS, profile: PROFILES.fleissig });
    assert.equal(maxPerDay, 40);
    assert.deepEqual(violations.slice(0, 10), [], `${violations.length} violations`);
    // It did bite: some days had to leave owed cards for tomorrow.
    assert.ok(rows.some((r) => r.deferred > 0));
  });

  it("works in one of her own decks, keyed deck:<id>, beside cards from elsewhere", async () => {
    const { db, userId } = await learner();
    const { lastInsertRowid: deckId } = db
      .prepare("INSERT INTO decks (owner_id, name, created_at, updated_at) VALUES (?, '100 vokabeln', 1, 1)")
      .run(userId);
    // Her own cards have negative ids (rule 4) and no frequency rank.
    const card = db.prepare(
      "INSERT INTO cards (id, word, word_meaning, deck, owner_id, deck_id) VALUES (?, ?, ?, 'personal', ?, ?)",
    );
    for (let i = 1; i <= 120; i++) card.run(-i, `私${i}`, `mine ${i}`, userId, deckId);
    db.prepare(
      "INSERT INTO deck_settings (user_id, deck_key, new_per_day, updated_at) VALUES (?, ?, 10, 0)",
    ).run(userId, `deck:${deckId}`);
    // A Kaishi session first, so she has seen cards outside this deck.
    await simulate(db, userId, { start: "2026-09-10", days: 2, profile: PROFILES.fleissig });

    const { rows, violations } = await simulate(db, userId, { deckKey: `deck:${deckId}`, start: START, days: 14, profile: PROFILES.fleissig });
    assert.deepEqual(violations.slice(0, 10), [], `${violations.length} violations`);
    // 120 cards at 10 a day: twelve full days, then the deck has run out.
    assert.deepEqual(rows.map((r) => r.fresh), [...Array(12).fill(10), 0, 0]);
  });

  it("lands on the same log twice, and card_state folds back to itself", async () => {
    const a = await run(PROFILES.schwach, 7);
    const b = await run(PROFILES.schwach, 7);
    assert.equal(logFingerprint(a.db, a.userId), logFingerprint(b.db, b.userId));
    assert.ok(rebuildMatches(a.db, a.userId));
  });
});
