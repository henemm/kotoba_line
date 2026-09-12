-- What 話す asks about (#77): the word alone, the sentence, or a random pick
-- each time it draws a card. Default 'sentence' is the behaviour this setting
-- replaces — prefer the sentence, fall back to the word when a card has none
-- — so nobody's practice changes until they touch the new control.
ALTER TABLE user_settings ADD COLUMN speak_source TEXT NOT NULL DEFAULT 'sentence'
  CHECK (speak_source IN ('word', 'sentence', 'random'));
