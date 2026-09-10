import { MAX_SESSION_LENGTH, ONLY_MODES, browseCards, queueForUser, setStar } from "../queue.js";
import { VALID_MODES, previewIntervals } from "../scheduler.js";

/**
 * The four intervals for each card, folded from its own history.
 *
 * One query for every card's events rather than one per card: a sixty-card
 * めくる session would otherwise be sixty round trips through SQLite for a
 * number printed under a button.
 */
function intervalsForCards(db, userId, cardIds) {
  const placeholders = cardIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT id, card_id, rating, reviewed_at
         FROM review_events
        WHERE user_id = ? AND card_id IN (${placeholders})`,
    )
    .all(userId, ...cardIds);

  const byCard = new Map(cardIds.map((id) => [id, []]));
  for (const row of rows) byCard.get(row.card_id)?.push(row);

  const now = new Date();
  const out = {};
  for (const id of cardIds) out[id] = previewIntervals(byCard.get(id), now);
  return out;
}

export default async function deckRoutes(app) {
  const { db } = app;

  /**
   * §5: cards changed since a timestamp. The client caches the deck in
   * IndexedDB, so after the first sync this returns almost nothing.
   */
  app.get(
    "/api/deck",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { since: { type: "integer", minimum: 0 } },
        },
      },
      preHandler: app.requireUser,
    },
    async (req) => {
      const since = req.query.since ?? 0;
      const cards = db
        .prepare(
          `SELECT id, word, word_furigana, word_reading, word_meaning, word_audio,
                  sentence, sentence_furigana, sentence_meaning, sentence_audio,
                  frequency_rank, deck, updated_at
             FROM cards
            WHERE updated_at > ?
            ORDER BY frequency_rank IS NULL, frequency_rank ASC, id ASC`,
        )
        .all(since);

      const tags = db
        .prepare(
          `SELECT card_id, tag FROM tags
            WHERE card_id IN (SELECT id FROM cards WHERE updated_at > ?)`,
        )
        .all(since);

      const byCard = new Map();
      for (const { card_id, tag } of tags) {
        if (!byCard.has(card_id)) byCard.set(card_id, []);
        byCard.get(card_id).push(tag);
      }

      const latest = db.prepare("SELECT max(updated_at) m FROM cards").get().m ?? 0;

      return {
        since,
        latest,
        cards: cards.map((c) => ({ ...c, tags: byCard.get(c.id) ?? [] })),
      };
    },
  );

  /** §5 and §5a: due card ids in scheduler order, narrowed by her filters. */
  app.get(
    "/api/queue",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            mode: { type: "string", enum: VALID_MODES },
            limit: { type: "integer", minimum: 1, maximum: MAX_SESSION_LENGTH },
            deck: { type: "string", maxLength: 32 },
            tag: { type: "string", maxLength: 32 },
            only: { type: "string", enum: ONLY_MODES },
          },
        },
      },
      preHandler: app.requireUser,
    },
    async (req) => {
      const answer = queueForUser(db, req.user.id, req.query);

      // Screen 41 prints, under each of めくる's four buttons, the interval
      // that button would give. It rides along with the queue rather than
      // getting its own request: it is needed for exactly these cards, and
      // the queue is what the client caches for offline (client/src/queue.js).
      if (req.query.mode === "flip" && answer.cardIds.length > 0) {
        answer.intervals = intervalsForCards(db, req.user.id, answer.cardIds);
      }
      return answer;
    },
  );

  /** §5a: the browse screen — search, filter, and see what is starred. */
  app.get(
    "/api/browse",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            q: { type: "string", maxLength: 64 },
            deck: { type: "string", maxLength: 32 },
            tag: { type: "string", maxLength: 32 },
            starred: { type: "boolean" },
            page: { type: "integer", minimum: 0 },
            pageSize: { type: "integer", minimum: 1, maximum: 200 },
          },
        },
      },
      preHandler: app.requireUser,
    },
    async (req) => browseCards(db, req.user.id, req.query),
  );

  /** §5a: pin a card so a session can be built from exactly those. */
  app.post(
    "/api/stars",
    {
      schema: {
        body: {
          type: "object",
          required: ["cardId", "starred"],
          additionalProperties: false,
          properties: {
            cardId: { type: "integer", minimum: 1 },
            starred: { type: "boolean" },
          },
        },
      },
      preHandler: app.requireUser,
    },
    async (req, reply) => {
      const result = setStar(db, req.user.id, req.body.cardId, req.body.starred);
      if (!result.ok) return reply.code(404).send({ error: result.reason });
      return result;
    },
  );
}
