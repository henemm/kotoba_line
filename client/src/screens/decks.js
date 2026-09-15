import { answerSoon } from "../api.js";
import { modeByKey } from "../modes.js";
import { describe } from "../resume.js";
import { modeName } from "../script.js";
import { el, num, render } from "../ui/dom.js";

/**
 * The practise tab's first screen (#137): her decks, each with its cards for
 * today, and one tap into a deck.
 *
 * Charlotte found Noji simpler because it starts there — "Man startet damit,
 * dass man ein Deck auswählt" (Henning, 2026-09-14, with screenshots of
 * Noji's start page and deck page). Before this the deck was chosen in the
 * "Choose a set" sheet, under the lines, and a session started from whatever
 * the sheet held; her own lists were two taps into that sheet.
 *
 * The number on the right is `/api/decks`' `today.total`, the queue's own
 * count for the deck, so the deck page never opens on a different number.
 */
export function decksScreen({
  // `{ decks }` from `/api/decks`, as a promise the shell owns — the same
  // reasoning as the practise tab's numbers (#106).
  decks,
  onOpen,
  // #137: "New deck", at the end of the list, as in the mockup Henning chose.
  onNewDeck,
  resumable,
  onResume,
  japanese = true,
  scrollTop = 0,
}) {
  const root = el("div.practise.decks");
  const list = el("div.deck-list", {}, el("div.loading", { text: "…" }));

  render(root, el("h1.decks-title", { text: "Deine Decks" }), resumeRow(), list);
  load();

  async function load() {
    const soon = await answerSoon(decks);
    if (soon) fill(soon);
    const outcome = soon ?? (await decks.then((value) => ({ value }), (error) => ({ error })));
    if (!soon) fill(outcome);
    if (scrollTop) root.scrollTop = scrollTop;
  }

  function fill(outcome) {
    if (outcome.error || !outcome.value) {
      render(list, el("p.deck-problem", { text: "Deine Decks konnten nicht geladen werden. Prüf die Verbindung und komm dann zu diesem Tab zurück." }));
      return;
    }
    const rows = outcome.value.decks ?? [];
    render(
      list,
      rows.map((deck) =>
        el(
          "button.deck-row",
          { type: "button", onclick: () => onOpen(deck) },
          el(
            "span.copy",
            {},
            el("span.name", { text: deck.name }),
            el("span.sub", { text: `${num(deck.cards)} ${deck.cards === 1 ? "Karte" : "Karten"} · ${num(deck.seen)} gesehen` }),
          ),
          el("span.today", {
            text: num(deck.today?.total ?? 0),
            "aria-label": `${deck.today?.total ?? 0} für heute`,
          }),
          el("span.chevron", { "aria-hidden": "true", text: "›" }),
        ),
      ),
      onNewDeck
        ? el(
            "button.deck-row.deck-new",
            { type: "button", onclick: onNewDeck },
            el("span.deck-new-plus", { "aria-hidden": "true", text: "+" }),
            el("span.copy", {}, el("span.name", { text: "Neues Deck" })),
          )
        : null,
      rows.length > 0 ? el("p.deck-hint", { text: "Die Zahl zeigt, wie viele Karten heute warten." }) : null,
    );
  }

  /** 51: an unfinished session is still the first thing offered. */
  function resumeRow() {
    if (!resumable || !onResume) return null;
    const mode = modeByKey(resumable.mode) ?? modeByKey("choose");
    return el(
      "button.deck-resume",
      { type: "button", onclick: () => onResume(resumable) },
      el(
        "span.copy",
        {},
        el("span.name", { text: `Weitermachen mit ${modeName(mode, japanese)}` }),
        el("span.sub", { text: describe(resumable) }),
      ),
      el("span.chevron", { "aria-hidden": "true", text: "›" }),
    );
  }

  return root;
}
