import { api } from "../api.js";
import { say, stop, unlock } from "../audio.js";
import { loadDeck, pickDistractors, shuffle } from "../deck.js";
import { modeByKey } from "../modes.js";
import { flush, record } from "../outbox.js";
import { sessionQueue } from "../queue.js";
import { el, render } from "../ui/dom.js";

/** How long the answer stays on screen before the next card. */
const PAUSE_CORRECT = 900;
const PAUSE_WRONG = 2400;

/**
 * §6: the multiple-choice modes give *again* on a miss and *good* on a hit;
 * the self-graded modes give *again* and *good*; and *hard* and *easy* are
 * offered only in めくる, where she is already making a judgement.
 */
const RATING_AGAIN = 1;
const RATING_HARD = 2;
const RATING_GOOD = 3;
const RATING_EASY = 4;

/**
 * What counts as recalled, for the station strip and the summary's tally.
 *
 * Anything above *again* is a successful recall — that is what FSRS means by
 * it, and *hard* is "I got there, with effort", not a miss. Counting hard as
 * wrong would put a card she knew into "worth another look".
 */
export const recalled = (rating) => rating > RATING_AGAIN;

const uuid = () =>
  crypto.randomUUID?.() ??
  `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-4000-8000-${Math.random()
    .toString(16)
    .slice(2, 14)}`;

/**
 * Design 16 and the prototype — the session, in all four modes.
 *
 * The loop is not up for redesign: `prototype/kotoba-line.html` is the agreed
 * visual direction and it already works out all four, so this follows its
 * interaction feel rather than waiting for a canvas frame per mode. The card
 * is read aloud on arrival, a wrong answer shows the right one, the sentence
 * is revealed either way, and the pause is longer after a miss.
 *
 * What the canvas genuinely does not settle is a handful of *states*, and
 * those are decided here and listed in design/README.md: what 聞く does with a
 * card it cannot play, and what 話す shows when speech recognition is absent,
 * refused, or hears nothing.
 */
export function sessionScreen({
  mode = "choose",
  filters = {},
  limit = 20,
  readAloud = true,
  onFinish,
  onExit,
}) {
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
  let answered = 0;
  let before;

  begin();

  async function begin() {
    try {
      const [loaded, q, snapshot] = await Promise.all([
        loadDeck(),
        sessionQueue({ ...filters, mode, limit }),
        api.stats().catch(() => undefined),
      ]);
      deck = loaded;
      before = snapshot;
      // Wrong answers are drawn from the whole deck, not from the session —
      // twenty cards is far too small a pool to find plausible ones in.
      pool = [...deck.values()];
      const due = q.cardIds.map((id) => deck.get(id)).filter(Boolean);
      queue = playableIn(mode, due);

      // 聞く dropped everything it was given: the cards are due, they just
      // cannot be listened to. That is a different message from "nothing due".
      if (due.length > 0 && queue.length === 0) {
        render(
          root,
          el("div.session-error", {},
            el("p", { text: `Nothing here can be played in ${line.jp}. The cards that are due have no sentence to listen to.` }),
            el("button.btn-secondary", { type: "button", text: "Back", onclick: onExit }),
          ),
        );
        return;
      }

      // Offline and this combination of filters was never fetched while
      // online. Saying so beats bouncing silently back to the tab, because
      // "nothing due" and "never asked" are different facts.
      if (q.never && queue.length === 0) {
        render(
          root,
          el("div.session-error", {},
            el("p", { text: "Offline, and this hasn't been practised online yet — so there is nothing here to run." }),
            el("button.btn-secondary", { type: "button", text: "Back", onclick: onExit }),
          ),
        );
        return;
      }
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
          stopRecognition();
          // The answers so far are already in the outbox; this only asks for
          // them to go up now rather than at the next flush.
          if (answered > 0) flush().catch(() => {});
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
    // §7: iOS produces no sound from speech synthesis until a user gesture has
    // happened, and every mode here may reach for it.
    unlock();

    ({ choose: drawChoose, listen: drawListen, speak: drawSpeak, flip: drawFlip }[mode] ??
      drawChoose)(card, area, answers);
  }

  /**
   * Record the answer and move on.
   *
   * Every mode ends here, whatever it asked. The pause differs: after a
   * multiple-choice answer she is reading the correction, so the screen holds;
   * after a self-grade she has already read it, so it does not.
   */
  function grade(card, rating, pause = 0) {
    const ok = recalled(rating);
    results[index] = ok;
    if (ok) right += 1;
    else if (!missed.some((m) => m.id === card.id)) missed.push(card);

    const event = {
      id: uuid(),
      card_id: card.id,
      mode,
      rating,
      reviewed_at: Math.floor(Date.now() / 1000),
    };
    answered += 1;

    // §4: "every answered card produces an event that goes *immediately* into
    // an IndexedDB outbox". Immediately, not at the end — otherwise closing a
    // session after fourteen cards throws away fourteen reviews, and being
    // interrupted is the normal way a session on a train ends. Not awaited:
    // the write is fast and the next card must not wait on a disk.
    record([event]).catch(() => {});

    // Redraw the strip so the marker just answered takes its colour.
    root.replaceChild(chrome(), root.firstChild);
    setTimeout(next, pause);
  }

  /**
   * A reading line, set as ruby rather than as Anki's bracket notation.
   *
   * Dropped when it carries nothing: a kana-only word like いい has a
   * "reading" identical to itself, and printing it again in grey says only
   * that the app did not notice.
   */
  function reading(furigana, word) {
    if (!furigana) return null;
    const parts = parseFurigana(furigana);
    if (!parts.some((p) => p.reading)) {
      const plain = parts.map((p) => p.text).join("");
      if (!plain || plain === word) return null;
    }
    return el("div.reading.reveal", {}, ...furiganaNodes(furigana));
  }

  function speaker(text, file, { rate, ghost = true, label = "Read aloud", big = false } = {}) {
    return el(`button.speaker${ghost ? ".ghost" : ""}${big ? ".big" : ""}`, {
      type: "button",
      "aria-label": label,
      text: "♪",
      onclick: () => say(text, file, rate ? { rate } : undefined),
    });
  }

  /** The two multiple-choice modes differ only in which gloss they read. */
  function chooseFrom(card, field, prompt, area, answers, promptNodes) {
    render(area, ...promptNodes);

    const options = shuffle([card, ...pickDistractors(card, pool, 3, Math.random, field)]);
    render(
      answers,
      options.map((option) =>
        el("button.opt", {
          type: "button",
          text: option[field],
          onclick: (e) => {
            const correct = option.id === card.id;

            for (const b of answers.children) {
              b.disabled = true;
              b.classList.add("dim");
            }
            e.currentTarget.classList.remove("dim");
            e.currentTarget.classList.add(correct ? "right" : "wrong");
            if (!correct) {
              const rightButton = [...answers.children].find((b) => b.textContent === card[field]);
              rightButton?.classList.remove("dim");
              rightButton?.classList.add("right");
            }

            if (card.sentence) {
              if (readAloud) say(card.sentence, card.sentence_audio, { rate: 0.85 });
              area.append(revealedSentence(card));
            }

            grade(card, correct ? RATING_GOOD : RATING_AGAIN, correct ? PAUSE_CORRECT : PAUSE_WRONG);
          },
        }),
      ),
    );
  }

  /** 選ぶ — see the word, pick the meaning. */
  function drawChoose(card, area, answers) {
    // "Read cards aloud" governs what happens on its own. The ♪ button still
    // works with it off — tapping it is an explicit request, and a setting
    // about automatic sound should not disable a control just pressed.
    if (readAloud) say(card.word, card.word_audio);

    chooseFrom(card, "word_meaning", null, area, answers, [
      el("span.prompt-label", { text: "What does this mean?" }),
      el("h2.word.jp", { text: card.word }),
      speaker(card.word, card.word_audio),
    ]);
  }

  /**
   * 聞く — audio only, then pick what it meant.
   *
   * This one plays whatever the sound setting says, because here the audio is
   * not a reading of the card: it *is* the question. A silent 聞く card would
   * be unanswerable.
   */
  function drawListen(card, area, answers) {
    const play = () => say(card.sentence, card.sentence_audio, { rate: 0.85 });
    play();

    chooseFrom(card, "sentence_meaning", null, area, answers, [
      el("span.prompt-label", { text: "Listen — no text" }),
      speaker(card.sentence, card.sentence_audio, {
        rate: 0.85,
        ghost: false,
        big: true,
        label: "Play it again",
      }),
      el("span.prompt-label", { text: "Tap to hear it again" }),
    ]);
  }

  /**
   * 話す — see the meaning, say it aloud, then judge yourself.
   *
   * §7: `webkitSpeechRecognition` exists in Safari but is unreliable in
   * standalone mode, so it is feature-detected and its result is *feedback,
   * never grading*. She marks the card herself either way — which also means
   * the mode works unchanged on a device that cannot listen at all.
   */
  function drawSpeak(card, area, answers) {
    const target = card.sentence ? card.sentence_meaning : card.word_meaning;
    const heard = el("div.mic-state");

    render(
      area,
      el("span.prompt-label", { text: "Say it in Japanese" }),
      el("p.meaning", { text: target ?? "" }),
      heard,
    );

    const actions = el("div.actions");
    if (recognitionAvailable()) actions.append(recordButton(card, heard));
    actions.append(
      el("button.btn.primary", {
        type: "button",
        text: "Show answer",
        onclick: () => revealSpeak(card, area, answers),
      }),
    );
    render(answers, actions);
  }

  function revealSpeak(card, area, answers) {
    stopRecognition();
    const text = card.sentence ?? card.word;
    const audio = card.sentence ? card.sentence_audio : card.word_audio;

    render(
      area,
      el("span.prompt-label", { text: card.sentence ? card.sentence_meaning : card.word_meaning }),
      card.sentence ? revealedSentence(card) : el("h2.word.jp.reveal", { text: card.word }),
      reading(
        card.sentence ? card.sentence_furigana : card.word_furigana,
        card.sentence ? undefined : card.word,
      ),
      speaker(text, audio, { rate: card.sentence ? 0.85 : undefined, ghost: false }),
    );
    if (readAloud) say(text, audio, card.sentence ? { rate: 0.85 } : undefined);

    // §6: the self-graded modes give *again* and *good*. Hard and easy belong
    // to めくる only.
    render(
      answers,
      el(
        "div.actions",
        {},
        el("button.btn.no", { type: "button", text: "Missed it", onclick: () => grade(card, RATING_AGAIN) }),
        el("button.btn.yes", { type: "button", text: "Had it", onclick: () => grade(card, RATING_GOOD) }),
      ),
    );
  }

  /** めくる — the classic flashcard, and the only mode with four ratings. */
  function drawFlip(card, area, answers) {
    render(
      area,
      el("h2.word.jp", { text: card.word }),
      speaker(card.word, card.word_audio),
    );
    if (readAloud) say(card.word, card.word_audio);

    render(
      answers,
      el(
        "div.actions",
        {},
        el("button.btn.primary", {
          type: "button",
          text: "Flip",
          onclick: () => revealFlip(card, area, answers),
        }),
      ),
    );
  }

  function revealFlip(card, area, answers) {
    render(
      area,
      el("h2.word.jp.reveal", { text: card.word }),
      reading(card.word_furigana, card.word),
      el("div.meaning.reveal", { text: card.word_meaning }),
      card.sentence ? revealedSentence(card) : null,
      card.sentence_meaning ? el("div.sentence-en.reveal", { text: card.sentence_meaning }) : null,
      speaker(card.sentence ?? card.word, card.sentence ? card.sentence_audio : card.word_audio, {
        rate: card.sentence ? 0.85 : undefined,
        ghost: false,
      }),
    );
    if (readAloud && card.sentence) say(card.sentence, card.sentence_audio, { rate: 0.85 });

    // §6: hard and easy are offered here and nowhere else, because this is the
    // one mode where she is already making a judgement.
    render(
      answers,
      el(
        "div.ratings",
        {},
        el("button.btn.rating.no", { type: "button", text: "Again", onclick: () => grade(card, RATING_AGAIN) }),
        el("button.btn.rating", { type: "button", text: "Hard", onclick: () => grade(card, RATING_HARD) }),
        el("button.btn.rating", { type: "button", text: "Good", onclick: () => grade(card, RATING_GOOD) }),
        el("button.btn.rating.yes", { type: "button", text: "Easy", onclick: () => grade(card, RATING_EASY) }),
      ),
    );
  }

  // ── 話す's microphone ───────────────────────────────────────────
  //
  // Undesigned states, decided here (design/README.md records them):
  //
  //   no recognition   the Record button is absent, not disabled — a control
  //                    that cannot ever work is worse than no control
  //   permission gone  says so once and does not ask again this session
  //   nothing heard    offers another go; never marks the card
  //
  // In every one of them the two self-grade buttons behave identically, so
  // the mode is never blocked by the microphone.

  let recogniser;
  let micRefused = false;

  function recognitionAvailable() {
    return !micRefused && ("SpeechRecognition" in globalThis || "webkitSpeechRecognition" in globalThis);
  }

  function stopRecognition() {
    try {
      recogniser?.abort();
    } catch {
      /* already gone */
    }
    recogniser = undefined;
  }

  function recordButton(card, out) {
    const button = el("button.btn", { type: "button", text: "Record" });
    button.addEventListener("click", () => listenOnce(card, out, button));
    return button;
  }

  function listenOnce(card, out, button) {
    const SR = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition;
    stopRecognition();

    const rec = new SR();
    recogniser = rec;
    rec.lang = "ja-JP";
    rec.interimResults = false;
    rec.maxAlternatives = 3;

    button.textContent = "Listening…";
    out.className = "mic-state";
    out.textContent = "…";

    const strip = (s) => (s ?? "").replace(/[。、！？\s]/g, "");
    const target = strip(plainSentence(card.sentence) ?? card.word);
    const word = strip(card.word);

    rec.onresult = (e) => {
      const alternatives = [...e.results[0]].map((r) => strip(r.transcript));
      const hit = alternatives.some(
        (h) => h === target || (h.length > 1 && (target.includes(h) || h.includes(word))),
      );
      // Feedback, not grading (§7): this colours the line she said and nothing
      // else. The card is still hers to mark.
      out.className = `mic-state ${hit ? "hit" : "miss"}`;
      out.textContent = e.results[0][0].transcript;
      button.textContent = "Again";
    };

    rec.onerror = (e) => {
      out.className = "mic-state";
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        // Refused for the session. Asking again on every card would be nagging
        // about something only Settings can undo.
        micRefused = true;
        out.textContent = "No microphone — mark it yourself below.";
        button.remove();
        return;
      }
      out.textContent = e.error === "no-speech" ? "Nothing heard" : "Could not listen";
      button.textContent = "Again";
    };

    rec.onend = () => {
      if (button.isConnected && button.textContent === "Listening…") button.textContent = "Record";
    };

    try {
      rec.start();
    } catch {
      out.textContent = "Could not listen";
      button.textContent = "Record";
    }
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

    // Every answer was written to the outbox as it happened, so there is
    // nothing to record here — only to send.
    let accepted = false;
    let after;
    try {
      const result = await flush();
      accepted = result.remaining === 0;
      if (accepted) after = await api.stats();
    } catch {
      // The events are on disk either way; the summary says what happened.
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

  root.destroy = () => {
    stop();
    stopRecognition();
  };
  return root;
}

/**
 * Kaishi stores readings the way Anki writes them: `事[こと]`, and for a
 * sentence ` 兄[あに]は 毎日[まいにち]テレビを 見[み]ます。` — a space before each
 * annotated run, which is a separator and not a space in the text.
 *
 * Shown raw it reads as brackets, which is how めくる looked before this. Split
 * into runs so it can be built as real `<ruby>` elements.
 */
export function parseFurigana(text) {
  const parts = [];
  const re = /([^\s[\]]+)\[([^\]]+)\]/g;
  let last = 0;
  let m;
  while ((m = re.exec(text ?? "")) !== null) {
    if (m.index > last) {
      // The space Anki puts before an annotated run is a separator, not text.
      const between = text.slice(last, m.index).replace(/[ 　]$/, "");
      if (between) parts.push({ text: between });
    }
    parts.push({ base: m[1], reading: m[2] });
    last = m.index + m[0].length;
  }
  if (last < (text ?? "").length) {
    const rest = text.slice(last);
    if (rest) parts.push({ text: rest });
  }
  return parts;
}

/** The same, as DOM — text and elements, never innerHTML. */
export function furiganaNodes(text, make = el) {
  return parseFurigana(text).map((part) =>
    part.reading
      ? make("ruby", {}, document.createTextNode(part.base), make("rt", { text: part.reading }))
      : document.createTextNode(part.text),
  );
}

/** The sentence without the deck's `<b>` marking, for comparing what was said. */
export function plainSentence(sentence) {
  return sentence == null ? undefined : splitEmphasis(sentence).map((p) => p.text).join("");
}

/**
 * Cards a mode can actually ask about.
 *
 * 聞く is the strict one: the audio *is* the prompt and the answer is the
 * sentence gloss, so a card with no sentence, no gloss, or nothing that could
 * produce sound is unanswerable rather than merely awkward. Dropping it before
 * the session starts is better than drawing a card with no question on it.
 *
 * `canSpeak` is speech synthesis, which stands in wherever a recording is
 * missing — one card in the current deck has no word audio, and the whole
 * personal deck will have none.
 */
export function playableIn(mode, cards, canSpeak = typeof speechSynthesis !== "undefined") {
  if (mode !== "listen") return cards;
  return cards.filter(
    (c) => c.sentence && c.sentence_meaning && (c.sentence_audio || canSpeak),
  );
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
