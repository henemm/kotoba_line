import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { seedUser, signIn, testApp } from "./helpers.js";

const T0 = 1_760_000_000;
const uid = (label) => `1a2b3c4d-5e6f-4a1b-8c2d-${label.padStart(12, "0")}`;

async function fixture() {
  const { app, db, config } = await testApp();
  await seedUser(db);
  const cookie = await signIn(app, config);
  const post = (events) =>
    app.inject({ method: "POST", url: "/api/ui-events", headers: { cookie }, payload: { events } });
  return { app, db, post };
}

describe("POST /api/ui-events (#228)", () => {
  it("needs a session", async () => {
    const { app } = await testApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/ui-events",
      payload: { events: [{ id: uid("a"), name: "more_new_shown", at: T0 }] },
    });
    assert.equal(res.statusCode, 401);
    await app.close();
  });

  it("stores each moment once, however often the batch is posted", async () => {
    const { app, db, post } = await fixture();
    const batch = [
      { id: uid("a"), name: "more_new_shown", detail: "deck:1", at: T0 },
      { id: uid("b"), name: "more_new_tapped", detail: "deck:1", at: T0 + 5 },
    ];
    for (let i = 0; i < 3; i++) assert.equal((await post(batch)).statusCode, 200);
    const rows = db.prepare("SELECT name, detail, at FROM ui_events ORDER BY at").all();
    assert.deepEqual(rows.map((r) => ({ ...r })), [
      { name: "more_new_shown", detail: "deck:1", at: T0 },
      { name: "more_new_tapped", detail: "deck:1", at: T0 + 5 },
    ]);
    await app.close();
  });

  it("refuses a name that is not on the list, rather than storing anything", async () => {
    const { app, db, post } = await fixture();
    const res = await post([{ id: uid("c"), name: "anything_at_all", at: T0 }]);
    assert.equal(res.statusCode, 400);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ui_events").get().n, 0);
    await app.close();
  });
});
