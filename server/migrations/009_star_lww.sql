-- Stars move from "a row exists = starred" to a last-write-wins register
-- (#22): the row stays once a card has been touched, carrying its current
-- state and when that state was decided, instead of appearing and
-- disappearing. That is what lets an offline star or unstar be queued on the
-- device and resolved by timestamp when it eventually reaches the server,
-- rather than needing a live connection for every tap — the same "trust the
-- time the action happened, not the order it arrived in" rule §4 states for
-- review_events, sized to what a boolean flag needs rather than a full log.
--
-- Every existing row meant "starred" by its mere presence, so it keeps that
-- meaning under the new column, and `added_at` becomes `changed_at` — the
-- same value, now read as "as of when" rather than "since when".
ALTER TABLE card_stars RENAME COLUMN added_at TO changed_at;
ALTER TABLE card_stars ADD COLUMN starred INTEGER NOT NULL DEFAULT 1;
