import { addRecording, removeRecording } from "../recordings.js";

const MAX_BYTES = 2 * 1024 * 1024; // a spoken word or sentence, generously

const uploadSchema = {
  params: { type: "object", properties: { cardId: { type: "integer" } } },
  querystring: {
    type: "object",
    required: ["kind", "id"],
    properties: {
      kind: { type: "string", enum: ["own", "native"] },
      id: { type: "string", minLength: 8, maxLength: 64 },
    },
  },
};

export default async function recordingRoutes(app) {
  const { db, config } = app;

  // The body is the raw audio blob, whatever MediaRecorder produced
  // (audio/webm;codecs=opus, or audio/mp4 on Safari before 18.4) — one file,
  // no form fields, so a multipart parser is more than this needs.
  app.addContentTypeParser(/^audio\//, { parseAs: "buffer", bodyLimit: MAX_BYTES }, (req, body, done) => done(null, body));

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
