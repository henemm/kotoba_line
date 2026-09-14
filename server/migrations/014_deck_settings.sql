-- Settings that belong to one deck (#137).
--
-- With the practise tab starting from her decks, two settings stopped being
-- about her and became about a deck. Which ways of practising make sense
-- differs by deck — her Noji lists have no sentence translations to listen to,
-- and fewer than half of their words have a reading to type against — and in
-- Noji, where she learned them, each deck has its own daily limit. Henning
-- agreed both on 2026-09-14.
--
-- `deck_key` is the practise tab's key: 'kaishi', 'mine', or 'list:<name>'.
-- A list is keyed by its name because the name is all a list is (migration
-- 012 has no lists table). A row appears only once she changes something; a
-- deck without one uses the defaults in deck-settings.js.
--
-- `user_settings.new_per_day` and `hidden_modes` stay: a phone still on v62
-- reads them, and Kaishi's limit defaults to her old overall one.
CREATE TABLE deck_settings (
  user_id      INTEGER NOT NULL REFERENCES users(id),
  deck_key     TEXT    NOT NULL CHECK (deck_key = 'kaishi' OR deck_key = 'mine' OR deck_key LIKE 'list:_%'),
  -- At most four of the five, so a deck always keeps a way of practising.
  hidden_modes TEXT    NOT NULL DEFAULT '[]'
    CHECK (json_valid(hidden_modes) AND json_type(hidden_modes) = 'array' AND json_array_length(hidden_modes) < 5),
  -- NULL: the deck's default. Otherwise the same bounds as the overall limit.
  new_per_day  INTEGER CHECK (new_per_day IS NULL OR new_per_day BETWEEN 5 AND 40),
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, deck_key)
);
