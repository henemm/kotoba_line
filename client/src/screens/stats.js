import { OfflineError, api } from "../api.js";
import { WEEKDAYS, calendarWeeks, dayDetail, dayKind, dayOfMonth, daysPractised } from "../history.js";
import { byTopicLabel, topicLabel } from "../topics.js";
import { el, num, render } from "../ui/dom.js";

/** The level bar is drawn as twelve segments however far apart the levels are. */
const LEVEL_SEGMENTS = 12;

/** Past this many topics the list truncates behind a rule (design 02, 24). */
const TOPICS_BEFORE_TRUNCATION = 5;

const MATURITY = [
  // Tokens, not colours: the ramp turns round in the light palette (v65).
  { key: "new", label: "Neu", colour: "var(--band-new)" },
  { key: "learning", label: "Am Lernen", colour: "var(--band-learning)" },
  { key: "young", label: "Jung", colour: "var(--band-young)" },
  { key: "mature", label: "Gefestigt", colour: "var(--band-mature)" },
];

/**
 * How much of the twelve-segment bar is filled for a given level's progress.
 * Exported because it is arithmetic with an off-by-one waiting in it, and
 * arithmetic belongs in a test rather than in a screenshot.
 */
export function levelProgress({ xp, xpForLevel, xpForNextLevel }) {
  const span = xpForNextLevel - xpForLevel;
  const into = xp - xpForLevel;
  const filled = span > 0 ? Math.round((into / span) * LEVEL_SEGMENTS) : 0;
  return {
    filled: Math.min(Math.max(filled, 0), LEVEL_SEGMENTS),
    remaining: Math.max(xpForNextLevel - xp, 0),
  };
}

/**
 * The end dot sits on the bar at `pct`, clamped so that at 0-3% or 98-100% it
 * stays inside the track rather than hanging half off the edge.
 */
export function endDotOffset(pct) {
  if (pct >= 98) return "-11px";
  if (pct <= 3) return "-3px";
  return "-7px";
}

/**
 * Which topic rows to draw. Only topics she has actually met appear — a topic
 * she has never seen a card from is not progress, it is absence — and past
 * five the rest go behind a rule.
 */
export function visibleTopics(topics, expanded, limit = TOPICS_BEFORE_TRUNCATION) {
  // In the order of the names she reads (v75): the server sends them by the
  // English keys, which in German is no order at all.
  const seen = (topics ?? []).filter((t) => t.seen > 0).sort((a, b) => byTopicLabel(a.tag, b.tag));
  const shown = expanded ? seen : seen.slice(0, limit);
  return { seen, shown, hidden: seen.length - shown.length };
}

const NUMBER_WORDS = ["Kein", "Ein", "Zwei", "Drei", "Vier", "Fünf", "Sechs", "Sieben", "Acht", "Neun", "Zehn"];
const numberWord = (n) => NUMBER_WORDS[n] ?? String(n);

/**
 * What designs 04 and 19 say, for a gap of `days` covered by as many jokers.
 * Exported because it is the part with the cases in it — one day or several,
 * one joker left or none — and cases belong in a test.
 */
export function jokerNoticeCopy({ days, streak, jokers }) {
  const headline =
    days === 1
      ? "Gestern hast du nichts wiederholt. Ein Joker hat den Tag abgedeckt."
      : `${numberWord(days)} Tage ohne Wiederholung. ${numberWord(days)} Joker haben sie abgedeckt.`;
  const left =
    jokers === 0
      ? "Kein Joker mehr übrig"
      : `${numberWord(jokers)} Joker übrig`;
  const body = `Deine Serie hält: ${num(streak)} ${streak === 1 ? "Tag" : "Tage"}. ${left}; fünf Tage am Stück bringen einen neuen.`;
  return { headline, body };
}

/**
 * What design 08 says when a gap ended the streak (#89). Exported for the
 * same reason as the joker copy: one day or several, and — a case the design
 * does not draw — a streak she has already started again today on another
 * device, where "starts the next one" would be a step behind her.
 */
export function streakResetCopy({ days, cards, level, streak }) {
  const headline =
    days === 1
      ? "Ein Tag ohne Wiederholung, und kein Joker mehr, der ihn abdeckt."
      : `${numberWord(days)} Tage ohne Wiederholung, und kein Joker mehr, der sie abdeckt.`;
  const body = `Die Serie ist wieder bei null. Sonst hat sich nichts geändert: ${num(cards)} ${cards === 1 ? "Karte" : "Karten"}, Level ${level}, und dein Lernplan macht weiter, wo er war.`;
  const next =
    streak > 0
      ? "Heute zählt schon als Tag eins. Fünf Tage am Stück bringen einen Joker zurück."
      : "Zehn Wiederholungen heute starten die nächste. Fünf Tage am Stück bringen einen Joker zurück.";
  return { headline, body, next };
}

/**
 * The three joker slots on the notice: what she holds, what the gap just
 * spent, and whatever is left empty. Never more than three in all.
 */
export function noticeSlots({ jokers, days }) {
  const held = Math.min(jokers, 3);
  const spent = Math.min(days, 3 - held);
  return [
    ...Array(held).fill("filled"),
    ...Array(spent).fill("spent"),
    ...Array(3 - held - spent).fill("empty"),
  ];
}

/**
 * "Joker spent" — designs 04 and 19 (#86).
 *
 * §8a: "tell her when one is spent. A safety net she does not know about does
 * not reduce the pressure it exists to reduce." Shown once, before the mode
 * picker, on the first day after a gap the jokers covered; the server decides
 * that day (`jokerGap` in /api/stats), and app.js remembers per gap that it
 * was shown.
 *
 * The design's button reads "Start today's session". This one says "Continue"
 * and returns to the practise tab, because the notice comes *before* the mode
 * picker: there is no session to start until she has picked a line, and a
 * button that quietly started 選ぶ would decide that for her.
 */
export function jokerSpentScreen({ stats, onContinue }) {
  const { days } = stats.jokerGap;
  const { headline, body } = jokerNoticeCopy({ days, streak: stats.streak, jokers: stats.jokers });

  return el(
    "div.joker-notice",
    {},
    el(
      "div.joker-notice-body",
      {},
      el(
        "div.joker-notice-slots",
        {},
        el("span.mono-label", { text: "Joker" }),
        el(
          "div.joker-slots",
          {},
          // No red, no green (04's note): a spent slot is dashed and says so.
          noticeSlots({ jokers: stats.jokers, days }).map((kind) =>
            kind === "filled"
              ? el("span.slot.filled", {}, el("span.diamond"))
              : kind === "spent"
                ? el("span.slot.spent", {}, el("span.slot-label", { text: "verbraucht" }))
                : el("span.slot.empty"),
          ),
        ),
      ),
      el(
        "div.joker-notice-copy",
        {},
        el("h2", { text: headline }),
        el("p", { text: body }),
      ),
      el(
        "div.joker-notice-streak",
        {},
        el("span.tabular", { text: num(stats.streak) }),
        el("span.joker-notice-streak-label", { text: "Tage in Folge\nSerie hält" }),
      ),
    ),
    el(
      "div.joker-notice-foot",
      {},
      el("button.btn-primary", { type: "button", text: "Weiter", onclick: onContinue }),
    ),
  );
}

/**
 * "Streak reset" — designs 08 and 20 (#89).
 *
 * The counterpart to the joker notice and, per 08's note, "deliberately not
 * louder": the same layout, three empty slots instead of spent ones, and a
 * second paragraph that exists "to say what survived; without it the screen
 * reads as though progress was lost". No red anywhere.
 *
 * Shown under the same rules as the joker notice (app.js), and its button says
 * "Continue" rather than 08's "Start day one" for the same reason that one
 * does not say "Start today's session": the practise tab is where she picks
 * how.
 */
export function streakResetScreen({ stats, onContinue }) {
  const { days } = stats.streakReset;
  const { headline, body, next } = streakResetCopy({
    days,
    cards: stats.cardsSeen,
    level: stats.level,
    streak: stats.streak,
  });

  return el(
    "div.joker-notice.streak-reset",
    {},
    el(
      "div.joker-notice-body",
      {},
      el(
        "div.joker-notice-slots",
        {},
        el("span.mono-label", { text: "Joker" }),
        el(
          "div.joker-slots",
          {},
          noticeSlots({ jokers: stats.jokers, days: 0 }).map((kind) =>
            kind === "filled" ? el("span.slot.filled", {}, el("span.diamond")) : el("span.slot.empty"),
          ),
        ),
      ),
      el(
        "div.joker-notice-copy",
        {},
        el("h2", { text: headline }),
        el("p", { text: body }),
      ),
      el(
        "div.joker-notice-streak",
        {},
        el("span.tabular", { text: num(stats.streak) }),
        el("span.joker-notice-streak-label", { text: "Tage\nSerie" }),
        el("span.tabular.streak-reset-longest", { text: num(stats.longestStreak) }),
        el("span.joker-notice-streak-label", { text: "längste" }),
      ),
      el("p.streak-reset-next", { text: next }),
    ),
    el(
      "div.joker-notice-foot",
      {},
      el("button.btn-primary", { type: "button", text: "Weiter", onclick: onContinue }),
    ),
  );
}

/**
 * Design 02 and 12. The screen that carries more numbers than any other, so
 * hierarchy is the whole job: one number at 96px, then two at 38px, then
 * everything else at text size.
 *
 * The maturity bands and the topic bars are a grey-to-white ramp on purpose —
 * the four saturated colours belong to the modes and are not reused.
 */
export function statsScreen({ onBrowse } = {}) {
  const root = el("div.stats");
  render(root, el("div.loading", { text: "…" }));

  let topicsExpanded = false;
  let data;
  // #98: the calendar day whose line is shown; today until she taps another.
  let pickedDay;

  load();

  async function load() {
    try {
      data = await api.stats();
    } catch (err) {
      // Same shape as Browse and Settings: told apart in what it says, not in
      // how alarming it looks — a background fetch failing is not a mistake
      // she made, offline or not (§25 and the same reasoning as `.browse-note`).
      render(
        root,
        el("div.stats-head", { text: "Statistik" }),
        el("p.stats-offline", {
          text:
            err instanceof OfflineError
              ? "Diese Zahlen kommen vom Server. Sie sind da, sobald du wieder Internet hast."
              : "Die Statistik konnte nicht geladen werden.",
        }),
      );
      return;
    }
    draw();
  }

  function draw() {
    render(
      root,
      el("div.stats-head", { text: "Statistik" }),
      el(
        "div.stats-body",
        {},
        levelBlock(),
        streakTiles(),
        jokerCard(),
        historyBlock(),
        maturityBlock(),
        topicsBlock(),
      ),
    );
  }

  // ── level ───────────────────────────────────────────────────────
  function levelBlock() {
    const { filled, remaining } = levelProgress(data);

    return el(
      "section.level",
      {},
      el(
        "div.level-row",
        {},
        el("span.level-numeral.tabular", { text: String(data.level) }),
        el(
          "div.level-meta",
          {},
          el("span.mono-label", { text: "Level" }),
          el("span.level-xp.tabular", { text: `${num(data.xp)} XP` }),
        ),
      ),
      el(
        "div.segments",
        {},
        Array.from({ length: LEVEL_SEGMENTS }, (_, i) =>
          el("span.segment", { class: i < filled ? "on" : undefined }),
        ),
      ),
      el(
        "div.level-scale",
        {},
        el("span", { text: `Level ${data.level} · ${num(data.xpForLevel)}` }),
        el("span", { text: `${num(remaining)} XP bis Level ${data.level + 1}` }),
      ),
    );
  }

  // ── streak ──────────────────────────────────────────────────────
  function streakTiles() {
    return el(
      "section.tiles",
      {},
      tile(data.streak, "Tage in Folge"),
      tile(data.longestStreak, "längste Serie", true),
    );
  }

  function tile(value, label, muted = false) {
    return el(
      "div.tile",
      {},
      el("span.tile-value.tabular", { class: muted ? "muted" : undefined, text: num(value) }),
      el("span.tile-label", { text: label }),
    );
  }

  // ── jokers ──────────────────────────────────────────────────────
  function jokerCard() {
    const held = data.jokers;
    const full = held >= 3;

    return el(
      "section.jokers",
      {},
      el(
        "div.jokers-head",
        {},
        el("span.jokers-title", { text: "Joker" }),
        el("span.jokers-count", { text: `${held} von 3` }),
      ),
      el(
        "div.joker-slots",
        {},
        // A diamond is the only diamond in the app: circles are stations, bars
        // are progress, and a joker is neither.
        Array.from({ length: 3 }, (_, i) =>
          i < held
            ? el("span.slot.filled", {}, el("span.diamond"))
            : el("span.slot.empty"),
        ),
      ),
      el("p.jokers-note", {
        text: full
          ? "Voll. Weitere Tage am Stück bringen nichts, bis einer verbraucht ist."
          : "Einer für je fünf Tage am Stück, höchstens drei. Ein verpasster Tag verbraucht einen, und die Serie läuft weiter.",
      }),
    );
  }

  // ── history ─────────────────────────────────────────────────────
  /**
   * Which days she practised, and how much (#98). design/ has no screen for
   * this — it came from comparing Noji, which shows an activity calendar — so
   * it borrows what this screen already has: the grey-to-white ramp, the
   * dashed slot a spent joker leaves, and a line of text for the one number a
   * tap asks about, rather than a tooltip a phone cannot hover.
   *
   * Placed under the jokers because it is the streak's evidence: a filled day
   * is one that counted, and a dashed one is a day a joker covered.
   */
  function historyBlock() {
    const history = data.history ?? [];
    if (history.length === 0) return null;

    const perDay = data.reviewsPerQualifyingDay;
    const today = history.at(-1).day;
    const yesterday = history.at(-2)?.day;
    const picked = history.find((d) => d.day === pickedDay) ?? history.at(-1);
    const practised = daysPractised(history);
    const detail = el("p.history-detail", { "aria-live": "polite", text: dayDetail(picked, perDay, today, yesterday) });

    // A tap changes the pressed day and the line under the grid in place.
    // Redrawing the screen would reset its scroll and drop the focus from
    // the button she just pressed.
    const pick = (entry, button) => {
      pickedDay = entry.day;
      for (const b of button.parentNode.querySelectorAll("button.history-day")) b.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-pressed", "true");
      detail.textContent = dayDetail(entry, perDay, today, yesterday);
    };

    return el(
      "section.history",
      {},
      el(
        "div.section-head",
        {},
        el("span.section-title", { text: "Verlauf" }),
        el("span.section-count", {
          text: `${practised} ${practised === 1 ? "Tag" : "Tage"} geübt`,
        }),
      ),
      el(
        "div.history-grid",
        { role: "group", "aria-label": `Die letzten ${calendarWeeks(history).length} Wochen` },
        WEEKDAYS.map((w) => el("span.history-weekday", { "aria-hidden": "true", text: w })),
        calendarWeeks(history).flat().map((entry) =>
          entry
            ? el(
                "button.history-day",
                {
                  type: "button",
                  class: [dayKind(entry, perDay), entry.day === today ? "today" : ""].filter(Boolean).join(" "),
                  "aria-pressed": String(entry === picked),
                  "aria-label": dayDetail(entry, perDay, today, yesterday),
                  onclick: (e) => pick(entry, e.currentTarget),
                },
                el("span.history-date.tabular", { text: String(dayOfMonth(entry.day)) }),
              )
            : el("span.history-day.future", { "aria-hidden": "true" }),
        ),
      ),
      detail,
      el(
        "div.history-legend",
        {},
        legendItem("counted", `ab ${perDay} Wiederholungen`),
        legendItem("some", "weniger"),
        legendItem("joker", "Joker"),
      ),
    );
  }

  function legendItem(kind, label) {
    return el(
      "span.history-legend-item",
      {},
      el("span.history-swatch", { class: kind }),
      el("span", { text: label }),
    );
  }

  // ── maturity ────────────────────────────────────────────────────
  function maturityBlock() {
    const counts = data.maturity;
    const total = MATURITY.reduce((n, b) => n + (counts[b.key] ?? 0), 0);

    // 31's note names this as one of browse's two entry points. The whole row
    // is the target rather than a separate control: "Cards seen" and the
    // number are already the thing she would tap to go and look at them.
    const head = el(
      onBrowse ? "button.section-head.tappable" : "div.section-head",
      onBrowse ? { type: "button", onclick: onBrowse } : {},
      el("span.section-title", { text: "Karten gesehen" }),
      el("span.section-value.tabular", { text: num(data.cardsSeen) }),
      onBrowse ? el("span.section-chevron", { text: "›" }) : null,
    );

    // Day one: the shape of the screen should not change between day one and
    // day one hundred, so the block stays and only its contents become a
    // sentence.
    if (total === 0) {
      return el(
        "section.maturity",
        {},
        head,
        el("div.maturity-empty"),
        el("p.section-note", { text: "Noch nichts wiederholt. Die Balken füllen sich, wenn sich Karten festigen." }),
      );
    }

    return el(
      "section.maturity",
      {},
      head,
      el(
        "div.maturity-bar",
        {},
        MATURITY.filter((b) => counts[b.key] > 0).map((b, i, shown) =>
          el("span", {
            style: {
              width: `${((counts[b.key] / total) * 100).toFixed(2)}%`,
              background: b.colour,
              borderTopLeftRadius: i === 0 ? "4px" : "0",
              borderBottomLeftRadius: i === 0 ? "4px" : "0",
              borderTopRightRadius: i === shown.length - 1 ? "4px" : "0",
              borderBottomRightRadius: i === shown.length - 1 ? "4px" : "0",
            },
          }),
        ),
      ),
      el(
        "div.maturity-legend",
        {},
        MATURITY.map((b) =>
          el(
            "div.legend-row",
            {},
            el("span.swatch", { style: { background: b.colour } }),
            el("span.legend-label", { text: b.label }),
            el("span.legend-value.tabular", { text: num(counts[b.key] ?? 0) }),
          ),
        ),
      ),
    );
  }

  // ── topics ──────────────────────────────────────────────────────
  function topicsBlock() {
    const { seen, shown, hidden } = visibleTopics(data.topics, topicsExpanded);

    const head = el(
      "div.section-head",
      {},
      el("span.section-title", { text: "Themen" }),
      seen.length > TOPICS_BEFORE_TRUNCATION
        ? el("span.section-count", { text: String(seen.length) })
        : null,
    );

    if (seen.length === 0) {
      return el(
        "section.topics",
        {},
        head,
        el("p.section-note", {
          text: "Ein Thema erscheint, sobald du eine Karte daraus wiederholt hast.",
        }),
      );
    }

    return el(
      "section.topics",
      { class: topicsExpanded ? "expanded" : undefined },
      head,
      shown.map(topicRow),
      hidden > 0 || topicsExpanded
        ? el(
            "button.topics-toggle",
            {
              type: "button",
              onclick: () => {
                topicsExpanded = !topicsExpanded;
                draw();
              },
            },
            el("span.line"),
            el("span.text", { text: topicsExpanded ? "Weniger zeigen" : `${hidden} weitere` }),
            el("span.line"),
          )
        : null,
    );
  }

  function topicRow(topic) {
    const pct = topic.total > 0 ? (topic.seen / topic.total) * 100 : 0;
    // The end dot is clamped inside the track, so at 0-3% or 98-100% it is
    // never half off the edge.
    const dotLeft = Math.min(Math.max(pct, 0), 100);
    const clamp = endDotOffset(pct);

    return el(
      "div.topic",
      {},
      el(
        "div.topic-head",
        {},
        el("span.topic-name", { text: topicLabel(topic.tag) }),
        el("span.topic-count", { text: `${num(topic.seen)} / ${num(topic.total)}` }),
      ),
      el(
        "div.topic-bar",
        {},
        el("span.track"),
        el("span.fill", { style: { width: `${pct.toFixed(1)}%` } }),
        el("span.end-dot", { style: { left: `${dotLeft.toFixed(1)}%`, marginLeft: clamp } }),
      ),
    );
  }

  return root;
}
