-- Her own decks as things of their own (#137).
--
-- Henning, 2026-09-14: like Noji, a deck holds its cards — she adds a card
-- while she is in the deck, can start a new, empty deck, and can rename or
-- delete one. Until now a deck was only the `list_name` written on each of its
-- cards (migration 012), which cannot be empty and cannot be renamed without
-- rewriting every card and orphaning the settings stored under the name
-- (migration 014 keys them 'list:<name>').
--
-- So a deck gets a row and a number. `cards.deck_id` says which deck an own
-- card is in; every own card is in one. `list_name` stays as what it was on
-- import — where the card came from — and nothing selects by it any more.
-- Kaishi is not a row: it is the same deck for everyone and nobody's to edit.

CREATE TABLE decks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id   INTEGER NOT NULL REFERENCES users(id),
  name       TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 60 AND name = trim(name)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  -- Soft, like a card: its cards are soft-deleted with it, and their
  -- `review_events` still point at them.
  deleted_at INTEGER
);
-- Two live decks of one person never share a name; a deleted one frees it.
CREATE UNIQUE INDEX idx_decks_owner_name ON decks(owner_id, name) WHERE deleted_at IS NULL;

ALTER TABLE cards ADD COLUMN deck_id INTEGER REFERENCES decks(id);
CREATE INDEX idx_cards_deck_id ON cards(deck_id);

-- Her imported lists become decks, in the order the practise tab showed them
-- (by their first card, `min(id)`), so the ids follow that order.
INSERT INTO decks (owner_id, name, created_at, updated_at)
  SELECT owner_id, list_name, unixepoch(), unixepoch()
    FROM cards
   WHERE deck = 'personal' AND owner_id IS NOT NULL AND list_name IS NOT NULL
   GROUP BY owner_id, list_name
   ORDER BY owner_id, min(id);

-- Words added in the app outside any list — the practise tab's "My words".
-- None are live on 2026-09-14; the rule is here for any database that has some.
INSERT INTO decks (owner_id, name, created_at, updated_at)
  SELECT owner_id, 'My words', unixepoch(), unixepoch()
    FROM cards
   WHERE deck = 'personal' AND owner_id IS NOT NULL AND list_name IS NULL AND deleted_at IS NULL
   GROUP BY owner_id;

-- `updated_at` moves so every device is sent `deck_id` on its next sync: the
-- client asks めくる's direction and 選ぶ's wrong answers of it.
UPDATE cards
   SET deck_id = (SELECT d.id FROM decks d
                   WHERE d.owner_id = cards.owner_id
                     AND d.name = coalesce(cards.list_name, 'My words')),
       updated_at = unixepoch()
 WHERE deck = 'personal' AND owner_id IS NOT NULL
   AND (list_name IS NOT NULL OR deleted_at IS NULL);

-- Per-deck settings follow their deck by number: 'deck:<id>' instead of
-- 'list:<name>' and 'mine', so a rename keeps them. The CHECK changes, which
-- SQLite does only by rebuilding the table. A row whose deck cannot be found
-- is dropped: it would be settings for nothing.
CREATE TABLE deck_settings_new (
  user_id      INTEGER NOT NULL REFERENCES users(id),
  deck_key     TEXT    NOT NULL CHECK (deck_key = 'kaishi' OR deck_key GLOB 'deck:[1-9]*'),
  hidden_modes TEXT    NOT NULL DEFAULT '[]'
    CHECK (json_valid(hidden_modes) AND json_type(hidden_modes) = 'array' AND json_array_length(hidden_modes) < 5),
  new_per_day  INTEGER CHECK (new_per_day IS NULL OR new_per_day BETWEEN 5 AND 40),
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, deck_key)
);

INSERT INTO deck_settings_new (user_id, deck_key, hidden_modes, new_per_day, updated_at)
  SELECT s.user_id,
         CASE WHEN s.deck_key = 'kaishi' THEN 'kaishi' ELSE 'deck:' || d.id END,
         s.hidden_modes, s.new_per_day, s.updated_at
    FROM deck_settings s
    LEFT JOIN decks d
      ON d.owner_id = s.user_id
     AND d.name = CASE WHEN s.deck_key = 'mine' THEN 'My words' ELSE substr(s.deck_key, 6) END
   WHERE s.deck_key = 'kaishi' OR d.id IS NOT NULL;

DROP TABLE deck_settings;
ALTER TABLE deck_settings_new RENAME TO deck_settings;
