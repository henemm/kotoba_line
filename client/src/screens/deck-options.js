import { MODES } from "../modes.js";
import { modeName } from "../script.js";
import { el, num, render } from "../ui/dom.js";

/**
 * One deck's options (#137): which ways of practising its page offers, and how
 * many new cards it brings a day.
 *
 * On the deck's page, top right, where Noji keeps a deck's menu — Henning
 * asked where per-deck settings should go, and the answer is where the deck
 * is. Settings keeps what is about her, not about a deck.
 *
 * A way the deck cannot do is shown switched off and greyed, with the reason,
 * rather than left out: "Listen only" vanishing from one deck and not another
 * would look like a fault. Counts are `/api/decks`' `ways` — the same rule
 * the session applies card by card.
 */
const NEW_PER_DAY_CHOICES = [5, 10, 15, 20, 30];

const CANNOT = {
  listen: "Not possible here: no example sentences with a translation",
  type: "Not possible here: no words with a reading to check against",
};

export function deckOptionsSheet({ deck, japanese = true, onChange, onClose }) {
  let settings = { hiddenModes: [], ...(deck.settings ?? {}) };
  const ways = deck.ways ?? {};

  const scrim = el("div.sheet-scrim.deck-options", {
    onclick: (e) => e.target === e.currentTarget && onClose?.(),
  });
  const sheet = el("div.sheet", { role: "dialog", "aria-label": `Options for ${deck.name}` });
  scrim.append(sheet);
  draw();

  function possible(mode) {
    return ways[mode.key] === undefined || ways[mode.key] > 0;
  }

  function draw() {
    const hidden = settings.hiddenModes ?? [];
    const on = MODES.filter((m) => possible(m) && !hidden.includes(m.key));
    render(
      sheet,
      el(
        "div.options-head",
        {},
        el("h2.sheet-title", { text: `Ways to practise “${deck.name}”` }),
        el("button.options-done", { type: "button", text: "Done", onclick: () => onClose?.() }),
      ),
      el("p.sheet-body", { text: "Only for this deck." }),
      el(
        "div.options-list",
        {},
        MODES.map((mode) => {
          const can = possible(mode);
          const shown = can && !hidden.includes(mode.key);
          // The last way still on cannot be switched off: a deck page with
          // nothing to tap is not a setting anyone wants, and the server
          // refuses to store it.
          const last = shown && on.length === 1;
          const count = ways[mode.key];
          const note = !can
            ? CANNOT[mode.key] ?? "Not possible here"
            : mode.key === "type" && count < deck.cards
              ? `${num(count)} of ${num(deck.cards)} cards can be typed`
              : null;
          return el(
            "div.option-row",
            { class: can ? undefined : "cannot" },
            el(
              "span.copy",
              {},
              el(japanese ? "span.name.jp" : "span.name", { text: modeName(mode, japanese) }),
              japanese ? el("span.note", { text: mode.en }) : null,
              note ? el("span.note", { text: note }) : null,
            ),
            el("button.toggle", {
              type: "button",
              role: "switch",
              "aria-checked": String(shown),
              "aria-label": `Show ${mode.en}`,
              disabled: !can || last,
              onclick: () =>
                change({
                  hiddenModes: shown ? [...hidden, mode.key] : hidden.filter((k) => k !== mode.key),
                }),
            }, el("span.knob")),
          );
        }),
      ),
      el("span.options-label", { id: "new-per-day-label", text: "New cards per day" }),
      el(
        "div.choice",
        { role: "group", "aria-labelledby": "new-per-day-label" },
        choicesFor(settings.newPerDay).map((n) =>
          el("button", {
            type: "button",
            text: String(n),
            "aria-pressed": String(n === settings.newPerDay),
            onclick: () => n !== settings.newPerDay && change({ newPerDay: n }),
          }),
        ),
      ),
    );
  }

  function change(patch) {
    settings = { ...settings, ...patch };
    draw();
    onChange?.(patch, settings);
  }

  return scrim;
}

/** The five choices, and hers among them if it was set to something else (Settings allowed 5 to 40 in fives). */
export function choicesFor(current) {
  if (current == null || NEW_PER_DAY_CHOICES.includes(current)) return NEW_PER_DAY_CHOICES;
  return [...NEW_PER_DAY_CHOICES, current].sort((a, b) => a - b);
}
