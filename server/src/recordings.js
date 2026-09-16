/**
 * Her own and a native speaker's recordings, attached to a card (#183
 * follow-up: no invented pronunciation, only real voices — Henning's own or
 * hers, whoever she is going through cards with, recorded live).
 *
 * Both `kind`s live under her account: there is no second login for a friend
 * or her host family to record into, by design ("keine Einladungs-/
 * Freigabe-Logik — einfach interaktiv"). `kind` only labels whose voice it
 * is, not whose account made the request.
 */

import { visibleCard } from "./cards.js";
import { encodeMp3 } from "./audio-encode.js";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";

export const KINDS = ["own", "native"];
export const NATIVE_LIMIT = 3;

const now = () => Math.floor(Date.now() / 1000);

/** Every live (not deleted) recording on a card, oldest first. */
export function recordingsFor(db, userId, cardId) {
  return db
    .prepare(
      `SELECT id, kind, file, recorded_at FROM card_recordings
        WHERE user_id = ? AND card_id = ? AND deleted_at IS NULL
        ORDER BY recorded_at`,
    )
    .all(userId, cardId);
}

/**
 * Live recordings on any of these card ids, flat with `card_id` alongside —
 * the same "answered for a set, not all of them" shape `starredAmong`
 * (queue.js) uses, and for the same reason: a session's queue is a bounded
 * set, and recordings are per-user like stars, not part of the public deck
 * the client caches.
 */
export function recordingsAmong(db, userId, cardIds) {
  if (!cardIds?.length) return [];
  const holes = cardIds.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT card_id, id, kind, file, recorded_at FROM card_recordings
        WHERE user_id = ? AND deleted_at IS NULL AND card_id IN (${holes})
        ORDER BY recorded_at`,
    )
    .all(userId, ...cardIds);
}

/**
 * Encode and store one recording. `audio` is whatever `MediaRecorder` handed
 * the browser — any container ffmpeg reads. `id` is the client-generated
 * UUID: retrying a dropped upload with the same id is a no-op, the same
 * idempotency review_events relies on.
 */
export async function addRecording(db, userId, { cardId, kind, id, audio, mediaDir, encode = encodeMp3 }) {
  if (!KINDS.includes(kind)) return { ok: false, reason: "unknown_kind" };
  if (!visibleCard(db, userId, cardId)) return { ok: false, reason: "not_found" };
  if (db.prepare("SELECT 1 FROM card_recordings WHERE id = ?").get(id)) return { ok: true, already: true };

  if (kind === "native") {
    const { n } = db
      .prepare("SELECT count(*) n FROM card_recordings WHERE user_id = ? AND card_id = ? AND kind = 'native' AND deleted_at IS NULL")
      .get(userId, cardId);
    if (n >= NATIVE_LIMIT) return { ok: false, reason: "native_limit" };
  }

  const file = `practice-${kind}-${id}.mp3`;
  const mp3 = await encode(audio, { comment: `Recorded in the app, kind=${kind} (#183 follow-up)` });
  await writeFile(join(mediaDir, file), mp3, { mode: 0o644 });

  db.prepare(
    `INSERT INTO card_recordings (id, user_id, card_id, kind, file, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, cardId, kind, file, now());

  return { ok: true, recording: { id, kind, file, recorded_at: now() } };
}

/**
 * Soft delete, like `cards.deleted_at` — the row stays (so a retried delete
 * is a no-op, not an error), only `deleted_at` moves. The file on disk is
 * left alone: at the size of a word recording, cleaning it up is not worth a
 * second failure mode (a delete that half-succeeds).
 */
export function removeRecording(db, userId, id) {
  const row = db.prepare("SELECT user_id, deleted_at FROM card_recordings WHERE id = ?").get(id);
  if (!row || row.user_id !== userId) return { ok: false, reason: "not_found" };
  if (!row.deleted_at) db.prepare("UPDATE card_recordings SET deleted_at = ? WHERE id = ?").run(now(), id);
  return { ok: true };
}
