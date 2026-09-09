/**
 * Topic tagging (§8, §5a).
 *
 * Kaishi ships with no tags at all — 0 of 1,501 notes — and §5a's filters, the
 * topic picker and the per-topic progress on the Stats screen all depend on
 * them. §8 proposes an LLM pass over the deck. This does something more boring
 * and, for a deck that gets re-imported, better: a rule set over the English
 * glosses plus a hand-curated override file.
 *
 * Why rules rather than a model:
 *
 *  - It is deterministic, so re-importing an updated deck does not silently
 *    reshuffle which cards belong to which topic.
 *  - Every decision is auditable. A wrong tag is a line in `tags-overrides.tsv`
 *    or a word in a rule, reviewable as a diff, rather than a re-run of
 *    something stochastic.
 *  - It costs nothing to run and needs no API key on the machine doing an
 *    import.
 *
 * The nine topics are the product owner's list, settled in
 * docs/phase-0-plan.md §3.1 A.
 */

export const TOPICS = [
  "school",
  "konbini",
  "food",
  "travel",
  "small talk",
  "family",
  "health",
  "money",
  "time",
];

/**
 * Parenthesised text in a Kaishi gloss is a usage note, not the meaning:
 * "to take (e.g. time or money)" is not about time or money. Stripping it
 * first removes most of what would otherwise be false positives.
 */
export function glossForMatching(meaning) {
  return (meaning ?? "")
    .replace(/\([^)]*\)/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Deliberately precise rather than generous. A topic list that is half noise
 * is worse than a short one: "drill a topic" has to produce a session that
 * feels like the topic it names.
 *
 * Words like "write", "read", "shop", "car", "near" were tried and removed —
 * they pull in most of a frequency deck.
 */
const RULES = {
  health: [
    "body", "head", "face", "eye", "eyes", "ear", "ears", "nose", "mouth",
    "tooth", "teeth", "throat", "neck", "shoulder", "arm", "arms", "hand",
    "hands", "finger", "chest", "stomach", "belly", "waist", "leg", "legs",
    "foot", "feet", "knee", "skin", "hair", "blood", "bone", "heart", "muscle",
    "illness", "sick", "sickness", "disease", "fever", "pain", "hurt", "ache",
    "injury", "injure", "wound", "medicine", "doctor", "hospital", "nurse",
    "pharmacy", "healthy", "health", "tired", "fatigue", "sleepy", "cough",
    "breath", "breathe", "recover", "cure", "heal",
    // Physiology the first pass missed. These are the cases a WordNet-style
    // hypernym walk would have caught for free (body part / bodily fluid).
    "sleep", "asleep", "nap", "voice", "tear", "tears", "sweat", "sneeze",
    "swallow", "digest", "pulse", "wrist", "elbow", "ankle", "lip", "lips",
    "tongue", "cheek", "forehead", "nail", "nerve", "lung", "liver",
  ],
  food: [
    "eat", "eating", "drink", "drinking", "food", "meal", "breakfast", "lunch",
    "dinner", "rice", "bread", "meat", "fish", "vegetable", "fruit", "egg",
    "milk", "tea", "coffee", "sugar", "salt", "soup", "noodle", "noodles",
    "cook", "cooking", "restaurant", "delicious", "tasty", "taste", "flavor",
    "flavour", "hungry", "thirsty", "sweet", "spicy", "bitter", "sour",
    "chopsticks", "plate", "bowl", "menu", "snack", "dessert", "cake",
  ],
  family: [
    "family", "mother", "father", "parent", "parents", "child", "children",
    "son", "daughter", "brother", "sister", "grandmother", "grandfather",
    "grandparent", "aunt", "uncle", "cousin", "wife", "husband", "spouse",
    "baby", "relative", "relatives", "sibling", "household",
    "marriage", "marry", "wedding", "birth", "born", "raise a child",
  ],
  time: [
    "day", "days", "week", "month", "year", "years", "hour", "minute",
    "today", "tomorrow", "yesterday", "morning", "evening", "night", "noon",
    "midnight", "o'clock", "soon", "early", "late", "season", "spring",
    "summer", "autumn", "winter", "calendar", "clock", "watch", "date",
    "moment", "instant", "century", "weekend", "daily", "weekly", "monthly",
    "annual", "duration", "period",
  ],
  travel: [
    "travel", "trip", "journey", "station", "train", "bus", "taxi", "subway",
    "bicycle", "airport", "airplane", "plane", "flight", "ticket", "road",
    "street", "map", "hotel", "inn", "luggage", "baggage", "passport",
    "abroad", "overseas", "tourist", "sightseeing", "depart", "departure",
    "arrive", "arrival", "platform", "transfer", "route", "highway",
  ],
  school: [
    "school", "student", "pupil", "teacher", "professor", "class",
    "classroom", "lesson", "study", "studying", "homework", "exam",
    "examination", "quiz", "university", "college", "textbook", "notebook",
    "blackboard", "graduate", "graduation", "semester", "tuition",
    "curriculum", "memorize", "memorise", "senior", "junior", "principal",
    "scholarship",
  ],
  money: [
    "money", "yen", "price", "cost", "pay", "payment", "purchase", "buy",
    "sell", "cheap", "expensive", "wallet", "cash", "coin", "bank",
    "salary", "wage", "fee", "budget", "expense", "debt", "lend", "borrow",
    "rent", "profit", "discount", "tax", "account", "invoice", "afford",
  ],
  konbini: [
    "convenience store", "cashier", "clerk", "receipt", "register",
    "shelf", "customer", "goods", "merchandise", "stock", "checkout",
    "supermarket", "grocery",
  ],
  "small talk": [
    "greeting", "greet", "hello", "goodbye", "farewell", "thank", "thanks",
    "gratitude", "sorry", "apology", "apologize", "apologise", "excuse me",
    "please", "congratulations", "welcome", "introduce", "introduction",
    "conversation", "chat", "polite", "politeness", "compliment",
  ],
};

const PATTERNS = Object.fromEntries(
  Object.entries(RULES).map(([topic, words]) => [
    topic,
    new RegExp(`(^|[^a-z])(${words.map(escapeRegExp).join("|")})($|[^a-z])`, "i"),
  ]),
);

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Topics for one card, from the rules alone. Overrides are applied by the
 * caller so that the two sources stay visibly separate.
 */
export function tagsFromRules(meaning) {
  const gloss = glossForMatching(meaning);
  if (!gloss) return [];
  return TOPICS.filter((topic) => PATTERNS[topic].test(gloss));
}

/**
 * Parse the override file: `word<TAB>tag,tag` per line.
 *
 * `#` starts a comment, either on its own line or after an entry — a
 * cancellation is far easier to review when it says *why*. An empty tag list
 * means "this word gets no tags", which is how a wrong rule match is cancelled.
 */
export function parseOverrides(text) {
  const map = new Map();
  for (const [n, raw] of text.split("\n").entries()) {
    const line = raw.replace(/(^|\s)#.*$/, "$1").trim();
    if (!line) continue;

    const [word, tagField = ""] = line.split("\t");
    if (!word) continue;

    const tags = tagField
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    for (const tag of tags) {
      if (!TOPICS.includes(tag)) {
        throw new Error(`unknown topic "${tag}" on line ${n + 1} of the override file`);
      }
    }
    map.set(word.trim(), tags);
  }
  return map;
}

/** Rules, then overrides. An override always wins, including to clear tags. */
export function tagsForCard(card, overrides = new Map()) {
  if (overrides.has(card.word)) return overrides.get(card.word);
  return tagsFromRules(card.word_meaning);
}
