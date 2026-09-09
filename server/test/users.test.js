import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openDatabase } from "../src/db.js";
import { createUser, checkPin, findByHandle, validatePin } from "../src/users.js";

describe("PIN rules", () => {
  it("requires at least six digits (§10)", () => {
    assert.ok(validatePin("12345"), "five digits should be rejected");
    assert.equal(validatePin("123456"), undefined);
    assert.equal(validatePin("1234567890"), undefined);
  });

  it("rejects anything that is not digits", () => {
    for (const bad of ["abcdef", "12 456", "12345a", "", "-123456"]) {
      assert.ok(validatePin(bad), `${JSON.stringify(bad)} should be rejected`);
    }
  });
});

describe("createUser", () => {
  it("stores a hash, never the PIN", async () => {
    const db = openDatabase(":memory:");
    await createUser(db, { handle: "Mira", display: "Mira", pin: "483920" });

    const row = findByHandle(db, "mira");
    assert.equal(row.handle, "mira", "handle should be lowercased");
    assert.ok(row.pin_hash.startsWith("$argon2id$"), "expected an argon2id hash");
    assert.ok(!row.pin_hash.includes("483920"));

    assert.equal(await checkPin(row, "483920"), true);
    assert.equal(await checkPin(row, "483921"), false);
    db.close();
  });

  it("falls back to the handle when no display name is given", async () => {
    const db = openDatabase(":memory:");
    const user = await createUser(db, { handle: "yuki", pin: "112233" });
    assert.equal(user.display, "yuki");
    db.close();
  });

  it("refuses a duplicate handle", async () => {
    const db = openDatabase(":memory:");
    await createUser(db, { handle: "mira", pin: "483920" });
    await assert.rejects(() => createUser(db, { handle: "MIRA", pin: "999999" }));
    db.close();
  });

  it("refuses a short PIN before touching the database", async () => {
    const db = openDatabase(":memory:");
    await assert.rejects(() => createUser(db, { handle: "mira", pin: "123" }));
    assert.equal(db.prepare("SELECT count(*) n FROM users").get().n, 0);
    db.close();
  });

  it("gives each new user default settings", async () => {
    const db = openDatabase(":memory:");
    const user = await createUser(db, { handle: "mira", pin: "483920" });
    const s = db
      .prepare("SELECT * FROM user_settings WHERE user_id = ?")
      .get(user.id);
    assert.equal(s.new_per_day, 15);
    assert.equal(s.session_length, 20);
    db.close();
  });
});

describe("checkPin against an unknown user", () => {
  it("is false and does not throw", async () => {
    assert.equal(await checkPin(undefined, "483920"), false);
    assert.equal(await checkPin(null, ""), false);
  });
});

describe("the daily new-card limit has a floor (phase-0-plan §3.1 E)", () => {
  const setLimit = (db, n) =>
    db.prepare("UPDATE user_settings SET new_per_day = ? WHERE user_id = 1").run(n);

  it("accepts 5 through 40", async () => {
    const db = openDatabase(":memory:");
    await createUser(db, { handle: "mira", pin: "483920" });
    for (const n of [5, 15, 40]) {
      setLimit(db, n);
      assert.equal(
        db.prepare("SELECT new_per_day FROM user_settings WHERE user_id = 1").get().new_per_day,
        n,
      );
    }
    db.close();
  });

  it("refuses zero — some new material must always keep arriving", async () => {
    const db = openDatabase(":memory:");
    await createUser(db, { handle: "mira", pin: "483920" });
    assert.throws(() => setLimit(db, 0), /CHECK constraint/);
    assert.throws(() => setLimit(db, 4), /CHECK constraint/);
    assert.throws(() => setLimit(db, 41), /CHECK constraint/);
    db.close();
  });
});
