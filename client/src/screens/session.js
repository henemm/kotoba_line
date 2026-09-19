import { api } from "../api.js";
import { mediaUrl, prime, say, stop, unlock } from "../audio.js";
import { deckCatchingUp, loadDeck, pickDistractors, shuffle } from "../deck.js";
import { modeByKey } from "../modes.js";
import { flush, record } from "../outbox.js";
import { accentLabel, accentsOf, contour } from "../pitch.js";
import { sessionQueue } from "../queue.js";
import { comesRoundAgain } from "../reshow.js";
import { forget, remember } from "../resume.js";
import { inScript, isKana, modeName, showsScript, shownWord, wordRomaji } from "../script.js";
import { seen } from "../seen.js";
import { setStar } from "../stars.js";
import { judge, kanaPreview, normalizeTyped, splitReadings } from "../typing.js";
import { acknowledged, el, render } from "../ui/dom.js";
import { wordSound } from "../sound.js";
import { answerRecorder, attemptRow } from "../ui/answer-recorder.js";
import { uuid, voiceCircle } from "../ui/voice-circle.js";
import { kanaMnemonicBlock } from "../ui/kana-mnemonic.js";
import { stopAllRecording } from "../recording.js";
import { soundButton } from "../ui/sound-button.js";


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
 * #218: a gentle nudge to look away from the screen after a long stretch of
 * practice — not a break she is forced to take (#179), and not a second
 * in-app activity to fill the pause, because the research behind the issue
 * says a *screen* pause helps consolidation and a screen replacement does
 * not. Module-level rather than a `sessionScreen()` local: two sessions
 * started back to back are one stretch of practice from her side, and this
 * is what makes them one stretch on the app's side too — it survives a
 * session ending, and only forgets once she has actually been away for a
 * while, or the page reloads.
 */
const BREAK_HINT_INTERVAL_MS = 20 * 60 * 1000; // the low end of the 20–25 min the issue names, so a long stretch is never overdue
// #221: how long the app has to have actually left the foreground — not how
// long between two cards — before a stretch counts as broken. A card that
// takes her 6 minutes (a recording, a hard 書く) is not a pause; it is
// exactly the screen time this hint exists for, and measuring the gap
// between draws instead of real backgrounding used to reset the streak for
// precisely the slow, thoughtful sessions the hint is most meant to catch.
const BREAK_HINT_GAP_MS = 5 * 60 * 1000;

/**
 * Whether a fresh 20-minute threshold of continuous practice was just
 * crossed, and the streak state to carry into the next call. Pure, so it can
 * be tested without a session or a DOM: given a state, a moment and whether
 * the app was truly away for too long since the last call (see the
 * `visibilitychange` listener below), it says what the next state is and
 * whether that moment earns a hint. Called once per card drawn — no timer of
 * its own runs while she is mid-answer.
 *
 * `state` starts `undefined` (nothing practised yet in this stretch).
 * `Math.max(0, …)` on `crossed` (#222) is for a device clock that steps
 * backward mid-stretch (a timezone re-sync, an NTP correction, plausible on
 * the travel this app already handles local-time zones for, `server/src/
 * day.js`) — without it a negative `crossed` would silently delay the next
 * hint by however far the clock jumped, on top of the real 20 minutes.
 */
export function breakHintCheck(state, now = Date.now(), awayTooLong = false) {
  const fresh = !state || awayTooLong;
  const streakStart = fresh ? now : state.streakStart;
  const shown = fresh ? 0 : state.shown;
  const crossed = Math.max(0, Math.floor((now - streakStart) / BREAK_HINT_INTERVAL_MS));
  const due = crossed > shown;
  return { due, state: { streakStart, shown: due ? crossed : shown } };
}

/** #218: the streak `breakHintCheck()` carries forward — module-level, see above. */
let breakHintState;

/**
 * #221: the real "she stepped away" signal, fed into `breakHintCheck()` as
 * `awayTooLong` — a screen lock or switching apps fires this reliably even
 * under iOS's background throttling (the same event `outbox.js` and
 * `stars.js` already flush on return from). `hiddenAt` is when the page was
 * last seen going into the background; becoming visible again turns a long
 * enough absence into the one-shot flag `drawCard()` reads and clears.
 */
let hiddenAt;
let awayTooLong = false;
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      hiddenAt = Date.now();
    } else {
      if (hiddenAt !== undefined && Date.now() - hiddenAt > BREAK_HINT_GAP_MS) awayTooLong = true;
      hiddenAt = undefined;
    }
  });
}

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
    answered === 1 ? "Die Karte, die du beantwortet hast, ist" : `Die ${answered} Karten, die du beantwortet hast, sind`;
  return `${subject} schon gespeichert. Der Rest kommt wieder in die Reihe.`;
}

/** Whether this device can read anything aloud at all (47's last sentence). */
export const canSpeak = () =>
  typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined";

/** 47: said plainly, because a synthetic voice mistaken for a recording
 *  teaches the wrong pronunciation. */
const SYNTH_CAPTION = "Keine Aufnahme für diese Karte – vorgelesen von der japanischen Stimme des Handys";

/** The line under a word's ♪ saying what kind of voice it plays (#185). */
const SOURCE_CAPTION = {
  native: "Muttersprachler-Aufnahme",
  synth: "Computer-generierte Aussprache",
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
  if (seconds < 60) return "<1 Min";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} Min`;
  const hours = Math.round(seconds / 3600);
  if (hours < 24) return `${hours} Std`;
  // Days and longer in words: "Tg" and "J" are not abbreviations anyone reads.
  const days = Math.round(seconds / 86400);
  if (days < 30) return `${days} ${days === 1 ? "Tag" : "Tage"}`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} ${months === 1 ? "Monat" : "Monate"}`;
  const years = Math.round(days / 365);
  return `${years} ${years === 1 ? "Jahr" : "Jahre"}`;
}

/**
 * Design 16 and the prototype — the session, in every mode. 書く (#97) came
 * later and has no screen of its own; see `drawType`.
 *
 * The loop is not up for redesign: `prototype/kotoba-line.html` is the agreed
 * visual direction and it already works out all four, so this follows its
 * interaction feel rather than waiting for a canvas frame per mode. The card
 * is read aloud on arrival, a wrong answer shows the right one, the sentence
 * is revealed either way, and the pause is longer after a miss.
 *
 * What the canvas genuinely does not settle is a handful of *states*, and
 * those are decided here and listed in design/README.md: what 聞く does with a
 * card it cannot play, and what 話す does without the microphone it no longer
 * uses (#155).
 */
export function sessionScreen({
  mode = "choose",
  filters = {},
  chosenLabel,
  limit = 20,
  readAloud = true,
  pitchAccent = false,
  romaji = false,
  // #77: what 話す draws its prompt from. "sentence" is what the mode always
  // did before this setting existed — prefer the sentence, fall back to the
  // word — so leaving it untouched changes nothing for anyone.
  speakSource = "sentence",
  // #135: false shows words in romaji and sentences as sound only — see
  // `client/src/script.js` for why sentences are not romaji too.
  japanese = true,
  // #185: off hides "Antwort aufnehmen" and the Muttersprachler chip
  // everywhere in this session. What a ♪ plays is still labelled — that is
  // about the card, not about recording.
  recordingEnabled = true,
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
  // #211: whether the card on screen has been graded. `grade()` is the one
  // gate every mode's answer passes, and on the last card the rating row
  // stays on screen while `finish()` waits for the network — on a train,
  // seconds — so a second tap there re-graded the card: six pairs of
  // events a second apart in Charlotte's log, 2026-09-18, each an extra
  // scheduler step (Gut → 1 Tag, then Gut again → 2 Tage). Reset by
  // `drawCard()`, never by `finish()`.
  let graded = false;
  let finishing = false;
  // #218: set when a break-hint threshold is crossed, cleared when she taps
  // it away. Survives a card turning (unlike `graded`) because `drawCard()`
  // redraws the whole chrome on every card, and the hint should stay put
  // until she dismisses it, not vanish with the card that happened to be on
  // screen when it appeared.
  let showBreakHint = false;
  // #214: a card she rated Nochmal goes to the end of this queue and comes
  // round again until it earns a Gut — what the "1 Min" under the button
  // already means, and what Noji does ("shown for you in 1 minute in the
  // same study session again"). Before this the queue was fixed, and on
  // 2026-09-18 she started four sessions in seven minutes to see her
  // Nochmal cards again. Card id → how often it has come round: their
  // interval labels came down at session start, before the Nochmal the
  // server has not seen yet, so they are withheld rather than shown wrong.
  // Bounded, so a card she cannot get today cannot keep the session from
  // ending — after that it is due again in a minute anyway, and the next
  // session brings it.
  const reshows = new Map();
  const results = []; // one entry per card, for the station strip afterwards
  let answered = 0;
  let before;
  let intervals = {};   // card id → { 1..4: seconds }, for めくる's rating row
  // The pending move to the next card in 選ぶ and 聞く. Held here rather than
  // left anonymous so a replay can push it back (#32) and so leaving the
  // session cancels it — an orphaned timer redraws a screen that is gone.
  let advanceTimer;
  // Card ids she has starred, for the ★ in the chrome (#35). Comes down with
  // the queue, because the cached deck is public and cannot carry it.
  let starred = new Set();
  // A native speaker's recording per card id (#183 follow-up, #185) — the
  // same reasoning as starred: per-user, comes down with the queue.
  let recordings = new Map();
  // Her spoken attempt at the card on screen and the control recording it
  // (#185, 2026-09-17) — held here, not in the DOM, because it has to
  // survive the card turning; ui/answer-recorder.js says why it is never
  // stored anywhere else.
  let attempt = { url: null };
  let recorder = null;

  begin();

  async function begin() {
    // The summary's "before" figures (XP, level, jokers). Not waited for
    // (#106): on a stalled connection it held the first card back for the
    // whole timeout, and the summary already copes without it. A snapshot
    // that lands after the first answer is not used — it might count that
    // answer, and the summary would then understate what the session earned.
    // The price is a summary without XP, level-up or design 11's joker badge
    // for that one session — the same as when this request fails outright,
    // and better than a figure that is wrong. Keep the guard.
    api.stats().then(
      (snapshot) => {
        if (answered === 0) before = snapshot;
      },
      () => {},
    );
    try {
      const [loaded, q] = await Promise.all([
        loadDeck(),
        // Resuming still asks, for めくる's intervals — but the card ids it
        // returns are ignored in favour of the ones she was already working
        // through. Re-composing the queue would silently swap her session for
        // a different one under the same name.
        sessionQueue({ ...filters, mode, limit }),
      ]);
      // A fresh queue can name a card the cached deck does not have yet; the
      // deck's difference is then worth its wait (deck.js).
      if (!q.stale && q.cardIds.some((id) => !loaded.has(id))) await deckCatchingUp();
      deck = loaded;
      // Wrong answers are drawn from the whole deck, not from the session —
      // twenty cards is far too small a pool to find plausible ones in.
      pool = [...deck.values()];
      intervals = q.intervals ?? {};
      starred = new Set(q.starred ?? []);
      recordings = new Map();
      for (const r of q.recordings ?? []) {
        if (r.kind === "native") recordings.set(r.card_id, r);
      }
      const ids = resuming?.cardIds ?? q.cardIds;
      // A resumed queue can already hold a card twice (#214); the second
      // copy's labels are as stale as they would have been live.
      const met = new Set();
      for (const id of ids) {
        if (met.has(id)) reshows.set(id, (reshows.get(id) ?? 0) + 1);
        met.add(id);
      }
      const due = ids.map((id) => deck.get(id)).filter(Boolean);
      queue = playableIn(mode, due);
      if (resuming) index = Math.min(resuming.index ?? 0, Math.max(queue.length - 1, 0));

      // 聞く or 書く dropped everything it was given: the cards are due, they
      // just cannot be asked this way. That is a different message from
      // "nothing due".
      if (due.length > 0 && queue.length === 0) {
        render(
          root,
          el("div.session-error", {},
            el("p", {
              text:
                mode === "type"
                  ? `Hier kann nichts in „${modeName(line, japanese)}“ getippt werden. Die fälligen Karten sind deine eigenen Wörter ohne Lesung, also gibt es nichts, womit eine Antwort verglichen werden kann.`
                  : `Hier kann nichts in „${modeName(line, japanese)}“ geübt werden. Die fälligen Karten haben keinen Satz mit Übersetzung zum Anhören.`,
            }),
            el("button.btn-secondary", { type: "button", text: "Zurück", onclick: onExit }),
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
            el("p", { text: "Du bist offline, und diese Auswahl wurde noch nie online geübt – deshalb gibt es hier nichts zu üben." }),
            el("button.btn-secondary", { type: "button", text: "Zurück", onclick: onExit }),
          ),
        );
        return;
      }
    } catch {
      render(
        root,
        el("div.session-error", {},
          el("p", { text: "Die Übung konnte nicht starten – das Deck ist noch nicht auf dem Gerät." }),
          el("button.btn-secondary", { type: "button", text: "Zurück", onclick: onExit }),
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
        "aria-label": "Übung verlassen",
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
              el("span.chosen-text", { text: `Deine Auswahl · ${chosenLabel}` }),
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
   * #218: sits under the chrome, above the card — never over it, so it never
   * costs her a tap meant for an answer. Stays through `grade()`'s chrome-only
   * replace (that touches `root.firstChild`, not this) and through the next
   * card's full redraw, because `drawCard()` includes it again as long as
   * `showBreakHint` is still true. Dismissing it only hides this one; it does
   * not reset the streak, so the next card does not bring it straight back.
   */
  function breakHint() {
    if (!showBreakHint) return null;
    return el(
      "div.break-hint",
      { role: "status" },
      el("span.break-hint-text", {
        text: "Kleine Pause? Schau kurz weg vom Bildschirm — aus dem Fenster reicht.",
      }),
      el("button.break-hint-dismiss", {
        type: "button",
        "aria-label": "Hinweis schließen",
        text: "×",
        onclick: () => {
          seen("break_hint_dismissed");
          showBreakHint = false;
          root.querySelector(".break-hint")?.remove();
        },
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
      "aria-label": on ? `${shownWord(card, japanese)} nicht mehr markieren` : `${shownWord(card, japanese)} markieren`,
      "aria-pressed": String(on),
      text: on ? "★" : "☆",
    });

    button.addEventListener("click", () => {
      const wanted = !starred.has(card.id);
      // 32's rule, the same here: the tap writes and the mark changes under
      // her hand — that is the whole confirmation.
      paint(wanted);
      // #22: the current card's starred state came down with this session's
      // own queue, so — unlike Browse's search, which has no reliable star
      // data to show for an arbitrary card — this tap knows what it is
      // toggling. `setStar` queues it durably and delivers it when it can;
      // offline is not a failure to undo, it is the queue doing its job.
      setStar(card.id, wanted);
    });

    function paint(on) {
      if (on) starred.add(card.id);
      else starred.delete(card.id);
      button.textContent = on ? "★" : "☆";
      button.classList.toggle("on", on);
      button.setAttribute("aria-pressed", String(on));
      button.setAttribute("aria-label", `${shownWord(card, japanese)} ${on ? "nicht mehr markieren" : "markieren"}`);
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
        el("h2.sheet-title", { text: "Übung verlassen?" }),
        el("p.sheet-body", { text: leavingCopy(answered) }),
        el(
          "div.sheet-actions",
          {},
          el("button.btn", { type: "button", text: "Verlassen", onclick: leave }),
          el("button.btn.solid", {
            type: "button",
            text: "Weiterüben",
            onclick: () => sheet.remove(),
          }),
        ),
      ),
    );
    root.append(sheet);
  }

  function leave() {
    stopAllRecording();
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
    // A card can be graded while a recording on it is still running
    // (grading is not gated on it) — the DOM node this replaces is the only
    // thing that held it, so without this the mic stays live for the rest
    // of the page load (Charlotte, 2026-09-16). The same is true of playing
    // one back (code review, 2026-09-17): grading mid-playback used to
    // leave a recording's own audio running audibly into the next card.
    stopAllRecording();
    stop();
    if (attempt.url) URL.revokeObjectURL(attempt.url);
    attempt = { url: null };
    recorder = null;
    graded = false;
    const card = queue[index];
    // The mode on the card is for the iPad card's layout (#150, screens.css).
    const area = el("div.card-area", { dataset: { mode } });
    const answers = el("div.options");

    const previousStreakStart = breakHintState?.streakStart;
    const hint = breakHintCheck(breakHintState, Date.now(), awayTooLong);
    awayTooLong = false;
    breakHintState = hint.state;
    if (hint.due) {
      showBreakHint = true;
      // #228: here and not in breakHint(), which every card redraws.
      seen("break_hint_shown", `${(hint.state.shown * BREAK_HINT_INTERVAL_MS) / 60000}min`);
    }
    // #220: a hint she never dismissed must not survive into a *new* stretch
    // — if she actually took the break it suggested, the streak restarting
    // is exactly the "started fresh" case #218's dismiss-only-hides-this-one
    // rule was never meant to cover.
    else if (hint.state.streakStart !== previousStreakStart) showBreakHint = false;
    render(root, chrome(), breakHint(), area, answers);
    // §7: iOS produces no sound from speech synthesis until a user gesture has
    // happened, and every mode here may reach for it.
    unlock();

    // #116: each mode calls `prime()` with the recordings it can play, as
    // soon as the card is on screen, so a tap on ♪ does not wait on the
    // network. Per mode rather than here, because the modes differ: 聞く never
    // plays the word and 書く never plays the sentence, and on metered data a
    // file nobody hears is not free (§1). About 25 KB a file.
    ({ choose: drawChoose, listen: drawListen, speak: drawSpeak, type: drawType, flip: drawFlip }[mode] ??
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
  function grade(card, rating, pause = 0) {
    if (graded) return;
    graded = true;
    // The rating row goes inert at once, so a second tap has something to
    // land on that visibly does nothing rather than a live button. Only the
    // ratings: 選ぶ's options disable themselves, and its "Weiter" after a
    // miss must stay pressable.
    for (const button of root.querySelectorAll(".ratings button")) button.disabled = true;
    const ok = recalled(rating);
    results[index] = ok;
    if (ok) right += 1;
    else if (!missed.some((m) => m.id === card.id)) missed.push(card);
    // #214: Nochmal — and only Nochmal — brings the card round again. Pushed
    // before the strip and the session note below are written, so both
    // already count it; on the last card this is what keeps `next()` from
    // finishing.
    if (comesRoundAgain(rating, reshows.get(card.id) ?? 0)) {
      queue.push(card);
      reshows.set(card.id, (reshows.get(card.id) ?? 0) + 1);
    }

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
    // #135: the kana line, and the pitch contour drawn over it, are Japanese
    // script — and with the script off the word above is already in romaji.
    if (!japanese) return null;
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

  /**
   * The word in romaji, as one more line below the reading (#73).
   *
   * Independent of `reading()`'s "carries nothing" rule: いい dropping its own
   * kana line is right — repeating いい as いい says nothing — but "ii" is not
   * the same string and is exactly the case where romaji earns its place. So
   * this reads `word_furigana` itself rather than reusing `reading()`'s
   * output.
   *
   * `word_reading` — the plain kana she types into her own card's optional
   * "Reading" field — is the second choice, before falling back to the word
   * itself for the kana-only case. Missing this fallback meant "Show romaji"
   * did nothing for every one of her own cards where she had *done exactly
   * what the field asks for* (#75) — 食べる with reading たべる produced
   * nothing, because `word_furigana` is always NULL on a personal card
   * (`server/src/cards.js`) and the word itself is kanji, not kana.
   *
   * Off by default, and silent rather than a guess wherever no kana reading
   * can be produced at all — a kanji word with neither field filled in.
   */
  function romajiLine(card, always = false) {
    // #135: with the script off the word itself is the romaji; a second copy
    // under it says nothing.
    if (!japanese) return null;
    // #158: a kana card's romaji is its answer, and its meaning already.
    if (isKana(card)) return null;
    if (!romaji && !always) return null;
    const text = wordRomaji(card);
    if (!text) return null;
    return el("div.romaji.reveal", { text });
  }

  /**
   * The sentence in romaji, under the Japanese when "Show romaji" is on.
   *
   * Written at import since 2026-09-19 (import/lib/sentence-romaji.js), not
   * guessed here any more: the phone's guess from the furigana alone (#75,
   * `sentenceKana`) could not tell where a word ends or that は is said "wa"
   * — この靴はいくらですか came out "kono kutsu haikuradesuka". A sentence the
   * import could not do (8 of 1,500) has none: no reading is better than a
   * wrong one.
   */
  function sentenceRomajiLine(card) {
    if (!romaji || !japanese || !card.sentence_romaji) return null;
    return el("p.romaji.sentence-romaji.reveal", { text: card.sentence_romaji });
  }

  /**
   * The card's word as the heading. #135: in romaji with the script off —
   * unless no reading exists, and then the Japanese, which keeps its font.
   * Romaji gets its own class because a word that is two characters in kanji
   * can be fifteen letters long, and the kanji size would run off the card.
   */
  function wordHeading(card) {
    return el(showsScript(card, japanese) ? "h2.word.jp" : "h2.word.latin", {
      text: shownWord(card, japanese),
    });
  }

  /**
   * Two animations, not one: `acknowledged()` gives the ~80ms tap-ring on
   * every button already; this adds a second one, `.playing`, that lasts as
   * long as the sound actually runs — a recording's real length, or a
   * synthesised sentence's, not a guess. Henning, 2026-09-18: a tap-ring
   * alone said "the tap arrived", never "it is still talking".
   */
  function speaker(text, file, { rate, ghost = true, label = "Vorlesen", big = false, small = false } = {}) {
    // Absent rather than inert, and never a guess (#137, v66): see `canVoice`.
    if (!canVoice(text, file)) return null;
    // The app's one ♪ (ui/sound-button.js): tap-ring and pulse come with it.
    return soundButton({
      sound: { text, file, rate },
      className: `.speaker${ghost ? ".ghost" : ""}${big ? ".big" : ""}${small ? ".small" : ""}`,
      label,
    });
  }

  /** Read aloud, the same rule as `speaker`: a recording, or Japanese to synthesise. */
  function voice(text, file, options) {
    if (canVoice(text, file)) say(text, file, options);
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

    // A wrong answer may not belong to a card that looks exactly like this
    // one — its meaning would be right too, and marked wrong. With the script
    // off (#135) that is 116 of the 1,500 Kaishi cards (measured): いる and 要る
    // are both "iru", 帰る and 変える both "kaeru". With it on, the 24 words the
    // deck carries twice (聞く "to hear" and "to ask") had the same problem.
    // Only in 選ぶ, where the word is the question; 聞く asks about a sentence.
    const candidates = field === "word_meaning" ? meaningPool(card, pool, japanese) : pool;
    const options = shuffle([card, ...pickDistractors(card, candidates, 3, Math.random, field)]);
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

            if (showsSentence(card, japanese)) {
              if (readAloud) voice(card.sentence, card.sentence_audio, { rate: 0.85 });
              area.append(revealedSentence(card));
            }

            // v83 (#158): a kana's sound was the question, so it stays silent
            // until she has answered — and then she hears it and the words
            // that carry it, as on the back of めくる. Henning: the sound was
            // there in めくる and not here.
            if (isKana(card)) {
              area.querySelector(".word")?.replaceWith(
                el("div.word-line", {}, wordHeading(card), kanaSpeaker(card)),
              );
              const note = kanaSynthNote(card);
              if (note) area.querySelector(".word-line")?.after(note);
              // v88: the picture comes with the answer here for the same
              // reason — on the front it would give the reading away.
              area.append(kanaMnemonicBlock(card, { className: "reveal" }) ?? "", kanaExampleBlock(card) ?? "");
              if (readAloud) voice(card.word, card.word_audio);
            }

            // #57: this used to schedule the next card on a fixed 900/2400ms
            // pause, cutting the confirmation sentence off on nearly every
            // correct answer (real recordings run 1.6-4.5s). Henning's call
            // once that was diagnosed: she should decide when to move on,
            // the same as めくる and 話す already work — so `grade` schedules
            // nothing (`pause: null`) and a "Continue" button does instead.
            grade(card, correct ? RATING_GOOD : RATING_AGAIN, null);
            answers.append(
              el(
                "div.actions",
                {},
                el("button.btn.primary", { type: "button", text: "Weiter", onclick: () => next() }),
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
    // A kana's recording is loaded now, so it plays on a train after she has
    // answered — but neither played nor offered before: its sound is the
    // answer (v84, #158). `promptAudio` is that rule.
    const kana = isKana(card);
    const audio = kana ? promptAudio(card) : soundOf(card).file;
    prime(kana ? card.word_audio : audio, showsSentence(card, japanese) && card.sentence_audio, ...exampleAudio(card));
    // Only a recording, like the speaker below. Until v66 a card without one
    // was read by the phone's voice with no button to hear it again — on her
    // Noji lists, a Japanese voice reading romaji (Henning, 2026-09-14).
    if (readAloud && audio) say(card.word, audio);

    chooseFrom(card, "word_meaning", null, area, answers, [
      // #158: a kana has a reading, not a meaning.
      el("span.prompt-label", { text: isKana(card) ? "Wie liest man das?" : "Was bedeutet das?" }),
      kana ? wordHeading(card) : null,
      // 48: in 選ぶ the sound is a bonus, so with no recording the control is
      // absent rather than inert — "an inert button would invite a tap that
      // does nothing". No caption either, because nothing was promised, and no
      // synthesis: the synthetic voice belongs where she is listening for the
      // pronunciation, which in 選ぶ she is not.
      ...(kana ? [audio ? speaker(card.word, audio) : null] : wordSoundParts(card, {}, { line: false })),
      // The question here is meaning, not pronunciation, so a romaji line
      // gives nothing away — it just lets "Show romaji" do on the prompt what
      // its settings description promises ("for reading it back") instead of
      // only after she has already answered.
      romajiLine(card),
      // No "Antwort aufnehmen" (#185, 2026-09-17): the word is already on
      // screen, so there is nothing to say from memory before the answer.
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
    prime(card.sentence_audio);
    const play = () => voice(card.sentence, card.sentence_audio, { rate: 0.85 });
    play();

    chooseFrom(card, "sentence_meaning", null, area, answers, [
      el("span.prompt-label", { text: "Hör zu – ohne Text" }),
      speaker(card.sentence, card.sentence_audio, {
        rate: 0.85,
        ghost: false,
        big: true,
        label: "Nochmal abspielen",
      }),
      // 47: here synthesis does stand in, because the audio is the whole
      // question — and it says so, since "a synthetic voice she mistakes for a
      // recording teaches her the wrong pronunciation". Her own cards always
      // land in this state.
      card.sentence_audio
        ? el("span.prompt-label", { text: "Tippen, um es nochmal zu hören" })
        : el("p.synth-note", { text: SYNTH_CAPTION }),
      // No text is ever shown here — the point is shadowing: hear it, then
      // say it back and hear herself (Henning, 2026-09-16). The one mode
      // where the attempt is not compared on a turned card: chooseFrom()
      // never replaces `area`, so it simply stays beside the ♪ it copies.
      // No Muttersprachler chip: the word is not on screen.
      answerRecorderFor(card),
    ]);
  }

  /**
   * 話す — see the meaning, say it aloud, then judge yourself. Screen 42.
   *
   * Screens 43–46 drew a record button that quoted what the phone heard.
   * #155 removed it: on her iPad, recording crashed the app. Speech
   * recognition never scored anything (§7), so the mode loses nothing it
   * decided with — she says it aloud to herself, turns the card and marks
   * it, exactly as a device without a microphone always did.
   */
  function drawSpeak(card, area, answers) {
    // Decided once per card, at the prompt — not re-rolled at reveal, or a
    // "random" card could ask about the word and then reveal the sentence.
    const useSentence = speakUsesSentence(card, speakSource);
    prime(useSentence ? card.sentence_audio : soundOf(card).file);

    render(
      area,
      el("span.prompt-label", { text: "Sag es auf Japanisch" }),
      el("p.meaning", { text: (useSentence ? card.sentence_meaning : card.word_meaning) ?? "" }),
      // She says it before she sees it (#185, 2026-09-17), and the reveal
      // puts what she said beside the real thing. "Antwort zeigen" in the
      // middle of a recording keeps it (thenReveal). Not for a kana card —
      // 話す is hidden for kana decks in deck-options.js, but playableIn()
      // does not filter kana out of "speak" (code review, 2026-09-17).
      answerRecorderFor(card),
    );
    render(
      answers,
      el(
        "div.actions",
        {},
        el("button.btn.primary", {
          type: "button",
          text: "Antwort zeigen",
          onclick: thenReveal(() => revealSpeak(card, area, answers, useSentence)),
        }),
      ),
    );
  }

  function revealSpeak(card, area, answers, useSentence) {
    // The front's recorder is a different DOM node than the one about to be
    // drawn here — replacing it does not stop a recording still running in
    // it, same reasoning as drawCard() above (thenReveal has already kept
    // what she said). Nor does it stop one playing back (code review,
    // 2026-09-17).
    stopAllRecording();
    stop();
    const text = useSentence ? card.sentence : card.word;
    const audio = useSentence ? card.sentence_audio : soundOf(card).file;

    // #113: the question stays at the top, where she read it, and the answer
    // comes in under it — so the English is no longer repeated at the bottom.
    const settle = holdInPlace(area, ".prompt-label");
    render(
      area,
      el("span.prompt-label", { text: "Sag es auf Japanisch" }),
      el("p.meaning", { text: (useSentence ? card.sentence_meaning : card.word_meaning) ?? "" }),
      // 話す is the mode where hearing it back matters most: she has just
      // tried to produce it, and the recording is the only way to find out
      // whether what she said was right (#32) — with her own attempt right
      // beside it, if she recorded one (#185).
      ...(useSentence
        ? [revealedSentence(card), attemptRow(attempt)]
        : wordSoundParts(card, { label: "Wort nochmal hören" }, { reveal: true, withAttempt: true })),
      useSentence ? null : romajiLine(card),
    );
    if (readAloud) voice(text, audio, useSentence ? { rate: 0.85 } : undefined);

    // 42: same height and tints as めくる's row, half the count and no
    // intervals — 話す asks whether she could produce it, a yes-or-no question.
    render(
      answers,
      el(
        "div.ratings.two",
        {},
        ratingButton("Nicht gewusst", RATING_AGAIN, () => grade(card, RATING_AGAIN)),
        ratingButton("Gewusst", RATING_GOOD, () => grade(card, RATING_GOOD)),
      ),
    );
    settle();
  }

  /**
   * 書く — see the meaning, type the Japanese (#97).
   *
   * The only mode that asks her to produce the word and then checks it; 話す
   * asks for the same thing and leaves the judging to her. Romaji, kana or
   * the word itself all count — `typing.js` says how.
   *
   * Everything she needs is at the top of the card, not in the answer row at
   * the bottom like the other modes: on the phone the keyboard covers the
   * bottom half of the screen while she types, and a Check button under it
   * would be a button she cannot see. Return on the keyboard checks too.
   */
  function drawType(card, area, answers) {
    prime(soundOf(card).file);
    const input = el("input.field-input.jp.type-input", {
      type: "text",
      lang: "ja",
      // Each of these would get between her and what she typed: iOS
      // capitalises the first letter, autocorrect rewrites romaji into English
      // words, and spellcheck underlines all of it as misspelt.
      autocomplete: "off",
      autocorrect: "off",
      autocapitalize: "off",
      spellcheck: "false",
      enterkeyhint: "go",
      placeholder: japanese ? "Romaji oder Kana" : "Romaji",
      "aria-label": "Das japanische Wort",
    });
    // Kept at its height when empty, so the buttons below do not jump the
    // moment she starts typing.
    const preview = el("p.type-preview.jp", { "aria-live": "polite" });
    const check = el("button.btn.primary", { type: "submit", text: "Prüfen", disabled: true });

    input.addEventListener("input", () => {
      // Only while there are letters to turn into kana. Kana from a Japanese
      // keyboard is already in the field, and a second copy under it says
      // nothing.
      // #135: with the script off, what she types is not shown back as kana.
      preview.textContent = japanese && /[a-z]/i.test(input.value) ? kanaPreview(input.value) : "";
      check.disabled = !normalizeTyped(input.value);
    });

    area.classList.add("typing");
    render(
      area,
      el("span.prompt-label", { text: "Tipp es auf Japanisch" }),
      el("p.meaning", { text: card.word_meaning ?? "" }),
      el(
        "form.type-form",
        {
          onsubmit: (e) => {
            e.preventDefault();
            if (normalizeTyped(input.value)) revealType(card, area, answers, input.value);
          },
        },
        el("div.field", {}, input),
        preview,
        el(
          "div.actions",
          {},
          // 話す's label for the same way out: she does not know it, and
          // typing nonsense to get past the card should not be the only exit.
          el("button.btn", {
            type: "button",
            text: "Antwort zeigen",
            onclick: () => revealType(card, area, answers),
          }),
          check,
        ),
      ),
    );
    render(answers);
    // Opens the keyboard for the next card straight away. iOS only does that
    // for focus() inside a tap, which is why every way to the next card
    // (Continue, Missed it, It was a typo) calls next() from its own click
    // rather than from a timer. The first card has no tap behind it, so there
    // she taps the field herself. Not measurable without the phone — desktop
    // WebKit has no on-screen keyboard.
    input.focus();
  }

  /**
   * 書く's answer. `typed` is undefined when she asked to see it.
   *
   * §6's mapping, unchanged: *good* for a right answer, *again* for a wrong
   * one — no *easy* for typing it, and no gentler rating for failing to. #97
   * asked whether a typed answer should be graded differently; §6 decided
   * that one card state is shared by every mode and not to model the skills
   * apart "unless she asks for it", and a mode-specific rating is that model
   * by another name.
   *
   * What is new is who calls a wrong answer. A typo is not forgetting, and
   * only she knows which it was — so a wrong answer asks before anything is
   * recorded, rather than recording *again* and offering to take it back.
   * Rule 1 is why it has to be that order: the log cannot take anything back,
   * and *again* followed by *good* is not the same history as *good*.
   */
  function revealType(card, area, answers, typed) {
    // The keyboard goes, or it covers the answer and the buttons — and with it
    // the reason to sit high on the screen.
    document.activeElement?.blur?.();

    const given = typed === undefined ? undefined : judge(typed, typingAnswers(card, pool));
    const correct = given !== undefined;

    // #113: the meaning she was asked for stays where it was, at the top, and
    // the answer comes in under it — not re-centred with the English moved to
    // the bottom. `holdInPlace` measures it while `.typing` still places it,
    // so the class can go with the keyboard.
    const settle = holdInPlace(area, ".prompt-label");
    area.classList.remove("typing");
    render(
      area,
      el("span.prompt-label", { text: "Tipp es auf Japanisch" }),
      el("p.meaning", { text: card.word_meaning ?? "" }),
      typed === undefined
        ? null
        : el(
            "div.typed.reveal",
            { class: correct ? "right" : "wrong" },
            el("span.typed-label", { text: correct ? "Richtig" : "Du hast getippt" }),
            el("p.typed-text.jp", { text: typed.trim() }),
          ),
      // No "Antwort aufnehmen" on 書く's front (#185, 2026-09-17): she
      // produces the word by typing it, not by saying it.
      ...wordSoundParts(card, { label: "Wort nochmal hören" }, { reveal: true }),
      reading(card.word_furigana || card.word_reading, card.word, card),
      // Always, whatever "Show romaji" says: she has most likely just typed
      // romaji, and this is the line to compare it with, letter by letter.
      romajiLine(card, true),
      // A meaning shared with another card (33 are): she typed a word that is
      // right, just not this card's. It counts, and says which.
      given && given.id !== card.id
        ? el("p.type-note.reveal", {
            text: `${shownWord(given, japanese)} heißt das auch. Diese Karte ist ${shownWord(card, japanese)}.`,
          })
        : null,
    );
    // The word, not the sentence: the sound of what she just tried to write
    // is the thing worth hearing here.
    if (readAloud) voice(card.word, soundOf(card).file);

    if (typed !== undefined && !correct) {
      render(
        answers,
        el(
          "div.ratings.two",
          {},
          // Moved on within the tap rather than on a timer, so the next
          // card's field can still open the keyboard (see `drawType`).
          ratingButton("Nicht gewusst", RATING_AGAIN, () => {
            grade(card, RATING_AGAIN, null);
            next();
          }),
          ratingButton("Nur vertippt", RATING_GOOD, () => {
            grade(card, RATING_GOOD, null);
            next();
          }),
        ),
      );
      settle();
      return;
    }

    grade(card, correct ? RATING_GOOD : RATING_AGAIN, null);
    render(
      answers,
      el(
        "div.actions",
        {},
        el("button.btn.primary", { type: "button", text: "Weiter", onclick: () => next() }),
      ),
    );
    settle();
  }

  /** The four intervals for this card, already formatted. Empty when unknown. */
  function intervalsFor(card) {
    // #214: a card that has come round again has a Nochmal the server has
    // not folded yet, so what it sent at session start is for the card as it
    // was. No number beats a wrong one.
    if (reshows.has(card.id)) return {};
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
    prime(isKana(card) ? card.word_audio : soundOf(card).file, showsSentence(card, japanese) && card.sentence_audio);
    if (flipsMeaningFirst(card)) {
      // No speaker and no reading aloud: the word is the answer. But she is
      // meant to say it herself before turning the card, the same as 話す
      // (#32) — so this front records the attempt, and the back puts it
      // beside the ♪ (#185, 2026-09-17). No Muttersprachler chip: the word
      // is not on screen yet, so nobody has anything to read it from.
      render(
        area,
        el("span.prompt-label", { text: "Auf Japanisch" }),
        el("p.meaning", { text: card.word_meaning ?? "" }),
        answerRecorderFor(card),
      );
    } else {
      // #158: a kana's sound is its reading, which is the answer — so the
      // front of a kana card stays silent and carries no speaker.
      const kana = isKana(card);
      render(
        area,
        ...(kana ? [wordHeading(card)] : wordSoundParts(card, {}, { line: false })),
        // Same reasoning as 選ぶ: めくる's front asks "do you know this", not
        // "what does it say" — a romaji line here does not spoil the flip.
        romajiLine(card),
        // "Antwort aufnehmen" only where there is something to say from
        // memory (#185): a kana, whose sound is the answer. A word's front
        // already shows and plays it.
        kana ? answerRecorderFor(card) : null,
      );
      if (kana) prime(...strokeFiles(card), ...exampleAudio(card));
      else if (readAloud) voice(card.word, soundOf(card).file);
    }

    render(
      answers,
      el(
        "div.actions",
        {},
        el("button.btn.primary", {
          type: "button",
          text: "Umdrehen",
          onclick: thenReveal(() => revealFlip(card, area, answers)),
        }),
      ),
    );
  }

  /**
   * How a kana is written (#158): KanjiVG's drawing of each character, the
   * strokes numbered in order — two for a yōon, the small ゃ beside its kana.
   * The files are the import's (`npm run import-kana`); one that is not there
   * yet, or not cached on a train, takes its block away rather than showing a
   * broken image.
   */
  function strokeOrder(card) {
    const block = el("div.kana-strokes.reveal");
    const hide = () => block.remove();
    render(
      block,
      el(
        "div.kana-stroke-row",
        {},
        strokeFiles(card).map((file) => el("img.kana-stroke", { src: mediaUrl(file), alt: "", onerror: hide })),
      ),
      // CC BY-SA 3.0 asks for the attribution wherever the drawing is shown.
      el("span.kana-credit", { text: "Strichfolge: KanjiVG (CC BY-SA 3.0)" }),
    );
    return block;
  }

  /**
   * Up to three words with this kana, each read in kana with its meaning, the
   * kana marked where it is and a speaker where Kaishi has the recording —
   * import/lib/examples.js chooses them (v83).
   */
  function kanaExampleBlock(card) {
    const examples = kanaExamples(card);
    if (examples.length === 0) return null;
    return el(
      "div.kana-examples.reveal",
      {},
      el("span.prompt-label", { text: "Zum Beispiel" }),
      examples.map((example) =>
        el(
          "div.kana-example",
          {},
          el("span.jp", {}, ...markedSound(example.kana, card.word, example.at)),
          el("span.kana-example-meaning", { text: example.meaning }),
          // v83: a native speaker saying the word, where Kaishi has the
          // recording — never the phone's voice for a whole word, which would
          // teach its pronunciation as if it were one.
          example.audio
            ? speaker(example.kana, example.audio, { small: true, label: `${example.kana} hören` })
            : null,
        ),
      ),
    );
  }

  /**
   * A lone kana's sound. Since v84 a person's recording, saying it three
   * times, for the 71 sounds Wikimedia Commons has one of
   * (import/lib/kana-sounds.js); the 33 yōon have none anywhere free
   * (researched 2026-09-15), so the phone's voice reads those — a lone kana
   * is Japanese text it reads as that sound — and `kanaSynthNote` says so.
   */
  function kanaSpeaker(card) {
    return speaker(card.word, card.word_audio, { small: true, label: "Kana hören" });
  }

  /**
   * 47's caption, where a kana's ♪ is the phone's voice: she is listening
   * for the pronunciation here, which is exactly when a synthetic voice has
   * to say what it is.
   */
  function kanaSynthNote(card) {
    return kanaSynthesised(card) && canVoice(card.word, null) ? el("p.synth-note.reveal", { text: SYNTH_CAPTION }) : null;
  }

  /** What this card's ♪ plays, and what kind of voice that is (#185). */
  function soundOf(card) {
    return wordSound(card, recordings.get(card.id));
  }

  /**
   * "Antwort aufnehmen" on a front that asks her to say the answer (#185).
   * A kana card too (Henning, 2026-09-17: "diese Zeichen werden doch auch
   * gesprochen"): its sound *is* the answer, so めくる's front is exactly the
   * place — #185 had left kana out only because their audio was wired
   * separately, not for a reason. 話す/書く are hidden for kana decks, and
   * 選ぶ/聞く hand the kana its sound before she answers.
   */
  function answerRecorderFor(card) {
    if (!recordingEnabled) return null;
    recorder = answerRecorder(attempt);
    return recorder?.root ?? null;
  }

  /**
   * A reveal that keeps what she was saying: turning the card mid-recording
   * is the natural end of an attempt, not a reason to throw it away. Once
   * only — a second tap while the recording is being closed must not draw
   * the answer twice.
   */
  function thenReveal(reveal) {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const running = recorder;
      recorder = null;
      if (running?.recording()) running.finish().then(reveal, reveal);
      else reveal();
    };
  }

  /**
   * The word, its ♪, and what that ♪ is (#185, the layout agreed with Henning
   * on 2026-09-17), for any non-kana side where the word is on screen:
   *
   * - The ♪ keeps the mode's colour. Which kind of voice it plays is a line
   *   of text under it — turquoise "Muttersprachler-Aufnahme", grey-blue
   *   "Computer-generierte Aussprache" — never a recolouring of the ♪.
   * - No sound: no ♪ (absent, not inert). Unlike before #185 the phone's
   *   voice does not stand in for a word here — it is not one of the two
   *   sources. Measured first: none of her 1,102 cards is a Japanese-script
   *   word without a recording; in Kaishi exactly one is (失礼します), and
   *   that one card loses the synthetic ♪ it had. Sentences are deliberately
   *   left alone: revealedSentence still lets the phone read one aloud (#32),
   *   because #183 has not decided that question for sentences.
   * - Unless the ♪ already plays the deck's own native recording, a quiet
   *   chip offers a native one: "hinzufügen", or "bearbeiten" once she has
   *   one. The chip opens the same circle as the deck's card menu. A card
   *   whose deck recording is native (Kaishi, or one she linked) gets none
   *   — found on 何, which has a real recording and was offered one anyway.
   * - With `withAttempt`, her attempt from the front, right under the ♪.
   *
   * Returns the nodes to spread into a render: the word line, then the notes.
   */
  function wordSoundParts(card, speakerOptions = {}, { reveal = false, withAttempt = false, line: inLine = true } = {}) {
    const slot = el("span.speaker-slot");
    const caption = el("span.sound-source");
    const chipHost = el("div.native-chip-host");
    // Henning (#183, 2026-09-17): an accent that may be wrong gets an
    // asterisk, and the bottom of the card says why. `order`/`margin-top:
    // auto` in screens.css put it there wherever it sits in the render.
    const accentNote = el("p.accent-note", {
      text: "* Computer-Aussprache: Die Betonung ist von keiner zweiten Quelle bestätigt und kann falsch sein. Eine Muttersprachler-Aufnahme ersetzt sie.",
    });
    const notes = el(`div.sound-notes${reveal ? ".reveal" : ""}`, {}, caption, withAttempt ? attemptRow(attempt) : null, chipHost);
    // `line: false` for a front that sets the ♪ under the word, not beside it
    // (選ぶ, めくる's word-first front) — the layout those had before #185.
    const heading = wordHeading(card);
    const line = inLine ? el(`div.word-line${reveal ? ".reveal" : ""}`, {}, heading, slot) : null;
    let circle = null;

    function paint() {
      const sound = soundOf(card);
      render(slot, sound.file ? speaker(card.word, sound.file, { small: reveal, ...speakerOptions }) : null);
      caption.textContent = (SOURCE_CAPTION[sound.source] ?? "") + (sound.unchecked ? "*" : "");
      caption.className = `sound-source ${sound.source}`;
      accentNote.hidden = !sound.unchecked;
      if (circle) return; // open: it shows its own state, "bearbeiten" or not
      render(
        chipHost,
        recordingEnabled && !sound.deckNative
          ? el("button.native-chip", {
              type: "button",
              class: sound.recording ? "edit" : null,
              text: sound.recording ? "Muttersprachler-Aufnahme bearbeiten" : "Muttersprachler-Aufnahme hinzufügen",
              onclick: openCircle,
            })
          : null,
      );
    }

    function openCircle() {
      stop();
      circle = voiceCircle({
        cardId: card.id,
        kind: "native",
        ariaLabel: "Muttersprachler",
        emptyCaption: "Muttersprachler-Aufnahme hinzufügen",
        // The line above already says "Muttersprachler-Aufnahme".
        filledCaption: "Antippen zum Abspielen",
        shared: { active: null },
        rowLayout: true,
        getSource: () => recordings.get(card.id),
        setSource: (rec) => {
          if (rec) recordings.set(card.id, rec);
          else recordings.delete(card.id);
          paint();
        },
      });
      render(chipHost, circle.root);
    }

    paint();
    return inLine ? [line, notes, accentNote] : [heading, slot, notes, accentNote];
  }

  /**
   * The rule between a card's front and its answer (#150). Drawn only where
   * the card is a surface of its own — an iPad, like Noji — and `display:
   * none` on the phone, where it takes no space and no gap.
   */
  function cardRule() {
    return el("hr.card-rule.reveal", { "aria-hidden": "true" });
  }

  function revealFlip(card, area, answers) {
    // The front's recorder or Muttersprachler circle is a different DOM node
    // than the one about to replace it — same reasoning as revealSpeak above,
    // playback included (code review, 2026-09-17).
    stopAllRecording();
    stop();
    const meaningFirst = flipsMeaningFirst(card);
    // #113: the word stays where the front showed it — or, with the meaning on
    // the front (#137), the meaning does, and the word comes in under it.
    const settle = holdInPlace(area, meaningFirst ? ".prompt-label" : ".word");
    if (isKana(card)) {
      // #158: the kana stays, and under it how it is read, how it is written
      // and words that start with it.
      render(
        area,
        el(
          "div.word-line",
          {},
          wordHeading(card),
          kanaSpeaker(card),
        ),
        kanaSynthNote(card),
        // Her attempt from the front, beside the sound it is compared with.
        attemptRow(attempt),
        cardRule(),
        el("div.meaning.kana-reading.reveal", { text: card.word_meaning }),
        kanaMnemonicBlock(card, { className: "reveal" }),
        strokeOrder(card),
        kanaExampleBlock(card),
      );
      if (readAloud) voice(card.word, card.word_audio);
    } else if (meaningFirst) {
      render(
        area,
        el("span.prompt-label", { text: "Auf Japanisch" }),
        el("p.meaning", { text: card.word_meaning ?? "" }),
        cardRule(),
        // Her attempt from the front sits right under the ♪ (#185): that
        // comparison is what turning the card is for.
        ...wordSoundParts(card, { label: "Wort hören" }, { reveal: true, withAttempt: true }),
        reading(card.word_furigana || card.word_reading, card.word, card),
        romajiLine(card),
        revealedSentence(card),
        card.sentence_meaning ? el("div.sentence-en.reveal", { text: card.sentence_meaning }) : null,
      );
      if (readAloud) voice(card.word, soundOf(card).file);
    } else {
      render(
        area,
        // Not `.reveal`: this is the front, staying — it does not rise in.
        // The front of the card carries its ♪; before #32 the flip took it
        // away, so the one gesture that had worked a second earlier stopped
        // working exactly when the reading was finally on screen to check it
        // against.
        ...wordSoundParts(card, { small: true, label: "Wort nochmal hören" }),
        // `word_reading` for her own words (#85): `word_furigana` is Anki's
        // bracket notation and is always NULL on a card she wrote, so the
        // reading she typed was stored and never shown. Plain kana passes
        // through `kanaReading` unchanged.
        reading(card.word_furigana || card.word_reading, card.word, card),
        romajiLine(card),
        cardRule(),
        el("div.meaning.reveal", { text: card.word_meaning }),
        revealedSentence(card),
        card.sentence_meaning ? el("div.sentence-en.reveal", { text: card.sentence_meaning }) : null,
      );
      if (readAloud && showsSentence(card, japanese)) voice(card.sentence, card.sentence_audio, { rate: 0.85 });
    }

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
        ratingButton("Nochmal", RATING_AGAIN, () => grade(card, RATING_AGAIN), intervals[RATING_AGAIN]),
        ratingButton("Schwer", RATING_HARD, () => grade(card, RATING_HARD), intervals[RATING_HARD]),
        ratingButton("Gut", RATING_GOOD, () => grade(card, RATING_GOOD), intervals[RATING_GOOD]),
        ratingButton("Leicht", RATING_EASY, () => grade(card, RATING_EASY), intervals[RATING_EASY]),
      ),
    );
    settle();
  }

  /**
   * #113: turn the card over without moving what she was asked.
   *
   * `.card-area` centres its column, so the reveal — which adds a reading, a
   * sentence, a meaning — used to re-centre everything and move the question
   * up the screen (measured: めくる's word 345 → 273), or, in 話す and 書く,
   * replace it outright. Call this while the front is still drawn: it notes
   * where the element matching `selector` sits. Call the function it returns
   * once the answer *and* its buttons are drawn: it pins that element back
   * there, by starting the column at the top with the padding that puts it
   * where it was. The front stays centred as designed; only the answer grows,
   * downward, the way a flashcard is turned over.
   *
   * If the answer does not fit below, the padding gives way first: the
   * question moves up just as far as needed, rather than the buttons being
   * pushed off the bottom.
   */
  function holdInPlace(area, selector) {
    // Layout offsets, not getBoundingClientRect: the answer rises in with an
    // 8px transform (`.reveal`), and measuring mid-animation left めくる's
    // word 8px above where the front had it.
    const offset = () => {
      const anchor = area.querySelector(selector);
      if (!anchor) return undefined;
      let top = 0;
      for (let node = anchor; node && node !== area.offsetParent; node = node.offsetParent) top += node.offsetTop;
      for (let node = area; node && node !== area.offsetParent; node = node.offsetParent) top -= node.offsetTop;
      return top;
    };
    // The session's height with the front up is the height of the screen it
    // has. `.card-area` does not overflow, it grows, and the session with it,
    // pushing the buttons off the bottom — so the session growing is the
    // measure of "does not fit". (Not innerHeight: in the installed app it is
    // 62px short, see base.css.) Settled after the buttons are drawn, because
    // めくる's rating row is taller than the Flip button it replaces: measured
    // before it, a card at 375 × 500 still ran 22px off the bottom.
    const screen = area.parentElement;
    const fits = screen.offsetHeight;
    const before = offset();

    return () => {
      if (before === undefined) return;
      area.classList.add("held");
      area.style.paddingTop = "0px";
      const natural = offset();
      if (natural === undefined) return;
      // #150: on the iPad the card is a surface with its own padding, and
      // text squeezed onto its edge would look like a mistake. 0 on the phone.
      const floor = parseFloat(getComputedStyle(area).getPropertyValue("--held-floor")) || 0;
      const wanted = Math.max(before - natural, floor);
      area.style.paddingTop = `${wanted}px`;
      const over = screen.offsetHeight - fits;
      if (over > 0) area.style.paddingTop = `${Math.max(wanted - over, floor)}px`;
    };
  }

  function revealedSentence(card) {
    if (!showsSentence(card, japanese)) return null;
    // #135: with the script off the sentence is its romaji — since
    // 2026-09-19, when the import writes one good enough to stand alone
    // (Henning: "Hier fehlt Romaji"). Where it could not (8 of 1,500), the
    // sentence stays what it was: its recording, labelled, and no text.
    if (!japanese && card.sentence_romaji) {
      return el(
        "div.sentence-line.reveal",
        {},
        el("div.sentence-copy", {}, el("p.sentence.latin", { text: card.sentence_romaji })),
        speaker(card.sentence, card.sentence_audio, {
          rate: 0.85,
          small: true,
          label: "Satz nochmal hören",
        }),
      );
    }
    if (!japanese) {
      return el(
        "div.sentence-line.reveal",
        {},
        el("span.sentence-sound", { text: "Beispielsatz" }),
        speaker(card.sentence, card.sentence_audio, {
          rate: 0.85,
          small: true,
          label: "Satz nochmal hören",
        }),
      );
    }
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
      el("div.sentence-copy", {}, p, sentenceRomajiLine(card)),
      speaker(card.sentence, card.sentence_audio, {
        rate: 0.85,
        small: true,
        label: "Satz nochmal hören",
      }),
    );
  }

  function next() {
    // #211: the same window as `graded` — 書く's "Nicht gewusst" and 選ぶ's
    // "Weiter" call this directly, and on the last card they too stay on
    // screen while `finish()` waits; a second tap must not finish twice.
    if (finishing) return;
    index += 1;
    if (index >= queue.length) return finish();
    drawCard();
  }

  async function finish() {
    finishing = true;
    stopAllRecording();
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
      // #86: design 11's badge lights "the first time a new joker is earned".
      // A joker is earned by the day's tenth review, which happens inside a
      // session, so the same two server answers that give the XP give this.
      jokerEarned: Boolean(before && after && after.jokers > before.jokers),
    });
  }

  /** Cards met for the first time in this session, as the server counts them. */
  function newCardsIn(after, beforeStats) {
    if (!after || !beforeStats) return 0;
    return Math.max(0, after.cardsSeen - beforeStats.cardsSeen);
  }

  root.destroy = () => {
    stop();
  };
  return root;
}

/**
 * Kaishi stores readings the way Anki writes them: `事[こと]`, and for a
 * sentence ` 兄[あに]は 毎日[まいにち]テレビを 見[み]ます。` — usually a space before
 * each annotated run, which is a separator and not a space in the text.
 *
 * "Usually" — the space is not reliable enough to parse by (#75). A real
 * sentence from the deck reads `あの<b>人[ひと]</b>はいい 人[ひと]です。`: the
 * second 人[ひと] gets Anki's leading space, the first does not. The base is
 * matched as a run of kanji specifically, not "anything that is not a
 * bracket or a space" as it briefly was — that version silently swallowed
 * every kana character back to the previous annotation (or the start of the
 * string) as part of the "base" whenever a run like the first 人[ひと] above
 * had no space to stop it at, which is invisible on a single word
 * (`word_furigana` starts right at the kanji) and total on a sentence: it
 * cost the entire clause before the first annotated word.
 *
 * Shown raw it reads as brackets, which is how めくる looked before this. Split
 * into runs so it can be built as real `<ruby>` elements.
 */
export function parseFurigana(text) {
  const parts = [];
  // Kanji, plus digits: a number can carry its own bracket reading too
  // (`1[いち]`), and it is exactly as safe to bound the base at — a digit is
  // never kana, so it can never wrongly swallow the clause before it.
  const re = /([一-鿿々0-9０-９]+)\[([^\]]+)\]/g;
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

/** Single-mora particles common enough to guess a word boundary at (#75). */
const SENTENCE_PARTICLES = new Set([..."はがをにでともへの"]);

/**
 * A sentence's reading, with a naive word-boundary guess: a space at each
 * furigana-annotation boundary next to one of `SENTENCE_PARTICLES` — never
 * inside a run of plain kana, and never at the word the deck itself
 * annotates.
 *
 * Both restrictions matter. Real segmentation needs a dictionary, which
 * this client does not have; guessing anywhere a target character appears
 * would be worse than no guess at all, because とても and でも are common
 * words whose *second* mora is one of these characters, and a boundary
 * inserted inside them ("tote mo", "de mo") teaches a wrong word split.
 * Confined to furigana boundaries — the edges of the one word per sentence
 * the deck actually annotates — that specific mistake is impossible: such a
 * word can end up fused to its neighbour, but it can never be broken in
 * half.
 *
 * The second restriction is what stopped 図書館[としょかん] from getting a
 * bogus space of its own: unrestricted, "starts with と" fires on と­しょ­かん
 * itself, because と is also the quoting particle — a false positive on
 * every word that happens to start with one of these nine sounds, found by
 * actually running this against the deck rather than reasoning about it (a
 * hand-traced example said no boundary would appear here; the real output
 * disagreed). The fix is directional: a particle character only creates a
 * boundary on the *plain-text* side of a furigana annotation, never as a
 * property of the annotated word's own reading — and, for the same reason,
 * never between two annotated parts in a row. A multi-kanji word is split
 * into one bracket per kanji (友[とも] 達[だち] for 友達, "friend"), and とも
 * ends in も — running the same directional check there split ともだち into
 * "tomo dachi", an actual word broken in half, found the same way as the
 * first bug: by running this against the deck, not by reasoning that the
 * "never breaks a word open" guarantee would obviously still hold.
 *
 * One case neither restriction catches: 最も (もっとも, "most") is one word
 * whose own reading ends in も, split into "motto" + "mo" once in the 1,500
 * sentences measured — the same shape as とても, but on the *reading* side
 * of a single annotated bracket rather than across two, so the "not between
 * two annotated parts" rule does not see it. なにも/だれも/いちども split the
 * same way and are left alone on purpose: those are transparently pronoun +
 * も, not a fused adverb, so "nani mo" is a defensible reading rather than a
 * wrong one. もっとも is the one confirmed case that is not — rare enough
 * (once in 1,500 sentences), and dropping も from `SENTENCE_PARTICLES` would
 * lose more correct splits elsewhere than this single word is worth fixing,
 * that a hardcoded exception is not worth adding (see this project's own
 * history with growing lists like that).
 */
export function sentenceKana(sentenceFurigana) {
  if (!sentenceFurigana) return undefined;
  const parts = parseFurigana(sentenceFurigana.replace(/<\/?b>/gi, ""));
  let kana = "";
  parts.forEach((part, i) => {
    const text = part.reading ?? part.text;
    if (i > 0) {
      const prev = parts[i - 1];
      const prevText = prev.reading ?? prev.text;
      const prevAnnotated = prev.reading !== undefined;
      const thisAnnotated = part.reading !== undefined;
      const boundary =
        prevAnnotated !== thisAnnotated &&
        ((prevAnnotated && SENTENCE_PARTICLES.has(text[0])) ||
          (thisAnnotated && SENTENCE_PARTICLES.has(prevText[prevText.length - 1])));
      if (boundary) kana += " ";
    }
    kana += text;
  });
  return kana;
}

/**
 * The cards 選ぶ may draw a word's wrong answers from.
 *
 * Not one that looks exactly like this card — its meaning would be right too,
 * and marked wrong (see `chooseFrom`). And not one whose meaning is in another
 * language (#137): her imported lists carry the German she wrote, the deck
 * carries English, and three English options around one German answer give the
 * answer away. A card from one of her lists draws from her lists; any other
 * card draws from everything else.
 */
/**
 * Whether めくる shows the meaning first (#137).
 *
 * Her Noji lists were learned that way round — German on the front, the
 * Japanese on the back — and a card from them keeps it. The Kaishi deck keeps
 * the word on the front: its meanings are English, and those cards were never
 * asked the other way. Decided by where a card came from rather than by a
 * setting, so one session over both decks asks each card the way it was
 * written.
 */
export const flipsMeaningFirst = (card) => isInHerDeck(card);

/**
 * A card of hers in one of her decks (#137, migration 016) — all of hers are.
 * `list_name` answers for a card cached before this phone was sent `deck_id`.
 */
export const isInHerDeck = (card) => Boolean(card?.deck_id ?? card?.list_name);

/**
 * Whether a card's example sentence is offered at all (#137, v66).
 *
 * Only with something to read beside the sound: the Japanese, or a
 * translation. With the script off, a card from her Noji lists has neither —
 * its sentence came from Kaishi, and its English was taken off at Henning's
 * request (v62) — so it was a six-second recording and the words "Example
 * sentence", which he heard as a voice not saying the word at all. Like Noji,
 * such a card is its word and nothing else.
 */
export function showsSentence(card, japanese) {
  return Boolean(card?.sentence) && (Boolean(japanese) || Boolean(card.sentence_meaning));
}

/**
 * Whether anything may be played for a text (#137, v66): its recording, or
 * speech synthesis — but synthesis only of Japanese characters. Her Noji words
 * are romaji ("Totemo oishii desu"), and a Japanese voice reading Latin letters
 * guesses at the pronunciation. Henning: "lieber stumm als falsch". 339 of the
 * 551 cards in her two lists have no recording (measured 2026-09-14).
 */
export function canVoice(text, file) {
  return Boolean(file) || inScript(text);
}

/** "Es ist sehr lecker" is a sentence; "Zug" and "Nur das" are not. */
const isPhrase = (text) => (text ?? "").trim().split(/\s+/).length >= 3;

/**
 * Which cards may lend a wrong answer to which: her decks' German to hers,
 * Kaishi's English to Kaishi's, and a kana's reading only to kana of the same
 * script (#158) — "ka" among Kaishi's glosses would be the answer at a glance,
 * and a Kaishi word offered "ka" would be nonsense.
 */
const answerGroup = (card) => (isInHerDeck(card) ? "hers" : isKana(card) ? card.deck : "kaishi");

/** Two gojūon rows either side (import/lib/kana.js ranks them in teaching order). */
const KANA_NEIGHBOURS = 10;

export function meaningPool(card, pool, japanese = true) {
  const shown = shownWord(card, japanese);
  const fromList = isInHerDeck(card);
  const group = answerGroup(card);
  const candidates = pool.filter(
    (c) => answerGroup(c) === group && shownWord(c, japanese) !== shown,
  );
  // #137, v66: on her lists a whole sentence among single words is the right
  // answer at a glance, whatever the Japanese said — "Es ist sehr lecker"
  // against "Schulclub", "Schulter" and "Warum". So a sentence gets sentences
  // and a word gets words, while there are three to choose from (101 of the
  // 551 meanings are three words or more). Kaishi's English glosses are not
  // sentences, and keep the pool they had.
  if (isKana(card)) {
    // #158: a kana's wrong answers come from the rows around it — the ones she
    // is learning with it, not "ji" beside イ on her second day, which is
    // wrong at a glance because she has not met ジ yet.
    const near = candidates.filter(
      (c) => Math.abs((c.frequency_rank ?? 0) - (card.frequency_rank ?? 0)) <= KANA_NEIGHBOURS,
    );
    return near.length >= 3 ? near : candidates;
  }
  if (!fromList) return candidates;
  const alike = candidates.filter((c) => isPhrase(c.word_meaning) === isPhrase(card.word_meaning));
  return alike.length >= 3 ? alike : candidates;
}

/** The media files of a kana card's stroke-order drawings (import/import-kana.js names them). */
export function strokeFiles(card) {
  return [...(card.word ?? "")].map((c) => `kanjivg-${c.codePointAt(0).toString(16).padStart(5, "0")}.svg`);
}

/**
 * A kana card's example words (#158, v78), as `npm run import-kana` chose them
 * — Kaishi first, then the JLPT lists (import/lib/examples.js has the rules).
 * Unreadable or absent is no examples, never an error on a card.
 */
export function kanaExamples(card) {
  if (!card?.word_examples) return [];
  try {
    const list = JSON.parse(card.word_examples);
    return Array.isArray(list) ? list.filter((e) => e?.kana && e?.meaning) : [];
  } catch {
    return [];
  }
}

/**
 * The recording 選ぶ may play and offer before she answers: the word's — but
 * never a kana's, whose sound is the answer (v84, #158).
 */
export function promptAudio(card) {
  return isKana(card) ? null : (card?.word_audio ?? null);
}

/** A kana whose ♪ is the phone's voice: one of the sounds with no recording (v84). */
export function kanaSynthesised(card) {
  return isKana(card) && !card.word_audio;
}

/** The recordings of a kana card's example words (v83), to fetch with the card. */
export function exampleAudio(card) {
  return kanaExamples(card)
    .map((e) => e.audio)
    .filter((file) => typeof file === "string" && file);
}

/**
 * An example word cut round the kana it is an example of (v83), so the sound
 * can be marked where it is — at the start, or inside the word. `at` is the
 * import's (`soundAt`); an example without one, or with one that does not
 * point at the kana, is left unmarked rather than marked in the wrong place.
 */
export function soundParts(text, kana, at) {
  if (!text || !kana || !Number.isInteger(at) || at < 0 || !text.startsWith(kana, at)) return [{ text }];
  return [
    { text: text.slice(0, at) },
    { text: kana, mark: true },
    { text: text.slice(at + kana.length) },
  ].filter((part) => part.text);
}

function markedSound(text, kana, at) {
  return soundParts(text, kana, at).map((part) => (part.mark ? el("span.kana-hit", { text: part.text }) : part.text));
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
  // 書く needs a reading to check the answer against. Every deck card has one
  // (measured: 1,500 of 1,500); her own kanji words without the optional
  // Reading field do not, and could only be answered on a Japanese keyboard
  // she may not have.
  if (mode === "type") return cards.filter((c) => readingsOf(c).length > 0);
  if (mode !== "listen") return cards;
  return cards.filter(
    (c) => c.sentence && c.sentence_meaning && (c.sentence_audio || (speaks && inScript(c.sentence))),
  );
}

/**
 * A card's readings as kana, for 書く: from the deck's furigana, then from the
 * Reading field of her own card, then the word itself when it is kana already.
 * The same order `romajiLine` reads them in. Nothing that is not kana counts
 * as a reading — a kanji word with no reading has none.
 */
export function readingsOf(card) {
  const kana = kanaReading(card.word_furigana) || card.word_reading || card.word;
  return splitReadings(kana).filter((r) => /^[ぁ-ゖー]+$/.test(r));
}

/**
 * The cards 書く accepts for this card's prompt: this one, and every other
 * whose English meaning is the same words (`typing.js`'s `judge`).
 */
export function typingAnswers(card, pool) {
  const meaning = (m) => (m ?? "").trim().toLowerCase();
  const asked = meaning(card.word_meaning);
  const others = asked
    ? pool.filter((c) => c.id !== card.id && meaning(c.word_meaning) === asked)
    : [];
  return [card, ...others]
    .map((c) => ({ id: c.id, word: c.word, readings: readingsOf(c) }))
    .filter((a) => a.readings.length > 0 || a.id === card.id);
}

/**
 * Whether 話す asks about the sentence or the word (#77).
 *
 * A card with no sentence is never in doubt — "sentence" and "random" both
 * fall back to the word, the same as before this setting existed, so her own
 * cards (which have none) are unaffected by any of the three values. "random"
 * only spends the coin flip where there is a real choice to make.
 *
 * Nor is a sentence with no translation (#137): the translation is the prompt.
 * The cards from her Noji lists keep Kaishi's sentence and recording without
 * its English, and asked about the sentence they would show an empty prompt.
 */
export function speakUsesSentence(card, speakSource, random = Math.random) {
  if (!card.sentence || !card.sentence_meaning) return false;
  if (speakSource === "word") return false;
  if (speakSource === "random") return random() < 0.5;
  return true;
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
