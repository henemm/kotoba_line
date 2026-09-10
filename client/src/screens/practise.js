import { api } from "../api.js";
import { MODES, modeByKey } from "../modes.js";
import { describe } from "../resume.js";
import { isDefault, summaryLine } from "./choose-set.js";
import { el, render, station } from "../ui/dom.js";

/**
 * The same three the Settings screen offers, and the same values: 60 is
 * MAX_SESSION_LENGTH on the server, and the screen calls it "All". Both
 * places write the one stored setting, so picking 10 here shows 10 there.
 */
const SESSION_LENGTHS = [
  { value: 10, label: "10" },
  { value: 20, label: "20" },
  { value: 60, label: "All" },
];

/**
 * Designs 10 and 15. One tab, two moods.
 *
 * On a normal day: a single line of due count, then the four lines. When
 * nothing is due, a block goes *on top* rather than replacing the screen —
 * the four lines stay one tap away, so a session is never more than one tap
 * from here.
 */
export function practiseScreen({
  onStart,
  onDrillTopic,
  onChooseSet,
  onAddWord,
  onOwnDeck,
  onBrowse,
  onResume,
  resumable,
  ownWords,
  filters = {},
  sessionLength,
  onSessionLength,
  readAloud = true,
}) {
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

    render(
      root,
      ...(due > 0 ? normalDay(due) : nothingDue(nextDue, stats)),
      resumeRow(),
      setLine(),
      linesBlock(),
      lengthPicker(),
      soundNote(),
      browseRow(),
      addWordRow(),
    );
  }

  /**
   * The way into Browse from the tab she is actually on (#35).
   *
   * Browse is where a card gets starred, and it was reachable only from Stats
   * and from Settings — two tabs that are about looking back and about
   * configuration, neither of which is where anyone goes to find a word. So
   * "star some cards, then practise exactly those" had a first step nobody
   * would find.
   *
   * Beside "Add a word" and sharing its class rather than getting one of its
   * own, because they are the same kind of thing and should not look like two:
   * both are what to do when the word she wants is not the one the scheduler
   * is offering. Looking one up comes first; adding one is what happens when
   * looking it up fails (33), which is the order they sit in.
   */
  function browseRow() {
    if (!onBrowse) return null;
    return el(
      // Deliberately `.add-word-row` — see above. A second class carrying the
      // same rules would be two things to keep in step.
      "button.add-word-row",
      { type: "button", onclick: () => onBrowse() },
      el("span.dashed-station", { text: "★" }),
      el(
        "span.copy",
        {},
        el("span.title", { text: "Find and star words" }),
        el("span.detail", { text: "Search the deck, then practise just the ones you picked" }),
      ),
      el("span.chevron", { "aria-hidden": "true", text: "›" }),
    );
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

  /**
   * 36 opens from here, "never in the way of them": one line above the four,
   * so tapping a line still starts a session with whatever the sheet last
   * held. On an ordinary day it says what the scheduler chose, which is also
   * how she learns the sheet exists.
   */
  function setLine() {
    if (!onChooseSet) return null;
    const chosen = !isDefault(filters);
    return el(
      "div.set-block",
      {},
      // #34: the summary alone reads as a fact about the session — "Both decks
      // · any topic · due today" is a sentence, not an offer. The label is
      // what says there is a choice here at all, and it is needed precisely
      // when nothing has been chosen, which is every first look.
      el("span.set-label", { text: "What to practise" }),
      el(
        "button.set-line",
        { type: "button", onclick: onChooseSet },
        el("span", { class: chosen ? "chosen" : undefined, text: summaryLine(filters) }),
        el("span.chevron", { "aria-hidden": "true", text: "›" }),
      ),
    );
  }

  /**
   * 51 — the unfinished session as one card above the four lines, carrying the
   * mode colour it belongs to. The lines stay exactly where they were: this is
   * an offer, not a detour.
   */
  function resumeRow() {
    if (!resumable || !onResume) return null;
    const mode = modeByKey(resumable.mode) ?? modeByKey("choose");
    return el(
      "div.resume-block",
      {},
      el(
        "button.resume-row",
        { type: "button", onclick: () => onResume(resumable) },
        station(mode.colour, 26, 5),
        el(
          "span.copy",
          {},
          el("span.title", { text: `Carry on with ${mode.jp}` }),
          el("span.detail", { text: describe(resumable) }),
        ),
        el("span.chevron", { text: "›" }),
      ),
      el(
        "div.rule",
        {},
        el("span.line"),
        el("span.text", { text: "Or start fresh" }),
        el("span.line"),
      ),
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
      SESSION_LENGTHS.map(({ value, label }) =>
        el("button", {
          type: "button",
          text: label,
          "aria-pressed": String(value === sessionLength),
          onclick: () => {
            sessionLength = value;
            onSessionLength?.(value);
            render(picker, ...lengthPicker().children);
          },
        }),
      ),
    );
    return picker;
  }

  /**
   * 27 — "a dashed station below the last stop: on the network, not part of
   * it". Under the four lines rather than in a header, because it is used far
   * less than starting a session and must never be what a thumb hits by
   * accident. Not a floating button; nothing in this design floats.
   */
  function addWordRow() {
    if (!onAddWord) return null;
    return el(
      "button.add-word-row",
      // Called with no argument: `onclick: onAddWord` would hand the click
      // event to it as the word to prefill, which is where 33 passes the
      // search query.
      { type: "button", onclick: () => onAddWord() },
      el("span.dashed-station", { text: "+" }),
      el(
        "span.copy",
        {},
        el("span.title", { text: "Add a word" }),
        el("span.detail", {
          text: ownWords ? `${ownWords} in your own deck` : "nothing in your own deck yet",
        }),
      ),
      // The count doubles as the way into the list (27's note).
      ownWords && onOwnDeck
        ? el("span.chevron", {
            text: "›",
            onclick: (e) => {
              e.stopPropagation();
              onOwnDeck();
            },
          })
        : null,
    );
  }

  function soundNote() {
    // The line has to follow the setting: promising sound that Settings has
    // switched off is the kind of small lie that makes the rest look unreliable.
    return el("p.sound-note", {
      text: readAloud
        ? "Sound on — every card is read aloud in Japanese."
        : "Sound off — tap ♪ on a card to hear it.",
    });
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
