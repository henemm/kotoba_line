/**
 * Bring one of her own vocabulary lists in from elsewhere (#137) — today, her
 * two Noji decks.
 *
 * Every row becomes a personal card of hers: the German she wrote is the
 * meaning, the romaji she wrote is the word. Nothing is generated. In
 * particular no kana is made from her romaji — the romaji→kana table in
 * `client/src/typing.js` is built for what she types, and as stored data it is
 * wrong exactly where it matters (kinyoubi → きにょうび, the particle wa →
 * わ). A card with no reading is an ordinary card here.
 *
 * Where the row names a Kaishi card (`kaishiId`), her card takes that card's
 * spelling, reading, pitch, recording and example sentence, and keeps her
 * German. Not the sentence's translation: Kaishi's is English, and on a German
 * card it was a third language (migration 013). The Kaishi card itself is not touched, and neither list is mixed
 * into the other: a word in both of her lists is two cards, as it was in Noji.
 * Which rows may name a Kaishi card is decided before this runs, by rule
 * (see #137) — this only refuses a name that does not point at a live Kaishi
 * card.
 *
 * Safe to run twice: `import_ref` is unique per owner, and a row already
 * imported is skipped rather than overwritten, so a correction made in the app
 * afterwards is never undone by re-running an import.
 */

import { deckIdFor } from "./decks.js";

const FLAGS = new Set(["meaning", "spelling", "reversed", "inflected", "sentence"]);

export function importList(db, userId, rows, { source = "noji", now = Date.now() } = {}) {
  const seconds = Math.floor(now / 1000);
  const existing = db.prepare("SELECT 1 FROM cards WHERE owner_id = ? AND import_ref = ?");
  const taken = db.prepare("SELECT 1 FROM cards WHERE id = ?");
  const kaishi = db.prepare(
    `SELECT word, word_furigana, word_reading, word_pitch, word_audio,
            sentence, sentence_furigana, sentence_audio
       FROM cards WHERE id = ? AND deck = 'kaishi' AND deleted_at IS NULL`,
  );
  const insert = db.prepare(
    `INSERT INTO cards
       (id, word, word_furigana, word_reading, word_pitch, word_meaning, word_audio,
        sentence, sentence_furigana, sentence_meaning, sentence_audio,
        frequency_rank, deck, owner_id, updated_at,
        list_name, import_ref, import_flag, import_source, deck_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'personal', ?, ?, ?, ?, ?, ?, ?)`,
  );

  const result = { imported: 0, skipped: 0, enriched: 0, flagged: 0 };

  db.transaction(() => {
    // Ids are negative epoch milliseconds (cards.js), one apart, in the order
    // of the file — so ascending id, which is how new personal cards are
    // introduced (queue.js), is the order of her lists.
    let id = -(now + rows.length);
    for (const row of rows) {
      const front = String(row.front ?? "").trim();
      const back = String(row.back ?? "").trim();
      const list = String(row.list ?? "").trim();
      if (!front || !back || !list || !row.noteId) {
        throw new Error(`incomplete row: ${JSON.stringify(row)}`);
      }
      if (row.flag != null && !FLAGS.has(row.flag)) throw new Error(`unknown flag: ${row.flag}`);

      const ref = `${source}:${list}:${row.noteId}`;
      if (existing.get(userId, ref)) {
        result.skipped += 1;
        continue;
      }

      const k = row.kaishiId == null ? undefined : kaishi.get(row.kaishiId);
      if (row.kaishiId != null && !k) throw new Error(`no live Kaishi card ${row.kaishiId} for ${ref}`);

      while (taken.get(id)) id += 1;
      insert.run(
        id,
        k ? k.word : back,
        k?.word_furigana ?? null,
        k?.word_reading ?? null,
        k?.word_pitch ?? null,
        front,
        k?.word_audio ?? null,
        k?.sentence ?? null,
        k?.sentence_furigana ?? null,
        null,
        k?.sentence_audio ?? null,
        userId,
        seconds,
        list,
        ref,
        row.flag ?? null,
        JSON.stringify({
          source,
          list,
          position: row.position ?? null,
          noteId: row.noteId,
          bothDirections: Boolean(row.bothDirections),
          front,
          back,
          kaishiId: row.kaishiId ?? null,
          check: row.check ?? null,
        }),
        // The list is a deck of hers (migration 016), made on its first row.
        deckIdFor(db, userId, list, now),
      );
      id += 1;
      result.imported += 1;
      if (k) result.enriched += 1;
      if (row.flag) result.flagged += 1;
    }
  })();

  return result;
}
