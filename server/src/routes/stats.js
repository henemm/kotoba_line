import { timeZoneOf } from "../day.js";
import { cardHistory, statsForUser } from "../stats.js";

export default async function statsRoutes(app) {
  const { db } = app;

  // §8a: the client displays these and never computes them, so an offline
  // device cannot show a streak the log does not support. Its days are the
  // device's own (#122).
  app.get("/api/stats", { preHandler: app.requireUser }, async (req) =>
    statsForUser(db, req.user.id, undefined, timeZoneOf(req)),
  );

  // #98: one card's own record. The id is not constrained to be positive —
  // her own cards have negative ids (rule 4).
  app.get(
    "/api/cards/:id/history",
    {
      schema: { params: { type: "object", properties: { id: { type: "integer" } } } },
      preHandler: app.requireUser,
    },
    async (req, reply) => {
      const history = cardHistory(db, req.user.id, req.params.id, timeZoneOf(req));
      if (!history) return reply.code(404).send({ error: "not_found" });
      return history;
    },
  );
}
