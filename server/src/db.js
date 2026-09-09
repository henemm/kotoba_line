import Database from "better-sqlite3";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/**
 * Open the database and bring it up to the latest schema.
 *
 * `:memory:` is accepted so tests get a throwaway database with the same
 * migrations applied as production — testing against a different schema than
 * the one that ships is how schema bugs survive a green suite.
 */
export function openDatabase(file) {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });

  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  migrate(db);
  return db;
}

/**
 * Numbered SQL files, applied once, in filename order. No migration library:
 * the runner is shorter than the configuration one would need.
 */
export function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
             name       TEXT PRIMARY KEY,
             applied_at INTEGER NOT NULL
           )`);

  const applied = new Set(
    db.prepare("SELECT name FROM schema_migrations").all().map((r) => r.name),
  );

  const pending = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const record = db.prepare(
    "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)",
  );

  for (const name of pending) {
    if (applied.has(name)) continue;
    const sql = readFileSync(join(migrationsDir, name), "utf8");
    // Each migration is one transaction: a half-applied schema is worse than
    // a failed startup, because the next run would skip the rest of the file.
    db.transaction(() => {
      db.exec(sql);
      record.run(name, Math.floor(Date.now() / 1000));
    })();
  }
}
