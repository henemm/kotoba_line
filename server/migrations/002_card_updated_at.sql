-- §5: GET /api/deck?since=<ts> returns "cards changed since ts", so a card has
-- to carry when it last changed. The import stamps this on every row it writes,
-- which is what lets the client hold the deck in IndexedDB and fetch only the
-- difference after a deck update rather than the whole 1,500 again.
ALTER TABLE cards ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_cards_updated_at ON cards(updated_at);
