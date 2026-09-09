import { ingestEvents } from "../events.js";
import { VALID_MODES } from "../scheduler.js";

/**
 * Batch size cap. A session is at most 60 cards (phase-0-plan §3.1 D), and an
 * outbox that has been offline for days still flushes in a handful of requests
 * at this size. It exists so one malformed client cannot post a million rows.
 */
const MAX_BATCH = 500;

const eventsSchema = {
  body: {
    type: "object",
    required: ["events"],
    additionalProperties: false,
    properties: {
      events: {
        type: "array",
        minItems: 1,
        maxItems: MAX_BATCH,
        items: {
          type: "object",
          required: ["id", "card_id", "mode", "rating", "reviewed_at"],
          additionalProperties: false,
          properties: {
            id: { type: "string", minLength: 8, maxLength: 64 },
            card_id: { type: "integer", minimum: 1 },
            mode: { type: "string", enum: VALID_MODES },
            // 1 again, 2 hard, 3 good, 4 easy. Deliberately not coupled to the
            // mode: §6 says hard and easy are only *offered* in めくる, which
            // is a rule about the interface. Enforcing it here would turn a
            // later design change into a server deploy.
            rating: { type: "integer", minimum: 1, maximum: 4 },
            reviewed_at: { type: "integer", minimum: 0 },
          },
        },
      },
    },
  },
};

export default async function eventRoutes(app) {
  const { db } = app;

  app.post(
    "/api/events",
    { schema: eventsSchema, preHandler: app.requireUser },
    async (req) => {
      const { accepted, rejected, states } = ingestEvents(
        db,
        req.user.id,
        req.body.events,
      );

      if (rejected.length) {
        req.log.warn({ userId: req.user.id, rejected }, "events rejected");
      }

      return { accepted, rejected, states };
    },
  );
}
