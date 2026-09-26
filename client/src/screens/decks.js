import { answerSoon } from "../api.js";
import { modeByKey } from "../modes.js";
import { describe } from "../resume.js";
import { modeName } from "../script.js";
import { seen } from "../seen.js";
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
  // The last list this device was given, or undefined (#297). What the list
  // shows while `decks` is still out.
  keptDecks,
  onOpen,
  // #137: "New deck", at the end of the list, as in the mockup Henning chose.
  onNewDeck,
  resumable,
  onResume,
  japanese = true,
  scrollTop = 0,
  // #252: Settings → Einstieg is on, and the list is Reise 1 and 2.
  beginner = false,
  // …and the word "Einstellungen" in the note below goes there (Henning,
  // 2026-09-20, with the word circled: "verlinken zu den Einstellungen").
  onSettings,
}) {
  const root = el("div.practise.decks");
  const list = el("div.deck-list", {}, el("div.loading", { text: "…" }));

  render(root, el("h1.decks-title", { text: "Deine Decks" }), resumeRow(), list);
  load();

  /**
   * #297: the list the device already holds goes up once the server has had
   * its PATIENCE_MS, not once the request gives up. It used to wait for the
   * latter, and `deckList()` falls back to the kept list only on a failure —
   * so on a stalled connection "…" stood for the whole REQUEST_TIMEOUT_MS
   * (measured on the live app in WebKit, API stalled: "…" at 9 s, the list at
   * 12 s; Henning sent a screenshot of it from Charlotte's iPad on next to
   * no WLAN, 2026-09-26). The answer, when it comes, redraws the same rows with today's numbers.
   */
  async function load() {
    const soon = await answerSoon(decks);
    if (soon) fill(soon);
    else {
      const kept = await keptDecks?.().catch(() => undefined);
      if (kept) {
        fill({ value: kept });
        if (scrollTop) root.scrollTop = scrollTop;
      }
      fill(await decks.then((value) => ({ value }), (error) => ({ error })));
    }
    if (scrollTop) root.scrollTop = scrollTop;
  }

  function fill(outcome) {
    if (outcome.error || !outcome.value) {
      render(list, el("p.deck-problem", { text: "Deine Decks konnten nicht geladen werden. Prüf die Verbindung und komm dann zu diesem Tab zurück." }));
      return;
    }
    const rows = outcome.value.decks ?? [];
    // #228: whether anyone ever gets this far — once a day, not per redraw.
    if (rows.some((deck) => deck.key === "travel:2" && !deck.locked)) {
      seen("travel_unlocked_shown", "travel:2", { oncePerDay: true });
    }
    render(
      list,
      rows.map((deck) =>
        deck.locked
          ? lockedRow(deck, rows)
          : el(
          "button.deck-row",
          { type: "button", onclick: () => onOpen(deck) },
          el(
            "span.copy",
            {},
            el("span.name", { text: deck.name }),
            el("span.sub", { text: subLine(deck) }),
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
      beginner
        ? el(
            "p.deck-hint",
            {},
            "Einstieg ist an. Alle Decks siehst du wieder, wenn du ihn in den ",
            onSettings
              ? el("button.link", { type: "button", text: "Einstellungen", onclick: onSettings })
              : el("span", { text: "Einstellungen" }),
            " ausschaltest.",
          )
        : null,
    );
  }

  /**
   * #252: a Reise deck counts what the unlock counts — cards said aloud and
   * known — so "21 von 21" is visibly the moment the next one opens.
   */
  function subLine(deck) {
    const cards = `${num(deck.cards)} ${deck.cards === 1 ? "Karte" : "Karten"}`;
    if (deck.known !== undefined) return `${cards} · ${num(deck.known)} gewusst`;
    return `${cards} · ${num(deck.seen)} gesehen`;
  }

  /**
   * Reise 2 before Reise 1 is done (#252): there, so the way ahead is
   * visible, but not a button — and it says what opens it, with the count.
   */
  function lockedRow(deck, rows) {
    const before = rows[rows.indexOf(deck) - 1];
    return el(
      // A button that is off rather than a div: the list's corners are drawn
      // by :first-child and :last-of-type, and a div among buttons is a
      // type of its own to those.
      "button.deck-row.deck-locked",
      { type: "button", disabled: true },
      el(
        "span.copy",
        {},
        el("span.name", { text: deck.name }),
        el("span.sub", {
          text: before
            ? `Wird frei, wenn du jede Karte aus ${before.name} einmal gewusst hast – ${num(before.known ?? 0)} von ${num(before.cards)}.`
            : "Noch nicht frei.",
        }),
      ),
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
