import { answerSoon } from "../api.js";
import { MODES, modeByKey } from "../modes.js";
import { describe } from "../resume.js";
import { isDefault, summaryLine } from "./choose-set.js";
import { el, render, station } from "../ui/dom.js";

/**
 * The same three the Settings screen offers, and the same values: 60 is
 * MAX_SESSION_LENGTH on the server, and the screen calls it "All". Both
 * places write the one stored setting, so picking 10 here shows 10 there.
 */
/** "1 card", "20 cards" — design 10's offers lead with the count. */
const cards = (n) => `${n} ${n === 1 ? "card" : "cards"}`;

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
  // #106: `{ due, outlook, stats }` from `/api/queue` and `/api/stats`, as a
  // promise the shell owns. The shell asks once and hands the same promise to
  // every rebuild of this tab; building the tab used to ask again itself, and
  // a normal start asked three times.
  numbers,
}) {
  const root = el("div.practise");
  render(root, el("div.loading", { text: "…" }));

  // #65: the resume card sits on top of an already-tight layout, and only
  // this state needs the extra room below tightened further — see the
  // media-query rule this class gates in screens.css.
  const hasResume = Boolean(resumable && onResume);
  root.classList.toggle("has-resume", hasResume);

  // What the numbers change, and nothing else: the slot above the chooser
  // holds 15's nothing-due block, the one above the lines holds the due line.
  const top = el("div.due-slot");
  const above = el("div.due-slot");

  load();

  /**
   * #106. The numbers are waited for only briefly. When they come in time the
   * tab is drawn once, whole — on a nothing-due day the block goes above the
   * lines, and drawing the lines first would move them under her thumb. When
   * they do not, the lines are drawn without them and the line above them is
   * filled in when the answer arrives — only that line, see `fill`. On a
   * stalled connection that answer is a timeout ten seconds later, and the
   * lines were hidden behind "…" for all of it.
   */
  async function load() {
    const soon = await answerSoon(numbers);
    render(
      root,
      top,
      resumeRow(),
      setLine(),
      above,
      linesBlock(),
      lengthPicker(),
      soundNote(),
      browseRow(),
      addWordRow(),
    );
    fill(soon);
    // Bounded without a timer of its own: every request gives up at
    // REQUEST_TIMEOUT_MS (api.js), so this settles one way or the other.
    if (!soon) fill(await numbers.then((value) => ({ value }), (error) => ({ error })), { late: true });
  }

  /**
   * Three states, not two. A count that could not be had is not zero: this
   * used to fall back to `due = 0`, which drew "おつかれさま · Nothing due
   * today" on a train with cards due. And on a stalled connection
   * `navigator.onLine` is still true, so no Offline strip explains a missing
   * count — the slot has to say it.
   */
  function fill(outcome, { late = false } = {}) {
    if (late && outcome?.value?.due === 0) {
      // Once the lines are on screen, nothing goes in above them. 15's block
      // arriving late — it came to 365 px with three buttons in it, measured
      // in WebKit — moved all four lines out from under a thumb already on
      // its way to one. So a late nothing-due is one line in the place the
      // "Checking" line held, and the offers wait for the next build of the
      // tab: after a session, or on coming back to it.
      render(top);
      render(above, el("p.due-line", { text: "Nothing due today." }));
      return;
    }
    if (!outcome || outcome.error) {
      render(top);
      // Both fit on one line at her phone's width, so the lines do not move
      // when one becomes the other (measured in WebKit at 394 px; a longer
      // sentence wrapped and pushed them down by 24 px).
      render(
        above,
        el("p.due-line", { text: outcome ? "Couldn't check what's due." : "Checking what's due…" }),
      );
      return;
    }
    // #91: `outlook` carries the design's "Next cards due" row and the offers'
    // counts (#90); the server sends it with an empty day's queue.
    const { due, outlook, stats } = outcome.value;
    // #58: on a normal day the due-line sentence is the instruction and the
    // four lines are its only answer — so it sits right above them, below
    // the chooser, not above it where the WHAT TO PRACTISE block used to
    // read as what the sentence was introducing.
    //
    // #70: "nothing due" and "carry on where you left off" both answer
    // "what do you do now", and stacked together they push the four lines
    // themselves below the fold. Carry on is the more specific answer, so
    // when it's on offer the generic suggestions step aside for it.
    render(top, ...(due > 0 || hasResume ? [] : nothingDue(outlook, stats)));
    render(above, ...(due > 0 ? normalDay(due) : []));
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

  function nothingDue(outlook, stats) {
    const offers = [];
    const { ahead = 0, lapsed = 0, nextDue } = outlook ?? {};

    // "If a row has nothing behind it the row is dropped, not disabled." Both
    // counts are the server's own count of the session the row starts, so a
    // row that is shown always has cards behind it (#90).
    if (ahead > 0) {
      offers.push(
        offer("Practise ahead", `${cards(ahead)} due in the next two days`, () =>
          onStart({ only: "ahead" }),
        ),
      );
    }

    const behind = weakestTopic(stats);
    if (behind) {
      offers.push(
        offer("Drill a topic", `${behind.tag} is furthest behind, ${behind.seen} of ${behind.total}`, () =>
          onDrillTopic(),
        ),
      );
    }

    if (lapsed > 0) {
      offers.push(
        offer("Recent mistakes", `${cards(lapsed)} missed in the last three days`, () =>
          onStart({ only: "lapsed" }),
        ),
      );
    }

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
            // Design 10: "28 · tomorrow 06:00". The wording of the time is the
            // server's, in Tokyo (§8a), not this device's clock.
            el("span.value.tabular", { text: `${nextDue.count} · ${nextDue.when}` }),
          )
        : null,
      offers.length > 0 ? el("div.offers", {}, offers) : null,
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

  /**
   * #111: every redraw goes into this one `picker`, the one on screen. It used
   * to redraw by building a whole second picker and moving its buttons across
   * — and those buttons' own taps then redrew the second picker, which was
   * never on screen. So only the first tap moved the highlight; every later
   * one was saved (measured: a PATCH per tap) and showed nothing, until a tab
   * change rebuilt the screen.
   */
  function lengthPicker() {
    const picker = el("div.length");
    const draw = () =>
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
              draw();
            },
          }),
        ),
      );
    draw();
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
