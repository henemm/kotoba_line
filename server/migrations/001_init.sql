-- Initial schema. Mirrors §3 of docs/kotoba-line-spec.md.
--
-- The rule that keeps this simple: review_events is the truth, card_state is
-- a cache. If scheduling ever produces something odd, delete card_state and
-- replay the event log.

-- Users are created by the administrator. No public registration.
CREATE TABLE users (
  id          INTEGER PRIMARY KEY,
  handle      TEXT NOT NULL UNIQUE,      -- lowercase login name
  display     TEXT NOT NULL,             -- shown in the UI
  pin_hash    TEXT NOT NULL,             -- argon2id, never the PIN itself
  created_at  INTEGER NOT NULL           -- unix seconds
);

CREATE TABLE sessions (
  token       TEXT PRIMARY KEY,          -- 32 random bytes, base64url
  user_id     INTEGER NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- The deck. Field names mirror the Kaishi 1.5k note type so importing
-- the real deck is a column mapping and nothing more.
CREATE TABLE cards (
  id                INTEGER PRIMARY KEY,
  word              TEXT NOT NULL,
  word_furigana     TEXT,
  word_meaning      TEXT NOT NULL,
  word_audio        TEXT,                -- filename under /media/, may be NULL
  sentence          TEXT,
  sentence_furigana TEXT,
  sentence_meaning  TEXT,
  sentence_audio    TEXT,
  frequency_rank    INTEGER,             -- deck order; drives introduction order
  deck              TEXT NOT NULL DEFAULT 'kaishi'
);
CREATE INDEX idx_cards_deck_rank ON cards(deck, frequency_rank);

CREATE TABLE tags (
  card_id  INTEGER NOT NULL REFERENCES cards(id),
  tag      TEXT NOT NULL,                -- 'school', 'konbini', 'food', ...
  PRIMARY KEY (card_id, tag)
);
CREATE INDEX idx_tags_tag ON tags(tag);

-- ── The important one ──────────────────────────────────────────────
-- Append-only. Never updated, never deleted. This is the entire
-- synchronisation mechanism; see §4 of the spec.
CREATE TABLE review_events (
  id          TEXT PRIMARY KEY,          -- UUID generated on the CLIENT
  user_id     INTEGER NOT NULL REFERENCES users(id),
  card_id     INTEGER NOT NULL REFERENCES cards(id),
  mode        TEXT NOT NULL,             -- choose | listen | speak | flip
  rating      INTEGER NOT NULL,          -- 1 again, 2 hard, 3 good, 4 easy
  reviewed_at INTEGER NOT NULL,          -- unix seconds, client clock
  received_at INTEGER NOT NULL           -- unix seconds, server clock
);
CREATE INDEX idx_events_user_card ON review_events(user_id, card_id, reviewed_at);

-- Cards she has explicitly chosen to prioritise. See §5a.
CREATE TABLE card_stars (
  user_id  INTEGER NOT NULL REFERENCES users(id),
  card_id  INTEGER NOT NULL REFERENCES cards(id),
  added_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, card_id)
);

-- Derived state. Rebuildable from review_events at any time; kept as a
-- table purely so the "what is due" query stays fast.
CREATE TABLE card_state (
  user_id     INTEGER NOT NULL REFERENCES users(id),
  card_id     INTEGER NOT NULL REFERENCES cards(id),
  due_at      INTEGER NOT NULL,
  stability   REAL,                      -- FSRS
  difficulty  REAL,                      -- FSRS
  reps        INTEGER NOT NULL DEFAULT 0,
  lapses      INTEGER NOT NULL DEFAULT 0,
  last_review INTEGER,
  PRIMARY KEY (user_id, card_id)
);
CREATE INDEX idx_card_state_due ON card_state(user_id, due_at);

-- Per-user settings. The spec names the daily new-card limit (§12) and the
-- session length; both are exposed in the Settings screen.
--
-- The new-card limit has a floor of 5 and may not be zero: the product owner
-- ruled that some new material must always keep arriving. This reverses the
-- annotation on design screen 22. See docs/phase-0-plan.md §3.1 E.
CREATE TABLE user_settings (
  user_id        INTEGER PRIMARY KEY REFERENCES users(id),
  new_per_day    INTEGER NOT NULL DEFAULT 15,
  session_length INTEGER NOT NULL DEFAULT 20,   -- 10 | 20 | 60 ("All" is capped)
  read_aloud     INTEGER NOT NULL DEFAULT 1,
  pitch_accent   INTEGER NOT NULL DEFAULT 0,
  CHECK (new_per_day BETWEEN 5 AND 40)
);
