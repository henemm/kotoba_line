import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { UI_EVENT_NAMES } from "../src/routes/ui-events.js";
import { seedUser, signIn, testApp } from "./helpers.js";

describe("the names the client sends (#273)", () => {
  it("are all ones the server accepts — a refused name drops its whole batch", () => {
    const files = [];
    const walk = (dir) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".js")) files.push(p);
      }
    };
    walk(new URL("../../client/src/", import.meta.url).pathname);
    // Reads the source, not a running app: the name a seen(…) call opens
    // with, or either branch of a ternary there — not the detail after the
    // comma, nor the string a condition compares with. Seven names were
    // refused this way until 2026-09-24 (#99, #260).
    const sent = new Set();
    for (const file of files) {
      for (const call of readFileSync(file, "utf8").matchAll(/\bseen\(([^;]*?)\)/g)) {
        for (const name of call[1].matchAll(/(?:^|[?:])\s*"([a-z_]+)"/g)) sent.add(name[1]);
      }
    }
    assert.ok(sent.size > 20, `found ${sent.size} names — the pattern stopped matching`);
    assert.deepEqual([...sent].filter((n) => !UI_EVENT_NAMES.includes(n)), []);
  });
});

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
