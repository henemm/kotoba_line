import { visibleModes } from "../script.js";
import { el } from "../ui/dom.js";
import { startLabel } from "./practise.js";

/**
 * Stats → a row of "Karten gesehen" (Charlotte, 2026-10-27: tap a band and
 * learn those words once more, in the way she picks).
 *
 * A sheet over the Stats tab with the same ways of practising a deck page
 * offers, worded the same. Not one of the 52 screens: the Stats numbers count
 * every deck together, so there is no deck page to choose the way on.
 */
export function bandSheet({ label, onPick, onClose }) {
  return el(
    "div.sheet-scrim.band-scrim",
    { onclick: (e) => e.target === e.currentTarget && onClose() },
    el(
      "div.sheet.band-sheet",
      { role: "dialog", "aria-modal": "true", "aria-labelledby": "band-title" },
      el("h2.sheet-title", { id: "band-title", text: `${label} noch einmal üben` }),
      // No number: the Stats count has a card and its reverse as two, and a
      // session asks them one after the other (#284) — 161 against 149 on
      // her real data. A number that does not match is worse than none.
      el("p.sheet-body", {
        text: "Alle Karten dieser Zeile aus allen deinen Decks, auch die, die heute nicht dran sind. Wie möchtest du üben?",
      }),
      el(
        "div.deck-ways-list",
        {},
        visibleModes().map((mode) =>
          el(
            "button.deck-way",
            { type: "button", onclick: () => onPick(mode.key) },
            el("span.copy", {}, el("span.name", { text: startLabel(mode) })),
          ),
        ),
      ),
      el("div.sheet-actions", {}, el("button.btn", { type: "button", text: "Abbrechen", onclick: onClose })),
    ),
  );
}
