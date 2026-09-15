/**
 * Topic names in German (v75, Henning, 2026-09-15: "Themennamen bitte auch
 * gleich übersetzen").
 *
 * The keys are the deck's topics exactly as `import/lib/tagging.js` writes them
 * into `tags` — data, filtered and stored by those names, so they stay
 * English in the database and in every request. Only what is drawn changes.
 * A topic she coined herself (`card_user_tags`) is not in here and is shown
 * as she wrote it.
 *
 * `client/test/topics.test.js` fails when tagging.js gains a topic this list
 * does not name, so a new one cannot quietly appear in English.
 */
const GERMAN = {
  // fields — what a word is about
  people: "Menschen",
  family: "Familie",
  feelings: "Gefühle",
  body: "Körper",
  health: "Gesundheit",
  food: "Essen",
  home: "Zuhause",
  nature: "Natur",
  school: "Schule",
  work: "Arbeit",
  money: "Geld",
  places: "Orte",
  time: "Zeit",
  movement: "Bewegung",
  actions: "Tätigkeiten",
  senses: "Sinne",
  speaking: "Sprechen",
  describing: "Beschreiben",
  amount: "Mengen",
  ideas: "Gedanken",
  grammar: "Grammatik",
  // situations — where in Tokyo she would need it
  konbini: "Konbini",
  restaurant: "Restaurant",
  train: "Zug",
  doctor: "Arzt",
  classroom: "Klassenzimmer",
  shopping: "Einkaufen",
  "host family": "Gastfamilie",
  greetings: "Begrüßungen",
};

export const TOPIC_KEYS = Object.keys(GERMAN);

/** The name to draw for a topic: German for the deck's, hers as she wrote it. */
export function topicLabel(tag) {
  return GERMAN[tag] ?? tag;
}

/** For lists drawn in German order rather than the English keys' order. */
export function byTopicLabel(a, b) {
  return topicLabel(a).localeCompare(topicLabel(b), "de");
}
