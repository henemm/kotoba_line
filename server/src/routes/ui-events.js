/**
 * What appeared on her screen and what she did with it (#228).
 *
 * A short fixed list rather than any string: this exists to answer specific
 * questions about specific offers ("did she ever see Mehr neue Wörter?"), not
 * to track her. A new offer that needs checking adds its names here.
 */
export const UI_EVENT_NAMES = [
  "more_new_shown", // #179: the nothing-due deck page offered more new cards
  "more_new_tapped",
  "break_hint_shown", // #218: "Kleine Pause?" appeared in a session
  "break_hint_dismissed",
  "kana_grid_shown", // #208: a kana deck's page showed its letters
  "kana_card_opened",
  "topic_line_shown", // #209: a deck page offered "Nach Thema üben"
  "topic_line_tapped",
  "topic_session_started", // #209: a session narrowed to one topic began
];

const schema = {
  body: {
    type: "object",
    required: ["events"],
    additionalProperties: false,
    properties: {
      events: {
        type: "array",
        minItems: 1,
        maxItems: 200,
        items: {
          type: "object",
          required: ["id", "name", "at"],
          additionalProperties: false,
          properties: {
            id: { type: "string", minLength: 8, maxLength: 64 },
            name: { type: "string", enum: UI_EVENT_NAMES },
            detail: { type: "string", maxLength: 64 },
            at: { type: "integer", minimum: 0 },
          },
        },
      },
    },
  },
};

export default async function uiEventRoutes(app) {
  const { db } = app;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO ui_events (id, user_id, name, detail, at, received_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertAll = db.transaction((userId, events, now) => {
    for (const e of events) insert.run(e.id, userId, e.name, e.detail ?? null, e.at, now);
  });

  app.post("/api/ui-events", { schema, preHandler: app.requireUser }, async (req) => {
    insertAll(req.user.id, req.body.events, Math.floor(Date.now() / 1000));
    return { ok: true };
  });
}
