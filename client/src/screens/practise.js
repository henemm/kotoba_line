import { answerSoon } from "../api.js";
import { modeName, visibleModes } from "../script.js";
import { seen } from "../seen.js";
import { topicLabel } from "../topics.js";
import { activeLabel, isDefault } from "./choose-set.js";
import { el, num, render } from "../ui/dom.js";

/**
 * Noji's words for how far a card is (#159), which Charlotte already reads
 * there. The server counts them (`progressBand` in server/src/queue.js):
 * "Gemeisterte" are the cards it waits three weeks or more to ask again.
 */
const BANDS = [
  { key: "new", label: "Nicht gelernte" },
  { key: "learning", label: "In Bearbeitung" },
  { key: "mastered", label: "Gemeisterte" },
];

/** "1 card", "20 cards" — design 10's offers lead with the count. */
const cards = (n) => `${n} ${n === 1 ? "Karte" : "Karten"}`;

/**
 * There is no "How long" any more (v74, #123 reversed). It stood beside "14
 * cards for today" as "Normal · 20 cards" — two numbers that disagreed, and
 * Charlotte found it confusing. As in Noji, a session is the day's cards; a
 * deck that should ask fewer has "Max cards per day" in its Options.
 */

/**
 * What the one button on a deck page says (#137), when only one way of
 * practising is switched on: what the session will do, as Noji's "Karten
 * lernen" does, rather than the name of a setting.
 */
const START_LABELS = {
  choose: "Bedeutungen wählen",
  listen: "Karten anhören",
  speak: "Karten laut sagen",
  type: "Wörter tippen",
  flip: "Karten umdrehen",
};

function startLabel(mode) {
  return START_LABELS[mode.key] ?? mode.en;
}

/**
 * A deck's page (#137) — designs 10 and 15, inside one deck.
 *
 * Reached from the deck list (decks.js), the way Noji's deck page is: the
 * cards for today as one large number, what they are made of, then how to
 * practise. With one way of practising switched on, that is one button, like
 * Noji's "Karten lernen"; with several, one button each (v74: they were rows
 * with a ›, which read as links to another page, not as "start"). The
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
  // #209: the open deck has topics to choose from, Kaishi's or her own.
  topicsHere = false,
  // #179: take one more batch of new cards into today, in this deck.
  onReleaseNew,
  filters = {},
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
  // The deck's cards, under everything else (deck-cards.js), and the way to add
  // one — only in a deck of hers (#137).
  cardsBlock,
  onAddCard,
}) {
  const root = el("div.practise.deck-page");
  render(root, el("div.loading", { text: "…" }));

  // What the numbers change, and nothing else: the large number and its
  // parts, and under them 15's offers on a day with nothing due.
  const today = el("div.deck-today");
  const top = el("div.due-slot");
  // #159: the whole deck in Noji's three bands, above its cards.
  const progress = el("div.deck-progress");

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
    // A deck of hers with nothing in it yet has nothing to practise: the page
    // is the way to its first card (#137).
    if (deck?.own && deck.cards === 0) {
      render(root, header(), emptyDeck());
      return;
    }
    const soon = await answerSoon(numbers);
    // What was chosen on the deck list comes first, then the one question —
    // how to practise — and the answer is the tap that starts the session.
    // What is left to narrow comes after it, because on most days nothing is
    // (#137).
    render(
      root,
      header(),
      today,
      top,
      linesBlock(),
      setLine(),
      soundNote(),
      progress,
      cardsBlock ?? null,
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
      // Late, below the lines, so it can come in whenever the answer does.
      render(progress);
      // In the number's place, so nothing below moves when one becomes the
      // other. A count that could not be had is not zero.
      render(today, el("div.deck-today-state", { text: outcome ? "Konnte nicht prüfen" : "Wird geprüft …" }));
      return;
    }
    const { due, today: counts, outlook, stats, maxReached, progress: bands } = outcome.value;
    const total = counts?.total ?? due;
    render(
      today,
      el("span.deck-today-n.tabular", { text: num(total) }),
      el("span.deck-today-label", { text: total === 1 ? "Karte für heute" : "Karten für heute" }),
      counts ? todaySplit(counts) : null,
    );
    // Below the lines, so drawing it late moves nothing she is about to tap.
    render(progress, ...(bands ? progressBlock(bands) : []));
    // Once the lines are on screen, nothing goes in above them: 15's offers
    // arriving late moved the lines out from under a thumb on its way to one
    // (measured in WebKit, 365 px). They wait for the next build of the page.
    if (late) return;
    render(top, ...(total > 0 ? [] : [maxNote(maxReached), ...nothingDue(outlook, stats)]));
  }

  /**
   * Migration 017: with cards still due, a zero is the deck's "Max cards per
   * day", not a finished deck — and the page says where that was set, so a
   * limit she forgot about does not look like a fault.
   */
  function maxNote(reached) {
    if (!reached) return null;
    return el("p.deck-max-note", {
      text: "Das ist das Maximum für heute in diesem Deck. Du kannst es unter Optionen ändern.",
    });
  }

  function emptyDeck() {
    return el(
      "div.deck-empty",
      {},
      el("p.deck-empty-title", { text: "In diesem Deck sind noch keine Karten." }),
      el("p.deck-empty-body", { text: "Schreib das Deutsche auf die Vorderseite und das Japanische auf die Rückseite, wie in Noji." }),
      onAddCard ? el("button.deck-start", { type: "button", onclick: onAddCard, text: "Erste Karte hinzufügen" }) : null,
    );
  }

  /**
   * Today's cards in Noji's three bands (#159): the new ones, and the reviews
   * split by how far the card is. A server from before v76 sends only new and
   * review, and gets the two it can say.
   */
  function todaySplit(counts) {
    if (counts.mastered === undefined) {
      return el("div.deck-today-split", {}, part(counts.fresh, "neu"), part(counts.review, "zu wiederholen"));
    }
    return el(
      "div.deck-today-split",
      {},
      BANDS.map((band) => part(band.key === "new" ? counts.fresh : counts[band.key], band.label, band.key)),
    );
  }

  function part(n, label, band) {
    return el(
      "span.deck-today-part",
      {},
      el("b.tabular", {}, band ? el(`span.band-dot.${band}`, { "aria-hidden": "true" }) : null, num(n ?? 0)),
      el("span", { text: label }),
    );
  }

  /**
   * "Karten im Deck (387)" (#159), as on Noji's deck page: one bar for the
   * whole deck and the same three bands under it, so she sees how far the
   * deck is and not only today. Counted by the server with the day's numbers,
   * so offline — where those are missing too — it is left off, not guessed.
   */
  function progressBlock(bands) {
    const shown = BANDS.filter((band) => bands[band.key] > 0);
    return [
      el("h2.deck-progress-title", {}, "Karten im Deck ", el("span.tabular", { text: `(${num(bands.total)})` })),
      el(
        "div.deck-progress-bar",
        { role: "img", "aria-label": BANDS.map((band) => `${num(bands[band.key])} ${band.label}`).join(", ") },
        shown.map((band) => el(`span.${band.key}`, { style: { flexGrow: String(bands[band.key]) } })),
      ),
      el(
        "div.deck-progress-legend",
        {},
        BANDS.map((band) =>
          el(
            "span.deck-progress-part",
            {},
            el(`span.band-dot.${band.key}`, { "aria-hidden": "true" }),
            el("b.tabular", { text: num(bands[band.key]) }),
            el("span", { text: band.label }),
          ),
        ),
      ),
    ];
  }

  /** The deck's name, and the way back to the list. */
  function header() {
    return el(
      "div.deck-head",
      {},
      onBack
        ? el("button.deck-back", { type: "button", "aria-label": "Deine Decks", onclick: onBack, text: "‹ Decks" })
        : null,
      el(
        "div.deck-title-row",
        {},
        el("h1.deck-name", { text: deck?.name ?? "" }),
        onOptions ? el("button.deck-options-button", { type: "button", onclick: onOptions, text: "Optionen" }) : null,
      ),
    );
  }

  function nothingDue(outlook, stats) {
    const offers = [];
    const { ahead = 0, lapsed = 0, fresh = 0, nextDue } = outlook ?? {};

    // Charlotte, 2026-09-16: "Ich hätte auch gerne das ich weiter lernen kann
    // wenn ich möchte und nicht erst morgen um 11:30". The day's new cards are
    // capped so that a big day does not come back as a bigger one three days
    // later — but the cap paces her, it does not stop her.
    //
    // It *releases* the next batch rather than starting a session of its own
    // (v90, after v89 did start one): what she wants is her ordinary practice
    // to carry on, in the ways she has chosen, not a set called "Deine
    // Auswahl". So the tap raises today's allowance and the page redraws with
    // cards for today on it — the same page she would see in the morning.
    if (fresh > 0 && onReleaseNew) {
      const batch = Math.min(fresh, deck?.settings?.newPerDay ?? fresh);
      offers.push(
        offer(newLabel(), `${cards(batch)} für heute dazunehmen · ${cards(fresh)} noch nicht gelernt`, () => {
          seen("more_new_tapped", deck?.key);
          onReleaseNew();
        }),
      );
      // #228: once a day per deck — this page redraws on every sync.
      seen("more_new_shown", deck?.key, { oncePerDay: true });
    }

    // "If a row has nothing behind it the row is dropped, not disabled." Both
    // counts are the server's own count of the session the row starts, so a
    // row that is shown always has cards behind it (#90).
    if (ahead > 0) {
      offers.push(
        offer("Vorausüben", `${cards(ahead)} in den nächsten zwei Tagen fällig`, () =>
          onStart({ only: "ahead" }),
        ),
      );
    }

    // Only in Kaishi: the topics are the deck's, and in one of her lists the
    // topic furthest behind would start a session of Kaishi cards.
    const behind = deck?.key === "kaishi" ? weakestTopic(stats) : undefined;
    if (behind) {
      offers.push(
        offer("Thema üben", `${topicLabel(behind.tag)} liegt am weitesten zurück, ${behind.seen} von ${behind.total}`, () =>
          onDrillTopic(),
        ),
      );
    }

    if (lapsed > 0) {
      offers.push(
        offer("Letzte Fehler", `${cards(lapsed)} in den letzten drei Tagen nicht gewusst`, () =>
          onStart({ only: "lapsed" }),
        ),
      );
    }

    return [
      nextDue
        ? el(
            "div.next-due",
            {},
            el("span.label", { text: "Nächste fällige Karten" }),
            // Design 10: "28 · tomorrow 06:00". The wording of the time is the
            // server's, in the zone this device sent it (§8a, #122).
            el("span.value.tabular", { text: `${nextDue.count} · ${nextDue.when}` }),
          )
        : null,
      offers.length > 0 ? el("div.offers", {}, offers) : null,
    ];
  }

  /** What a kana deck teaches is characters, not words (#158). */
  function newLabel() {
    return deck?.key === "hiragana" || deck?.key === "katakana" ? "Mehr neue Zeichen" : "Mehr neue Wörter";
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
    // #209: the topics were behind "Weitere Auswahl", a name that does not
    // say they are there — Charlotte missed them. Where a deck has topics, the
    // line says so; the sheet it opens is the same.
    const byTopic = topicsHere && !chosen;
    if (byTopic) seen("topic_line_shown", deck?.key, { oncePerDay: true });
    return el(
      "button.deck-more",
      {
        type: "button",
        onclick: () => {
          if (byTopic) seen("topic_line_tapped", deck?.key);
          onChooseSet();
        },
      },
      el("span", {
        text: chosen ? `Nur: ${activeLabel({ tag: filters.tag, only: filters.only })}` : byTopic ? "Nach Thema üben" : "Weitere Auswahl",
      }),
      el("span.chevron", { "aria-hidden": "true", text: "›" }),
    );
  }

  /**
   * How to practise (#137). One way switched on: one button that says what it
   * does, like Noji's "Karten lernen". Several: a button each, with ▶ where
   * the rows had ›, because a tap starts the session rather than opening a
   * page (v74, Henning: "die Übungen müssen tatsächlich Buttons sein"). A
   * session she left in a line is still offered on the deck list.
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
      el("span.set-label", { text: "Üben" }),
      el(
        "div.deck-ways-list",
        {},
        modes.map((mode) =>
          el(
            "button.deck-way",
            { type: "button", onclick: () => onStart({ mode: mode.key }) },
            el(
              "span.copy",
              {},
              el(japanese ? "span.name.jp" : "span.name", { text: modeName(mode, japanese) }),
              japanese ? el("span.en", { text: mode.en }) : null,
            ),
            el("span.play", { "aria-hidden": "true", text: "▶" }),
          ),
        ),
      ),
    );
  }

  /**
   * A status, not a question: it sits apart below the lines, smaller, with
   * the one thing she might want to do about it on a quiet train right beside
   * it. The switch writes the same stored setting as Settings → Read cards
   * aloud, so the two never disagree. Redrawn in place (#111): a redraw that
   * builds a second note leaves the switch's later taps drawing off screen.
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
          text: readAloud ? "Ton an – Karten werden vorgelesen." : "Ton aus – tippe auf ♪, um eine Karte zu hören.",
        }),
        onReadAloud
          ? el("button.sound-switch", {
              type: "button",
              text: readAloud ? "Ausschalten" : "Einschalten",
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
