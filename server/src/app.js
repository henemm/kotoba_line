import Fastify from "fastify";
import { config as defaultConfig } from "./config.js";
import { readCookie } from "./cookies.js";
import { openDatabase } from "./db.js";
import { pruneExpiredSessions, userForToken } from "./sessions.js";
import authRoutes from "./routes/auth.js";

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

  app.addHook("onClose", async () => database.close());

  return app;
}
