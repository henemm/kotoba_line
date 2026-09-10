import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allTags, createCard, deleteCard, normaliseTag, personalCards } from "../src/cards.js";
import { ingestEvents } from "../src/events.js";
import { statsForUser } from "../src/stats.js";
import { openDatabase } from "../src/db.js";
import { seedCards, seedUser, signIn, testApp } from "./helpers.js";

const uid = (n) => `11111111-2222-4333-8444-${String(n).padStart(12, "0")}`;

describe("a card of her own", () => {
  it("gets a negative id, so it can never collide with an Anki note id", async () => {
    // Kaishi's ids are epoch milliseconds — always large and positive. Hers
    // being negative means the two spaces cannot meet, with no counter kept
    // anywhere and no join needed to tell them apart.
    const db = openDatabase(":memory:");
    await seedUser(db);
    seedCards(db, 3);

    const card = createCard(db, { word: "レシート", meaning: "receipt" });
    assert.ok(card.id < 0, `id was ${card.id}`);
    assert.equal(card.deck, "personal");
    db.close();
  });

  it("stays unique when two are added in the same millisecond", async () => {
    const db = openDatabase(":memory:");
    await seedUser(db);
    const now = 1_760_000_000_000;
    const a = createCard(db, { word: "袋", meaning: "bag" }, now);
    const b = createCard(db, { word: "箸", meaning: "chopsticks" }, now);
    assert.notEqual(a.id, b.id);
    db.close();
  });

  it("needs a word and a meaning, and nothing else", async () => {
    const db = openDatabase(":memory:");
    await seedUser(db);

    const bare = createCard(db, { word: "先輩", meaning: "senior" });
    assert.equal(bare.word_reading, null);
    assert.equal(bare.sentence, null);
    assert.deepEqual(bare.tags, []);

    assert.throws(() => createCard(db, { word: "  ", meaning: "x" }), /required/);
    assert.throws(() => createCard(db, { word: "x", meaning: "" }), /required/);
    db.close();
  });

  it("keeps the reading, the sentence and the topics when they are given", async () => {
    const db = openDatabase(":memory:");
    await seedUser(db);
    const card = createCard(db, {
      word: "改札",
      reading: "かいさつ",
      meaning: "ticket gate",
      sentence: "改札はどこですか。",
      sentenceMeaning: "Where is the ticket gate?",
      tags: ["Travel", " travel ", "konbini"],
    });
    assert.equal(card.word_reading, "かいさつ");
    assert.equal(card.sentence_meaning, "Where is the ticket gate?");
    // Case and spacing folded, duplicates dropped: "Travel" and " travel " are
    // one topic, not three.
    assert.deepEqual(card.tags.sort(), ["konbini", "travel"]);
    db.close();
  });

  it("has no audio, so it always meets the synthesis state", async () => {
    const db = openDatabase(":memory:");
    await seedUser(db);
    const card = createCard(db, { word: "定期", meaning: "commuter pass" });
    assert.equal(card.word_audio, null);
    assert.equal(card.sentence_audio, null);
    db.close();
  });
});

describe("topics coined on the spot", () => {
  it("folds case and spacing", () => {
    assert.equal(normaliseTag("  Small   Talk "), "small talk");
    assert.equal(normaliseTag("KONBINI"), "konbini");
  });

  it("refuses what would not read as a topic", () => {
    assert.equal(normaliseTag(""), undefined);
    assert.equal(normaliseTag("   "), undefined);
    assert.equal(normaliseTag("-leading"), undefined);
    assert.equal(normaliseTag("x".repeat(40)), undefined);
  });

  it("takes Japanese, since she may well name one in it", () => {
    assert.equal(normaliseTag("電車"), "電車");
  });
});

describe("her list (design 30)", () => {
  it("is newest first", async () => {
    const db = openDatabase(":memory:");
    const user = await seedUser(db);
    createCard(db, { word: "一", meaning: "one" }, 1_000);
    createCard(db, { word: "二", meaning: "two" }, 2_000);
    createCard(db, { word: "三", meaning: "three" }, 3_000);

    // The card she just added is the one she is looking for; a personal deck
    // has no frequency order to fall back on.
    assert.deepEqual(personalCards(db, user.id).map((c) => c.word), ["三", "二", "一"]);
    db.close();
  });

  it("leaves Kaishi's cards out of it", async () => {
    const db = openDatabase(":memory:");
    const user = await seedUser(db);
    seedCards(db, 5);
    createCard(db, { word: "袋", meaning: "bag" });
    assert.deepEqual(personalCards(db, user.id).map((c) => c.word), ["袋"]);
    db.close();
  });
});

describe("deleting one of her words", () => {
  it("removes the card but never its history", async () => {
    // §4: review_events is append-only truth. Deleting from it would change a
    // streak she already earned and break the promise that card_state can be
    // rebuilt by replaying the log.
    const db = openDatabase(":memory:");
    const user = await seedUser(db);
    const card = createCard(db, { word: "袋", meaning: "bag" });

    ingestEvents(db, user.id, [
      { id: uid(1), card_id: card.id, mode: "choose", rating: 3, reviewed_at: 1_700_000_000 },
    ]);
    const before = statsForUser(db, user.id).xp;
    assert.ok(before > 0);

    assert.deepEqual(deleteCard(db, card.id), { ok: true });

    // The row stays, marked. `review_events.card_id` is a foreign key, so a
    // reviewed card cannot be removed outright — and an old summary still has
    // to be able to name the word she missed.
    assert.ok(db.prepare("SELECT deleted_at FROM cards WHERE id = ?").get(card.id).deleted_at);
    assert.equal(
      db.prepare("SELECT count(*) n FROM review_events WHERE card_id = ?").get(card.id).n,
      1,
    );
    assert.equal(statsForUser(db, user.id).xp, before, "the XP she earned still stands");

    // …and it is gone from everywhere she would meet it.
    assert.deepEqual(personalCards(db, user.id), []);
    db.close();
  });

  it("clears the scheduler row, which is a cache and would otherwise dangle", async () => {
    const db = openDatabase(":memory:");
    const user = await seedUser(db);
    const card = createCard(db, { word: "袋", meaning: "bag" });
    ingestEvents(db, user.id, [
      { id: uid(2), card_id: card.id, mode: "choose", rating: 3, reviewed_at: 1_700_000_000 },
    ]);
    assert.equal(db.prepare("SELECT count(*) n FROM card_state WHERE card_id = ?").get(card.id).n, 1);

    deleteCard(db, card.id);
    assert.equal(db.prepare("SELECT count(*) n FROM card_state WHERE card_id = ?").get(card.id).n, 0);
    db.close();
  });

  it("refuses to delete a card from the shared deck", async () => {
    const db = openDatabase(":memory:");
    await seedUser(db);
    seedCards(db, 3);
    assert.deepEqual(deleteCard(db, 1), { ok: false, reason: "not_yours" });
    assert.deepEqual(deleteCard(db, 999), { ok: false, reason: "not_found" });
    db.close();
  });
});

describe("the API", () => {
  async function signedIn() {
    const { app, db, config } = await testApp();
    await seedUser(db);
    return { app, db, cookie: await signIn(app, config) };
  }

  it("adds a word and gives it back", async () => {
    const { app, cookie } = await signedIn();
    const res = await app.inject({
      method: "POST",
      url: "/api/cards",
      headers: { cookie },
      payload: { word: "レシート", meaning: "receipt", tags: ["konbini"] },
    });
    assert.equal(res.statusCode, 201);
    const { card } = res.json();
    assert.equal(card.word, "レシート");
    assert.deepEqual(card.tags, ["konbini"]);
    await app.close();
  });

  it("refuses a word with no meaning, before it reaches the database", async () => {
    const { app, cookie } = await signedIn();
    const res = await app.inject({
      method: "POST",
      url: "/api/cards",
      headers: { cookie },
      payload: { word: "レシート" },
    });
    assert.equal(res.statusCode, 400);
    await app.close();
  });

  it("lets her review her own card, whose id is negative", async () => {
    // The id bounds on /api/events used to require `minimum: 1`, which would
    // have rejected every review of a card she added.
    const { app, cookie } = await signedIn();
    const { card } = (
      await app.inject({
        method: "POST",
        url: "/api/cards",
        headers: { cookie },
        payload: { word: "袋", meaning: "bag" },
      })
    ).json();

    const res = await app.inject({
      method: "POST",
      url: "/api/events",
      headers: { cookie },
      payload: {
        events: [
          { id: uid(3), card_id: card.id, mode: "choose", rating: 3, reviewed_at: 1_700_000_000 },
        ],
      },
    });
    assert.equal(res.statusCode, 200);
    // `accepted` is the list of ids the server took, not a count.
    assert.deepEqual(res.json().accepted, [uid(3)]);
    await app.close();
  });

  it("lets her star her own card, so it can be practised with priority", async () => {
    const { app, cookie } = await signedIn();
    const { card } = (
      await app.inject({
        method: "POST",
        url: "/api/cards",
        headers: { cookie },
        payload: { word: "改札", meaning: "ticket gate" },
      })
    ).json();

    const res = await app.inject({
      method: "POST",
      url: "/api/stars",
      headers: { cookie },
      payload: { cardId: card.id, starred: true },
    });
    assert.equal(res.statusCode, 200);

    const queue = (
      await app.inject({ method: "GET", url: "/api/queue?only=starred&limit=20", headers: { cookie } })
    ).json();
    assert.deepEqual(queue.cardIds, [card.id]);
    await app.close();
  });

  it("will not delete someone else's card through the API either", async () => {
    const { app, db, cookie } = await signedIn();
    seedCards(db, 3);
    const res = await app.inject({ method: "DELETE", url: "/api/cards/1", headers: { cookie } });
    assert.equal(res.statusCode, 403);
    await app.close();
  });

  it("needs a signed-in user", async () => {
    const { app, db } = await testApp();
    await seedUser(db);
    for (const [method, url] of [["GET", "/api/cards"], ["POST", "/api/cards"], ["DELETE", "/api/cards/-1"]]) {
      const res = await app.inject({ method, url, payload: method === "POST" ? { word: "a", meaning: "b" } : undefined });
      assert.equal(res.statusCode, 401, `${method} ${url}`);
    }
    await app.close();
  });
});

describe("every topic in use", () => {
  it("counts them, so the sheet's chips and 29's field have a list", async () => {
    const db = openDatabase(":memory:");
    await seedUser(db);
    seedCards(db, 3);
    db.prepare("INSERT INTO tags (card_id, tag) VALUES (1, 'food'), (2, 'food'), (3, 'travel')").run();
    createCard(db, { word: "改札", meaning: "ticket gate", tags: ["travel"] });

    assert.deepEqual(allTags(db), [
      { tag: "food", n: 2 },
      { tag: "travel", n: 2 },
    ]);
    db.close();
  });
});

describe("her own topics on any card (#35)", () => {
  async function fixture() {
    const { app, db, config } = await testApp();
    await seedUser(db);
    seedCards(db, 6);
    return { app, db, config };
  }

  it("puts a Kaishi card into a topic she invented", async () => {
    const { app, config } = await fixture();
    const cookie = await signIn(app, config);

    const res = await app.inject({
      method: "PUT",
      url: "/api/cards/3/tags",
      headers: { cookie },
      payload: { tags: ["My Exam", "school"] },
    });
    assert.equal(res.statusCode, 200);
    // Normalised the same way the personal deck normalises its own.
    assert.deepEqual(res.json().tags, ["my exam", "school"]);

    const browse = (
      await app.inject({ method: "GET", url: "/api/browse", headers: { cookie } })
    ).json();
    assert.deepEqual(browse.cards.find((c) => c.id === 3).myTags, ["my exam", "school"]);
    await app.close();
  });

  it("builds a session out of a topic she invented", async () => {
    // The point of the feature: coining a topic is worth nothing if she cannot
    // then practise it.
    const { app, config } = await fixture();
    const cookie = await signIn(app, config);

    for (const id of [2, 5]) {
      await app.inject({
        method: "PUT",
        url: `/api/cards/${id}/tags`,
        headers: { cookie },
        payload: { tags: ["my exam"] },
      });
    }

    const queue = (
      await app.inject({ method: "GET", url: "/api/queue?tag=my%20exam", headers: { cookie } })
    ).json();
    assert.deepEqual(queue.cardIds.sort(), [2, 5]);
    assert.equal(queue.filtered, true, "a chosen topic is a chosen session");
    await app.close();
  });

  it("survives the deck being re-tagged", async () => {
    // The reason card_user_tags is its own table: `npm run tag` begins with
    // DELETE FROM tags, so anything of hers stored there would be destroyed by
    // the next deck update — silently, and completely.
    const { app, db, config } = await fixture();
    const cookie = await signIn(app, config);
    await app.inject({
      method: "PUT",
      url: "/api/cards/4/tags",
      headers: { cookie },
      payload: { tags: ["konbini run"] },
    });

    db.prepare("DELETE FROM tags").run();

    const queue = (
      await app.inject({ method: "GET", url: "/api/queue?tag=konbini%20run", headers: { cookie } })
    ).json();
    assert.deepEqual(queue.cardIds, [4], "still hers after the deck's tags were wiped");
    await app.close();
  });

  it("replaces the set rather than adding to it, and can clear it", async () => {
    const { app, config } = await fixture();
    const cookie = await signIn(app, config);
    const put = (tags) =>
      app.inject({
        method: "PUT",
        url: "/api/cards/1/tags",
        headers: { cookie },
        payload: { tags },
      });

    await put(["a", "b"]);
    assert.deepEqual((await put(["b", "c"])).json().tags, ["b", "c"], "replaced, not merged");
    assert.deepEqual((await put([])).json().tags, [], "an empty list clears them");

    const { myTags } = (
      await app.inject({ method: "GET", url: "/api/cards", headers: { cookie } })
    ).json();
    assert.deepEqual(myTags, [], "and the catalogue forgets the topic with its last card");
    await app.close();
  });

  it("keeps one user's topics out of another's", async () => {
    const { app, db, config } = await fixture();
    await seedUser(db, { handle: "someone", pin: "111111", display: "Someone" });
    const mine = await signIn(app, config);
    const theirs = await signIn(app, config, { handle: "someone", pin: "111111" });

    await app.inject({
      method: "PUT",
      url: "/api/cards/2/tags",
      headers: { cookie: theirs },
      payload: { tags: ["private"] },
    });

    const queue = (
      await app.inject({ method: "GET", url: "/api/queue?tag=private", headers: { cookie: mine } })
    ).json();
    assert.deepEqual(queue.cardIds, [], "his topic does not select cards for her");

    const browse = (
      await app.inject({ method: "GET", url: "/api/browse", headers: { cookie: mine } })
    ).json();
    assert.deepEqual(browse.cards.find((c) => c.id === 2).myTags, []);
    await app.close();
  });

  it("404s a card that does not exist, and refuses more than five topics", async () => {
    const { app, config } = await fixture();
    const cookie = await signIn(app, config);
    assert.equal(
      (
        await app.inject({
          method: "PUT",
          url: "/api/cards/9999/tags",
          headers: { cookie },
          payload: { tags: ["x"] },
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await app.inject({
          method: "PUT",
          url: "/api/cards/1/tags",
          headers: { cookie },
          payload: { tags: ["a", "b", "c", "d", "e", "f"] },
        })
      ).statusCode,
      400,
    );
    await app.close();
  });
});
