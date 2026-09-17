import { addRecording, recordingsFor, removeRecording } from "../recordings.js";
import { visibleCard } from "../cards.js";

const MAX_BYTES = 2 * 1024 * 1024; // a spoken word or sentence, generously

// `id` becomes part of a filename (recordings.js's addRecording), written
// with no further check beyond this — a length-only bound let `/` and `..`
// through, and `own-x/../../../../etc/passwd.mp3` joined against mediaDir
// resolves outside it (measured: /srv/etc/passwd.mp3). Alphanumeric and
// hyphen only — no `/`, no `.` — costs a real crypto.randomUUID() nothing.
const ID_PATTERN = "^[0-9a-zA-Z-]+$";

const uploadSchema = {
  params: { type: "object", properties: { cardId: { type: "integer" } } },
  querystring: {
    type: "object",
    required: ["kind", "id"],
    properties: {
      kind: { type: "string", enum: ["own", "native"] },
      id: { type: "string", minLength: 8, maxLength: 64, pattern: ID_PATTERN },
    },
  },
};

export default async function recordingRoutes(app) {
  const { db, config } = app;

  // The body is the raw audio blob, whatever MediaRecorder produced
  // (audio/webm;codecs=opus, or audio/mp4 on Safari before 18.4) — one file,
  // no form fields, so a multipart parser is more than this needs.
  app.addContentTypeParser(/^audio\//, { parseAs: "buffer", bodyLimit: MAX_BYTES }, (req, body, done) => done(null, body));

  // For a single card, outside a session's queue (#185 follow-up, 2026-09-17:
  // the deck's card menu offers a native recording on its own, without going
  // through a review). `recordingsAmong()` (queue.js) already covers the
  // in-session case; this is `recordingsFor()`'s first caller.
  app.get(
    "/api/cards/:cardId/recordings",
    { schema: { params: { type: "object", properties: { cardId: { type: "integer" } } } }, preHandler: app.requireUser },
    async (req, reply) => {
      if (!visibleCard(db, req.user.id, req.params.cardId)) return reply.code(404).send({ error: "not_found" });
      return { recordings: recordingsFor(db, req.user.id, req.params.cardId) };
    },
  );

  app.post(
    "/api/cards/:cardId/recordings",
    { schema: uploadSchema, preHandler: app.requireUser },
    async (req, reply) => {
      const result = await addRecording(db, req.user.id, {
        cardId: req.params.cardId,
        kind: req.query.kind,
        id: req.query.id,
        audio: req.body,
        mediaDir: config.practiceDir,
      });
      if (!result.ok) {
        return reply.code(result.reason === "not_found" ? 404 : 422).send({ error: result.reason });
      }
      return reply.code(201).send({ recording: result.recording ?? null });
    },
  );

  app.delete(
    "/api/cards/:cardId/recordings/:id",
    { schema: { params: { type: "object", properties: { cardId: { type: "integer" }, id: { type: "string" } } } }, preHandler: app.requireUser },
    async (req, reply) => {
      const result = removeRecording(db, req.user.id, req.params.id);
      if (!result.ok) return reply.code(404).send({ error: result.reason });
      return { ok: true };
    },
  );
}
