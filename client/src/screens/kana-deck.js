import { api } from "../api.js";
import { say } from "../audio.js";
import { deckCatchingUp, loadDeck } from "../deck.js";
import { stopAllRecording } from "../recording.js";
import { seen } from "../seen.js";
import { setStar } from "../stars.js";
import { wordSound } from "../sound.js";
import { cardHistoryBlock } from "./card-history.js";
import { el, num, render } from "../ui/dom.js";
import { kanaMnemonicBlock } from "../ui/kana-mnemonic.js";
import { starButton } from "../ui/card-marks.js";
import { voiceCircle } from "../ui/voice-circle.js";

/**
 * The letters of a kana deck, on its page (#208).
 *
 * Henning, 2026-09-18: "Warum gibt es bei Kana keine Aufnahme-Möglichkeit?
 * Bzw. gar nicht die Möglichkeit, das Deck zu zeigen?" Her own decks list
 * their cards (#137) and Kaishi's words are in Search, but Search leaves the
 * letters out on purpose (#158) — so the 2 × 104 kana cards could only be
 * reached by being asked one in a session.
 *
 * A grid rather than deck-cards.js's rows: a kana is one character, and the
 * table it is taught from is a grid, so she recognises the layout. No search
 * and no "+ Karte hinzufügen": 104 letters fit on a page, and the deck is not
 * hers to add to.
 *
 * Drawn from the deck already cached on the phone, like her decks' lists:
 * it opens on a train and costs no data. Tiles are text only — the pictures
 * and sounds are fetched when a letter is opened, never for the whole page.
 */

/** A kana deck's cards in the order they are taught (`frequency_rank`, import/lib/kana.js). Pure. */
export function kanaOfDeck(deckKey, cards) {
  return cards
    .filter((c) => c.deck === deckKey && !c.deleted_at)
    .sort((a, b) => (a.frequency_rank ?? Infinity) - (b.frequency_rank ?? Infinity) || a.id - b.id);
}

/**
 * Which part of the table a kana belongs to. Pure. From the characters, not
 * the rank, so a card added to the import later still lands in its place:
 * two characters is a yōon (きゃ), a mark that decomposes off is ゛ or ゜ (が, ぱ).
 */
export function kanaGroup(card) {
  const word = card.word ?? "";
  if ([...word].length > 1) return "yoon";
  if (word.normalize("NFD").length > 1) return "dakuten";
  return "basic";
}

const GROUPS = [
  { key: "basic", label: "Grundzeichen", columns: 5 },
  { key: "dakuten", label: "Mit Strichen oder Kreis – wie が und ぱ", columns: 5 },
  { key: "yoon", label: "Kombinationen", columns: 3 },
];

/**
 * The column a basic kana takes in the five-column table: its vowel. Pure.
 * ん has none and starts a row of its own.
 */
function vowelColumn(romaji) {
  return "aiueo".indexOf((romaji ?? "").slice(-1));
}

/**
 * The cells of the basic table, with a gap where a row has no kana in that
 * column — や _ ゆ _ よ, わ _ _ _ を — as every printed gojūon table has, so
 * each column is one vowel. `null` is a gap. Pure.
 */
export function basicCells(cards) {
  const cells = [];
  for (const card of cards) {
    let col = vowelColumn(card.word_meaning);
    // ん, or anything whose reading ends in no vowel: on a row of its own.
    if (col < 0) col = 0;
    // A column already passed means the next row.
    if (col < cells.length % 5) while (cells.length % 5 !== 0) cells.push(null);
    while (cells.length % 5 !== col) cells.push(null);
    cells.push(card);
  }
  return cells;
}

export function kanaGridBlock({ deck, onCard }) {
  const root = el("div.deck-cards.kana-grid");
  const heading = el("span.set-label", { text: "Zeichen in diesem Deck" });
  const body = el("div.kana-grid-body", {}, el("div.loading", { text: "…" }));
  render(root, heading, body);
  load();

  async function load() {
    let all;
    try {
      all = [...(await loadDeck()).values()];
    } catch {
      all = [];
    }
    draw(all);
    // A phone that has never synced the kana decks gets them with the first
    // difference of this run.
    if (kanaOfDeck(deck.key, all).length === 0) {
      await deckCatchingUp();
      try {
        draw([...(await loadDeck()).values()]);
      } catch {
        /* the note already says what is missing */
      }
    }
  }

  function draw(all) {
    const kana = kanaOfDeck(deck.key, all);
    heading.textContent = `Zeichen in diesem Deck · ${num(kana.length)}`;
    if (kana.length === 0) {
      render(body, el("p.deck-cards-note", { text: "Die Zeichen sind noch nicht auf diesem Handy. Geh einmal ins Internet und öffne das Deck dann noch einmal." }));
      return;
    }
    // #228: whether she ever opens this page, and a letter on it.
    seen("kana_grid_shown", deck.key, { oncePerDay: true });
    render(
      body,
      GROUPS.map((group) => {
        const cards = kana.filter((c) => kanaGroup(c) === group.key);
        if (cards.length === 0) return null;
        const cells = group.key === "basic" ? basicCells(cards) : cards;
        return el(
          "section.kana-group",
          {},
          el("h3.kana-group-label", { text: group.label }),
          el(
            `div.kana-tiles.cols-${group.columns}`,
            {},
            cells.map((card) => (card ? tile(card) : el("span.kana-tile.gap", { "aria-hidden": "true" }))),
          ),
        );
      }),
    );
  }

  function tile(card) {
    return el(
      "button.kana-tile",
      {
        type: "button",
        "aria-label": `${card.word}, ${card.word_meaning ?? ""}`,
        onclick: () => {
          seen("kana_card_opened", `${deck.key}:${card.word}`);
          onCard?.(card);
        },
      },
      el("span.kana-tile-char.jp", { text: card.word }),
      el("span.kana-tile-romaji", { text: card.word_meaning ?? "" }),
    );
  }

  return root;
}

/**
 * One kana, opened from the grid (#208): the letter and its reading, ♪, the
 * picture where it has one (#177), and — where its sound is generated, the 33
 * yōon — the circle a native speaker records into (#185). Her record of the
 * card under it (#98), as on her own cards.
 *
 * Not cardActionsSheet: that one edits, moves and deletes, and a kana card is
 * everyone's, not hers to change. The native speaker's voice only, never her
 * own — the same rule as her cards' menu.
 */
export function kanaCardSheet({ card, recordingEnabled = true, onClose }) {
  const scrim = el("div.sheet-scrim.card-actions.kana-card", {
    onclick: (e) => e.target === e.currentTarget && close(),
  });
  const sheet = el("div.sheet.card-sheet", { role: "dialog", "aria-label": `${card.word}, ${card.word_meaning ?? ""}` });
  scrim.append(sheet);

  let nativeRecording;
  const deckNative = wordSound(card).deckNative;
  const nativeCircle = recordingEnabled && !deckNative
    ? voiceCircle({
        cardId: card.id,
        kind: "native",
        ariaLabel: "Muttersprachler",
        emptyCaption: "Muttersprachler-Aufnahme hinzufügen",
        filledCaption: "Muttersprachler-Aufnahme bearbeiten",
        shared: { active: null },
        rowLayout: true,
        getSource: () => nativeRecording,
        setSource: (rec) => {
          nativeRecording = rec;
        },
      })
    : null;
  if (nativeCircle) {
    api
      .cardRecordings(card.id)
      .then(({ recordings }) => {
        nativeRecording = recordings?.find((r) => r.kind === "native") ?? null;
        nativeCircle.refresh();
      })
      .catch(() => {
        // Left empty: a listing that fails still lets her record.
      });
  }

  // One request for the record below and the star (2026-09-19): a kana had
  // a star in a session but none here, the only card sheet without one. The
  // grid reads the phone's copy, which knows no stars, so the record says.
  const record = api.cardHistory(card.id);
  record.catch(() => {});
  const star = starButton({
    word: card.word,
    lookup: record.then((r) => r.starred),
    onToggle: (on) => setStar(card.id, on),
  });

  // What ♪ plays is asked at the tap, so a recording made in this sheet is
  // what it plays next — the same order a session's ♪ follows (sound.js).
  const hear = () => {
    const file = wordSound(card, nativeRecording).file;
    if (file) say(undefined, file);
  };

  render(
    sheet,
    el(
      "div.card-actions-head",
      {},
      el(
        "div.card-actions-title",
        {},
        el("h2.sheet-title.kana-card-char.jp", { text: card.word }),
        el("p.sheet-body", { text: card.word_meaning ?? "" }),
      ),
      star,
      wordSound(card).file
        ? el("button.topics-hear", { type: "button", "aria-label": `${card.word} anhören`, text: "♪", onclick: hear })
        : null,
    ),
    kanaMnemonicBlock(card),
    nativeCircle ? el("div.card-recording-row", {}, nativeCircle.root) : null,
    recordingEnabled && deckNative
      ? el("p.card-recording-note", { text: "Muttersprachler-Aufnahme vorhanden – das ♪ spielt sie." })
      : null,
    cardHistoryBlock({ cardId: card.id, request: record }),
  );

  function close() {
    stopAllRecording();
    onClose?.();
  }

  return scrim;
}
