/**
 * The flight recorder's lines (#299, client/src/trace.js), kept for
 * `ops/device-log.sh` to read back as a timeline.
 *
 * Open-ended on purpose, unlike ui-events' fixed list of names: that one
 * answers questions decided in advance, and this exists for the ones nobody
 * knew to ask — "what was the app waiting for at 12:56?". So a line's data is
 * any small object, bounded in size rather than in shape.
 */

/** Long enough to be looked back on after a trip; short enough not to pile up. */
export const KEEP_DAYS = 60;
/** A line's data as stored, at most. The watchdog's line with its open requests is the longest. */
export const DATA_MAX = 2000;

const schema = {
  body: {
    type: "object",
    required: ["device", "lines"],
    additionalProperties: false,
    properties: {
      device: { type: "string", minLength: 8, maxLength: 64 },
      lines: {
        type: "array",
        minItems: 1,
        maxItems: 500,
        items: {
          type: "object",
          required: ["s", "t", "k"],
          additionalProperties: false,
          properties: {
            s: { type: "integer", minimum: 1 },
            t: { type: "integer", minimum: 0 },
            k: { type: "string", minLength: 1, maxLength: 32 },
            d: { type: "object" },
          },
        },
      },
    },
  },
};

export default async function deviceLogRoutes(app) {
  const { db } = app;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO device_log (user_id, device, seq, at, kind, data, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const prune = db.prepare("DELETE FROM device_log WHERE user_id = ? AND at < ?");
  const insertAll = db.transaction((userId, device, lines, now) => {
    for (const l of lines) {
      const data = l.d ? JSON.stringify(l.d).slice(0, DATA_MAX) : null;
      insert.run(userId, device, l.s, l.t, l.k, data, now);
    }
    prune.run(userId, now - KEEP_DAYS * 24 * 60 * 60 * 1000);
  });

  app.post("/api/device-log", { schema, preHandler: app.requireUser }, async (req) => {
    insertAll(req.user.id, req.body.device, req.body.lines, Date.now());
    return { ok: true };
  });
}
