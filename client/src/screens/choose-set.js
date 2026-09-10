import { api } from "../api.js";
import { el, num, render } from "../ui/dom.js";

/**
 * Choose a set — screens 36 to 38. §5a's three filter dimensions.
 *
 * A sheet over the practise tab, never a screen of its own: it opens from the
 * summary line above the four lines and it is never in the way of them, so
 * tapping a line still starts a session with whatever the sheet last held. The
 * two-tap path survives.
 *
 * The count above the button recomputes on every tap, and that is what keeps
 * this from being a settings screen — she is watching a number, not filling a
 * form.
 */

/** 36: "topics below about five cards are dimmed but selectable." */
const THIN_TOPIC = 5;

/** 36: six topics fit before the row needs a "+3". */
const TOPICS_SHOWN = 6;

const DECKS = [
  { value: undefined, label: "Both" },
  { value: "kaishi", label: "Kaishi" },
  { value: "personal", label: "Mine" },
];

const ONLY = [
  { value: undefined, label: "Due today" },
  { value: "starred", label: "★ Starred" },
  { value: "lapsed", label: "Lapsed" },
  { value: "new", label: "New" },
];

/** The defaults are the scheduler's own answer, so opening and closing changes nothing. */
export const DEFAULT_FILTERS = { deck: undefined, tag: undefined, only: undefined };

export const isDefault = (f) => !f.deck && !f.tag && !f.only;

/**
 * 36's summary line: "Both decks · any topic · due today".
 *
 * With three filters active it truncates from the left, "because the last-set
 * filter is the one she is thinking about".
 */
export function summaryLine({ deck, tag, only }, { max = 3 } = {}) {
  const parts = [
    deck ? (deck === "personal" ? "my deck" : "Kaishi") : "Both decks",
    tag ?? "any topic",
    ONLY.find((o) => o.value === only)?.label.replace("★ ", "").toLowerCase() ?? "due today",
  ];
  if (parts.length <= max) return parts.join(" · ");
  return `… · ${parts.slice(-max).join(" · ")}`;
}

/**
 * What 39's dashed rule carries: only what she changed.
 *
 * The rule says "Your set · konbini", not the whole summary line — the parts
 * still at their default are what an ordinary session would have done, and
 * naming them would make a chosen set look more elaborate than it is.
 */
export function activeLabel({ deck, tag, only }) {
  const parts = [];
  if (deck) parts.push(deck === "personal" ? "my deck" : "Kaishi");
  if (tag) parts.push(tag);
  if (only) parts.push(ONLY.find((o) => o.value === only)?.label.replace("★ ", "") ?? only);
  return parts.join(" · ");
}

export function chooseSetScreen({ filters, topics = [], sessionLength = 20, onApply, onClose }) {
  const chosen = { ...DEFAULT_FILTERS, ...filters };
  let available;
  let counting = false;
  let expanded = false;
  // Declared here rather than beside recount(): `let` is not initialised
  // until its declaration runs, and recount() is called during construction —
  // reading it from further down threw before the first count ever arrived.
  let generation = 0;

  const scrim = el("div.sheet-scrim.set-scrim", {
    onclick: (e) => e.target === e.currentTarget && onClose?.(),
  });
  const sheet = el("div.sheet.set-sheet");
  scrim.append(sheet);

  draw();
  recount();

  function draw() {
    render(
      sheet,
      el(
        "div.set-head",
        {},
        el("span.set-title", { text: "Choose a set" }),
        el("button.set-reset", {
          type: "button",
          text: "Reset",
          disabled: isDefault(chosen),
          onclick: () => {
            Object.assign(chosen, DEFAULT_FILTERS);
            draw();
            recount();
          },
        }),
      ),
      deckGroup(),
      topicGroup(),
      onlyGroup(),
      foot(),
    );
  }

  function group(label, control) {
    return el(
      "div.set-group",
      {},
      el("span.set-label", { text: label }),
      control,
    );
  }

  function set(key, value) {
    chosen[key] = chosen[key] === value ? undefined : value;
    draw();
    recount();
  }

  function deckGroup() {
    return group(
      "Deck",
      el(
        "div.segmented",
        {},
        DECKS.map(({ value, label }) =>
          el("button", {
            type: "button",
            text: label,
            "aria-pressed": String(chosen.deck === value),
            onclick: () => {
              chosen.deck = value;
              draw();
              recount();
            },
          }),
        ),
      ),
    );
  }

  function topicGroup() {
    const sorted = [...topics].sort((a, b) => b.total - a.total);
    const shown = expanded ? sorted : sorted.slice(0, TOPICS_SHOWN);
    const rest = sorted.length - shown.length;

    return group(
      "Topic",
      el(
        "div.chips.set-chips",
        {},
        el("button.chip", {
          type: "button",
          text: "Any",
          "aria-pressed": String(!chosen.tag),
          onclick: () => {
            chosen.tag = undefined;
            draw();
            recount();
          },
        }),
        shown.map((t) =>
          el("button.chip", {
            // Dimmed but selectable: three cards is a legitimate session (37),
            // and hiding a thin topic would be hiding the deck's shape.
            class: t.total < THIN_TOPIC ? "thin" : undefined,
            type: "button",
            text: `${t.tag} ${num(t.total)}`,
            "aria-pressed": String(chosen.tag === t.tag),
            onclick: () => set("tag", t.tag),
          }),
        ),
        rest > 0
          ? el("button.chip", {
              type: "button",
              text: `+${rest}`,
              onclick: () => {
                expanded = true;
                draw();
              },
            })
          : null,
      ),
    );
  }

  function onlyGroup() {
    return group(
      "Only",
      el(
        "div.chips.set-chips",
        {},
        ONLY.map(({ value, label }) =>
          el("button.chip", {
            type: "button",
            text: label,
            "aria-pressed": String(chosen.only === value),
            onclick: () => {
              chosen.only = value;
              draw();
              recount();
            },
          }),
        ),
      ),
    );
  }

  function foot() {
    const total = available;
    const willPractise = Math.min(sessionLength, total ?? sessionLength);

    // 38: the button is inert, not hidden, and the chips that produced the
    // empty set are outlined — the cause is marked rather than shouted at.
    const empty = total === 0;
    if (empty) sheet.classList.add("empty");
    else sheet.classList.remove("empty");

    return el(
      "div.set-foot",
      {},
      el(
        "div.set-summary",
        {},
        el("span", { text: summaryLine(chosen) }),
        el("span.set-count.tabular", { text: counting ? "…" : num(total ?? 0) }),
      ),
      // 37: "three cards is a legitimate session and the button says so plainly
      // rather than hiding the topic."
      total !== undefined && total > 0 && total < THIN_TOPIC
        ? el("p.set-note", {
            text: `Only ${num(total)} ${total === 1 ? "card" : "cards"} match. That is still a session.`,
          })
        : null,
      empty
        ? el("p.set-note", { text: "Nothing matches all three. Change one, or reset." })
        : null,
      el("button.btn-primary", {
        type: "button",
        disabled: empty || counting,
        text:
          total === undefined || counting
            ? "Start"
            : total > willPractise
              ? `Start ${num(willPractise)} of ${num(total)}`
              : `Start ${num(total)}`,
        onclick: () => onApply?.({ ...chosen }),
      }),
    );
  }

  /** The number under her hand. One request per tap, and the last one wins. */
  async function recount() {
    const mine = ++generation;
    counting = true;
    redrawFoot();
    try {
      const answer = await api.queue({ ...chosen, limit: sessionLength });
      if (mine !== generation) return;
      available = answer.available ?? answer.cardIds.length;
    } catch {
      if (mine !== generation) return;
      available = undefined;
    }
    counting = false;
    redrawFoot();
  }

  function redrawFoot() {
    sheet.replaceChild(foot(), sheet.lastChild);
  }

  return scrim;
}
