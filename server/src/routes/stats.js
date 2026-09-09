import { statsForUser } from "../stats.js";

export default async function statsRoutes(app) {
  const { db } = app;

  // §8a: the client displays these and never computes them, so an offline
  // device cannot show a streak the log does not support.
  app.get("/api/stats", { preHandler: app.requireUser }, async (req) =>
    statsForUser(db, req.user.id),
  );
}
