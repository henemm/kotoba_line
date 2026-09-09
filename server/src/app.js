import Fastify from "fastify";
import { config as defaultConfig } from "./config.js";
import { readCookie } from "./cookies.js";
import { openDatabase } from "./db.js";
import { pruneExpiredSessions, userForToken } from "./sessions.js";
import authRoutes from "./routes/auth.js";
import eventRoutes from "./routes/events.js";
import deckRoutes from "./routes/deck.js";
import settingsRoutes from "./routes/settings.js";
import statsRoutes from "./routes/stats.js";

/**
 * Build the server. Takes an already-open database so tests can hand in an
 * in-memory one; otherwise opens the configured file.
 */
export async function buildApp({ db, config = defaultConfig, logger } = {}) {
  const database = db ?? openDatabase(config.dbFile);
  pruneExpiredSessions(database, config.sessionMaxAgeSeconds);

  const app = Fastify({
    logger: logger ?? { level: config.logLevel },
    // nginx is the only entry point (§9) and sets X-Forwarded-For.
    trustProxy: true,
    // Fastify's default is to *delete* a property `additionalProperties: false`
    // rejects, so a misspelled field returns 200 and changes nothing. That is
    // the same shape of failure as the media path that 404'd invisibly: the
    // request looks like it worked. Reject instead.
    ajv: { customOptions: { removeAdditional: false } },
  });

  app.decorate("db", database);
  app.decorate("config", config);
  app.decorateRequest("user", null);

  /** preHandler for anything that needs a signed-in user. */
  app.decorate("requireUser", async (req, reply) => {
    const token = readCookie(req, config.cookieName);
    const user = userForToken(database, token, config.sessionMaxAgeSeconds);
    if (!user) {
      return reply.code(401).send({ error: "unauthenticated" });
    }
    req.user = user;
  });

  app.get("/api/health", async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(eventRoutes);
  await app.register(statsRoutes);
  await app.register(deckRoutes);
  await app.register(settingsRoutes);

  app.addHook("onClose", async () => database.close());

  return app;
}
