-- „Höchstens gleichzeitig lernen" counts every deck together (#314).
--
-- v176 kept it per deck (migration 039). The day after, Charlotte had 50 in
-- „100 vokabeln" and started Kaishi, Hiragana, Katakana and a deck of her
-- own: 50 new words and characters that day, 35 of them where no limit
-- applied. Henning, 2026-10-05: „gemeinsame Grenze über alle Decks". What
-- she has too much of is words, not words in one deck.
--
-- The value moves to her account. A deck's own column stays, unread: shells
-- from v176 still send it with every change to a deck's options, and the
-- route accepts and drops it rather than refuse the whole change.
ALTER TABLE user_settings ADD COLUMN max_open INTEGER
  CHECK (max_open IS NULL OR max_open BETWEEN 10 AND 500);

UPDATE user_settings SET max_open =
  (SELECT max(d.max_open) FROM deck_settings d WHERE d.user_id = user_settings.user_id);

UPDATE deck_settings SET max_open = NULL;
