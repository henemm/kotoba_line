import { answerSoon } from "../api.js";
import { MODES, modeByKey } from "../modes.js";
import { describe } from "../resume.js";
import { isDefault, summaryLine } from "./choose-set.js";
import { el, render, station } from "../ui/dom.js";

/** "1 card", "20 cards" — design 10's offers lead with the count. */
const cards = (n) => `${n} ${n === 1 ? "card" : "cards"}`;

/**
 * 60 is MAX_SESSION_LENGTH on the server.
 *
 * The only place session length is set (#123). Settings offered the same
 * three and wrote the same stored value, which read as two different
 * settings; it is a choice made when she sits down to practise, so it lives
 * where she does that.
 *
 * The question she is actually answering is how much time she has, so the
 * buttons say that in words, and the count stays underneath so the word never
 * promises more than it does. No minutes: there is not yet enough of her own
 * practice to say how long a card takes (measured 2026-09-14: no answers on
 * her account, nine on Henning's, from 9 to 98 seconds apart), and a guess
 * would be wrong on the first 書く session. The last is "up to 60" rather than
 * "all", because on a day with more than 60 due it is not all.
 *
 * The words are Japanese, drawn like the lines below them: the modes are
 * 選ぶ and 聞く with English underneath, and "Quick / Normal / Long" read
 * as a form (Henning: "etwas langweilig"). All three are words she is
 * learning — ちょっと is rank 93 in the deck, 普通 293, いっぱい 683 — so the
 * choice is also a small reading exercise. ふつう is written in kana, as she
 * would read it before the kanji. `en` is what VoiceOver says.
 */
const SESSION_LENGTHS = [
  { value: 10, label: "ちょっと", en: "A little", detail: "10 cards" },
  { value: 20, label: "ふつう", en: "Normal", detail: "20 cards" },
  { value: 60, label: "いっぱい", en: "A lot", detail: "up to 60" },
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
  onResume,
  resumable,
  filters = {},
  sessionLength,
  onSessionLength,
  readAloud = true,
  onReadAloud,
  // #106: `{ due, outlook, stats }` from `/api/queue` and `/api/stats`, as a
  // promise the shell owns. The shell asks once and hands the same promise to
  // every rebuild of this tab; building the tab used to ask again itself, and
  // a normal start asked three times.
  numbers,
  // #118: where the tab this one replaces was scrolled to.
  scrollTop = 0,
}) {
  const root = el("div.practise");
  render(root, el("div.loading", { text: "…" }));

  // #65: the resume card sits on top of an already-tight layout, and only
  // this state needs the extra room below tightened further — see the
  // media-query rule this class gates in screens.css.
  const hasResume = Boolean(resumable && onResume);
  root.classList.toggle("has-resume", hasResume);

  // What the numbers change, and nothing else: the slot above the chooser
  // holds 15's nothing-due block, the one beside the lines' heading holds the
  // due count.
  const top = el("div.due-slot");
  const above = el("span.due-slot");

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
    // Three questions in the order she answers them — what, how long, how —
    // and the answer to the last one is the tap that starts the session. The
    // length picker used to sit under the lines, where it was chosen after
    // the tap it applied to. The lines are still the lowest controls, which
    // on a phone is where the thumb already is.
    render(
      root,
      top,
      resumeRow(),
      setLine(),
      lengthPicker(),
      linesHead(),
      linesBlock(),
      soundNote(),
      // #123: "Find and star words" and "Add a word" were the last two rows
      // here. They are the Words tab now, which is also what lets this tab fit
      // on the screen with the Carry-on card showing, rather than scrolling.
    );
    fill(soon);
    // Once the rows are in: before, there is nothing to scroll and it clamps
    // to 0. By now renderApp() has put this tab on the page.
    if (scrollTop) root.scrollTop = scrollTop;
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
      render(above, "Nothing due today");
      return;
    }
    if (!outcome || outcome.error) {
      render(top);
      // Beside the heading, on its one line, so the lines do not move when
      // one becomes the other.
      render(above, outcome ? "Couldn't check" : "Checking…");
      return;
    }
    // #91: `outlook` carries the design's "Next cards due" row and the offers'
    // counts (#90); the server sends it with an empty day's queue.
    const { due, outlook, stats } = outcome.value;
    // #58: the due count sits right above the lines, not above the chooser,
    // where WHAT TO PRACTISE read as what it was introducing. Since the three
    // headings it is no longer the instruction — "How to practise" is — just
    // the count beside it.
    //
    // #70: "nothing due" and "carry on where you left off" both answer
    // "what do you do now", and stacked together they push the four lines
    // themselves below the fold. Carry on is the more specific answer, so
    // when it's on offer the generic suggestions step aside for it.
    render(top, ...(due > 0 || hasResume ? [] : nothingDue(outlook, stats)));
    render(above, ...(due > 0 ? [`${cards(due)} due`] : []));
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

  function linesHead() {
    return el(
      "div.lines-head",
      {},
      el("span.set-label", { text: "How to practise" }),
      el("span.due-count", {}, above),
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
   *
   * The label came back after #123: in Settings the row sat under "Session
   * length", and moved here it was three bare buttons that neither she nor
   * Henning could read. It asks the question the way "What to practise" does,
   * in her words rather than the setting's name.
   */
  function lengthPicker() {
    const picker = el("div.length", { role: "group", "aria-labelledby": "length-label" });
    const draw = () =>
      render(
        picker,
        SESSION_LENGTHS.map(({ value, label, en, detail }) =>
          el(
            "button",
            {
              type: "button",
              "aria-label": `${en}, ${detail}`,
              "aria-pressed": String(value === sessionLength),
              onclick: () => {
                sessionLength = value;
                onSessionLength?.(value);
                draw();
              },
            },
            el("span.length-word", { lang: "ja", text: label }),
            el("span.length-count", { text: detail }),
          ),
        ),
      );
    draw();
    return el(
      "div.length-block",
      {},
      el("span.set-label", { id: "length-label", text: "How long" }),
      picker,
    );
  }

  /**
   * A status, not a fourth question: it sits apart below the lines, smaller,
   * with the one thing she might want to do about it on a quiet train right
   * beside it. The switch writes the same stored setting as Settings → Read
   * cards aloud, so the two never disagree. Redrawn in place, for the reason
   * `lengthPicker` gives.
   *
   * The line has to follow the setting: promising sound that is switched off
   * is the kind of small lie that makes the rest look unreliable.
   */
  function soundNote() {
    const note = el("div.sound-note");
    const draw = () =>
      render(
        note,
        el("span.sound-state", {
          text: readAloud ? "Sound on — cards are read aloud." : "Sound off — tap ♪ on a card to hear it.",
        }),
        onReadAloud
          ? el("button.sound-switch", {
              type: "button",
              text: readAloud ? "Turn off" : "Turn on",
              onclick: () => {
                readAloud = !readAloud;
                onReadAloud(readAloud);
                draw();
              },
            })
          : null,
      );
    draw();
    return note;
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
