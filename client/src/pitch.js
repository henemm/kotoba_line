/**
 * Drawing the pitch contour (#21).
 *
 * The card carries `word_pitch`: the mora the pitch drops after, or 0 for a
 * word that never drops. That is all the information there is, and it is
 * enough — the contour follows from it and the reading by three rules that
 * have no exceptions in standard Japanese:
 *
 *   accent 0   low,  then high to the end, and the particle after it stays high
 *   accent 1   high, then low to the end
 *   accent n   low,  high from 2 to n, then low
 *
 * Drawn here rather than shipped as markup from the deck. Kaishi's own is
 * absolutely-positioned spans that need a container this app does not have,
 * and putting someone else's HTML through innerHTML is the one thing this
 * client never does.
 */

/** Small kana that ride on the mora before them rather than making their own. */
const COMBINING = new Set("ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ");

/**
 * A reading split into moras.
 *
 * ー and っ each count: 先生 せ-ん-せ-い drops after the third, and a contour
 * that merged them would put the fall in the wrong place.
 */
export function moras(reading) {
  const out = [];
  for (const ch of reading ?? "") {
    if (out.length > 0 && COMBINING.has(ch)) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

/**
 * High or low for each mora, plus whether the particle after the word is high.
 *
 * The particle matters: it is the only thing that distinguishes 花 [2] from
 * 鼻 [0], both はな, both low-high. Saying so is the point of showing accent
 * at all, so it is returned rather than left for the caller to work out.
 */
export function contour(reading, accent) {
  const parts = moras(reading);
  if (parts.length === 0 || accent === undefined || accent === null) return undefined;

  const n = Number(accent);
  if (!Number.isInteger(n) || n < 0 || n > parts.length) return undefined;

  const high = parts.map((_, i) => {
    const mora = i + 1;
    if (n === 1) return mora === 1;
    return mora > 1 && (n === 0 || mora <= n);
  });

  return { moras: parts, high, particleHigh: n === 0 };
}

/**
 * What the deck says, as a list — 55 words carry two current accents.
 *
 * "0,2" means either is right. Kept as both rather than collapsed to the
 * first, because picking one would quietly teach that the other is wrong.
 */
export function accentsOf(card) {
  const raw = card?.word_pitch;
  if (raw === undefined || raw === null || raw === "") return [];
  return String(raw)
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n));
}

/** "[2]", or "[0 or 2]" where the deck gives two. */
export function accentLabel(card) {
  const accents = accentsOf(card);
  if (accents.length === 0) return undefined;
  return `[${accents.join(" or ")}]`;
}
