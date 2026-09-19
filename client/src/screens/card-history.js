import { OfflineError, api } from "../api.js";
import { cardRecordSummary, dayLabel, modeLabel, ratingLabel } from "../history.js";
import { el, render } from "../ui/dom.js";

/**
 * One card's own record (#98): how often she has practised it, how each
 * answer went, and when it comes back.
 *
 * Shown inside the sheets a card already opens — a Kaishi word's topics, and
 * the form for one of her own — rather than on a screen of its own, because
 * those are where she already is when she wonders about one word. design/ has
 * no screen for it.
 *
 * Asked for when the sheet opens and not before: the list is small, but the
 * Search tab lists hundreds of rows and none of them needs it until tapped.
 * It needs a connection, like the Stats tab, and says so.
 */

/** Answers shown before "show all": most cards have a handful. */
const ROWS_BEFORE_MORE = 5;

export function cardHistoryBlock({ cardId, request }) {
  const root = el("div.card-history");
  const body = el("div.card-history-body", {}, el("p.card-history-note", { text: "…" }));
  render(root, el("span.set-label", { text: "Dein Verlauf" }), body);

  let record;
  let expanded = false;

  load();

  async function load() {
    try {
      // The card sheet asks once and shares the answer, which also says
      // whether the card is starred (2026-09-19).
      record = await (request ?? api.cardHistory(cardId));
    } catch (err) {
      render(
        body,
        el("p.card-history-note", {
          text:
            err instanceof OfflineError
              ? "Der Verlauf kommt vom Server. Er ist da, sobald du wieder Internet hast."
              : "Der Verlauf konnte nicht geladen werden.",
        }),
      );
      return;
    }
    draw();
  }

  function draw() {
    const { count, due } = cardRecordSummary(record);
    const shown = expanded ? record.events : record.events.slice(0, ROWS_BEFORE_MORE);
    const hidden = record.events.length - shown.length;

    render(
      body,
      el("p.card-history-summary", { text: count }),
      due ? el("p.card-history-note", { text: due }) : null,
      shown.length > 0
        ? el(
            "ol.card-history-list",
            {},
            shown.map((e) =>
              el(
                "li.card-history-row",
                {},
                el("span.card-history-day", { text: dayLabel(e.day, record.today) }),
                el("span.card-history-mode", { text: modeLabel(e.mode) }),
                el("span.card-history-rating", {
                  class: e.rating === 1 ? "missed" : undefined,
                  text: ratingLabel(e.rating),
                }),
              ),
            ),
          )
        : null,
      hidden > 0
        ? el("button.card-history-more", {
            type: "button",
            text: `Alle ${record.events.length} zeigen`,
            onclick: () => {
              expanded = true;
              draw();
            },
          })
        : null,
    );
  }

  return root;
}
