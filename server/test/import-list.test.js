import assert from "node:assert/strict";
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
