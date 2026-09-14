-- Light or dark (Henning, 2026-09-14: "eine helle Variante der App … in den
-- Settings umstellbar", and "für Charlotte soll light der default sein").
--
-- 'light' for everyone, the accounts that exist included — the default is his
-- decision for her account, not a side effect. 'system' follows the iPhone's
-- own Appearance setting ("Like iPhone" on the screen).
ALTER TABLE user_settings ADD COLUMN appearance TEXT NOT NULL DEFAULT 'light'
  CHECK (appearance IN ('light', 'dark', 'system'));
