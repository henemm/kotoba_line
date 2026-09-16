-- Her own and a native speaker's recordings, attached to a card (the #183
-- follow-up): unlike review_events, a recording must be deletable and
-- "native" capped at 3 per card, so this is a real row per recording rather
-- than an append-only log folded into a cache — the same shape card_stars
-- and card_user_tags already use for per-(user, card) state that needs more
-- than a boolean. card_id carries no CHECK > 0: her own cards' negative ids
-- are ordinary foreign keys here too (rule 4), same as in card_stars.
--
-- id is a client-generated UUID, like review_events.id, so a retried upload
-- after a dropped connection cannot create a duplicate row.
CREATE TABLE card_recordings (
  id          TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  card_id     INTEGER NOT NULL REFERENCES cards(id),
  kind        TEXT NOT NULL,               -- 'own' | 'native'
  file        TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  deleted_at  INTEGER                      -- soft delete, like cards.deleted_at
);

CREATE INDEX idx_recordings_user_card ON card_recordings(user_id, card_id, deleted_at);
