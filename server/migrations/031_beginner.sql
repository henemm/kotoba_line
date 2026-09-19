-- #252: "Einstieg" (Henning, 2026-09-19). With it on, the deck list is Reise 1,
-- and Reise 2 once every Reise 1 card was said aloud and known once. Off by
-- default: every account that exists keeps the app it has until someone
-- touches the switch, and switching it off hides nothing and deletes nothing.
ALTER TABLE user_settings ADD COLUMN beginner INTEGER NOT NULL DEFAULT 0
  CHECK (beginner IN (0, 1));

-- Reise 1 and Reise 2 are decks of the beginner's list, keyed 'travel:1' and
-- 'travel:2' (server/src/queue.js, parseDeckKey): Kaishi's cards under one
-- topic, paced by a daily limit of their own like any deck. So they have
-- settings like any deck, and the CHECK has to admit their keys — which in
-- SQLite means rebuilding the table, as 016 and 018 did.
CREATE TABLE deck_settings_new (
  user_id       INTEGER NOT NULL REFERENCES users(id),
  deck_key      TEXT    NOT NULL
    CHECK (deck_key IN ('kaishi', 'hiragana', 'katakana', 'travel:1', 'travel:2') OR deck_key GLOB 'deck:[1-9]*'),
  hidden_modes  TEXT    NOT NULL DEFAULT '[]'
    CHECK (json_valid(hidden_modes) AND json_type(hidden_modes) = 'array' AND json_array_length(hidden_modes) < 5),
  new_per_day   INTEGER CHECK (new_per_day IS NULL OR new_per_day BETWEEN 5 AND 40),
  updated_at    INTEGER NOT NULL,
  max_per_day   INTEGER CHECK (max_per_day IS NULL OR max_per_day BETWEEN 10 AND 500),
  extra_new     INTEGER NOT NULL DEFAULT 0 CHECK (extra_new >= 0),
  extra_new_day TEXT,
  PRIMARY KEY (user_id, deck_key)
);

INSERT INTO deck_settings_new (user_id, deck_key, hidden_modes, new_per_day, updated_at, max_per_day, extra_new, extra_new_day)
  SELECT user_id, deck_key, hidden_modes, new_per_day, updated_at, max_per_day, extra_new, extra_new_day FROM deck_settings;

DROP TABLE deck_settings;
ALTER TABLE deck_settings_new RENAME TO deck_settings;
