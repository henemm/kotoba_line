-- Her own words belong to her (#84).
--
-- `cards` had no owner, so a word one account added was in every account's
-- list, queue, topic chips and cached deck, and any account could delete it.
-- Reproduced on production with two test accounts before this was written.
--
-- NULL for the Kaishi deck, which belongs to everyone. A personal card is
-- visible only to `owner_id`; the rule lives in one place, `visibleTo()` in
-- server/src/cards.js, and every read path goes through it.
--
-- Existing personal cards have no recorded owner and cannot be given one after
-- the fact, so they become visible to nobody. When this was written production
-- held exactly two, both test words, both already soft-deleted.
ALTER TABLE cards ADD COLUMN owner_id INTEGER REFERENCES users(id);

CREATE INDEX idx_cards_owner ON cards(owner_id) WHERE owner_id IS NOT NULL;

-- Re-send every personal card on the next deck sync. `/api/deck` now delivers
-- someone else's card as a tombstone, and a device that cached one before this
-- migration only hears about it if the row has changed since its watermark.
UPDATE cards SET updated_at = CAST(strftime('%s', 'now') AS INTEGER) WHERE deck = 'personal';
