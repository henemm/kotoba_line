-- Her own topics on any card (#35).
--
-- Separate from `tags` on purpose, and it is not tidiness. `tags` is the deck's
-- own topic list: global, the same for everyone, and rebuilt from scratch by
-- `npm run tag`, which begins with `DELETE FROM tags`. Anything of hers stored
-- there would be destroyed by the next deck update, silently and completely.
--
-- It also could not be hers in the first place — `tags` has no user column, so
-- filing 図書館 under "my exam" would file it there for everyone with an
-- account.
--
-- The tag itself is free text she types (normalised the same way the personal
-- deck normalises its tags: trimmed, lower-cased, spaces collapsed). No foreign
-- key to a topic table, because there is no topic table: her vocabulary is
-- whatever she needs it to be, and the deck's fixed list is a different thing
-- that happens to be displayed beside it.
CREATE TABLE card_user_tags (
  user_id  INTEGER NOT NULL REFERENCES users(id),
  card_id  INTEGER NOT NULL REFERENCES cards(id),
  tag      TEXT    NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, card_id, tag)
);

-- Filtering a session by one of her topics walks user_id + tag, so that is the
-- index; the primary key already covers "what are this card's topics".
CREATE INDEX idx_card_user_tags_lookup ON card_user_tags(user_id, tag);
