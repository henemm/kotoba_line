import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { migrate, openDatabase } from "../src/db.js";

const tableNames = (db) =>
  new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name),
  );

describe("migrations", () => {
  it("creates every table the spec's §3 names", () => {
    const db = openDatabase(":memory:");
    const tables = tableNames(db);
    for (const t of [
      "users",
      "sessions",
      "cards",
      "tags",
      "review_events",
      "card_stars",
      "card_state",
      "user_settings",
    ]) {
      assert.ok(tables.has(t), `missing table ${t}`);
    }
    db.close();
  });

  it("is idempotent — running it again changes nothing", () => {
    const db = openDatabase(":memory:");
    const before = db.prepare("SELECT name FROM schema_migrations ORDER BY name").all();
    migrate(db);
    migrate(db);
    const after = db.prepare("SELECT name FROM schema_migrations ORDER BY name").all();
    assert.deepEqual(after, before);
    db.close();
  });

  it("enforces foreign keys", () => {
    const db = openDatabase(":memory:");
    assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO review_events (id, user_id, card_id, mode, rating, reviewed_at, received_at)
             VALUES ('x', 999, 999, 'choose', 3, 0, 0)`,
          )
          .run(),
      /FOREIGN KEY/,
    );
    db.close();
  });

  it("keeps review_events keyed on the client-generated id", () => {
    const db = openDatabase(":memory:");
    db.prepare(
      `INSERT INTO users (id, handle, display, pin_hash, created_at)
       VALUES (1, 'mira', 'Mira', 'x', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO cards (id, word, word_meaning) VALUES (1, 'これ', 'this one')`,
    ).run();

    const insert = db.prepare(
      `INSERT OR IGNORE INTO review_events
         (id, user_id, card_id, mode, rating, reviewed_at, received_at)
       VALUES (?, 1, 1, 'choose', 3, 100, 100)`,
    );

    // §4: replaying the same batch must be harmless.
    insert.run("event-uuid-1");
    insert.run("event-uuid-1");
    insert.run("event-uuid-1");

    assert.equal(db.prepare("SELECT count(*) n FROM review_events").get().n, 1);
    db.close();
  });
});
