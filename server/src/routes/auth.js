import { clearedCookie, readCookie, serializeCookie } from "../cookies.js";
import { createSession, destroySession } from "../sessions.js";
import { checkPin, findByHandle } from "../users.js";

const loginSchema = {
  body: {
    type: "object",
    required: ["handle", "pin"],
    additionalProperties: false,
    properties: {
      handle: { type: "string", minLength: 1, maxLength: 64 },
      pin: { type: "string", minLength: 1, maxLength: 64 },
    },
  },
};

export default async function authRoutes(app) {
  const { db, config } = app;

  const setSessionCookie = (reply, token) =>
    reply.header(
      "set-cookie",
      serializeCookie(config.cookieName, token, {
        path: config.cookiePath,
        maxAge: config.sessionMaxAgeSeconds,
        secure: config.cookieSecure,
      }),
    );

  // Rate limiting lives in nginx (§9), not here: it has to reject before the
  // request costs us an argon2 verification.
  app.post("/api/auth/login", { schema: loginSchema }, async (req, reply) => {
    const { handle, pin } = req.body;
    const user = findByHandle(db, handle);

    if (!(await checkPin(user, pin))) {
      req.log.info({ handle }, "login rejected");
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    setSessionCookie(reply, createSession(db, user.id));
    req.log.info({ userId: user.id }, "login accepted");
    return { id: user.id, handle: user.handle, display: user.display };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    destroySession(db, readCookie(req, config.cookieName));
    reply.header(
      "set-cookie",
      clearedCookie(config.cookieName, {
        path: config.cookiePath,
        secure: config.cookieSecure,
      }),
    );
    return { ok: true };
  });

  app.get("/api/me", { preHandler: app.requireUser }, async (req) => req.user);
}
