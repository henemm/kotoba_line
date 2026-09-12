import {
  MAX_TAGS,
  allTags,
  createCard,
  deleteCard,
  personalCards,
  setUserTags,
  userTags,
} from "../cards.js";
import {
  MAX_SESSION_LENGTH,
  ONLY_MODES,
  browseCards,
  queueForUser,
  setStar,
  starredAmong,
} from "../queue.js";
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
          properties: {
            since: { type: "integer", minimum: 0 },
            // The first run pages through the deck rather than taking 1,500
            // cards in one response (design 49), so each page can be written
            // to disk before the next is asked for — which is what makes "you
            // can start practising as soon as the first cards arrive" true.
            offset: { type: "integer", minimum: 0 },
            limit: { type: "integer", minimum: 1, maximum: 500 },
          },
        },
      },
      preHandler: app.requireUser,
    },
    async (req) => {
      const since = req.query.since ?? 0;
      const paging = req.query.limit !== undefined;
      const cards = db
        .prepare(
          `SELECT id, word, word_furigana, word_reading, word_pitch, word_meaning, word_audio,
                  sentence, sentence_furigana, sentence_meaning, sentence_audio,
                  frequency_rank, deck, updated_at, deleted_at
             FROM cards
            WHERE updated_at > ?
            ORDER BY frequency_rank IS NULL, frequency_rank ASC, id ASC
            ${paging ? "LIMIT ? OFFSET ?" : ""}`,
        )
        .all(...(paging ? [since, req.query.limit, req.query.offset ?? 0] : [since]));

      // Only the tags for the cards actually being sent: a paged first run
      // would otherwise carry the whole tag table in every page.
      const ids = cards.map((c) => c.id);
      const tags =
        ids.length === 0
          ? []
          : db
              .prepare(
                `SELECT card_id, tag FROM tags
                  WHERE card_id IN (${ids.map(() => "?").join(",")})`,
              )
              .all(...ids);

      const byCard = new Map();
      for (const { card_id, tag } of tags) {
        if (!byCard.has(card_id)) byCard.set(card_id, []);
        byCard.get(card_id).push(tag);
      }

      const latest = db.prepare("SELECT max(updated_at) m FROM cards").get().m ?? 0;
      const { n: total } = db
        .prepare("SELECT count(*) n FROM cards WHERE updated_at > ?")
        .get(since);

      return {
        since,
        latest,
        total,
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

      // Which of these she has already starred (#35).
      //
      // Stars live in card_stars, per user; the deck the client caches is
      // public and cannot carry them. Sent with the queue for the same reason
      // as the intervals — wanted for exactly these cards, and the queue is
      // what the client caches for offline, so a session started without a
      // connection still knows which of its cards are starred.
      if (answer.cardIds.length > 0) {
        answer.starred = starredAmong(db, req.user.id, answer.cardIds);
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

  /**
   * Put any card into her own topics (#35).
   *
   * PUT rather than POST: the body is the card's whole set of her topics, not
   * an addition. The screen is a row of chips she toggles, so what it knows is
   * the final set — asking the client to work out an add/remove difference is
   * asking it to get that right on a flaky connection.
   *
   * Only her topics. The deck's own tags are not editable from here: they are
   * global, and `npm run tag` rebuilds them from scratch on every deck update.
   */
  app.put(
    "/api/cards/:id/tags",
    {
      schema: {
        params: { type: "object", properties: { id: { type: "integer" } } },
        body: {
          type: "object",
          required: ["tags"],
          additionalProperties: false,
          properties: {
            tags: {
              type: "array",
              maxItems: MAX_TAGS,
              items: { type: "string", minLength: 1, maxLength: 32 },
            },
          },
        },
      },
      preHandler: app.requireUser,
    },
    async (req, reply) => {
      const result = setUserTags(db, req.user.id, req.params.id, req.body.tags);
      if (!result.ok) return reply.code(404).send({ error: result.reason });
      return result;
    },
  );

  /**
   * §5a: pin a card so a session can be built from exactly those.
   *
   * `changedAt` is required, not defaulted server-side (#22): it is the one
   * thing that makes a star safe to set offline and deliver late, the same
   * way `reviewed_at` is for an answer. Stamping arrival time here instead
   * would let whichever device happens to sync last always win, which is
   * exactly the wrong-order bug an offline star is supposed to survive.
   */
  app.post(
    "/api/stars",
    {
      schema: {
        body: {
          type: "object",
          required: ["cardId", "starred", "changedAt"],
          additionalProperties: false,
          properties: {
            // Not `minimum: 1`: a personal card's id is negative on purpose,
            // so that Anki's note ids and hers can never collide (cards.js).
            cardId: { type: "integer" },
            starred: { type: "boolean" },
            changedAt: { type: "integer", minimum: 0 },
          },
        },
      },
      preHandler: app.requireUser,
    },
    async (req, reply) => {
      const result = setStar(db, req.user.id, req.body.cardId, req.body.starred, req.body.changedAt);
      if (!result.ok) return reply.code(404).send({ error: result.reason });
      return result;
    },
  );
}

/**
 * Her own words (§8, design 27–30).
 *
 * Registered beside the deck because that is what they are — the same table,
 * the same tags, the same scheduler. Only the way in is new.
 */
export async function personalDeckRoutes(app) {
  const { db } = app;

  app.get("/api/cards", { preHandler: app.requireUser }, async (req) => ({
    cards: personalCards(db, req.user.id),
    tags: allTags(db),
    // Hers, separately, so the picker can show them apart from the deck's
    // (#35). Merging the two lists here would lose which is which, and "my
    // topics" is exactly the distinction she is looking for.
    myTags: userTags(db, req.user.id),
  }));

  app.post(
    "/api/cards",
    {
      schema: {
        body: {
          type: "object",
          required: ["word", "meaning"],
          additionalProperties: false,
          properties: {
            word: { type: "string", minLength: 1, maxLength: 64 },
            reading: { type: "string", maxLength: 64 },
            meaning: { type: "string", minLength: 1, maxLength: 200 },
            sentence: { type: "string", maxLength: 300 },
            sentenceMeaning: { type: "string", maxLength: 300 },
            tags: {
              type: "array",
              maxItems: MAX_TAGS,
              items: { type: "string", minLength: 1, maxLength: 32 },
            },
          },
        },
      },
      preHandler: app.requireUser,
    },
    async (req, reply) => {
      const card = createCard(db, req.body);
      return reply.code(201).send({ card });
    },
  );

  app.delete(
    "/api/cards/:id",
    {
      schema: { params: { type: "object", properties: { id: { type: "integer" } } } },
      preHandler: app.requireUser,
    },
    async (req, reply) => {
      const result = deleteCard(db, req.params.id);
      if (!result.ok) {
        // "not_yours" is a 403 rather than a 404: the card exists, it is simply
        // not hers to delete, and pretending otherwise would be confusing when
        // the row is visible two screens away.
        return reply.code(result.reason === "not_found" ? 404 : 403).send({ error: result.reason });
      }
      return { ok: true };
    },
  );
}
