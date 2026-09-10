/**
 * Pitch accent, out of Kaishi's markup and into a number (#21).
 *
 * The deck carries it on 1,500 of its 1,501 notes, but as a drawing: katakana
 * with the high moras wrapped in a span that paints an overline with a CSS
 * border, and the downstep marked by a border on that span's right edge.
 *
 *   私    ワ<span …border-top…>タシ</span>                      no drop  → 0
 *   雨    <span …border-top; border-right…>ア</span>メ          drop @1  → 1
 *   先生  セ<span …border-top; border-right…>ンセ</span>ー       drop @3  → 3
 *
 * Handing that to innerHTML is not an option — this client never does, and the
 * markup is absolute-positioned against a container it does not have. So the
 * import reduces it to what it actually means: **the mora the pitch drops
 * after, or 0 for a word with no drop.** That is the standard notation, it is
 * one integer, and the client can draw the contour itself from the reading.
 *
 * Verified against the deck: every derivation below was checked against NHK's
 * values for 私[0], 勉強[0], 友達[0], 先生[3], 男[3], 日本[2], 花[2], 山[2],
 * 雨[1], さん[1], 彼[1], あなた[2], 好き[2].
 */

/**
 * Small kana that join the preceding mora rather than forming their own.
 *
 * ー and ッ are *not* here: both are moras in their own right, and both change
 * where the drop falls. 先生 セ-ン-セ-ー drops after the third, not the fourth.
 */
const COMBINING = new Set("ャュョァィゥェォヮ");

/** Kana, and the marks that decorate them. Everything else is not a syllable. */
const KANA = /[\u3040-\u309f\u30a0-\u30ff\uff66-\uff9f]/;

/** Katakana (plus the marks the deck decorates them with) as a run of moras. */
export function moras(kana) {
  const out = [];
  for (const ch of kana ?? "") {
    // Anything that is not kana is not a mora — Latin letters, punctuation, a
    // tag that escaped. Silently counting one is how a drop lands in the wrong
    // place, which is worse than showing no accent at all.
    if (!KANA.test(ch) && ch !== "°" && ch !== "\u00b0") continue;
    // The deck annotates a nasal ng with a red ゜ and devoicing with colour;
    // the colour is gone by now, the ゜ rides along with its kana.
    if (out.length > 0 && (COMBINING.has(ch) || ch === "゜" || ch === "°")) {
      out[out.length - 1] += ch;
    } else {
      out.push(ch);
    }
  }
  return out;
}

/**
 * One alternative's accent, from its markup fragment.
 *
 * Returns the mora index the pitch drops after, or 0 when it never drops.
 * `undefined` when the fragment carries no overline at all — a note whose
 * field is prose rather than a drawing, which is a thing to report rather
 * than to guess at.
 */
export function accentOf(fragment) {
  return accentsFrom(fragment)[0];
}

/**
 * The accent of one already-parsed run of pieces.
 *
 * Returns the mora the pitch drops after, or 0 when it never drops.
 * `undefined` when the run carries no overline at all — a note whose field is
 * prose rather than a drawing, which is a thing to report rather than guess at.
 */
function accentOfPieces(run) {
  let index = 0; // moras counted so far
  let drop;
  let sawHigh = false;

  for (const piece of run) {
    // A piece can begin with a mark belonging to the mora before it: the deck
    // puts its nasal-ng ° in a red span of its own, so 次 arrives as "ツ" ·
    // "キ" · "°", and counting each piece from scratch makes that ° a third
    // mora — pushing every later drop one place too far.
    const n = moras(leadingMarks(stripMarks(piece.text))).length;
    if (n === 0) {
      // Still a place a drop can be marked, though it carries no mora.
      if (piece.high && piece.drops && index > 0) drop = index;
      continue;
    }
    index += n;
    if (piece.high) {
      sawHigh = true;
      if (piece.drops) drop = index;
    }
  }

  if (!sawHigh) return undefined;
  return drop ?? 0;
}

/**
 * The fragment as a run of {text, high, drops}, in reading order.
 *
 * The shape that matters, and the reason a tag-by-tag walk gets it wrong:
 *
 *   <span ACCENT position:relative[; padding-right when it drops]>
 *     <span display:inline>タシ</span>          ← the text
 *     <span position:absolute; border-top …/>   ← the drawing, *empty*
 *   </span>
 *
 * The overline sits on a **sibling of the text**, not on an ancestor of it, so
 * asking "which spans am I inside" never finds it. What identifies an accent
 * span is that it has that empty drawing as a *direct child*.
 *
 * Direct child, not descendant — that distinction is the whole reason this
 * parses a tree rather than scanning. 失礼します is シツ\レイシマ\ス: one
 * wrapper span containing two accent spans. Judging the wrapper by everything
 * inside it makes it high, and then its text — which contains the inner spans'
 * text as well — counts those moras a second time.
 */
function pieces(fragment) {
  const out = [];
  walk(parse(fragment), out);
  return out;
}

/**
 * The fragment as a tree of spans.
 *
 * Every other tag is dropped rather than kept as text: one drawing span in the
 * deck contains a stray `<br>`, and treating that as content made the span
 * non-empty — so it stopped looking like a drawing, and its four characters
 * were counted as four moras. 硬い came out as accent 6 for a three-mora word.
 */
function parse(fragment) {
  const root = { attrs: "", children: [] };
  const stack = [root];
  const token = /<(\/?)span([^>]*)>/g;
  let at = 0;
  let m;

  const clean = fragment.replace(/<(?!\/?span)[^>]*>/gi, "");

  while ((m = token.exec(clean)) !== null) {
    if (m.index > at) stack.at(-1).children.push({ text: clean.slice(at, m.index) });
    at = token.lastIndex;
    if (m[1]) {
      if (stack.length > 1) stack.pop();
    } else {
      const node = { attrs: m[2], children: [] };
      stack.at(-1).children.push(node);
      stack.push(node);
    }
  }
  if (at < clean.length) stack.at(-1).children.push({ text: clean.slice(at) });
  return root;
}

/** A node with no text of its own that paints an overline: the drawing. */
const isDrawing = (n) => n.children !== undefined && text(n) === "" && isHigh(n.attrs);

function text(node) {
  if (node.text !== undefined) return node.text;
  return node.children.map(text).join("");
}

function walk(node, out, inherited = false) {
  // An accent span owns its drawing *directly*. `text-decoration: overline` is
  // the deck's other spelling, and needs no drawing at all.
  const drawing = node.children?.find(isDrawing);
  const owns = Boolean(drawing) || isHigh(node.attrs);
  const high = inherited || owns;
  const start = out.length;

  for (const child of node.children ?? []) {
    if (child.text !== undefined) out.push({ text: child.text, high, drops: false });
    else if (!isDrawing(child)) walk(child, out, high);
    // A drawing contributes nothing: it is a line, not a syllable.
  }

  // The drop falls after the last mora *this* span covers, so it is marked on
  // the piece that ends it — not on the span, which may cover several.
  const drops = owns && (hasDrop(drawing?.attrs) || hasDrop(node.attrs));
  if (drops) {
    for (let i = out.length - 1; i >= start; i--) {
      if (out[i].text.trim()) {
        out[i] = { ...out[i], drops: true };
        break;
      }
    }
  }
}

/**
 * The overline that marks a high mora.
 *
 * Two spellings in this deck: a `border-top` on an absolutely positioned span,
 * and a plain `text-decoration: overline`. Both mean the same thing.
 */
function isHigh(s) {
  return /border-top-width\s*:|text-decoration\s*:[^;"']*overline/i.test(s ?? "");
}

/**
 * The downstep: a border on the right edge of the drawn span.
 *
 * `padding-right` on the outer span is the same signal — it makes room for
 * that border — but it is not sufficient on its own: a span can be padded
 * without dropping. The border is the thing that is only ever there when the
 * pitch falls.
 */
function hasDrop(s) {
  return /border-right-width\s*:/i.test(s ?? "");
}

/** Marks that attach to the mora before them, when a piece opens with one. */
function leadingMarks(s) {
  return (s ?? "").replace(/^[ャュョァィゥェォヮ゛゜°ﾟ\u3099\u309a]+/, "");
}

/**
 * Entities, whitespace, and the deck's own footnote marks; tags are gone by
 * now. `*` flags a note in the Pitch Accent Notes field and is not a syllable —
 * counted as one it would push every following drop a mora too far.
 */
function stripMarks(s) {
  return (s ?? "")
    .replace(/&nbsp;/g, "")
    .replace(/&amp;/g, "&")
    .replace(/[*＊†‡]/g, "")
    .replace(/\s+/g, "");
}

/**
 * Every accent the note gives, in order.
 *
 * `・` separates alternatives — 人 is ヒト and ヒ\ト, both current. Kept as a
 * list rather than collapsed to the first, because "either is right" is a
 * true and useful thing to be able to say, and dropping one would quietly
 * teach that it is wrong.
 */
export function accentsFrom(field) {
  if (!field?.trim()) return [];

  // Split *after* parsing, never before. `・` separates alternatives — 硬い is
  // カタイ・カタイ* — but it sits inside the markup, so splitting the string
  // first cuts a span in half and leaves two fragments neither of which
  // parses. That produced an accent of 6 for a three-mora word.
  const runs = [[]];
  for (const piece of pieces(field)) {
    const parts = piece.text.split("・");
    runs.at(-1).push({ ...piece, text: parts[0] });
    for (const part of parts.slice(1)) {
      runs.push([{ ...piece, text: part }]);
    }
  }

  return runs.map(accentOfPieces).filter((a) => a !== undefined);
}

/** The stored form: "0", "2", or "0,2" for a word with two current accents. */
export function pitchColumn(field) {
  const accents = accentsFrom(field);
  return accents.length > 0 ? accents.join(",") : null;
}
