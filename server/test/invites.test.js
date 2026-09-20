import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createInvite, inviteState, redeemInvite } from "../src/invites.js";
import { openDatabase } from "../src/db.js";
import { seedCards, seedUser, signIn, testApp } from "./helpers.js";

/**
 * #260: one code for a group. Henning does not know the names of Julia's
 * fifteen fellow travellers, and the app is on a public address — so a code
 * that runs out and expires, rather than an account each or an open door.
 */
const NOW = 1_800_000_000;

function withInvite(overrides = {}) {
  const db = openDatabase(":memory:");
  createInvite(
    db,
    { code: "reise26", label: "Reise nach Japan", settings: { beginner: true, japaneseScript: false }, maxUses: 2, days: 60, ...overrides },
    NOW,
  );
  return db;
}

describe("invitation codes (#260)", () => {
  it("is stored upper-case and says what it is for", () => {
    const db = withInvite();
    assert.deepEqual(inviteState(db, "reise26", NOW), { ok: true, label: "Reise nach Japan", left: 2 });
    assert.deepEqual(inviteState(db, "REISE26", NOW), { ok: true, label: "Reise nach Japan", left: 2 });
    db.close();
  });

  it("says no in the same way to an unknown, an expired and a used-up code", () => {
    const db = withInvite({ maxUses: 1 });
    assert.deepEqual(inviteState(db, "WASAUCHIMMER", NOW), { ok: false, reason: "unknown" });
    assert.deepEqual(inviteState(db, "REISE26", NOW + 61 * 86400), { ok: false, reason: "expired" });
    db.prepare("UPDATE invites SET used = 1").run();
    assert.deepEqual(inviteState(db, "REISE26", NOW), { ok: false, reason: "full" });
    db.close();
  });

  it("makes an account with the settings the code carries", async () => {
    const db = withInvite();
    const made = await redeemInvite(db, { code: "REISE26", handle: "Mika", pin: "918273" }, NOW);
    assert.equal(made.ok, true);
    const settings = db.prepare("SELECT beginner, japanese_script FROM user_settings WHERE user_id = ?").get(made.user.id);
    assert.deepEqual(settings, { beginner: 1, japanese_script: 0 });
    assert.equal(db.prepare("SELECT invite_code FROM users WHERE id = ?").get(made.user.id).invite_code, "REISE26");
    assert.equal(inviteState(db, "REISE26", NOW).left, 1);
    db.close();
  });

  it("refuses a name that exists and a PIN that is too short, without using up a place", async () => {
    const db = withInvite();
    await seedUser(db, { handle: "mika", pin: "918273" });
    assert.deepEqual(await redeemInvite(db, { code: "REISE26", handle: "mika", pin: "918273" }, NOW), {
      ok: false,
      reason: "handle_taken",
    });
    assert.deepEqual(await redeemInvite(db, { code: "REISE26", handle: "ken", pin: "123" }, NOW), { ok: false, reason: "bad_pin" });
    assert.equal(inviteState(db, "REISE26", NOW).left, 2);
    db.close();
  });

  it("hands out the last place once, however many ask", async () => {
    const db = withInvite({ maxUses: 1 });
    const both = await Promise.all([
      redeemInvite(db, { code: "REISE26", handle: "ken", pin: "918273" }, NOW),
      redeemInvite(db, { code: "REISE26", handle: "rin", pin: "918273" }, NOW),
    ]);
    assert.deepEqual(both.map((r) => r.ok).sort(), [false, true]);
    assert.equal(db.prepare("SELECT count(*) n FROM users").get().n, 1);
    db.close();
  });
});

describe("POST /api/invite/:code", () => {
  async function app() {
    const made = await testApp();
    seedCards(made.db, 3);
    createInvite(made.db, { code: "REISE26", label: "Reise", settings: { beginner: true }, maxUses: 5, days: 60 });
    return made;
  }

  it("signs the new account in at once", async () => {
    const { app: server } = await app();
    const res = await server.inject({ method: "POST", url: "/api/invite/REISE26", payload: { handle: "mika", pin: "918273" } });
    assert.equal(res.statusCode, 201, res.body);
    const cookie = res.headers["set-cookie"].split(";")[0];
    const me = await server.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    assert.equal(me.json().handle, "mika");
    assert.equal((await server.inject({ method: "GET", url: "/api/settings", headers: { cookie } })).json().settings.beginner, true);
    await server.close();
  });

  it("tells the screen what a code is worth before anyone types", async () => {
    const { app: server } = await app();
    assert.deepEqual((await server.inject({ method: "GET", url: "/api/invite/REISE26" })).json(), {
      ok: true,
      label: "Reise",
      left: 5,
    });
    assert.deepEqual((await server.inject({ method: "GET", url: "/api/invite/NOPE1234" })).json(), { ok: false, reason: "unknown" });
    await server.close();
  });

  it("refuses a name that is taken with 409, and keeps the place", async () => {
    const { app: server, db, config } = await app();
    await seedUser(db, { handle: "mira", pin: "483920" });
    await signIn(server, config);
    const res = await server.inject({ method: "POST", url: "/api/invite/REISE26", payload: { handle: "mira", pin: "918273" } });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error, "handle_taken");
    assert.equal((await server.inject({ method: "GET", url: "/api/invite/REISE26" })).json().left, 5);
    await server.close();
  });

  it("takes no code that is not a code", async () => {
    const { app: server } = await app();
    const res = await server.inject({ method: "POST", url: "/api/invite/rei se", payload: { handle: "ken", pin: "918273" } });
    assert.equal(res.statusCode, 400);
    await server.close();
  });
});
