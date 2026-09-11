import { api } from "../api.js";
import { say, stop, unlock } from "../audio.js";
import { loadDeck, pickDistractors, shuffle } from "../deck.js";
import { modeByKey } from "../modes.js";
import { flush, record } from "../outbox.js";
import { accentLabel, accentsOf, contour } from "../pitch.js";
import { sessionQueue } from "../queue.js";
import { forget, remember } from "../resume.js";
import { setMeta } from "../store.js";
import { el, render } from "../ui/dom.js";

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

/**
 * 45 and 46 — the same layout, different copy. The situation is identical from
 * her side, which is why neither reads like an error and neither offers a link
 * into iOS Settings: iOS cannot deep-link there reliably, and a dead link is
 * worse than a sentence.
 */
/**
 * Screen 50's sentence, which answers the only real question — whether the
 * work counts. The count is exact because a vague "your answers are saved"
 * is exactly the reassurance nobody believes.
 */
export function leavingCopy(answered) {
  const subject =
    answered === 1 ? "The card you answered is" : `The ${answered} cards you answered are`;
  return `${subject} already saved. The rest go back in the queue.`;
}

/** Whether this device can read anything aloud at all (47's last sentence). */
export const canSpeak = () =>
  typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined";

/** 47: said plainly, because a synthetic voice mistaken for a recording
 *  teaches the wrong pronunciation. */
const SYNTH_CAPTION = "No recording for this card — read by the phone's Japanese voice";

const MIC_COPY = {
  refused:
    "The microphone is off, so say it out loud and grade yourself. You can turn it on in iOS Settings.",
  unsupported:
    "This device can't listen. Say it out loud anyway — the mode works the same, you just grade yourself unaided.",
};

/**
 * An interval the way screen 41 prints it: `<1m`, `8m`, `2d`, `6d`, `3mo`.
 *
 * Coarse on purpose. The number is there to be compared with the three beside
 * it, not to be relied on to the minute, and a button that reads "2.4d" invites
 * a precision the scheduler does not claim.
 */
export function formatInterval(seconds) {
  if (seconds == null) return undefined;
  if (seconds < 60) return "<1m";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(seconds / 3600);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(seconds / 86400);
  if (days < 30) return `${days}d`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.round(days / 365)}y`;
}

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
  chosenLabel,
  limit = 20,
  readAloud = true,
  pitchAccent = false,
  // 51: a session she left. The queue and the position are restored; the
  // answers she already gave are in the outbox and never came from here.
  resuming,
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
  let intervals = {};   // card id → { 1..4: seconds }, for めくる's rating row
  // The pending move to the next card in 選ぶ and 聞く. Held here rather than
  // left anonymous so a replay can push it back (#32) and so leaving the
  // session cancels it — an orphaned timer redraws a screen that is gone.
  let advanceTimer;
  // When the card currently on screen became answerable — the moment a
  // choice/rating appears, which in 聞く and めくる is also when the sentence
  // starts playing. Diagnostic only: how long between that and a grade.
  let revealedAt;
  // Card ids she has starred, for the ★ in the chrome (#35). Comes down with
  // the queue, because the cached deck is public and cannot carry it.
  let starred = new Set();

  /**
   * 45 and 46 look identical to her — "the distinction between refused and
   * unsupported matters to the developer, not to her" — but the copy differs,
   * so the state does too. Feature-detected once, at session start.
   */
  let micState =
    "SpeechRecognition" in globalThis || "webkitSpeechRecognition" in globalThis
      ? "ready"
      : "unsupported";
  let micNoticeShown = false;

  begin();

  async function begin() {
    try {
      const [loaded, q, snapshot] = await Promise.all([
        loadDeck(),
        // Resuming still asks, for めくる's intervals — but the card ids it
        // returns are ignored in favour of the ones she was already working
        // through. Re-composing the queue would silently swap her session for
        // a different one under the same name.
        sessionQueue({ ...filters, mode, limit }),
        api.stats().catch(() => undefined),
      ]);
      deck = loaded;
      before = snapshot;
      // Wrong answers are drawn from the whole deck, not from the session —
      // twenty cards is far too small a pool to find plausible ones in.
      pool = [...deck.values()];
      intervals = q.intervals ?? {};
      starred = new Set(q.starred ?? []);
      const ids = resuming?.cardIds ?? q.cardIds;
      const due = ids.map((id) => deck.get(id)).filter(Boolean);
      queue = playableIn(mode, due);
      if (resuming) index = Math.min(resuming.index ?? 0, Math.max(queue.length - 1, 0));

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
        onclick: askToLeave,
      }),
      el(
        "div.strip",
        {},
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
        // 39: the lightest thing that says "this queue is yours". Dashed
        // because the route is provisional — the scheduler did not lay it.
        // It disappears entirely on an ordinary session.
        chosenLabel
          ? el(
              "div.chosen-rule",
              {},
              el("span.dash"),
              el("span.chosen-text", { text: `Your set · ${chosenLabel}` }),
              el("span.dash.long"),
            )
          : null,
      ),
      starButton(),
      el("span.session-counter.tabular", {
        text: `${Math.min(index + 1, queue.length)}/${queue.length}`,
      }),
    );
  }

  /**
   * Star the card she is looking at (#35).
   *
   * Reported as "ich möchte in jedem Bereich selbst Favoriten anlegen können".
   * Before this the ★ existed only in Browse, and Browse was reachable only
   * from Stats and Settings — so the one moment she wants to mark a word, the
   * moment she meets it, was the one place she could not.
   *
   * In the chrome rather than on the card, and drawn on every mode: the card
   * area is redrawn on every reveal and belongs to the question, while this
   * belongs to the card and must not move or vanish under her thumb.
   */
  function starButton() {
    const card = queue[index];
    if (!card) return null;
    const on = starred.has(card.id);

    const button = el("button.session-star", {
      type: "button",
      class: on ? "on" : undefined,
      "aria-label": on ? `Unstar ${card.word}` : `Star ${card.word}`,
      "aria-pressed": String(on),
      text: on ? "★" : "☆",
    });

    button.addEventListener("click", async () => {
      const wanted = !starred.has(card.id);
      // 32's rule, the same here: the tap writes and the mark changes under
      // her hand — that is the whole confirmation.
      paint(wanted);
      try {
        await api.star(card.id, wanted);
      } catch {
        // Put it back rather than leave a star the server does not have.
        // Offline this is what happens, and it is the honest outcome: the
        // outbox carries answers, not stars, and a star that silently failed
        // would be worse than one that visibly did not take.
        paint(!wanted);
      }
    });

    function paint(on) {
      if (on) starred.add(card.id);
      else starred.delete(card.id);
      button.textContent = on ? "★" : "☆";
      button.classList.toggle("on", on);
      button.setAttribute("aria-pressed", String(on));
      button.setAttribute("aria-label", `${on ? "Unstar" : "Star"} ${card.word}`);
    }

    return button;
  }

  /**
   * Screen 50. The × asks once — and only once there is something to lose.
   *
   * "Before the first answer there is no sheet at all: leaving costs nothing,
   * so it just leaves." Keep going is the primary, because the tap that opened
   * this was often a mistake.
   */
  function askToLeave() {
    stop();
    stopRecognition();
    // Deliberately not cancelling the pending advance: "Keep going" has to
    // land her back in a session that still moves, and the card behind the
    // sheet is one she has already answered.

    if (answered === 0) return leave();

    const sheet = el(
      "div.sheet-scrim",
      { onclick: (e) => e.target === e.currentTarget && sheet.remove() },
      el(
        "div.sheet",
        {},
        el("h2.sheet-title", { text: "Leave this session?" }),
        el("p.sheet-body", { text: leavingCopy(answered) }),
        el(
          "div.sheet-actions",
          {},
          el("button.btn", { type: "button", text: "Leave", onclick: leave }),
          el("button.btn.solid", {
            type: "button",
            text: "Keep going",
            onclick: () => sheet.remove(),
          }),
        ),
      ),
    );
    root.append(sheet);
  }

  function leave() {
    // A pending advance would fire into a screen that no longer exists, draw a
    // card into a detached node, and — at the end of the queue — call finish()
    // on a session she has already left.
    clearTimeout(advanceTimer);
    advanceTimer = undefined;

    // The answers are already in the outbox (§4); this only asks for them to
    // go up now rather than at the next flush.
    if (answered > 0) flush().catch(() => {});
    onExit?.();
  }

  // ── one card ────────────────────────────────────────────────────

  function drawCard() {
    const card = queue[index];
    const area = el("div.card-area");
    const answers = el("div.options");

    revealedAt = Date.now();
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
   * Every mode ends here, whatever it asked. `pause` decides how: a number
   * schedules the departure (めくる and 話す pass 0 — tapping a rating already
   * is her decision to move on); `null` schedules nothing at all, because the
   * caller is going to ask her first (#57 — see `chooseFrom`'s "Continue").
   */
  function grade(card, rating, pause = 0, tapEvent) {
    const ok = recalled(rating);
    results[index] = ok;
    if (ok) right += 1;
    else if (!missed.some((m) => m.id === card.id)) missed.push(card);

    // #57: a card was reported to advance in 聞く with no tap at all, right as
    // the sentence finished — not reproducible from here, so the device
    // records what actually triggered the grade instead. `trusted` alone
    // under-discriminates (VoiceOver and Switch Control activations are also
    // trusted), so this also keeps where the event landed and its `detail`:
    // a finger lands at varying coordinates with `detail: 1`; a synthetic or
    // assistive-technology activation tends to report `0,0` or the element's
    // centre, often with `detail: 0`. `active` is what still has focus, in
    // case this is a focus-plus-activation path rather than a touch at all.
    // Settings' diagnostics shows the last one. Remove once #57 is settled.
    setMeta("diag.lastGrade", {
      mode,
      rating,
      cardId: card.id,
      trusted: tapEvent?.isTrusted ?? null,
      x: tapEvent?.clientX ?? null,
      y: tapEvent?.clientY ?? null,
      detail: tapEvent?.detail ?? null,
      active: document.activeElement?.className || null,
      ms: revealedAt ? Date.now() - revealedAt : null,
      at: Math.floor(Date.now() / 1000),
    }).catch(() => {});

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

    // 51: where she is, kept for the next start. Written after the answer is
    // recorded, so a session note can never claim progress the outbox has not.
    remember({
      mode,
      filters,
      chosenLabel,
      cardIds: queue.map((c) => c.id),
      index: index + 1,
    }).catch(() => {});

    // Redraw the strip so the marker just answered takes its colour.
    root.replaceChild(chrome(), root.firstChild);
    clearTimeout(advanceTimer);
    if (pause !== null) advanceTimer = setTimeout(next, pause);
  }

  /**
   * The reading, as one kana line in the mode colour.
   *
   * Screen 41 draws it that way — 大丈夫 with だいじょうぶ under it — rather
   * than as ruby over the kanji. Ruby was the first build's idea and it is
   * not what was drawn: at 56px the word is already the largest thing on the
   * card, and a second annotated copy of it competes with the meaning.
   *
   * Dropped when it carries nothing: a kana-only word like いい reads back as
   * itself, and repeating it says only that the app did not notice.
   */
  function reading(furigana, word, card) {
    const kana = kanaReading(furigana);
    if (!kana || kana === word) return null;
    return pitchLine(card, kana) ?? el("div.reading.reveal", { text: kana });
  }

  /**
   * The reading with its pitch contour drawn over it (#21).
   *
   * Replaces the plain reading rather than sitting beside it: they are the same
   * information, and two copies of かたい one above the other is a puzzle, not
   * a lesson.
   *
   * Off by default and behind a setting, because it is one more thing on a
   * card for someone who has not asked for it — and unreadable if you do not
   * know what the line means. On, it is the reading she was already reading.
   *
   * Returns nothing where there is no accent: her own cards have none, and the
   * deck draws none on ten single-mora words. A contour invented for those
   * would be a guess presented as a fact.
   */
  function pitchLine(card, kana) {
    if (!pitchAccent) return null;
    const accents = accentsOf(card);
    if (accents.length === 0) return null;

    // The contour drawn is the first accent; the label beside it names them
    // all. 55 of 1,500 words have two, and drawing both would double the width
    // of the line for 3.7% of cards — a dictionary prints "[2 or 0]" and draws
    // the head entry, which is the same trade and a familiar one.
    const shape = contour(kana, accents[0]);
    if (!shape) return null;

    return el(
      "div.pitch.reveal",
      {},
      el(
        "span.pitch-moras",
        {},
        shape.moras.map((mora, i) =>
          el("span.mora", { class: shape.high[i] ? "high" : undefined, text: mora }),
        ),
        // The particle is the whole point on a word like 花: はな [0] and
        // はな [2] are both low-high, and differ only in what follows. Drawn
        // as a mora of its own so the difference is visible rather than
        // asserted in a caption she would have to decode.
        //
        // ○ rather than a blank line, which is the notation these charts use
        // and which reads as "whatever comes next"; an underscore reads as a
        // field waiting to be filled in.
        el("span.mora.particle", { class: shape.particleHigh ? "high" : undefined, text: "○" }),
      ),
      el("span.pitch-number", { text: accentLabel(card) }),
    );
  }

  function speaker(text, file, { rate, ghost = true, label = "Read aloud", big = false, small = false } = {}) {
    return el(`button.speaker${ghost ? ".ghost" : ""}${big ? ".big" : ""}${small ? ".small" : ""}`, {
      type: "button",
      "aria-label": label,
      text: "♪",
      onclick: () => say(text, file, rate ? { rate } : undefined),
    });
  }

  /**
   * Where synthesis is allowed to stand in for a missing recording.
   *
   * Only where the sound is the question. In 聞く it is, so synthesis speaks
   * and 47 captions it. In 選ぶ the sound is a bonus, so a card without a
   * recording simply has no speaker (48) — the synthetic voice is not offered
   * where she is not listening for the pronunciation, which is the same
   * reasoning as 47's caption seen from the other side.
   */


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

            // #57: this used to schedule the next card on a fixed 900/2400ms
            // pause, cutting the confirmation sentence off on nearly every
            // correct answer (real recordings run 1.6-4.5s). Henning's call
            // once that was diagnosed: she should decide when to move on,
            // the same as めくる and 話す already work — so `grade` schedules
            // nothing (`pause: null`) and a "Continue" button does instead.
            grade(card, correct ? RATING_GOOD : RATING_AGAIN, null, e);
            answers.append(
              el(
                "div.actions",
                {},
                el("button.btn.primary", { type: "button", text: "Continue", onclick: () => next() }),
              ),
            );
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
      // 48: in 選ぶ the sound is a bonus, so with no recording the control is
      // absent rather than inert — "an inert button would invite a tap that
      // does nothing". No caption either, because nothing was promised, and no
      // synthesis: the synthetic voice belongs where she is listening for the
      // pronunciation, which in 選ぶ she is not.
      card.word_audio ? speaker(card.word, card.word_audio) : null,
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
      // 47: here synthesis does stand in, because the audio is the whole
      // question — and it says so, since "a synthetic voice she mistakes for a
      // recording teaches her the wrong pronunciation". Her own cards always
      // land in this state.
      card.sentence_audio
        ? el("span.prompt-label", { text: "Tap to hear it again" })
        : el("p.synth-note", { text: SYNTH_CAPTION }),
    ]);
  }

  /**
   * 話す — see the meaning, say it aloud, then judge yourself. Screens 42–46.
   *
   * §7 and screen 44 agree and the first build did not: recognition is
   * *quoted, never scored*. No tick, no colour, no yes/no — and a sentence
   * under the transcript, because "a transcript on a practice screen looks
   * like a verdict unless something says otherwise". She marks the card
   * either way, which is also why the mode is unchanged on a device that
   * cannot listen at all.
   */
  function drawSpeak(card, area, answers) {
    const prompt = card.sentence ? card.sentence_meaning : card.word_meaning;

    /**
     * `phase` is what the card is doing, not what the microphone can do:
     *   idle | listening | heard
     * 45 and 46 are not phases — they are the absence of the record control,
     * plus one sentence, and they look identical to her (46's note).
     */
    const draw = (phase, transcript) => {
      const cannotListen = micState !== "ready";
      const dimmed = phase === "heard";

      render(
        area,
        el("span.prompt-label", { text: "Say it in Japanese" }),
        el(`p.meaning${dimmed ? ".dim" : ""}`, { text: prompt ?? "" }),
        phase === "listening" ? levelBars() : null,
        phase === "listening"
          ? el("span.mic-label", { text: "Listening" })
          : null,
        phase === "heard"
          ? el(
              "div.heard",
              {},
              el("span.heard-label", { text: "Heard" }),
              el("p.heard-text.jp", {
                class: transcript ? undefined : "empty",
                text: transcript || "— nothing heard —",
              }),
            )
          : null,
        phase === "heard"
          ? el("p.mic-note", {
              text: "What the phone heard, not a mark. You decide whether you had it.",
            })
          : null,
        // 45/46: one sentence, once per session — not once per card.
        cannotListen && !micNoticeShown ? el("p.mic-note", { text: MIC_COPY[micState] }) : null,
      );
      if (cannotListen) micNoticeShown = true;

      const row = el("div.actions");
      if (!cannotListen) {
        if (phase === "listening") {
          row.append(el("button.btn", { type: "button", text: "Stop", onclick: () => stopRecognition() }));
        } else {
          row.append(
            el("button.btn", {
              type: "button",
              text: phase === "heard" ? "Again" : "Record",
              onclick: () => listenOnce(card, draw),
            }),
          );
        }
      }
      // 43: "Show answer stays available throughout."
      row.append(
        el("button.btn.primary", {
          type: "button",
          text: "Show answer",
          onclick: () => revealSpeak(card, area, answers),
        }),
      );
      render(answers, row);
    };

    draw("idle");
  }

  /** 43: six bars in the mode colour, the only animation here. */
  function levelBars() {
    return el(
      "div.level-bars",
      {},
      // Their heights are a loop rather than the microphone's real level:
      // SpeechRecognition hands over no audio stream, and opening a second
      // one with getUserMedia to measure it is unreliable next to
      // recognition on iOS. Recorded in design/README.md.
      [0, 1, 2, 3, 4, 5].map((i) => el("span", { style: { animationDelay: `${i * 90}ms` } })),
    );
  }

  function revealSpeak(card, area, answers) {
    stopRecognition();
    const text = card.sentence ?? card.word;
    const audio = card.sentence ? card.sentence_audio : card.word_audio;

    render(
      area,
      card.sentence
        ? revealedSentence(card)
        : el(
            "div.word-line.reveal",
            {},
            el("h2.word.jp", { text: card.word }),
            // 話す is the mode where hearing it back matters most: she has just
            // tried to produce it, and the recording is the only way to find
            // out whether what she said was right (#32).
            speaker(card.word, card.word_audio, { small: true, label: "Hear the word again" }),
          ),
      el("p.sentence-en.reveal", {
        text: (card.sentence ? card.sentence_meaning : card.word_meaning) ?? "",
      }),
    );
    if (readAloud) say(text, audio, card.sentence ? { rate: 0.85 } : undefined);

    // 42: same height and tints as めくる's row, half the count and no
    // intervals — 話す asks whether she could produce it, a yes-or-no question.
    render(
      answers,
      el(
        "div.ratings.two",
        {},
        ratingButton("Missed it", RATING_AGAIN, (e) => grade(card, RATING_AGAIN, undefined, e)),
        ratingButton("Had it", RATING_GOOD, (e) => grade(card, RATING_GOOD, undefined, e)),
      ),
    );
  }

  /** The four intervals for this card, already formatted. Empty when unknown. */
  function intervalsFor(card) {
    const seconds = intervals[card.id];
    if (!seconds) return {};
    return Object.fromEntries(
      Object.entries(seconds).map(([rating, s]) => [rating, formatInterval(s)]),
    );
  }

  /**
   * One rating button (41, 42).
   *
   * The tint carries the meaning and runs one way — red tint, plain, green
   * tint, solid green — "so the row reads left to right as worse to better
   * without a legend". The interval underneath is what makes four buttons
   * worth the width; 話す passes none, because a yes-or-no question has no
   * interval to compare.
   */
  function ratingButton(label, rating, onClick, interval) {
    const tone = { 1: "again", 2: "hard", 3: "good", 4: "easy" }[rating];
    return el(
      "div.rating",
      {},
      el(`button.btn.rating-${tone}`, { type: "button", text: label, onclick: onClick }),
      interval ? el("span.rating-interval", { text: interval }) : null,
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
    // Reset here, not just in drawCard: this is when the sentence starts
    // playing, and that is the moment a grade's timing is measured against.
    revealedAt = Date.now();
    render(
      area,
      el(
        "div.word-line.reveal",
        {},
        el("h2.word.jp", { text: card.word }),
        // The front of the card carries this button; before #32 the flip took
        // it away, so the one gesture that had worked a second earlier stopped
        // working exactly when the reading was finally on screen to check it
        // against.
        speaker(card.word, card.word_audio, { small: true, label: "Hear the word again" }),
      ),
      reading(card.word_furigana, card.word, card),
      el("div.meaning.reveal", { text: card.word_meaning }),
      card.sentence ? revealedSentence(card) : null,
      card.sentence_meaning ? el("div.sentence-en.reveal", { text: card.sentence_meaning }) : null,
    );
    if (readAloud && card.sentence) say(card.sentence, card.sentence_audio, { rate: 0.85 });

    // §6 and screen 41: hard and easy are offered here and nowhere else,
    // because this is the one mode where she is already making a judgement —
    // and the interval each button would give is the reason four are worth
    // the width.
    const intervals = intervalsFor(card);
    render(
      answers,
      el(
        "div.ratings",
        {},
        ratingButton("Again", RATING_AGAIN, (e) => grade(card, RATING_AGAIN, undefined, e), intervals[RATING_AGAIN]),
        ratingButton("Hard", RATING_HARD, (e) => grade(card, RATING_HARD, undefined, e), intervals[RATING_HARD]),
        ratingButton("Good", RATING_GOOD, (e) => grade(card, RATING_GOOD, undefined, e), intervals[RATING_GOOD]),
        ratingButton("Easy", RATING_EASY, (e) => grade(card, RATING_EASY, undefined, e), intervals[RATING_EASY]),
      ),
    );
  }

  // ── 話す's microphone (43–46) ────────────────────────────────────

  let recogniser;

  function stopRecognition() {
    try {
      recogniser?.abort();
    } catch {
      /* already gone */
    }
    recogniser = undefined;
  }

  /**
   * Listen once and hand the transcript back to the card, unjudged.
   *
   * Nothing here decides anything: `redraw` is given the words and the phase,
   * and screen 44 is explicit that the words are quoted rather than scored.
   * The earlier build compared them against the sentence and tinted the
   * result, which is the thing the design rules out.
   */
  function listenOnce(card, redraw) {
    const SR = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition;
    stopRecognition();

    const rec = new SR();
    recogniser = rec;
    rec.lang = "ja-JP";
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    let got;
    rec.onresult = (e) => {
      got = e.results[0][0].transcript;
    };

    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        // 45: for the rest of the session, not for this card. Asking again on
        // every card would nag about something only iOS Settings can undo.
        micState = "refused";
        micNoticeShown = false;
        redraw("idle");
        return;
      }
      // Anything else — including "no-speech" — is the empty transcript, which
      // 44 draws as the same box reading "— nothing heard —".
      got = "";
    };

    rec.onend = () => {
      recogniser = undefined;
      redraw("heard", got ?? "");
    };

    try {
      rec.start();
      redraw("listening");
    } catch {
      redraw("heard", "");
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

    // The sentence never appears without a way to hear it again.
    //
    // A deviation from screens 41 and 42, which draw the revealed card with no
    // speaker at all — reported from the phone as "keine Wiederholung des
    // Audio-Outputs möglich" (#32). The reveal is the moment she is most
    // likely to want the audio: she has just seen what the sentence means, and
    // "read cards aloud" had already played it once, before she knew. Without
    // this the only way to hear it a second time is to fail the card.
    //
    // Offered whether or not a recording exists, because that is what the
    // automatic playback beside it already does — synthesis stands in, and on
    // her own cards it is the only voice there is. 48's rule against offering
    // synthesis applies where the sound is a bonus she is not listening to;
    // here she is.
    return el(
      "div.sentence-line.reveal",
      {},
      p,
      speaker(card.sentence, card.sentence_audio, {
        rate: 0.85,
        small: true,
        label: "Hear the sentence again",
      }),
    );
  }

  function next() {
    index += 1;
    if (index >= queue.length) return finish();
    drawCard();
  }

  async function finish() {
    stop();
    // Finished sessions are not resumable, whatever the four-hour window says.
    forget().catch(() => {});

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

    // 40 needs both: which set this was, and what the real queue still holds.
    // The second is only knowable online, and its absence is what collapses
    // the two buttons into one.
    let stillDue;
    if (chosenLabel && accepted) {
      stillDue = await api
        .queue({ limit: 60 })
        .then((q) => q.available ?? q.cardIds.length)
        .catch(() => undefined);
    }

    onFinish?.({
      mode,
      chosenLabel,
      stillDue,
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

/** The whole thing as kana: `見[み]る` → `みる`. */
export function kanaReading(text) {
  if (!text) return undefined;
  return parseFurigana(text)
    .map((p) => p.reading ?? p.text)
    .join("");
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
export function playableIn(mode, cards, speaks = canSpeak()) {
  if (mode !== "listen") return cards;
  return cards.filter(
    (c) => c.sentence && c.sentence_meaning && (c.sentence_audio || speaks),
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
