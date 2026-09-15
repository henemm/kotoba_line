-- The hiragana and katakana decks (#158) have settings of their own, like
-- Kaishi: "New cards per day" is how fast new kana come, a row at a time.
-- Their keys are the deck names, as Kaishi's is. The CHECK changes, which
-- SQLite does only by rebuilding the table (as in 016).
CREATE TABLE deck_settings_new (
  user_id      INTEGER NOT NULL REFERENCES users(id),
  deck_key     TEXT    NOT NULL
    CHECK (deck_key IN ('kaishi', 'hiragana', 'katakana') OR deck_key GLOB 'deck:[1-9]*'),
  hidden_modes TEXT    NOT NULL DEFAULT '[]'
    CHECK (json_valid(hidden_modes) AND json_type(hidden_modes) = 'array' AND json_array_length(hidden_modes) < 5),
  new_per_day  INTEGER CHECK (new_per_day IS NULL OR new_per_day BETWEEN 5 AND 40),
  updated_at   INTEGER NOT NULL,
  max_per_day  INTEGER CHECK (max_per_day IS NULL OR max_per_day BETWEEN 10 AND 500),
  PRIMARY KEY (user_id, deck_key)
);

INSERT INTO deck_settings_new (user_id, deck_key, hidden_modes, new_per_day, updated_at, max_per_day)
  SELECT user_id, deck_key, hidden_modes, new_per_day, updated_at, max_per_day FROM deck_settings;

DROP TABLE deck_settings;
ALTER TABLE deck_settings_new RENAME TO deck_settings;
