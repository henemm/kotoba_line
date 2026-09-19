-- What appeared on her screen, and what she did with it (#228).
--
-- An offer like "Mehr neue Wörter" (#179) or the break hint (#218) leaves no
-- trace in review_events, so "did it work for her?" had no answer except
-- asking her. One row per moment: `name` is one of a short fixed list
-- (routes/ui-events.js), `detail` says where (a deck key), `at` is the
-- device's clock.
--
-- Not part of synchronisation: nothing is folded from this table and nothing
-- reads it to decide what she sees. It can be emptied or dropped at any time.
-- The id is the client's UUID, so a batch posted twice lands once.
CREATE TABLE ui_events (
  id          TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  name        TEXT NOT NULL,
  detail      TEXT,
  at          INTEGER NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE INDEX ui_events_user_at ON ui_events (user_id, at);
