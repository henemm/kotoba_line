import { api } from "../api.js";
import { say, stop, unlock } from "../audio.js";
import { loadDeck, pickDistractors, shuffle } from "../deck.js";
import { modeByKey } from "../modes.js";
import { el, render } from "../ui/dom.js";

/** How long the answer stays on screen before the next card. */
const PAUSE_CORRECT = 900;
const PAUSE_WRONG = 2400;

/** §6: the multiple-choice modes give *again* on a miss and *good* on a hit. */
const RATING_AGAIN = 1;
const RATING_GOOD = 3;

const uuid = () =>
  crypto.randomUUID?.() ??
  `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-4000-8000-${Math.random()
    .toString(16)
    .slice(2, 14)}`;

/**
 * Design 16 — the session, in 選ぶ.
 *
 * The loop itself is not up for redesign, so this follows the prototype's
 * interaction feel: the card is read aloud on arrival, a wrong answer shows
 * the right one, the sentence is revealed either way, and the pause is longer
 * after a miss.
 *
 * Only 選ぶ is drawn. 聞く shares this shape and is a small change once its
 * card is designed; めくる needs four rating buttons and 話す needs its own
 * states, and neither is drawn (design/next-brief.md).
 */
export function sessionScreen({ mode = "choose", filters = {}, limit = 20, onFinish, onExit }) {
  const line = modeByKey(mode) ?? modeByKey("choose");
  const root = el("div.session", { style: { "--rail": line.colour } });
  render(root, el("div.loading", { text: "…" }));

  const started = Date.now();
  let deck;
  let pool = [];
  let queue = [];
  let index = 0;
  let right = 0;
  const missed = [];
  const results = []; // one entry per card, for the station strip afterwards
  const events = [];
  let before;

  begin();

  async function begin() {
    try {
      const [loaded, q, snapshot] = await Promise.all([
        loadDeck(),
        api.queue({ ...filters, mode, limit }),
        api.stats().catch(() => undefined),
      ]);
      deck = loaded;
      before = snapshot;
      // Wrong answers are drawn from the whole deck, not from the session —
      // twenty cards is far too small a pool to find plausible ones in.
      pool = [...deck.values()];
      queue = q.cardIds.map((id) => deck.get(id)).filter(Boolean);
    } catch {
      render(
        root,
        el("div.session-error", {},
          el("p", { text: "Could not start a session — the deck is not here yet." }),
          el("button.btn-secondary", { type: "button", text: "Back", onclick: onExit }),
        ),
      );
      return;
    }

    if (queue.length === 0) {
      onFinish?.({ empty: true });
      return;
    }
    drawCard();
  }

  // ── chrome ──────────────────────────────────────────────────────
  function chrome() {
    return el(
      "div.session-chrome",
      {},
      el("button.session-close", {
        type: "button",
        "aria-label": "Leave the session",
        text: "×",
        onclick: () => {
          stop();
          onExit?.();
        },
      }),
      el(
        "div.stations",
        {},
        queue.map((_, i) =>
          el("span.station", {
            class:
              results[i] === false
                ? "missed"
                : results[i] === true
                  ? "done"
                  : i === index
                    ? "now"
                    : undefined,
          }),
        ),
      ),
      el("span.session-counter.tabular", {
        text: `${Math.min(index + 1, queue.length)}/${queue.length}`,
      }),
    );
  }

  // ── one card ────────────────────────────────────────────────────
  function drawCard() {
    const card = queue[index];
    const area = el("div.card-area");
    const answers = el("div.options");

    render(root, chrome(), area, answers);

    render(
      area,
      el("span.prompt-label", { text: "What does this mean?" }),
      el("h2.word.jp", { text: card.word }),
      el("button.speaker.ghost", {
        type: "button",
        "aria-label": "Read aloud",
        text: "♪",
        onclick: () => say(card.word, card.word_audio),
      }),
    );

    unlock();
    say(card.word, card.word_audio);

    const options = shuffle([card, ...pickDistractors(card, pool)]);

    render(
      answers,
      options.map((option) =>
        el("button.opt", {
          type: "button",
          text: option.word_meaning,
          onclick: (e) => answer(card, option, e.currentTarget, answers, area),
        }),
      ),
    );
  }

  function answer(card, option, button, answers, area) {
    const correct = option.id === card.id;

    for (const b of answers.children) {
      b.disabled = true;
      b.classList.add("dim");
    }
    button.classList.remove("dim");
    button.classList.add(correct ? "right" : "wrong");

    if (!correct) {
      const rightButton = [...answers.children].find(
        (b) => b.textContent === card.word_meaning,
      );
      rightButton?.classList.remove("dim");
      rightButton?.classList.add("right");
    }

    results[index] = correct;
    if (correct) right += 1;
    else if (!missed.some((m) => m.id === card.id)) missed.push(card);

    events.push({
      id: uuid(),
      card_id: card.id,
      mode,
      rating: correct ? RATING_GOOD : RATING_AGAIN,
      reviewed_at: Math.floor(Date.now() / 1000),
    });

    if (card.sentence) {
      say(card.sentence, card.sentence_audio, { rate: 0.85 });
      area.append(revealedSentence(card));
    }

    // Redraw the strip so the marker just answered takes its colour.
    root.replaceChild(chrome(), root.firstChild);

    setTimeout(next, correct ? PAUSE_CORRECT : PAUSE_WRONG);
  }

  function revealedSentence(card) {
    const p = el("p.sentence.jp.reveal");
    // The deck marks the target word with <b>; the prototype guessed at it by
    // stripping a trailing kana, which misfires on conjugations. Rendered as
    // text plus one element, never as parsed markup.
    for (const part of splitEmphasis(card.sentence)) {
      p.append(part.bold ? el("b", { text: part.text }) : document.createTextNode(part.text));
    }
    return p;
  }

  function next() {
    index += 1;
    if (index >= queue.length) return finish();
    drawCard();
  }

  async function finish() {
    stop();

    let accepted = false;
    let after;
    try {
      await api.events(events);
      accepted = true;
      after = await api.stats();
    } catch {
      // Phase 5 gives this an outbox; for now the summary says what happened.
    }

    // §8a: the client displays progress and never computes it. The figure on
    // the summary is the difference between two server answers, so it cannot
    // disagree with the Stats screen. Offline it is simply absent rather than
    // guessed at.
    const xpGained = before && after ? after.xp - before.xp : undefined;
    const levelUp =
      before && after && after.level > before.level
        ? {
            from: before.level,
            to: after.level,
            xp: after.xp,
            cardsSince: after.cardsSeen - before.cardsSeen,
          }
        : undefined;

    onFinish?.({
      mode,
      total: queue.length,
      right,
      missed,
      results,
      seconds: Math.round((Date.now() - started) / 1000),
      newCards: newCardsIn(after, before),
      synced: accepted,
      xpGained,
      levelUp,
    });
  }

  /** Cards met for the first time in this session, as the server counts them. */
  function newCardsIn(after, beforeStats) {
    if (!after || !beforeStats) return 0;
    return Math.max(0, after.cardsSeen - beforeStats.cardsSeen);
  }

  root.destroy = stop;
  return root;
}

/**
 * Split Kaishi's `<b>`-marked sentence into runs, so the emphasis can be
 * rebuilt as elements instead of being handed to innerHTML.
 */
export function splitEmphasis(sentence) {
  const parts = [];
  const re = /<b>(.*?)<\/b>/gi;
  let last = 0;
  let m;
  while ((m = re.exec(sentence ?? "")) !== null) {
    if (m.index > last) parts.push({ text: sentence.slice(last, m.index), bold: false });
    parts.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < (sentence ?? "").length) parts.push({ text: sentence.slice(last), bold: false });
  return parts.filter((p) => p.text.length > 0);
}
