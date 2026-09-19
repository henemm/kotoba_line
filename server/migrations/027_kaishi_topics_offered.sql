-- Her own cards take their topics from the Kaishi word they match (#209).
--
-- Once per card, not on every start: when this is NULL the card has not been
-- offered its Kaishi topics yet (server/src/kaishi-topics.js). A topic she
-- takes off a card afterwards stays off, because the card is never offered
-- again. Only personal cards ever have a value here.
ALTER TABLE cards ADD COLUMN topics_offered_at INTEGER;
