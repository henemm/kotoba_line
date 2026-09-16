-- A picture that holds a kana's shape (#177, v88), as JSON —
-- { "file": "mnemonic-03042.png", "hook": "Attention! Says the drill sergeant." }.
-- Written by `npm run import-kana` (import/lib/kana-mnemonics.js) for the 46
-- basic kana of each script; NULL on every other card, dakuten and yōon
-- included, which the chart does not draw.
ALTER TABLE cards ADD COLUMN word_mnemonic TEXT
  CHECK (word_mnemonic IS NULL OR (json_valid(word_mnemonic) AND json_type(word_mnemonic) = 'object'));
