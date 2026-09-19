import { readFileSync } from "node:fs";
import {
  APPEARANCES,
  MODE_KEYS,
  NEW_PER_DAY_MAX,
  NEW_PER_DAY_MIN,
  SESSION_LENGTHS,
  SPEAK_SOURCES,
  deckCounts,
  settingsForUser,
  syncStateForUser,
  updateSettings,
} from "../settings.js";

const version = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
).version;

// What is actually deployed (ops/deploy.sh → image env). `version` above has
// read "1.0.0" since the first commit and still goes out for shells older
// than v119, which print it.
const built = Number.parseInt(process.env.KOTOBA_BUILT_AT ?? "", 10);
const build = {
  commit: process.env.KOTOBA_COMMIT && process.env.KOTOBA_COMMIT !== "unknown" ? process.env.KOTOBA_COMMIT : null,
  builtAt: Number.isInteger(built) && built > 0 ? built : null,
};

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
      speakSource: { type: "string", enum: SPEAK_SOURCES },
      japaneseScript: { type: "boolean" },
      appearance: { type: "string", enum: APPEARANCES },
      recordingEnabled: { type: "boolean" },
      beginner: { type: "boolean" },
      // #133: at most four of the five, so one line always remains.
      hiddenModes: {
        type: "array",
        items: { type: "string", enum: MODE_KEYS },
        uniqueItems: true,
        maxItems: MODE_KEYS.length - 1,
      },
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
    decks: deckCounts(db, req.user.id),
    sync: syncStateForUser(db, req.user.id),
    version,
    build,
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
