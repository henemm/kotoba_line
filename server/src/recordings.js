/**
 * A native speaker's recording, attached to a card (#183 follow-up: no
 * invented pronunciation, only real voices — whoever she is going through
 * cards with, recorded live on her device).
 *
 * It lives under her account: there is no second login for a friend or her
 * host family to record into, by design ("keine Einladungs-/Freigabe-Logik —
 * einfach interaktiv").
 *
 * Her own voice is not a kind (#185, 2026-09-17). It was one until v116, and
 * that was a misunderstanding: what she says is only ever compared, in the
 * moment, against a real source — it is never stored or played back later as
 * a card's pronunciation. Migration 024 retired the old rows; `kind` stays a
 * column so that a row of that kind can never be read back by accident.
 */

import { visibleCard } from "./cards.js";
import { encodeMp3 } from "./audio-encode.js";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

export const KINDS = ["native"];
/** One at most (#185, 2026-09-16: "nur ein Muttersprachler, das ist
 * einfacher") — re-recording replaces via a delete first. */
export const RECORDING_LIMIT = 1;

const now = () => Math.floor(Date.now() / 1000);

/** Every live (not deleted) recording on a card, oldest first. */
export function recordingsFor(db, userId, cardId) {
  return db
    .prepare(
      `SELECT id, kind, file, recorded_at FROM card_recordings
        WHERE user_id = ? AND card_id = ? AND deleted_at IS NULL AND kind = 'native'
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
        WHERE user_id = ? AND deleted_at IS NULL AND kind = 'native' AND card_id IN (${holes})
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
  // `id` becomes part of a filename below — checked again here, not only by
  // the route's JSON schema, the same "more than one place" rule the rest
  // of this codebase applies to anything a bad value can reach unchecked
  // (settings.js's own comment says why). A `/` or `..` here let a write
  // land outside mediaDir entirely (measured: /srv/etc/passwd.mp3).
  if (!/^[0-9a-zA-Z-]{8,64}$/.test(id)) return { ok: false, reason: "invalid_id" };
  if (!visibleCard(db, userId, cardId)) return { ok: false, reason: "not_found" };
  if (db.prepare("SELECT 1 FROM card_recordings WHERE id = ?").get(id)) return { ok: true, already: true };

  const { n } = db
    .prepare("SELECT count(*) n FROM card_recordings WHERE user_id = ? AND card_id = ? AND kind = ? AND deleted_at IS NULL")
    .get(userId, cardId, kind);
  if (n >= RECORDING_LIMIT) return { ok: false, reason: `${kind}_limit` };

  // Written under practice/ (config.practiceDir — its own :rw mount, #183
  // follow-up's own commit says why), but nginx serves the whole media tree
  // from one alias, so the client's plain media/<file> resolution needs the
  // subdirectory *in* the name it is given — mediaUrl() (audio.js) does not
  // know this directory exists.
  const name = `${kind}-${id}.mp3`;
  const file = `practice/${name}`;
  const mp3 = await encode(audio, { comment: `Recorded in the app, kind=${kind} (#183 follow-up)` });
  // Not buildApp()'s job (code review, 2026-09-17): an unconditional
  // mkdirSync there ran on every server startup and every test regardless
  // of whether anything ever touches a recording, writing a real
  // server/media/practice/ directory as a side effect of tests that have
  // nothing to do with this feature. Made only when actually about to write.
  await mkdir(mediaDir, { recursive: true });
  await writeFile(join(mediaDir, name), mp3, { mode: 0o644 });

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
