import { api } from "../api.js";
import { MODES } from "../modes.js";
import { el, render, station, statusBar } from "../ui/dom.js";

const SESSION_LENGTHS = [10, 20, "All"];

/**
 * Designs 10 and 15. One tab, two moods.
 *
 * On a normal day: a single line of due count, then the four lines. When
 * nothing is due, a block goes *on top* rather than replacing the screen —
 * the four lines stay one tap away, so a session is never more than one tap
 * from here.
 */
export function practiseScreen({ onStart, onDrillTopic, sessionLength, onSessionLength }) {
  const root = el("div.practise");
  render(root, el("div.loading", { text: "…" }));

  load();

  async function load() {
    let due = 0;
    let nextDue;
    let stats;

    try {
      const [queue, s] = await Promise.all([api.queue({ limit: 60 }), api.stats()]);
      due = queue.cardIds.length;
      stats = s;
    } catch {
      // Offline: the shell shows the strip; the tab still offers the lines.
      due = 0;
    }

    render(root, ...(due > 0 ? normalDay(due) : nothingDue(nextDue, stats)), linesBlock(), lengthPicker(), soundNote());
  }

  function normalDay(due) {
    return [
      el("p.due-line", { text: `${due} ${due === 1 ? "card" : "cards"} due. Pick how you want to practise.` }),
    ];
  }

  function nothingDue(nextDue, stats) {
    const offers = [];

    // "If a row has nothing behind it the row is dropped, not disabled."
    offers.push(
      offer("Practise ahead", "Cards due in the next two days", () =>
        onStart({ only: "new" }),
      ),
    );

    const behind = weakestTopic(stats);
    if (behind) {
      offers.push(
        offer("Drill a topic", `${behind.tag} is furthest behind, ${behind.seen} of ${behind.total}`, () =>
          onDrillTopic(),
        ),
      );
    }

    offers.push(
      offer("Recent mistakes", "Cards missed in the last three days", () =>
        onStart({ only: "lapsed" }),
      ),
    );

    return [
      el(
        "div.head",
        {},
        el("h1.jp", { text: "おつかれさま" }),
        el("p", { text: "Nothing due today." }),
      ),
      nextDue
        ? el(
            "div.next-due",
            {},
            el("span.label", { text: "Next cards due" }),
            el("span.value.tabular", { text: nextDue }),
          )
        : null,
      el("div.offers", {}, offers),
      el(
        "div.rule",
        {},
        el("span.line"),
        el("span.text", { text: "Or pick a line" }),
        el("span.line"),
      ),
    ];
  }

  function offer(title, detail, onClick) {
    return el(
      "button.offer",
      { type: "button", onclick: onClick },
      station("var(--ink)", 22, 4),
      el("span.copy", {}, el("span.title", { text: title }), el("span.detail", { text: detail })),
    );
  }

  function linesBlock() {
    return el(
      "div.lines",
      {},
      el("div.rail"),
      MODES.map((mode) =>
        el(
          "button.line-row",
          { type: "button", onclick: () => onStart({ mode: mode.key }) },
          station(mode.colour, 30, 5),
          el(
            "span.copy",
            {},
            el("span.jp", { text: mode.jp }),
            el("span.en", { text: mode.en }),
          ),
        ),
      ),
    );
  }

  function lengthPicker() {
    const picker = el("div.length");
    render(
      picker,
      SESSION_LENGTHS.map((len) =>
        el("button", {
          type: "button",
          text: typeof len === "number" ? String(len) : len,
          "aria-pressed": String(len === sessionLength),
          onclick: () => {
            sessionLength = len;
            onSessionLength?.(len);
            render(picker, ...lengthPicker().children);
          },
        }),
      ),
    );
    return picker;
  }

  function soundNote() {
    return el("p.sound-note", { text: "Sound on — every card is read aloud in Japanese." });
  }

  return root;
}

/**
 * The topic furthest behind, by share seen. Only topics that actually hold
 * cards qualify — with konbini at three cards, "furthest behind" would
 * otherwise always name the smallest topic (docs/tagging.md).
 */
export function weakestTopic(stats, minimumCards = 10) {
  const candidates = (stats?.topics ?? []).filter((t) => t.total >= minimumCards);
  if (candidates.length === 0) return undefined;
  return candidates.reduce((worst, t) =>
    t.seen / t.total < worst.seen / worst.total ? t : worst,
  );
}

export { statusBar };
