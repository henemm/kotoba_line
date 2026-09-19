import { timeZoneOf } from "../day.js";
import { subscribe, unsubscribe, vapidKeys } from "../push.js";

/**
 * Web Push subscriptions (#248). The device asks for the server's public key,
 * subscribes with its browser's push service, and hands the result here.
 * `X-Time-Zone` comes with it, for the quiet hours.
 */

// An endpoint is the push service's URL for this one device; Apple's are
// https://web.push.apple.com/…, Google's https://fcm.googleapis.com/…
const subscription = {
  type: "object",
  required: ["endpoint", "keys"],
  additionalProperties: true, // browsers add expirationTime, and more over time
  properties: {
    endpoint: { type: "string", pattern: "^https://", maxLength: 1024 },
    keys: {
      type: "object",
      required: ["p256dh", "auth"],
      additionalProperties: true,
      properties: {
        p256dh: { type: "string", minLength: 16, maxLength: 256 },
        auth: { type: "string", minLength: 8, maxLength: 64 },
      },
    },
  },
};

export default async function pushRoutes(app) {
  const { db } = app;

  app.get("/api/push/key", { preHandler: app.requireUser }, async () => ({ publicKey: vapidKeys(db).publicKey }));

  app.post(
    "/api/push/subscribe",
    {
      preHandler: app.requireUser,
      schema: { body: { type: "object", required: ["subscription"], additionalProperties: false, properties: { subscription } } },
    },
    async (req) => {
      subscribe(db, req.user.id, req.body.subscription, timeZoneOf(req));
      return { ok: true };
    },
  );

  app.post(
    "/api/push/unsubscribe",
    {
      preHandler: app.requireUser,
      schema: {
        body: {
          type: "object",
          required: ["endpoint"],
          additionalProperties: false,
          properties: { endpoint: { type: "string", maxLength: 1024 } },
        },
      },
    },
    async (req) => ({ ok: true, removed: unsubscribe(db, req.user.id, req.body.endpoint) }),
  );
}
