import {
  MAX_TAGS,
  allTags,
  createCard,
  deleteCard,
  personalCards,
  setUserTags,
  updateCard,
  userTags,
  visibleCard,
} from "../cards.js";
import {
  DECK_KEY_PATTERN,
  MAX_SESSION_LENGTH,
  ONLY_MODES,
  browseCards,
  deckCardIds,
  deckDue,
  decksForUser,
  outlookForUser,
  queueForUser,
  setStar,
  starredAmong,
} from "../queue.js";
import { dayIn, timeZoneOf } from "../day.js";
import { VALID_MODES } from "../scheduler.js";
import { intervalsForCards } from "../labels.js";
import { MAX_PER_DAY_MAX, MAX_PER_DAY_MIN, releaseNewCards, updateDeckSettings } from "../deck-settings.js";
import { DECK_NAME_MAX, createDeck, deleteDeck, renameDeck } from "../decks.js";
import { MODE_KEYS, NEW_PER_DAY_MAX, NEW_PER_DAY_MIN } from "../settings.js";
import { recordingsAmong } from "../recordings.js";
import { reversible, setDeckReverse, setReverse } from "../reverse.js";

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
      const rows = db
        .prepare(
          `SELECT id, word, word_furigana, word_reading, word_pitch, word_meaning, word_audio,
                  sentence, sentence_furigana, sentence_meaning, sentence_audio,
                  frequency_rank, deck, owner_id, updated_at, deleted_at, list_name, deck_id,
                  word_examples, word_mnemonic,
                  -- #284: set on a card that asks its original the other way round.
                  reverse_of,
                  -- #183: only while it is still a recording of this word
                  -- (migration 025 says why).
                  CASE WHEN word_audio_generated_for = word THEN word_audio_generated END AS word_audio_generated,
                  CASE WHEN word_audio_generated_for = word THEN word_audio_checked END AS word_audio_checked,
                  -- The sentence in romaji (migration 028), by the sentence
                  -- itself: a changed sentence finds none rather than an old one.
                  (SELECT r.romaji FROM sentence_romaji r WHERE r.sentence = cards.sentence) AS sentence_romaji
             FROM cards
            WHERE updated_at > ?
            ORDER BY frequency_rank IS NULL, frequency_rank ASC, id ASC
            ${paging ? "LIMIT ? OFFSET ?" : ""}`,
        )
        .all(...(paging ? [since, req.query.limit, req.query.offset ?? 0] : [since]));

      // Someone else's own word goes out as a tombstone, not left out (#84).
      //
      // Left out, a device that had already cached one — every device did,
      // before cards had an owner — would keep it for good, because nothing
      // would ever tell it otherwise. As a deletion the client already applies
      // it (client/src/deck.js). The id is all that leaves the server; the
      // word, its meaning and its topics do not.
      //
      // Kept in the same rows rather than filtered out of the query, so the
      // first run's offset paging and `total` still count the same set.
      const cards = rows.map(({ owner_id, ...card }) =>
        card.deck === "personal" && owner_id !== req.user.id
          ? { id: card.id, deck: card.deck, updated_at: card.updated_at, deleted_at: card.deleted_at ?? card.updated_at }
          : card,
      );

      // Only the tags for the cards actually being sent: a paged first run
      // would otherwise carry the whole tag table in every page.
      const ids = cards.filter((c) => !c.deleted_at).map((c) => c.id);
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
            // The practise tab's deck (#137).
            deckKey: { type: "string", pattern: DECK_KEY_PATTERN },
            deck: { type: "string", maxLength: 32 },
            // One of her lists (#137), named the way Noji named it.
            list: { type: "string", minLength: 1, maxLength: 100 },
            tag: { type: "string", maxLength: 32 },
            only: { type: "string", enum: ONLY_MODES },
            // #271: with only=again, the cards to practise again, comma
            // separated. Her own cards have negative ids (rule 4).
            cards: { type: "string", maxLength: 8000, pattern: "^-?[0-9]{1,15}(,-?[0-9]{1,15})*$" },
          },
        },
      },
      preHandler: app.requireUser,
    },
    async (req) => {
      // Today is the device's day (#122): it bounds the new cards allowed.
      const timeZone = timeZoneOf(req);
      const cards = req.query.cards ? req.query.cards.split(",").map(Number) : undefined;
      const answer = queueForUser(db, req.user.id, { ...req.query, cards, timeZone });

      // Screen 41 prints, under each of めくる's four buttons, the interval
      // that button would give. It rides along with the queue rather than
      // getting its own request: it is needed for exactly these cards, and
      // the queue is what the client caches for offline (client/src/queue.js).
      //
      // #242: for every mode, and with what the buttons say after a Nochmal,
      // because the session now brings a card back when a learning step
      // (8, 15 minutes) runs out while she is still practising — and needs
      // to know how long each answer's step is to do that.
      if (answer.cardIds.length > 0) {
        Object.assign(answer, intervalsForCards(db, req.user.id, answer.cardIds, timeZone));
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

      // A native speaker's recordings (#183 follow-up, #185), the same
      // shape and the same reason as starred above: per-user, not part of the
      // public deck, wanted for exactly these cards.
      if (answer.cardIds.length > 0) {
        answer.recordings = recordingsAmong(db, req.user.id, answer.cardIds);
      }

      // Design 10 (#90, #91): an empty day's queue is exactly when the practise
      // tab draws "Next cards due" and the counted offers, so they come with
      // that answer rather than costing the tab another request.
      if (!answer.filtered && answer.cardIds.length === 0) {
        answer.outlook = outlookForUser(db, req.user.id, undefined, { ...req.query, timeZone });
      }
      return answer;
    },
  );

  /** #137: her decks with their cards for today — the practise tab's first screen. */
  app.get("/api/decks", { preHandler: app.requireUser }, async (req) => ({
    decks: decksForUser(db, req.user.id, undefined, timeZoneOf(req)),
  }));

  /**
   * #274: when each card in one deck comes back, for the labels in its card
   * list. Its own request rather than part of the deck list: only the deck
   * page with the list open wants it, and there for every card.
   */
  app.get(
    "/api/decks/due",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["deckKey"],
          properties: { deckKey: { type: "string", pattern: DECK_KEY_PATTERN } },
        },
      },
      preHandler: app.requireUser,
    },
    async (req) => ({ due: deckDue(db, req.user.id, req.query.deckKey, undefined, timeZoneOf(req)) }),
  );

  /** #137: one deck's ways of practising and daily limit, from its options sheet. */
  app.patch(
    "/api/decks/settings",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["deckKey"],
          minProperties: 2,
          properties: {
            deckKey: { type: "string", pattern: DECK_KEY_PATTERN },
            hiddenModes: {
              type: "array",
              items: { type: "string", enum: MODE_KEYS },
              uniqueItems: true,
              maxItems: MODE_KEYS.length - 1,
            },
            newPerDay: { type: "integer", minimum: NEW_PER_DAY_MIN, maximum: NEW_PER_DAY_MAX },
            // Migration 017: null is "no limit".
            maxPerDay: { type: ["integer", "null"], minimum: MAX_PER_DAY_MIN, maximum: MAX_PER_DAY_MAX },
            // #275: what „Karte umdrehen" shows first.
            flipFront: { type: "string", enum: ["word", "meaning"] },
            // #284: „Auch andersherum abfragen" — every card of the deck.
            reverse: { type: "boolean" },
          },
        },
      },
      preHandler: app.requireUser,
    },
    async (req, reply) => {
      const { deckKey, ...patch } = req.body;
      const settings = updateDeckSettings(db, req.user.id, deckKey, patch);
      if (!settings) return reply.code(404).send({ error: "not_found" });
      // As Noji's "Select all → Reverse": the switch sets every card of the
      // deck, including one she had set apart before.
      const reversed =
        "reverse" in patch
          ? setDeckReverse(db, deckCardIds(db, req.user.id, deckKey), patch.reverse, Math.floor(Date.now() / 1000), req.user.id)
          : undefined;
      return { settings, ...(reversed === undefined ? {} : { reversed }) };
    },
  );

  /**
   * #284: one card asked the other way round too, or not — from Search's
   * sheet and from the back of a card in めくる. Any card she can see: a
   * Kaishi word's reverse is hers alone (reverse.js). A reverse or a kana is
   * refused; a reverse is switched by its original.
   */
  app.post(
    "/api/cards/:id/reverse",
    {
      schema: {
        params: { type: "object", properties: { id: { type: "integer" } } },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["on"],
          properties: { on: { type: "boolean" } },
        },
      },
      preHandler: app.requireUser,
    },
    async (req, reply) => {
      const id = req.params.id;
      if (!visibleCard(db, req.user.id, id) || !reversible(db, id)) return reply.code(404).send({ error: "not_found" });
      db.transaction(() => setReverse(db, id, req.body.on, Math.floor(Date.now() / 1000), req.user.id))();
      return { cardId: id, reverse: req.body.on };
    },
  );

  /**
   * More new cards for today (#179, v90): one more batch of the deck's own
   * daily number, for her device's day. The deck page asks for this when
   * nothing is due and she wants to keep going — it raises today's allowance
   * rather than starting a session of its own, so what follows is her ordinary
   * practice, in the ways she has chosen.
   */
  app.post(
    "/api/decks/new-cards",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["deckKey"],
          properties: { deckKey: { type: "string", pattern: DECK_KEY_PATTERN } },
        },
      },
      preHandler: app.requireUser,
    },
    async (req, reply) => {
      const settings = releaseNewCards(db, req.user.id, req.body.deckKey, dayIn(Math.floor(Date.now() / 1000), timeZoneOf(req)));
      if (!settings) return reply.code(404).send({ error: "not_found" });
      return { settings };
    },
  );

  // ── Her own decks (#137, migration 016) ────────────────────────────
  const deckName = { type: "string", minLength: 1, maxLength: DECK_NAME_MAX };
  const deckParams = { type: "object", properties: { id: { type: "integer", minimum: 1 } } };
  // What went wrong, as a status: a name she already uses is a conflict.
  const failed = (reply, reason) =>
    reply.code(reason === "not_found" ? 404 : reason === "name_taken" ? 409 : 400).send({ error: reason });

  app.post(
    "/api/decks",
    {
      schema: { body: { type: "object", additionalProperties: false, required: ["name"], properties: { name: deckName } } },
      preHandler: app.requireUser,
    },
    async (req, reply) => {
      const result = createDeck(db, req.user.id, req.body.name);
      if (!result.ok) return failed(reply, result.reason);
      return reply.code(201).send({ deck: result.deck });
    },
  );

  app.patch(
    "/api/decks/:id",
    {
      schema: {
        params: deckParams,
        body: { type: "object", additionalProperties: false, required: ["name"], properties: { name: deckName } },
      },
      preHandler: app.requireUser,
    },
    async (req, reply) => {
      const result = renameDeck(db, req.user.id, req.params.id, req.body.name);
      if (!result.ok) return failed(reply, result.reason);
      return { deck: result.deck };
    },
  );

  app.delete(
    "/api/decks/:id",
    { schema: { params: deckParams }, preHandler: app.requireUser },
    async (req, reply) => {
      const result = deleteDeck(db, req.user.id, req.params.id);
      if (!result.ok) return failed(reply, result.reason);
      return { ok: true, cards: result.cards };
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

/** One of her own words, as the add and edit forms send it. */
const cardBody = {
  type: "object",
  required: ["word", "meaning"],
  additionalProperties: false,
  properties: {
    word: { type: "string", minLength: 1, maxLength: 64 },
    reading: { type: "string", maxLength: 64 },
    meaning: { type: "string", minLength: 1, maxLength: 200 },
    sentence: { type: "string", maxLength: 300 },
    sentenceMeaning: { type: "string", maxLength: 300 },
    // Which of her decks (#137). Optional: a phone from before decks sends none.
    deckId: { type: "integer", minimum: 1 },
    // The Kaishi card whose recording she chose for this word (v70); null
    // takes a recording off. Left out — an older phone — nothing is chosen,
    // and a changed word loses a recording that no longer fits.
    kaishiId: { type: ["integer", "null"], minimum: 1 },
    // #284: "Auch andersherum abfragen". Left out — a phone from before
    // v162 — the card keeps whatever it had.
    reverse: { type: "boolean" },
    tags: {
      type: "array",
      maxItems: MAX_TAGS,
      items: { type: "string", minLength: 1, maxLength: 32 },
    },
  },
};

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
    tags: allTags(db, req.user.id),
    // Hers, separately, so the picker can show them apart from the deck's
    // (#35). Merging the two lists here would lose which is which, and "my
    // topics" is exactly the distinction she is looking for.
    myTags: userTags(db, req.user.id),
  }));

  app.post(
    "/api/cards",
    { schema: { body: cardBody }, preHandler: app.requireUser },
    async (req, reply) => {
      const card = createCard(db, req.user.id, req.body);
      return reply.code(201).send({ card });
    },
  );

  /**
   * Change one of her own words (#85). PUT, with the same body as adding one:
   * the form holds the whole card, so the whole card is what it sends.
   */
  app.put(
    "/api/cards/:id",
    {
      schema: {
        params: { type: "object", properties: { id: { type: "integer" } } },
        body: cardBody,
      },
      preHandler: app.requireUser,
    },
    async (req, reply) => {
      const result = updateCard(db, req.user.id, req.params.id, req.body);
      if (!result.ok) {
        return reply.code(result.reason === "not_found" ? 404 : 403).send({ error: result.reason });
      }
      return { card: result.card };
    },
  );

  app.delete(
    "/api/cards/:id",
    {
      schema: { params: { type: "object", properties: { id: { type: "integer" } } } },
      preHandler: app.requireUser,
    },
    async (req, reply) => {
      const result = deleteCard(db, req.user.id, req.params.id);
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
