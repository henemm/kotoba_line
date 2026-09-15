import { timeZoneOf } from "../day.js";
import { statsForUser } from "../stats.js";

export default async function statsRoutes(app) {
  const { db } = app;

  // §8a: the client displays these and never computes them, so an offline
  // device cannot show a streak the log does not support. Its days are the
  // device's own (#122).
  app.get("/api/stats", { preHandler: app.requireUser }, async (req) =>
    statsForUser(db, req.user.id, undefined, timeZoneOf(req)),
  );
}
