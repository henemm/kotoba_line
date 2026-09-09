import { MAX_SESSION_LENGTH, ONLY_MODES, browseCards, queueForUser, setStar } from "../queue.js";
import { VALID_MODES } from "../scheduler.js";

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
          `SELECT id, word, word_furigana, word_meaning, word_audio,
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
    async (req) => queueForUser(db, req.user.id, req.query),
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
