import { randomBytes, timingSafeEqual } from "node:crypto";

const now = () => Math.floor(Date.now() / 1000);

/** Only rewrite last_seen when it is this stale, to avoid a write per request. */
const LAST_SEEN_THROTTLE_SECONDS = 60;

/** §3: 32 random bytes, base64url. Opaque — it carries no claims. */
export function newToken() {
  return randomBytes(32).toString("base64url");
}

export function createSession(db, userId) {
  const token = newToken();
  const t = now();
  db.prepare(
    `INSERT INTO sessions (token, user_id, created_at, last_seen)
     VALUES (?, ?, ?, ?)`,
  ).run(token, userId, t, t);
  return token;
}

export function destroySession(db, token) {
  if (!token) return;
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

/**
 * Resolve a token to its user, or undefined.
 *
 * The cookie's Max-Age is advisory — a client can keep sending an expired
 * cookie — so the same lifetime is enforced here against created_at.
 */
export function userForToken(db, token, maxAgeSeconds) {
  if (!token) return undefined;

  const row = db
    .prepare(
      `SELECT s.token, s.created_at, u.id, u.handle, u.display
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token = ?`,
    )
    .get(token);
  if (!row) return undefined;

  const t = now();
  if (t - row.created_at > maxAgeSeconds) {
    destroySession(db, row.token);
    return undefined;
  }

  db.prepare(
    `UPDATE sessions SET last_seen = ?
      WHERE token = ? AND last_seen < ?`,
  ).run(t, row.token, t - LAST_SEEN_THROTTLE_SECONDS);

  return { id: row.id, handle: row.handle, display: row.display };
}

/** Housekeeping at startup: sessions past their lifetime serve no purpose. */
export function pruneExpiredSessions(db, maxAgeSeconds) {
  const { changes } = db
    .prepare("DELETE FROM sessions WHERE created_at < ?")
    .run(now() - maxAgeSeconds);
  return changes;
}

/** Constant-time string compare for equal-length secrets. */
export function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
