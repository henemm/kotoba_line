import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { importList } from "../src/import-list.js";
import { seedUser, signIn, testApp } from "./helpers.js";

/**
 * Her own lists, imported (#137). The rows here have the shape of the real
 * import file, with made-up words — her material is never committed.
 */

function kaishiCard(db) {
  db.prepare(
    `INSERT INTO cards (id, word, word_furigana, word_reading, word_pitch, word_meaning, word_audio,
                        sentence, sentence_furigana, sentence_meaning, sentence_audio,
                        frequency_rank, deck, updated_at)
     VALUES (100, '読む', '読[よ]む', 'よむ', '1', 'to read', 'yomu.mp3',
             '本を<b>読む</b>。', '本[ほん]を<b>読[よ]む</b>。', 'I read a book.', 'yomu-s.mp3', 1, 'kaishi', 1)`,
  ).run();
}

const rows = [
  { list: "list a", position: 1, noteId: "n1-0", front: "Lesen", back: "Yomu", flag: null, kaishiId: 100, check: { status: "confirmed" } },
  { list: "list a", position: 2, noteId: "n2-0", front: "Fußball", back: "Yakyuu", flag: "meaning", kaishiId: null, check: { status: "meaning" } },
  { list: "list b", position: 1, noteId: "n3-0", front: "Wo ist der Bahnhof?", back: "Eki wa doko desu ka?", flag: "sentence", kaishiId: null },
  // The same word in the other list: a card of its own, as in Noji.
  { list: "list b", position: 2, noteId: "n4-0", front: "Lesen", back: "Yomu", flag: null, kaishiId: 100 },
];

async function imported() {
  const { app, db, config } = await testApp();
  const user = await seedUser(db);
  kaishiCard(db);
  const result = importList(db, user.id, rows, { now: 1_800_000_000_000 });
  const cookie = await signIn(app, config);
  const json = async (url) => (await app.inject({ method: "GET", url, headers: { cookie } })).json();
  return { app, db, user, result, json };
}

describe("importing her lists", () => {
  it("makes every row a card of hers, and a word in both lists two cards", async () => {
    const { app, db, user, result } = await imported();
    assert.deepEqual(result, { imported: 4, skipped: 0, enriched: 2, flagged: 2 });
    const cards = db.prepare("SELECT * FROM cards WHERE owner_id = ? ORDER BY id").all(user.id);
    assert.equal(cards.length, 4);
    assert.ok(cards.every((c) => c.deck === "personal" && c.id < 0 && c.updated_at > 0));
    assert.deepEqual(cards.map((c) => c.list_name), ["list a", "list a", "list b", "list b"], "ascending id is the order of the file");
    await app.close();
  });

  it("keeps her German and her romaji, and invents no reading", async () => {
    const { app, db, user } = await imported();
    const card = db.prepare("SELECT * FROM cards WHERE owner_id = ? AND import_ref = ?").get(user.id, "noji:list a:n2-0");
    assert.equal(card.word_meaning, "Fußball");
    assert.equal(card.word, "Yakyuu");
    assert.equal(card.word_reading, null);
    assert.equal(card.word_furigana, null);
    assert.equal(card.word_audio, null);
    await app.close();
  });

  it("takes Kaishi's spelling, recording and sentence where the row names a Kaishi card, and leaves that card alone", async () => {
    const { app, db, user } = await imported();
    const card = db.prepare("SELECT * FROM cards WHERE owner_id = ? AND import_ref = ?").get(user.id, "noji:list a:n1-0");
    assert.equal(card.word, "読む");
    assert.equal(card.word_reading, "よむ");
    assert.equal(card.word_audio, "yomu.mp3");
    assert.equal(card.sentence_audio, "yomu-s.mp3");
    assert.equal(card.word_meaning, "Lesen", "her German, not Kaishi's English");
    assert.equal(card.sentence_meaning, null, "nor the sentence's English");
    const source = JSON.parse(card.import_source);
    assert.equal(source.back, "Yomu", "her own spelling is kept for a later correction");
    assert.equal(source.kaishiId, 100);
    const k = db.prepare("SELECT word_meaning, owner_id, deck FROM cards WHERE id = 100").get();
    assert.deepEqual({ ...k }, { word_meaning: "to read", owner_id: null, deck: "kaishi" });
    await app.close();
  });

  it("marks doubtful cards where no device can see it", async () => {
    const { app, db, user, json } = await imported();
    const flagged = db.prepare("SELECT import_ref, import_flag FROM cards WHERE owner_id = ? AND import_flag IS NOT NULL ORDER BY id").all(user.id);
    assert.deepEqual(flagged.map((r) => r.import_flag), ["meaning", "sentence"]);

    const deck = await json("/api/deck?since=0");
    const sent = deck.cards.filter((c) => c.deck === "personal");
    assert.equal(sent.length, 4);
    assert.ok(sent.every((c) => c.import_flag === undefined && c.import_source === undefined && c.import_ref === undefined));
    assert.deepEqual([...new Set(sent.map((c) => c.list_name))], ["list a", "list b"], "the list travels, for 選ぶ's wrong answers");
    await app.close();
  });

  it("does nothing the second time, so a correction made since is not undone", async () => {
    const { app, db, user } = await imported();
    db.prepare("UPDATE cards SET word_meaning = 'Baseball' WHERE import_ref = 'noji:list a:n2-0'").run();
    const again = importList(db, user.id, rows, { now: 1_800_000_100_000 });
    assert.deepEqual(again, { imported: 0, skipped: 4, enriched: 0, flagged: 0 });
    assert.equal(db.prepare("SELECT word_meaning FROM cards WHERE import_ref = 'noji:list a:n2-0'").get().word_meaning, "Baseball");
    await app.close();
  });

  it("refuses a Kaishi card that does not exist, and imports nothing of that file", async () => {
    const { app, db } = await testApp();
    const user = await seedUser(db);
    assert.throws(() => importList(db, user.id, [{ ...rows[0], kaishiId: 999 }]), /no live Kaishi card/);
    assert.equal(db.prepare("SELECT count(*) n FROM cards").get().n, 0);
    await app.close();
  });

  it("introduces new cards of hers in the order of her list", async () => {
    // Which cards, not the order met: a session shuffles what it chose (§5).
    const { app, json } = await imported();
    const q = await json("/api/queue?deck=personal&only=new&limit=2");
    const deck = await json("/api/deck?since=0");
    const byId = new Map(deck.cards.map((c) => [c.id, c]));
    assert.deepEqual(q.cardIds.map((id) => byId.get(id).import_ref ?? byId.get(id).word_meaning).sort(), ["Fußball", "Lesen"]);
    const first = q.cardIds.map((id) => byId.get(id).list_name);
    assert.deepEqual(first, ["list a", "list a"], "the first list's first two, not the second list's");
    await app.close();
  });
});

describe("migration 013: no English on her lists (#137)", () => {
  const sql = readFileSync(new URL("../migrations/013_no_english_on_her_lists.sql", import.meta.url), "utf8");

  it("takes Kaishi's English off the cards it was copied to, and leaves a translation she wrote", async () => {
    const { app, db, user } = await imported();
    // What the v58 import left behind: Kaishi's translation on both "Lesen" cards.
    db.prepare("UPDATE cards SET sentence_meaning = 'I read a book.', updated_at = 1 WHERE owner_id = ? AND word_meaning = 'Lesen'").run(user.id);
    // …and one she has since corrected by hand.
    db.prepare("UPDATE cards SET sentence_meaning = 'Ich lese ein Buch.' WHERE import_ref = 'noji:list b:n4-0'").run();

    db.exec(sql);

    const rows = db.prepare("SELECT import_ref, sentence_meaning, sentence_audio, updated_at FROM cards WHERE word_meaning = 'Lesen' ORDER BY import_ref").all();
    assert.deepEqual(rows.map((r) => [r.import_ref, r.sentence_meaning, r.sentence_audio]), [
      ["noji:list a:n1-0", null, "yomu-s.mp3"],
      ["noji:list b:n4-0", "Ich lese ein Buch.", "yomu-s.mp3"],
    ]);
    assert.ok(rows[0].updated_at > 1, "stamped, so her phone picks the change up");
    assert.equal(db.prepare("SELECT sentence_meaning FROM cards WHERE id = 100").get().sentence_meaning, "I read a book.", "the Kaishi card keeps its own");
    await app.close();
  });
});

describe("her decks, for the practise tab (#137)", () => {
  it("lists Kaishi, then her lists in the order they came in, each with its cards for today", async () => {
    const { app, json } = await imported();
    const { decks } = await json("/api/decks");
    assert.deepEqual(
      decks.map((d) => [d.key, d.name, d.cards, d.seen, d.today.total, d.today.fresh, d.today.review]),
      [
        ["kaishi", "Kaishi", 1, 0, 1, 1, 0],
        ["deck:1", "list a", 2, 0, 2, 2, 0],
        ["deck:2", "list b", 2, 0, 2, 2, 0],
      ],
      "no \"My words\": every word of hers came from a list",
    );
    assert.deepEqual(decks.map((d) => d.own), [false, true, true]);
    await app.close();
  });

  it("still runs a deck by the name a phone from before decks sends (migration 016)", async () => {
    const { app, json } = await imported();
    const byName = await json(`/api/queue?deckKey=${encodeURIComponent("list:list b")}&limit=20`);
    const byId = await json("/api/queue?deckKey=deck:2&limit=20");
    assert.deepEqual([...byName.cardIds].sort(), [...byId.cardIds].sort());
    assert.equal(byId.cardIds.length, 2);
    await app.close();
  });

  it("runs a deck's queue by its key, and refuses a key that is not a deck", async () => {
    const { app, json } = await imported();
    const listB = await json(`/api/queue?deckKey=${encodeURIComponent("list:list b")}&limit=20`);
    assert.equal(listB.cardIds.length, 2);
    assert.deepEqual(listB.today, { total: 2, fresh: 2, review: 0, learning: 0, mastered: 0 });
    const kaishi = await json("/api/queue?deckKey=kaishi&limit=20");
    assert.deepEqual(kaishi.cardIds, [100]);
    const refused = await json("/api/queue?deckKey=personal");
    assert.equal(refused.statusCode, 400);
    await app.close();
  });
});

describe("settings of one deck (#137, migration 014)", () => {
  const patch = async (app, cookie, body) =>
    app.inject({ method: "PATCH", url: "/api/decks/settings", headers: { cookie }, payload: body });

  async function signedIn() {
    const { app, db, config } = await testApp();
    const user = await seedUser(db);
    kaishiCard(db);
    // A list long enough for a daily limit to bite.
    const many = Array.from({ length: 14 }, (_, i) => ({ list: "long", position: i + 1, noteId: `l${i}-0`, front: `Wort ${i}`, back: `kotoba${i}` }));
    importList(db, user.id, [...rows, ...many], { now: 1_800_000_000_000 });
    const cookie = await signIn(app, config);
    const json = async (url) => (await app.inject({ method: "GET", url, headers: { cookie } })).json();
    return { app, db, user, cookie, json };
  }

  it("starts a list at 10 new cards a day and Kaishi at her overall limit, with every way on", async () => {
    const { app, db, user, json } = await signedIn();
    db.prepare("UPDATE user_settings SET new_per_day = 20 WHERE user_id = ?").run(user.id);
    const { decks } = await json("/api/decks");
    const byName = Object.fromEntries(decks.map((d) => [d.name, d]));
    assert.deepEqual(byName.Kaishi.settings, { hiddenModes: [], newPerDay: 20, maxPerDay: null, extraNew: 0, extraNewDay: null, flipFront: "word" });
    assert.deepEqual(byName.long.settings, { hiddenModes: [], newPerDay: 10, maxPerDay: null, extraNew: 0, extraNewDay: null, flipFront: "meaning" });
    assert.equal(byName.long.today.fresh, 10, "a list of 14 new words offers 10 today");
    await app.close();
  });

  it("says which ways of practising a deck can do", async () => {
    const { app, json } = await signedIn();
    const { decks } = await json("/api/decks");
    const byName = Object.fromEntries(decks.map((d) => [d.name, d]));
    // Kaishi's card has a translated sentence and a reading; the imported
    // "Lesen" took the sentence without its English, the others have neither.
    assert.deepEqual(byName.Kaishi.ways, { choose: 1, listen: 1, speak: 1, type: 1, flip: 1 });
    assert.deepEqual(byName["list a"].ways, { choose: 2, listen: 0, speak: 2, type: 1, flip: 2 });
    await app.close();
  });

  it("keeps each deck's new cards to itself", async () => {
    const { app, cookie, json } = await signedIn();
    assert.equal((await patch(app, cookie, { deckKey: "list:long", newPerDay: 5 })).statusCode, 200);
    const long = await json(`/api/queue?deckKey=${encodeURIComponent("list:long")}&limit=60`);
    assert.equal(long.cardIds.length, 5);
    // Answer all five: that deck is done for the day, the other is untouched.
    // At now, not a minute before: that minute can be yesterday (#122).
    const events = long.cardIds.map((id, i) => ({ id: `00000000-0000-4000-8000-00000000000${i}`, card_id: id, mode: "flip", rating: 3, reviewed_at: Math.floor(Date.now() / 1000) }));
    const posted = await app.inject({ method: "POST", url: "/api/events", headers: { cookie }, payload: { events } });
    assert.equal(posted.statusCode, 200, posted.body);
    const after = await json(`/api/queue?deckKey=${encodeURIComponent("list:long")}&limit=60`);
    assert.equal(after.today.fresh, 0);
    const other = await json(`/api/queue?deckKey=${encodeURIComponent("list:list a")}&limit=60`);
    assert.equal(other.today.fresh, 2, "new cards in one list do not use up another's");
    await app.close();
  });

  it("stores the ways of practising per deck, and never all five hidden", async () => {
    const { app, cookie, json } = await signedIn();
    const res = await patch(app, cookie, { deckKey: "list:list a", hiddenModes: ["type", "choose"] });
    assert.deepEqual(res.json().settings, { hiddenModes: ["choose", "type"], newPerDay: 10, maxPerDay: null, extraNew: 0, extraNewDay: null, flipFront: "meaning" });
    const { decks } = await json("/api/decks");
    assert.deepEqual(decks.find((d) => d.key === "kaishi").settings.hiddenModes, [], "another deck is not touched");
    assert.equal((await patch(app, cookie, { deckKey: "list:list a", hiddenModes: ["choose", "listen", "speak", "type", "flip"] })).statusCode, 400);
    assert.equal((await patch(app, cookie, { deckKey: "personal", newPerDay: 10 })).statusCode, 400);
    assert.equal((await patch(app, cookie, { deckKey: "kaishi", newPerDay: 3 })).statusCode, 400);
    await app.close();
  });

  it("caps a deck's cards for the day, reviews first, and counts what she answered (migration 017)", async () => {
    const { app, db, user, cookie, json } = await signedIn();
    const url = `/api/queue?deckKey=${encodeURIComponent("list:long")}&limit=60`;
    const now = Math.floor(Date.now() / 1000);
    // Three of the long list's cards are due reviews; the other eleven are new.
    const ids = db.prepare("SELECT id FROM cards WHERE list_name = 'long' ORDER BY id").all().map((r) => r.id);
    const state = db.prepare(
      "INSERT INTO card_state (user_id, card_id, due_at, stability, difficulty, reps, lapses, last_review) VALUES (?, ?, ?, 1, 5, 1, 0, ?)",
    );
    for (const id of ids.slice(0, 3)) state.run(user.id, id, now - 60, now - 5 * 86400);
    db.prepare("INSERT INTO review_events (id, user_id, card_id, mode, rating, reviewed_at, received_at) VALUES (?, ?, ?, 'flip', 3, ?, ?)")
      .run("00000000-0000-4000-8000-0000000000aa", user.id, ids[0], now - 5 * 86400, now - 5 * 86400);

    assert.deepEqual((await json(url)).today, { total: 13, fresh: 10, review: 3, learning: 3, mastered: 0 }, "no limit: 3 due and 10 new");

    const set = await patch(app, cookie, { deckKey: "list:long", maxPerDay: 10 });
    assert.equal(set.statusCode, 200, set.body);
    assert.equal(set.json().settings.maxPerDay, 10);
    const capped = await json(url);
    assert.deepEqual(capped.today, { total: 10, fresh: 7, review: 3, learning: 3, mastered: 0 }, "the reviews stay, the new cards give way");
    assert.equal(capped.cardIds.length, 10);

    // Four answered today leave six.
    const events = capped.cardIds.slice(0, 4).map((id, i) => ({ id: `00000000-0000-4000-8000-00000000010${i}`, card_id: id, mode: "flip", rating: 3, reviewed_at: now }));
    assert.equal((await app.inject({ method: "POST", url: "/api/events", headers: { cookie }, payload: { events } })).statusCode, 200);
    assert.equal((await json(url)).today.total, 6);

    // A set she chose is not capped (§5a), and null takes the limit off again.
    assert.ok((await json(`${url}&only=new`)).cardIds.length > 6);
    assert.equal((await patch(app, cookie, { deckKey: "list:long", maxPerDay: null })).json().settings.maxPerDay, null);
    assert.ok((await json(url)).today.total > 6);
    assert.equal((await patch(app, cookie, { deckKey: "list:long", maxPerDay: 5 })).statusCode, 400);
    await app.close();
  });

  it("says when the day's maximum, not an empty deck, is why nothing is left", async () => {
    const { app, db, user, cookie, json } = await signedIn();
    const url = `/api/queue?deckKey=${encodeURIComponent("list:long")}&limit=60`;
    const now = Math.floor(Date.now() / 1000);
    // All fourteen are due reviews; the maximum is ten.
    const state = db.prepare(
      "INSERT INTO card_state (user_id, card_id, due_at, stability, difficulty, reps, lapses, last_review) VALUES (?, ?, ?, 1, 5, 1, 0, ?)",
    );
    for (const { id } of db.prepare("SELECT id FROM cards WHERE list_name = 'long'").all()) state.run(user.id, id, now - 60, now - 5 * 86400);
    await patch(app, cookie, { deckKey: "list:long", maxPerDay: 10 });
    const first = await json(url);
    assert.equal(first.maxReached, false);
    const events = first.cardIds.map((id, i) => ({ id: `00000000-0000-4000-8000-0000000002${String(i).padStart(2, "0")}`, card_id: id, mode: "flip", rating: 3, reviewed_at: now }));
    await app.inject({ method: "POST", url: "/api/events", headers: { cookie }, payload: { events } });
    const after = await json(url);
    assert.equal(after.today.total, 0);
    assert.equal(after.maxReached, true, "four are still due, held back by the maximum");
    await app.close();
  });
});

describe("practising one of her lists (#137)", () => {
  it("runs only that list's cards", async () => {
    const { app, json } = await imported();
    const deck = await json("/api/deck?since=0");
    const byId = new Map(deck.cards.map((c) => [c.id, c]));
    const q = await json(`/api/queue?deck=personal&list=${encodeURIComponent("list b")}&limit=20`);
    assert.equal(q.cardIds.length, 2);
    assert.ok(q.cardIds.every((id) => byId.get(id).list_name === "list b"));
    assert.equal(q.filtered, false, "the scheduler still decides inside a list");
    await app.close();
  });

  it("counts the nothing-due offers inside the list", async () => {
    const { app, db, user, json } = await imported();
    const [a1, a2] = db.prepare("SELECT id FROM cards WHERE list_name = 'list a' ORDER BY id").all();
    const [b1, b2] = db.prepare("SELECT id FROM cards WHERE list_name = 'list b' ORDER BY id").all();
    const now = Math.floor(Date.now() / 1000);
    const state = db.prepare(
      "INSERT INTO card_state (user_id, card_id, due_at, stability, difficulty, reps, lapses, last_review) VALUES (?, ?, ?, 1, 5, 1, 0, ?)",
    );
    // Every card seen, none due now: the queue is empty, so the answer
    // carries the outlook. One card of each list falls due within the hour.
    state.run(user.id, a1.id, now + 3600, now - 7200);
    state.run(user.id, b1.id, now + 3660, now - 7200);
    state.run(user.id, a2.id, now + 30 * 86400, now - 7200);
    state.run(user.id, b2.id, now + 30 * 86400, now - 7200);

    const listA = await json(`/api/queue?deck=personal&list=${encodeURIComponent("list a")}`);
    assert.equal(listA.cardIds.length, 0);
    assert.equal(listA.outlook.ahead, 1, "list b's card is not list a's offer");
    assert.equal(listA.outlook.nextDue.count, 1);
    const mine = await json("/api/queue?deck=personal");
    assert.equal(mine.outlook.ahead, 2, "all her own words count both");
    await app.close();
  });

  it("names her lists with their counts, for the set sheet", async () => {
    const { app, json } = await imported();
    const stats = await json("/api/stats");
    assert.deepEqual(stats.lists, [
      { list: "list a", total: 2 },
      { list: "list b", total: 2 },
    ]);
    await app.close();
  });
});
