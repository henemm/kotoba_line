/**
 * Reise 1 and Reise 2 (#237): import/travel.tsv, read and checked.
 *
 * Two topics inside Kaishi rather than a deck of their own (Henning,
 * 2026-09-19). A row names a Kaishi card, which keeps its native recording,
 * or carries a phrase Kaishi does not have — copied from the Wikivoyage
 * phrasebook, the file's header says how.
 */

import { TOPICS } from "./tagging.js";

/** Topic per round, as `tags` stores it; the client names them (topics.js). */
export const TRAVEL_TOPICS = { 1: "travel 1", 2: "travel 2" };

/** Ids for the phrases Kaishi lacks: far above its note ids (~1.7e12). */
export const TRAVEL_ID_FLOOR = 9_000_000_000_000;

const JAPANESE = /[぀-ヿ㐀-鿿]/u;
// A reading is kana and single spaces between words: see the file's header.
const READING = /^[぀-ゟー]+( [぀-ゟー]+)*$/u;

export function parseTravel(text) {
  const rows = [];
  const seen = new Set();
  text.split("\n").forEach((line, i) => {
    if (!line.trim() || line.startsWith("#")) return;
    const where = `travel.tsv line ${i + 1}`;
    const parts = line.split("\t");
    const [round, id, word, reading, meaning] = parts;
    if (!TRAVEL_TOPICS[round]) throw new Error(`${where}: round must be 1 or 2, not ${round}`);
    if (!/^\d+$/.test(id)) throw new Error(`${where}: id must be a positive integer`);
    if (seen.has(id)) throw new Error(`${where}: id ${id} appears twice`);
    seen.add(id);
    if (!word || !JAPANESE.test(word)) throw new Error(`${where}: word must be Japanese`);
    const own = Number(id) >= TRAVEL_ID_FLOOR;
    if (!own) {
      if (parts.length !== 3) throw new Error(`${where}: a Kaishi row has round, id and word only`);
      rows.push({ round: Number(round), id: Number(id), word, kaishi: true });
      return;
    }
    if (parts.length !== 6) throw new Error(`${where}: a new phrase needs round, id, word, reading, meaning and topics`);
    if (!READING.test(reading)) throw new Error(`${where}: reading must be kana with single spaces`);
    if (!meaning?.trim()) throw new Error(`${where}: meaning is empty`);
    const topics = parts[5].split(",").map((t) => t.trim()).filter(Boolean);
    for (const t of topics) if (!TOPICS.includes(t)) throw new Error(`${where}: ${t} is not a topic`);
    rows.push({ round: Number(round), id: Number(id), word, reading, meaning: meaning.trim(), topics, kaishi: false });
  });
  return rows;
}

/**
 * The topics each listed card carries, for tag-cards.js and the import: its
 * round for every row, and for an added phrase the topics written beside it.
 */
export function travelAssignments(rows) {
  return rows.flatMap((r) => [
    { card_id: r.id, tag: TRAVEL_TOPICS[r.round] },
    ...(r.topics ?? []).map((tag) => ({ card_id: r.id, tag })),
  ]);
}

/** The added phrases' ids: their topics come from the file, not the rules. */
export const handTagged = (rows) => new Set(rows.filter((r) => !r.kaishi).map((r) => r.id));
