import { answerSoon } from "../api.js";
import { modeName, visibleModes } from "../script.js";
import { activeLabel, isDefault } from "./choose-set.js";
import { el, num, render } from "../ui/dom.js";

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
 * What the one button on a deck page says (#137), when only one way of
 * practising is switched on: what the session will do, as Noji's "Karten
 * lernen" does, rather than the name of a setting.
 */
const START_LABELS = {
  choose: "Pick the meanings",
  listen: "Listen to the cards",
  speak: "Say the cards aloud",
  type: "Type the words",
  flip: "Flip the cards",
};

function startLabel(mode) {
  return START_LABELS[mode.key] ?? mode.en;
}

/**
 * A deck's page (#137) — designs 10 and 15, inside one deck.
 *
 * Reached from the deck list (decks.js), the way Noji's deck page is: the
 * cards for today as one large number, what they are made of, then how long
 * and how to practise. With one way of practising switched on, that is one
 * button, like Noji's "Karten lernen"; with several, one plain row each. The
 * metro-line stations are gone from here — Henning: the red circles "kamen
 * nicht gut an" — and so is the rail between them.
 *
 * When nothing is due, the offers of design 15 sit under the number, inside
 * this deck: the queue's outlook is counted with the same deck key.
 */
export function practiseScreen({
  deck,
  onBack,
  onOptions,
  onStart,
  onDrillTopic,
  onChooseSet,
  filters = {},
  sessionLength,
  onSessionLength,
  readAloud = true,
  onReadAloud,
  // #106: `{ due, today, outlook, stats }` from `/api/queue` and `/api/stats`,
  // as a promise the shell owns. The shell asks once and hands the same promise to
  // every rebuild of this tab; building the tab used to ask again itself, and
  // a normal start asked three times.
  numbers,
  // #118: where the tab this one replaces was scrolled to.
  scrollTop = 0,
  // #135: false shows the English beside every Japanese label instead.
  japanese = true,
  // The ways of practising switched off for this deck (#137, Deck options).
  hiddenModes = [],
}) {
  const root = el("div.practise.deck-page");
  render(root, el("div.loading", { text: "…" }));

  // What the numbers change, and nothing else: the large number and its
  // parts, and under them 15's offers on a day with nothing due.
  const today = el("div.deck-today");
  const top = el("div.due-slot");

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
    // What was chosen on the deck list comes first, then the two questions
    // in the order she answers them — how long, how — and the answer to the
    // last is the tap that starts the session. What is left to narrow comes
    // after it, because on most days nothing is (#137).
    render(
      root,
      header(),
      today,
      top,
      lengthPicker(),
      linesBlock(),
      setLine(),
      soundNote(),
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
   * used to fall back to `due = 0`, which drew "Nothing due today" on a train
   * with cards due. And on a stalled connection `navigator.onLine` is still
   * true, so no Offline strip explains a missing count — the number has to.
   */
  function fill(outcome, { late = false } = {}) {
    if (!outcome || outcome.error) {
      render(top);
      // In the number's place, so nothing below moves when one becomes the
      // other. A count that could not be had is not zero.
      render(today, el("div.deck-today-state", { text: outcome ? "Couldn't check" : "Checking…" }));
      return;
    }
    const { due, today: counts, outlook, stats } = outcome.value;
    const total = counts?.total ?? due;
    render(
      today,
      el("span.deck-today-n.tabular", { text: num(total) }),
      el("span.deck-today-label", { text: total === 1 ? "card for today" : "cards for today" }),
      counts
        ? el(
            "div.deck-today-split",
            {},
            part(counts.fresh, "new"),
            part(counts.review, "to review"),
          )
        : null,
    );
    // Once the lines are on screen, nothing goes in above them: 15's offers
    // arriving late moved the lines out from under a thumb on its way to one
    // (measured in WebKit, 365 px). They wait for the next build of the page.
    if (late) return;
    render(top, ...(total > 0 ? [] : nothingDue(outlook, stats)));
  }

  function part(n, label) {
    return el("span.deck-today-part", {}, el("b.tabular", { text: num(n ?? 0) }), el("span", { text: label }));
  }

  /** The deck's name, and the way back to the list. */
  function header() {
    return el(
      "div.deck-head",
      {},
      onBack
        ? el("button.deck-back", { type: "button", "aria-label": "Your decks", onclick: onBack, text: "‹ Decks" })
        : null,
      el(
        "div.deck-title-row",
        {},
        el("h1.deck-name", { text: deck?.name ?? "" }),
        onOptions ? el("button.deck-options-button", { type: "button", onclick: onOptions, text: "Options" }) : null,
      ),
    );
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

    // Only in Kaishi: the topics are the deck's, and in one of her lists the
    // topic furthest behind would start a session of Kaishi cards.
    const behind = deck?.key === "kaishi" ? weakestTopic(stats) : undefined;
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
    ];
  }

  function offer(title, detail, onClick) {
    return el(
      "button.offer",
      { type: "button", onclick: onClick },
      el("span.copy", {}, el("span.title", { text: title }), el("span.detail", { text: detail })),
      el("span.chevron", { "aria-hidden": "true", text: "›" }),
    );
  }

  /**
   * 36's sheet, now for what is left to narrow inside a deck: a topic, starred
   * cards, recent mistakes, new cards only. Below the lines rather than above
   * them — the deck is the choice that matters, and it was made on the list.
   * What is chosen is said on the row, so a narrowed session is never a
   * surprise.
   */
  function setLine() {
    if (!onChooseSet) return null;
    const chosen = !isDefault(filters);
    return el(
      "button.deck-more",
      { type: "button", onclick: onChooseSet },
      el("span", { text: chosen ? `Only: ${activeLabel({ tag: filters.tag, only: filters.only })}` : "More options" }),
      el("span.chevron", { "aria-hidden": "true", text: "›" }),
    );
  }

  /**
   * How to practise (#137). One way switched on: one button that says what it
   * does, like Noji's "Karten lernen". Several: a plain row each. A session
   * she left in a line is still offered on the deck list.
   */
  function linesBlock() {
    // A way the deck cannot do is off whatever was stored (Deck options).
    const cannot = Object.entries(deck?.ways ?? {}).filter(([, n]) => n === 0).map(([key]) => key);
    const modes = visibleModes([...hiddenModes, ...cannot]);
    if (modes.length === 1) {
      const [mode] = modes;
      return el(
        "div.deck-start-block",
        {},
        el("button.deck-start", { type: "button", onclick: () => onStart({ mode: mode.key }), text: startLabel(mode) }),
      );
    }
    return el(
      "div.deck-ways",
      {},
      el("span.set-label", { text: "Practise by" }),
      el(
        "div.deck-ways-list",
        {},
        modes.map((mode) =>
          el(
            "button.deck-way",
            { type: "button", onclick: () => onStart({ mode: mode.key }) },
            el(japanese ? "span.name.jp" : "span.name", { text: modeName(mode, japanese) }),
            japanese ? el("span.en", { text: mode.en }) : null,
            el("span.chevron", { "aria-hidden": "true", text: "›" }),
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
            japanese
              ? el("span.length-word", { lang: "ja", text: label })
              : el("span.length-word.latin", { text: en }),
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
