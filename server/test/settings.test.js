import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deckCounts, settingsForUser, updateSettings } from "../src/settings.js";
import { ingestEvents } from "../src/events.js";
import { openDatabase } from "../src/db.js";
import { seedCards, seedUser, signIn, testApp } from "./helpers.js";

const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function signedIn() {
  const { app, db, config } = await testApp();
  await seedUser(db);
  const cookie = await signIn(app, config);
  return { app, db, cookie };
}

describe("the settings row", () => {
  it("comes back as the client shape, not the column shape", async () => {
    const db = openDatabase(":memory:");
    const user = await seedUser(db);
    assert.deepEqual(settingsForUser(db, user.id), {
      newPerDay: 15,
      sessionLength: 20,
      readAloud: true,
      pitchAccent: false,
    });
    db.close();
  });

  it("updates only the keys it was given", async () => {
    const db = openDatabase(":memory:");
    const user = await seedUser(db);
    const after = updateSettings(db, user.id, { pitchAccent: true });
    assert.equal(after.pitchAccent, true);
    // Untouched, rather than reset to a default the patch never mentioned.
    assert.equal(after.newPerDay, 15);
    assert.equal(after.readAloud, true);
    db.close();
  });

  it("reads back from the database rather than echoing the patch", async () => {
    const db = openDatabase(":memory:");
    const user = await seedUser(db);
    updateSettings(db, user.id, { newPerDay: 30 });
    assert.equal(settingsForUser(db, user.id).newPerDay, 30);
    db.close();
  });

  it("refuses a new-card limit of zero at the schema, not just the route", async () => {
    // The product owner's ruling is a CHECK constraint, so it holds even if a
    // future route forgets to validate. See docs/phase-0-plan.md §3.1 E.
    const db = openDatabase(":memory:");
    const user = await seedUser(db);
    assert.throws(() => updateSettings(db, user.id, { newPerDay: 0 }), /CHECK/i);
    db.close();
  });
});

describe("the deck rows", () => {
  it("lists the personal deck at zero cards so the import has somewhere to land", () => {
    const db = openDatabase(":memory:");
    seedCards(db, 3);
    assert.deepEqual(deckCounts(db), [
      { key: "kaishi", label: "Kaishi 1.5k", cards: 3 },
      { key: "personal", label: "Personal", cards: 0 },
    ]);
    db.close();
  });
});

describe("GET /api/settings", () => {
  it("needs a signed-in user", async () => {
    const { app, db } = await testApp();
    await seedUser(db);
    const res = await app.inject({ method: "GET", url: "/api/settings" });
    assert.equal(res.statusCode, 401);
    await app.close();
  });

  it("draws the whole screen in one request", async () => {
    const { app, db, cookie } = await signedIn();
    seedCards(db, 4);

    const res = await app.inject({ method: "GET", url: "/api/settings", headers: { cookie } });
    assert.equal(res.statusCode, 200);
    const body = res.json();

    assert.deepEqual(body.settings, {
      newPerDay: 15,
      sessionLength: 20,
      readAloud: true,
      pitchAccent: false,
    });
    assert.deepEqual(
      body.decks.map((d) => d.key),
      ["kaishi", "personal"],
    );
    assert.deepEqual(body.sync, { events: 0, lastEventAt: null });
    assert.match(body.version, /^\d+\.\d+\.\d+$/);
    await app.close();
  });

  it("reports the newest review the server holds, not a clock on the device", async () => {
    const { app, db, cookie } = await signedIn();
    seedCards(db, 3);
    const user = db.prepare("SELECT id FROM users").get();

    ingestEvents(db, user.id, [
      { id: uid(1), card_id: 1, mode: "choose", rating: 3, reviewed_at: 1_700_000_000 },
      { id: uid(2), card_id: 2, mode: "choose", rating: 3, reviewed_at: 1_700_000_500 },
    ]);

    const body = (await app.inject({ method: "GET", url: "/api/settings", headers: { cookie } })).json();
    assert.deepEqual(body.sync, { events: 2, lastEventAt: 1_700_000_500 });
    await app.close();
  });
});

describe("PATCH /api/settings", () => {
  it("writes one control at a time and returns the whole object", async () => {
    const { app, cookie } = await signedIn();

    const res = await app.inject({
      method: "PATCH",
      url: "/api/settings",
      headers: { cookie },
      payload: { readAloud: false },
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().settings, {
      newPerDay: 15,
      sessionLength: 20,
      readAloud: false,
      pitchAccent: false,
    });
    await app.close();
  });

  it("survives a reload — the screen has no Save button", async () => {
    const { app, cookie } = await signedIn();
    await app.inject({
      method: "PATCH",
      url: "/api/settings",
      headers: { cookie },
      payload: { newPerDay: 25, sessionLength: 60, pitchAccent: true },
    });

    const body = (await app.inject({ method: "GET", url: "/api/settings", headers: { cookie } })).json();
    assert.deepEqual(body.settings, {
      newPerDay: 25,
      sessionLength: 60,
      readAloud: true,
      pitchAccent: true,
    });
    await app.close();
  });

  it("rejects a new-card limit outside 5–40 with 400, not 500", async () => {
    // Without the JSON schema the CHECK constraint would still hold, but it
    // would surface as an unhandled SQLITE_CONSTRAINT and a 500.
    const { app, cookie } = await signedIn();
    for (const newPerDay of [0, 4, 41]) {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/settings",
        headers: { cookie },
        payload: { newPerDay },
      });
      assert.equal(res.statusCode, 400, `newPerDay=${newPerDay}`);
    }
    await app.close();
  });

  it("takes only the three session lengths the screen offers", async () => {
    const { app, cookie } = await signedIn();
    for (const [sessionLength, expected] of [[10, 200], [20, 200], [60, 200], [30, 400], [61, 400]]) {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/settings",
        headers: { cookie },
        payload: { sessionLength },
      });
      assert.equal(res.statusCode, expected, `sessionLength=${sessionLength}`);
    }
    await app.close();
  });

  it("refuses an unknown key rather than ignoring it", async () => {
    const { app, cookie } = await signedIn();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/settings",
      headers: { cookie },
      payload: { newPerDay: 20, theme: "light" },
    });
    assert.equal(res.statusCode, 400);
    await app.close();
  });

  it("refuses an empty patch", async () => {
    const { app, cookie } = await signedIn();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/settings",
      headers: { cookie },
      payload: {},
    });
    assert.equal(res.statusCode, 400);
    await app.close();
  });
});

describe("the new-card limit reaches the queue", () => {
  // The point of the stepper. A setting that writes but changes nothing is
  // worse than no setting at all, so this asserts the whole path.
  it("changes how many new cards a session offers", async () => {
    const { app, db, cookie } = await signedIn();
    seedCards(db, 40);

    const before = (
      await app.inject({ method: "GET", url: "/api/queue?limit=60", headers: { cookie } })
    ).json();
    assert.equal(before.cardIds.length, 15, "the default of 15 new cards a day");

    await app.inject({
      method: "PATCH",
      url: "/api/settings",
      headers: { cookie },
      payload: { newPerDay: 5 },
    });

    const after = (
      await app.inject({ method: "GET", url: "/api/queue?limit=60", headers: { cookie } })
    ).json();
    assert.equal(after.cardIds.length, 5);
    await app.close();
  });
});
