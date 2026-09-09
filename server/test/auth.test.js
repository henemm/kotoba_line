import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cookieHeader, cookieValue, seedUser, testApp } from "./helpers.js";

describe("authentication", () => {
  let app, db, config;

  before(async () => {
    ({ app, db, config } = await testApp());
    await seedUser(db, { handle: "mira", pin: "483920", display: "Mira" });
  });

  after(async () => app.close());

  const login = (payload) =>
    app.inject({ method: "POST", url: "/api/auth/login", payload });

  it("serves health without a session", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true });
  });

  it("refuses /api/me without a cookie", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me" });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().error, "unauthenticated");
  });

  it("rejects an unknown handle", async () => {
    const res = await login({ handle: "nobody", pin: "483920" });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().error, "invalid_credentials");
  });

  it("rejects a wrong PIN", async () => {
    const res = await login({ handle: "mira", pin: "000000" });
    assert.equal(res.statusCode, 401);
  });

  it("does not distinguish an unknown handle from a wrong PIN", async () => {
    const unknown = await login({ handle: "nobody", pin: "483920" });
    const wrongPin = await login({ handle: "mira", pin: "000000" });
    assert.deepEqual(unknown.json(), wrongPin.json());
    assert.equal(unknown.statusCode, wrongPin.statusCode);
  });

  it("rejects a malformed body", async () => {
    const res = await login({ handle: "mira" });
    assert.equal(res.statusCode, 400);
  });

  it("accepts the right PIN and sets a session cookie", async () => {
    const res = await login({ handle: "mira", pin: "483920" });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { id: 1, handle: "mira", display: "Mira" });

    const header = cookieHeader(res.headers["set-cookie"], config.cookieName);
    assert.ok(header, "expected a session cookie");
    assert.match(header, /HttpOnly/);
    assert.match(header, /SameSite=Lax/);
    assert.match(header, /Secure/);
    assert.match(header, new RegExp(`Path=${config.cookiePath}`));
    assert.match(header, new RegExp(`Max-Age=${config.sessionMaxAgeSeconds}`));
  });

  it("matches the handle case-insensitively", async () => {
    const res = await login({ handle: "  MIRA ", pin: "483920" });
    assert.equal(res.statusCode, 200);
  });

  it("returns the user from /api/me with that cookie, then forgets it on logout", async () => {
    const res = await login({ handle: "mira", pin: "483920" });
    const token = cookieValue(res.headers["set-cookie"], config.cookieName);
    const cookie = `${config.cookieName}=${token}`;

    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    assert.equal(me.statusCode, 200);
    assert.deepEqual(me.json(), { id: 1, handle: "mira", display: "Mira" });

    const out = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie },
    });
    assert.equal(out.statusCode, 200);
    assert.match(
      cookieHeader(out.headers["set-cookie"], config.cookieName),
      /Max-Age=0/,
    );

    const after = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    assert.equal(after.statusCode, 401);
  });

  it("rejects a forged token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: `${config.cookieName}=not-a-real-token` },
    });
    assert.equal(res.statusCode, 401);
  });

  it("gives every login its own token", async () => {
    const a = await login({ handle: "mira", pin: "483920" });
    const b = await login({ handle: "mira", pin: "483920" });
    assert.notEqual(
      cookieValue(a.headers["set-cookie"], config.cookieName),
      cookieValue(b.headers["set-cookie"], config.cookieName),
    );
  });
});

describe("session lifetime", () => {
  it("refuses a session older than the configured maximum", async () => {
    const { app, db, config } = await testApp({ sessionMaxAgeSeconds: 3600 });
    await seedUser(db);

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { handle: "mira", pin: "483920" },
    });
    const token = cookieValue(res.headers["set-cookie"], config.cookieName);
    const cookie = `${config.cookieName}=${token}`;

    assert.equal(
      (await app.inject({ method: "GET", url: "/api/me", headers: { cookie } })).statusCode,
      200,
    );

    // Age the session past the limit rather than waiting an hour.
    db.prepare("UPDATE sessions SET created_at = created_at - ? WHERE token = ?")
      .run(3601, token);

    assert.equal(
      (await app.inject({ method: "GET", url: "/api/me", headers: { cookie } })).statusCode,
      401,
    );
    assert.equal(
      db.prepare("SELECT count(*) n FROM sessions WHERE token = ?").get(token).n,
      0,
      "an expired session should be deleted, not just refused",
    );

    await app.close();
  });
});
