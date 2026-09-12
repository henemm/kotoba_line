import { OfflineError, api } from "../api.js";
import { el, num, render } from "../ui/dom.js";

/** The level bar is drawn as twelve segments however far apart the levels are. */
const LEVEL_SEGMENTS = 12;

/** Past this many topics the list truncates behind a rule (design 02, 24). */
const TOPICS_BEFORE_TRUNCATION = 5;

const MATURITY = [
  { key: "new", label: "New", colour: "#39415A" },
  { key: "learning", label: "Learning", colour: "#5E6884" },
  { key: "young", label: "Young", colour: "#97A0B8" },
  { key: "mature", label: "Mature", colour: "#F2F4F8" },
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
  const seen = (topics ?? []).filter((t) => t.seen > 0);
  const shown = expanded ? seen : seen.slice(0, limit);
  return { seen, shown, hidden: seen.length - shown.length };
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
        el("div.stats-head", { text: "Stats" }),
        el("p.stats-offline", {
          text:
            err instanceof OfflineError
              ? "These numbers come from the server. They will be here when the connection is."
              : "Could not load stats.",
        }),
      );
      return;
    }
    draw();
  }

  function draw() {
    render(
      root,
      el("div.stats-head", { text: "Stats" }),
      el(
        "div.stats-body",
        {},
        levelBlock(),
        streakTiles(),
        jokerCard(),
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
        el("span", { text: `level ${data.level} · ${num(data.xpForLevel)}` }),
        el("span", { text: `${num(remaining)} XP to level ${data.level + 1}` }),
      ),
    );
  }

  // ── streak ──────────────────────────────────────────────────────
  function streakTiles() {
    return el(
      "section.tiles",
      {},
      tile(data.streak, "day streak"),
      tile(data.longestStreak, "longest", true),
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
        el("span.jokers-title", { text: "Jokers" }),
        el("span.jokers-count", { text: `${held} of 3` }),
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
          ? "Full. Further consecutive days earn nothing until one is spent."
          : "One every five days in a row, three at most. A missed day spends one and the streak keeps running.",
      }),
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
      el("span.section-title", { text: "Cards seen" }),
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
        el("p.section-note", { text: "Nothing reviewed yet. The bands fill in as cards mature." }),
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
      el("span.section-title", { text: "Topics" }),
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
          text: "Topics appear once a card carrying that tag has been reviewed.",
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
            el("span.text", { text: topicsExpanded ? "Show less" : `${hidden} more` }),
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
        el("span.topic-name", { text: topic.tag }),
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
