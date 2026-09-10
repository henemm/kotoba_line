-- Deleting one of her own words, without rewriting history.
--
-- Design 30 asks that deleting a card "removes it from the deck but not from
-- the event log, so stats do not change retroactively". The schema forbids the
-- literal reading of that: `review_events.card_id` is a foreign key, so a card
-- with reviews behind it cannot be deleted at all.
--
-- The schema is right and the design's intent survives it. The card is marked
-- rather than removed: it leaves every queue, every browse and her list, while
-- the row stays for the log to point at — which also keeps an old summary able
-- to name the word she missed, and keeps §3's promise that card_state can be
-- rebuilt by replaying review_events.
ALTER TABLE cards ADD COLUMN deleted_at INTEGER;

CREATE INDEX idx_cards_live ON cards(deck, deleted_at);
