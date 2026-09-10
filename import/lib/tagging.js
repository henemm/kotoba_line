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
 *
 * ── What changed, and why the reasoning above was wrong (#24) ──────────
 *
 * The rules reach 191 of 1,500 cards. That was recorded as a fact about the
 * deck — "most of this deck has no topic to be tagged with" — and it is not.
 * 木, 闇, 忙しい, 叩く, 空, 愛, 手紙 all have obvious topics. What they do not
 * have is one of *these nine*.
 *
 * The nine are situations: konbini, school, travel, small talk. A frequency
 * deck maps badly onto situations and well onto semantic fields, so the low
 * number measured the taxonomy, not the vocabulary. The forced fits are
 * visible in the output — 迎える "to go out to meet" tagged `small talk`,
 * ください "please give" tagged `small talk`, 眠る "to sleep" tagged `health`.
 *
 * So there are now two axes, and a card may carry both:
 *
 *  - FIELDS — what the word is *about*. Every content word has one, which is
 *    what lifts coverage from an eighth of the deck to most of it.
 *  - SITUATIONS — where in Tokyo she would actually need it. Sparse on
 *    purpose: a situation that matches half the deck is not a situation.
 *
 * `grammar` is a field like the others rather than an absence. する, ますます
 * and あくまで have no subject matter, and a taxonomy that pretended otherwise
 * would put them somewhere wrong. Named, they stay filterable.
 */

/** What the word is about. Every content word gets at least one. */
export const FIELDS = [
  "people",
  "family",
  "feelings",
  "body",
  "health",
  "food",
  "home",
  "nature",
  "school",
  "work",
  "money",
  "places",
  "time",
  "movement",
  "actions",
  "senses",
  "speaking",
  "describing",
  "amount",
  // Cause, result, proof, plan, mistake, chance. Split out of `grammar` after
  // the first full pass, where it was the largest field by a wide margin —
  // the same shape of number that gave the nine topics away. Two unrelated
  // things were sitting in it: function words with no subject matter (する,
  // もし, むしろ) and abstract nouns that have one (原因, 証拠, 事実, 例).
  // Filing 証拠 "evidence" under grammar is the same mistake as filing
  // ください under small talk, one taxonomy later.
  "ideas",
  "grammar",
];

/** Where she would need it. Sparse by design. */
export const SITUATIONS = [
  "konbini",
  "restaurant",
  "train",
  "doctor",
  "classroom",
  "shopping",
  "host family",
  "greetings",
];

export const TOPICS = [...FIELDS, ...SITUATIONS];

/** Which axis a topic belongs to — the picker and Stats group by this. */
export function axisOf(topic) {
  if (FIELDS.includes(topic)) return "field";
  if (SITUATIONS.includes(topic)) return "situation";
  return undefined;
}

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
  places: [
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
  greetings: [
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
  // Only the topics the rules actually cover. Since #24 the vocabulary is
  // much larger than the rule set: the model pass supplies the rest, and a
  // topic with no pattern must be absent here rather than a crash.
  return Object.keys(PATTERNS).filter((topic) => PATTERNS[topic].test(gloss));
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

/**
 * Parse the model pass: `id<TAB>word<TAB>fields<TAB>situations` per line.
 *
 * Keyed by card id, not by word, unlike the override file — and that is not
 * tidiness. 24 words appear twice in the deck with different senses: もう is
 * "already" and "another, again"; 聞く is "to hear" and "to ask"; 早い is
 * "early" and "fast". A word-keyed file gives both cards the same topics and
 * silently loses one of the two senses. The id is Anki's note id, which is
 * what cards are keyed on, so it survives a re-import.
 *
 * The word is carried in column 2 for the reader's sake only — a diff of
 * bare ids is not reviewable, and this file is meant to be reviewed.
 */
export function parseModelPass(text) {
  const map = new Map();
  for (const [n, raw] of text.split("\n").entries()) {
    const line = raw.replace(/(^|\s)#.*$/, "$1").trim();
    if (!line) continue;

    const [id, , fieldField = "", situationField = ""] = line.split("\t");
    if (!id) continue;

    const tags = [...fieldField.split(","), ...situationField.split(",")]
      .map((t) => t.trim())
      .filter(Boolean);

    for (const tag of tags) {
      if (!TOPICS.includes(tag)) {
        throw new Error(`unknown topic "${tag}" on line ${n + 1} of the model pass`);
      }
    }
    map.set(String(id).trim(), tags);
  }
  return map;
}

/**
 * Topics for one card. Three sources, most specific first.
 *
 * The hand-written override file wins over everything, including over the
 * model, and including the empty list that means "no topics at all" — that is
 * how a wrong assignment is cancelled without arguing with the source of it.
 *
 * The model pass covers the deck as it stands. The rules stay underneath it
 * rather than being deleted: an updated Kaishi release brings cards the pass
 * has never seen, and a keyword rule is a better answer for those than
 * nothing at all until the pass is re-run.
 */
export function tagsForCard(card, overrides = new Map(), modelPass = new Map()) {
  if (overrides.has(card.word)) return overrides.get(card.word);
  const fromModel = modelPass.get(String(card.id));
  if (fromModel) return fromModel;
  return tagsFromRules(card.word_meaning);
}
