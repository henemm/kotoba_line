import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ingestEvents } from "../src/events.js";
import { replayCardState } from "../src/replay.js";
import { seedCards, seedUser, signIn, testApp } from "./helpers.js";

const DAY = 86400;
const T0 = 1_760_000_000; // a fixed instant, so nothing depends on the clock

/**
 * Events carry client-generated UUIDs (§3), so the tests use UUID-shaped ids
 * rather than one-letter ones — short ids would pass here and be rejected in
 * production by the route's minimum length.
 */
const uid = (label) => `9f8e7d6c-5b4a-4321-8765-${label.padStart(12, "0")}`;
const uids = (...labels) => labels.map(uid).sort();

const ev = (label, card_id, rating, reviewed_at, mode = "choose") => ({
  id: uid(label),
  card_id,
  mode,
  rating,
  reviewed_at,
});

const cardStates = (db) =>
  db.prepare("SELECT * FROM card_state ORDER BY user_id, card_id").all();

async function fixture() {
  const { app, db, config } = await testApp();
  const user = await seedUser(db);
  seedCards(db, 5);
  return { app, db, config, user };
}

describe("POST /api/events", () => {
  it("needs a session", async () => {
    const { app } = await fixture();
    const res = await app.inject({
      method: "POST",
      url: "/api/events",
      payload: { events: [ev("e1", 1, 3, T0)] },
    });
    assert.equal(res.statusCode, 401);
    await app.close();
  });

  it("stores events and returns the updated state", async () => {
    const { app, db, config } = await fixture();
    const cookie = await signIn(app, config);

    const res = await app.inject({
      method: "POST",
      url: "/api/events",
      headers: { cookie },
      payload: { events: [ev("e1", 1, 3, T0), ev("e2", 2, 1, T0 + 10)] },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.deepEqual(body.accepted.sort(), uids("e1", "e2"));
    assert.deepEqual(body.rejected, []);
    assert.equal(body.states.length, 2);
    assert.equal(db.prepare("SELECT count(*) n FROM review_events").get().n, 2);
    await app.close();
  });

  it("stamps received_at from the server, not the client", async () => {
    const { app, db, config } = await fixture();
    const cookie = await signIn(app, config);
    await app.inject({
      method: "POST",
      url: "/api/events",
      headers: { cookie },
      payload: { events: [ev("e1", 1, 3, T0)] },
    });
    const row = db.prepare("SELECT reviewed_at, received_at FROM review_events").get();
    assert.equal(row.reviewed_at, T0);
    assert.notEqual(row.received_at, T0);
    await app.close();
  });

  it("rejects a bad batch without failing the good events in it", async () => {
    const { app, db, config } = await fixture();
    const cookie = await signIn(app, config);

    const res = await app.inject({
      method: "POST",
      url: "/api/events",
      headers: { cookie },
      payload: {
        events: [
          ev("good", 1, 3, T0),
          ev("no-such-card", 999, 3, T0),
          ev("from-the-future", 2, 3, T0 + 400 * DAY),
        ],
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.deepEqual(body.accepted, [uid("good")]);
    assert.deepEqual(
      body.rejected.sort((a, b) => a.id.localeCompare(b.id)),
      [
        { id: uid("from-the-future"), reason: "reviewed_at_in_future" },
        { id: uid("no-such-card"), reason: "unknown_card" },
      ],
    );
    assert.equal(db.prepare("SELECT count(*) n FROM review_events").get().n, 1);
    await app.close();
  });

  it("refuses a malformed event at the schema", async () => {
    const { app, config } = await fixture();
    const cookie = await signIn(app, config);
    for (const bad of [
      { ...ev("x", 1, 3, T0), mode: "guess" },
      { ...ev("x", 1, 9, T0) },
      { ...ev("x", 1, 0, T0) },
      { id: "x", card_id: 1, mode: "choose" },
    ]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/events",
        headers: { cookie },
        payload: { events: [bad] },
      });
      assert.equal(res.statusCode, 400, `expected 400 for ${JSON.stringify(bad)}`);
    }
    await app.close();
  });

  it("keeps one user's events out of another's state", async () => {
    const { app, db, config } = await fixture();
    await seedUser(db, { handle: "yuki", pin: "112233", display: "Yuki" });

    const mira = await signIn(app, config);
    const yuki = await signIn(app, config, { handle: "yuki", pin: "112233" });

    await app.inject({
      method: "POST", url: "/api/events", headers: { cookie: mira },
      payload: { events: [ev("m1", 1, 3, T0)] },
    });
    await app.inject({
      method: "POST", url: "/api/events", headers: { cookie: yuki },
      payload: { events: [ev("y1", 1, 1, T0)] },
    });

    const rows = cardStates(db);
    assert.equal(rows.length, 2, "each user gets their own row for card 1");
    assert.notEqual(rows[0].due_at, rows[1].due_at);
    await app.close();
  });
});

// ── The proof the brief asks for ─────────────────────────────────────
describe("idempotency (§4)", () => {
  const batch = [
    ev("a", 1, 3, T0),
    ev("b", 1, 1, T0 + 2 * DAY),
    ev("c", 1, 3, T0 + 3 * DAY),
    ev("d", 2, 4, T0 + DAY),
    ev("e", 3, 2, T0 + DAY, "flip"),
  ];

  it("posting the same batch three times leaves identical state", async () => {
    const { app, db, config } = await fixture();
    const cookie = await signIn(app, config);

    const post = () =>
      app.inject({ method: "POST", url: "/api/events", headers: { cookie }, payload: { events: batch } });

    const first = await post();
    const afterFirst = cardStates(db);

    const second = await post();
    const third = await post();

    assert.equal(second.statusCode, 200);
    assert.equal(third.statusCode, 200);

    // Every post acknowledges every event — the client may clear its outbox
    // whether or not the server had already seen them.
    for (const res of [first, second, third]) {
      assert.deepEqual(res.json().accepted.sort(), uids("a", "b", "c", "d", "e"));
      assert.deepEqual(res.json().rejected, []);
    }

    assert.equal(
      db.prepare("SELECT count(*) n FROM review_events").get().n,
      batch.length,
      "duplicates must not add rows",
    );
    assert.deepEqual(cardStates(db), afterFirst, "state must not drift");
    await app.close();
  });

  it("does not care what order the events arrive in", async () => {
    const inOrder = await fixture();
    const shuffled = await fixture();

    ingestEvents(inOrder.db, inOrder.user.id, batch, T0 + 10 * DAY);

    // The two-device case from §4: the same events, split and interleaved
    // the wrong way round.
    const reversed = [...batch].reverse();
    ingestEvents(shuffled.db, shuffled.user.id, reversed.slice(0, 2), T0 + 10 * DAY);
    ingestEvents(shuffled.db, shuffled.user.id, reversed.slice(2), T0 + 10 * DAY);

    assert.deepEqual(cardStates(shuffled.db), cardStates(inOrder.db));
    await inOrder.app.close();
    await shuffled.app.close();
  });

  it("agrees with a full replay from the log", async () => {
    const { app, db, user } = await fixture();
    ingestEvents(db, user.id, batch, T0 + 10 * DAY);
    const incremental = cardStates(db);

    const summary = replayCardState(db, { userId: user.id });
    assert.equal(summary.events, batch.length);
    assert.equal(summary.cards, 3);

    assert.deepEqual(cardStates(db), incremental);
    await app.close();
  });
});

describe("replay (§3)", () => {
  it("rebuilds state that was deleted", async () => {
    const { app, db, user } = await fixture();
    ingestEvents(db, user.id, [ev("a", 1, 3, T0), ev("b", 2, 1, T0)], T0 + DAY);
    const before = cardStates(db);

    db.prepare("DELETE FROM card_state").run();
    assert.equal(cardStates(db).length, 0);

    replayCardState(db);
    assert.deepEqual(cardStates(db), before);
    await app.close();
  });

  it("repairs state that has been corrupted", async () => {
    const { app, db, user } = await fixture();
    ingestEvents(db, user.id, [ev("a", 1, 3, T0)], T0 + DAY);
    const before = cardStates(db);

    db.prepare("UPDATE card_state SET due_at = 1, stability = 999, reps = 42").run();
    assert.notDeepEqual(cardStates(db), before);

    replayCardState(db);
    assert.deepEqual(cardStates(db), before, "the log is the truth");
    await app.close();
  });

  it("leaves no state behind for a card whose events are gone", async () => {
    const { app, db, user } = await fixture();
    ingestEvents(db, user.id, [ev("a", 1, 3, T0)], T0 + DAY);
    assert.equal(cardStates(db).length, 1);

    db.prepare("DELETE FROM review_events").run();
    replayCardState(db);
    assert.equal(cardStates(db).length, 0);
    await app.close();
  });

  it("rebuilds only the user asked for", async () => {
    const { app, db, user } = await fixture();
    const yuki = await seedUser(db, { handle: "yuki", pin: "112233" });
    ingestEvents(db, user.id, [ev("a", 1, 3, T0)], T0 + DAY);
    ingestEvents(db, yuki.id, [ev("b", 1, 3, T0)], T0 + DAY);

    const before = cardStates(db);
    replayCardState(db, { userId: user.id });
    assert.deepEqual(cardStates(db), before, "the other user's row must survive");
    assert.equal(cardStates(db).length, 2);
    await app.close();
  });
});
