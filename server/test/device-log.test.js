import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DATA_MAX, KEEP_DAYS } from "../src/routes/device-log.js";
import { seedUser, signIn, testApp } from "./helpers.js";

const DEVICE = "0f1e2d3c-4b5a-4968-8776-655443322110";

async function fixture() {
  const { app, db, config } = await testApp();
  await seedUser(db);
  const cookie = await signIn(app, config);
  const post = (lines, device = DEVICE) =>
    app.inject({ method: "POST", url: "/api/device-log", headers: { cookie }, payload: { device, lines } });
  return { app, db, post };
}

describe("POST /api/device-log (#299)", () => {
  it("needs a session", async () => {
    const { app } = await testApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/device-log",
      payload: { device: DEVICE, lines: [{ s: 1, t: Date.now(), k: "start" }] },
    });
    assert.equal(res.statusCode, 401);
    await app.close();
  });

  it("stores each line once, however often the batch is posted", async () => {
    const { app, db, post } = await fixture();
    const now = Date.now();
    const lines = [
      { s: 1, t: now - 2000, k: "start", d: { v: "v169", online: true } },
      { s: 2, t: now - 1000, k: "req", d: { p: "GET /decks", ms: 10000, r: "timeout" } },
      { s: 3, t: now, k: "stuck", d: { w: "decks", ms: 5000, open: ["GET /decks 5s"] } },
    ];
    for (let i = 0; i < 3; i++) assert.equal((await post(lines)).statusCode, 200);
    const rows = db.prepare("SELECT seq, kind, data FROM device_log ORDER BY seq").all();
    assert.equal(rows.length, 3);
    assert.deepEqual(JSON.parse(rows[1].data), { p: "GET /decks", ms: 10000, r: "timeout" });
    assert.equal(rows[0].kind, "start");
    await app.close();
  });

  it("keeps two devices' lines apart, though they number alike", async () => {
    const { app, db, post } = await fixture();
    await post([{ s: 1, t: Date.now(), k: "start" }]);
    await post([{ s: 1, t: Date.now(), k: "start" }], "a-second-device-0001");
    assert.equal(db.prepare("SELECT count(*) n FROM device_log").get().n, 2);
    await app.close();
  });

  it("refuses a misspelled field rather than dropping it", async () => {
    const { app, post } = await fixture();
    const res = await post([{ s: 1, t: Date.now(), k: "start", data: {} }]);
    assert.equal(res.statusCode, 400);
    await app.close();
  });

  it("cuts an oversized line's data, and lets old lines go", async () => {
    const { app, db, post } = await fixture();
    const now = Date.now();
    await post([
      { s: 1, t: now - (KEEP_DAYS + 1) * 86400000, k: "start" },
      { s: 2, t: now, k: "error", d: { m: "x".repeat(5000) } },
    ]);
    const rows = db.prepare("SELECT seq, length(data) len FROM device_log ORDER BY seq").all();
    assert.deepEqual(rows.map((r) => r.seq), [2]);
    assert.ok(rows[0].len <= DATA_MAX);
    await app.close();
  });
});
