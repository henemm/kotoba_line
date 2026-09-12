import { readFileSync } from "node:fs";
import {
  NEW_PER_DAY_MAX,
  NEW_PER_DAY_MIN,
  SESSION_LENGTHS,
  deckCounts,
  settingsForUser,
  syncStateForUser,
  updateSettings,
} from "../settings.js";

const version = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
).version;

const patchSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    properties: {
      newPerDay: { type: "integer", minimum: NEW_PER_DAY_MIN, maximum: NEW_PER_DAY_MAX },
      sessionLength: { type: "integer", enum: SESSION_LENGTHS },
      readAloud: { type: "boolean" },
      pitchAccent: { type: "boolean" },
      romaji: { type: "boolean" },
    },
  },
};

export default async function settingsRoutes(app) {
  const { db } = app;

  /**
   * Everything design 22 puts on one screen, in one request: the four
   * settings, the deck rows above them, and the diagnostics underneath.
   *
   * The decks and the sync state are not settings — they are facts the screen
   * displays. They travel with it because the alternative is three requests to
   * draw one screen that is opened rarely and read at a glance.
   */
  app.get("/api/settings", { preHandler: app.requireUser }, async (req) => ({
    settings: settingsForUser(db, req.user.id),
    decks: deckCounts(db),
    sync: syncStateForUser(db, req.user.id),
    version,
  }));

  /**
   * A partial update. The screen writes one control at a time, so this takes
   * whichever keys changed and returns the whole settings object back — read
   * from the database, not echoed from the request.
   */
  app.patch(
    "/api/settings",
    { schema: patchSchema, preHandler: app.requireUser },
    async (req) => ({ settings: updateSettings(db, req.user.id, req.body) }),
  );
}
