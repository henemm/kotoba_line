import { modeByKey } from "../modes.js";
import { showsScript, shownWord } from "../script.js";
import { el, num, render } from "../ui/dom.js";

/** The missed list caps at five and says how many are behind it. */
const MISSED_SHOWN = 5;

/** Design 03: the moment holds, then gets out of the way. */
const LEVEL_UP_MS = 3000;

export const mmss = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(Math.round(seconds) % 60).padStart(2, "0")}`;

/**
 * Design 09 — the session summary.
 *
 * The station strip stays at the top and becomes the record of the route:
 * green for cleared, red for missed (#156: it was the mode colour, which in
 * 選ぶ is an orange too close to red). A session is modal, so there is no
 * tab bar underneath.
 */
export function summaryScreen(result, { onDone, onAgain, onCarryOn, onPushYes, onPushNo, japanese = true }) {
  const line = modeByKey(result.mode) ?? modeByKey("choose");
  const root = el("div.summary", { style: { "--rail": line.colour } });

  const shown = result.missed.slice(0, MISSED_SHOWN);
  const more = result.missed.length - shown.length;

  render(
    root,
    el(
      "div.summary-strip",
      {},
      el(
        "div.stations",
        {},
        result.results.map((ok) => el("span.station", { class: ok ? "done" : "missed" })),
      ),
      // 40: the chosen set keeps its dashed rule here too, so the summary
      // belongs to the session it came from rather than to the day.
      result.chosenLabel
        ? el(
            "div.chosen-rule",
            {},
            el("span.dash"),
            el("span.chosen-text", { text: `Deine Auswahl · ${result.chosenLabel}` }),
            el("span.dash.long"),
          )
        : null,
    ),
    el(
      "div.summary-body",
      {},
      japanese
        ? el("span.summary-jp.jp", { text: greeting(result) })
        : el("span.summary-jp", { text: greetingInEnglish(result) }),
      el(
        "div.score",
        {},
        el("span.score-value.tabular", { text: String(result.right) }),
        el("span.score-of.tabular", { text: `/${result.total}` }),
      ),
      el(
        "div.figures",
        {},
        figure(result.xpGained != null ? `+${num(result.xpGained)}` : "—", "XP"),
        figure(mmss(result.seconds), "Minuten"),
        figure(String(result.newCards ?? 0), "Neu"),
      ),
      // At zero missed the block is dropped and the three figures centre on
      // their own.
      shown.length
        ? el(
            "div.missed-list",
            {},
            el("span.mono-label", { text: "Nochmal ansehen" }),
            shown.map((card) =>
              el(
                "div.missed-row",
                {},
                el(showsScript(card, japanese) ? "span.missed-jp.jp" : "span.missed-jp", {
                  text: shownWord(card, japanese),
                }),
                el("span.missed-en", { text: card.word_meaning }),
              ),
            ),
            more > 0 ? el("div.missed-more", { text: `und ${more} weitere` }) : null,
          )
        : null,
      // 40: "finishing a chosen set is not finishing the day". The sentence
      // says which it was, and the primary button below is the way back to
      // the real queue.
      result.chosenLabel
        ? el("p.summary-note.chosen-note", { text: chosenSentence(result) })
        : null,
      result.synced === false
        ? el("p.summary-note", {
            text: "Auf diesem Gerät gespeichert. Es wird übertragen, sobald du wieder Verbindung hast.",
          })
        : null,
      result.pushOffer ? pushOfferBlock(result.pushOffer, { onPushYes, onPushNo }) : null,
    ),
    result.chosenLabel ? chosenFoot(result, { onDone, onCarryOn }) : el(
      "div.summary-foot",
      {},
      el("button.summary-done", { type: "button", text: "Fertig", onclick: onDone }),
      // #271: with cards she answered Nochmal or Schwer, it practises those
      // and a few new ones (app.js); the label says it is not the same round.
      el("button.summary-again", { type: "button", text: result.struggled?.length ? "Nochmal üben" : "Nochmal", onclick: onAgain }),
    ),
  );

  if (result.levelUp) root.append(levelUpOverlay(result));
  return root;
}

/**
 * 40's sentence. "When nothing is due the sentence becomes 'Nothing else is
 * due today'" — and the two buttons collapse into one.
 */
export function chosenSentence({ chosenLabel, stillDue }) {
  const set = `Deine Auswahl „${chosenLabel}“, nicht die Wiederholungen von heute.`;
  if (stillDue === undefined) return set;
  if (stillDue === 0) return `${set} Heute ist nichts anderes mehr fällig.`;
  return `${set} ${num(stillDue)} ${stillDue === 1 ? "Karte ist" : "Karten sind"} noch fällig.`;
}

/**
 * 40's foot. The way back to the real queue is the loudest thing on the
 * screen, because finishing a chosen set is not finishing the day — and when
 * there is nothing to carry on to, the two buttons become one.
 */
function chosenFoot({ stillDue }, { onDone, onCarryOn }) {
  if (!stillDue) {
    return el(
      "div.summary-foot.stacked",
      {},
      el("button.btn-primary", { type: "button", text: "Fertig für jetzt", onclick: onDone }),
    );
  }
  return el(
    "div.summary-foot.stacked",
    {},
    el("button.btn-primary", {
      type: "button",
      text: `Weitermachen mit ${num(stillDue)} fälligen`,
      onclick: onCarryOn,
    }),
    el("button.summary-done", { type: "button", text: "Fertig für jetzt", onclick: onDone }),
  );
}

function greeting({ right, total }) {
  const share = total > 0 ? right / total : 0;
  if (share === 1) return "完璧！";
  return share >= 0.7 ? "おつかれさま！" : "また明日！";
}

/** #135: the same three, for the script switched off. */
function greetingInEnglish({ right, total }) {
  const share = total > 0 ? right / total : 0;
  if (share === 1) return "Perfekt!";
  return share >= 0.7 ? "Gut gemacht!" : "Bis morgen!";
}

function figure(value, label) {
  return el(
    "div.figure",
    {},
    el("span.figure-value.tabular", { text: value }),
    el("span.figure-label", { text: label }),
  );
}

/**
 * Design 03 — level up.
 *
 * One orchestrated moment: the old level dims to the left, the new numeral is
 * the size of the screen. Auto-dismisses after three seconds; a tap anywhere
 * dismisses it sooner. It never blocks the summary underneath — the reward is
 * the number changing, not confetti.
 */
function levelUpOverlay({ levelUp }) {
  const overlay = el("div.levelup", { role: "status" });

  const dismiss = () => overlay.remove();
  overlay.addEventListener("click", dismiss);
  const timer = setTimeout(dismiss, LEVEL_UP_MS);
  overlay.addEventListener("remove", () => clearTimeout(timer));

  render(
    overlay,
    el("span.levelup-label", { text: "Level aufgestiegen" }),
    el(
      "div.levelup-numbers",
      {},
      el("span.levelup-from.tabular", { text: String(levelUp.from) }),
      el("span.levelup-dash"),
      el("span.levelup-to.tabular", { text: String(levelUp.to) }),
    ),
    el(
      "div.levelup-meta",
      {},
      el("span.levelup-xp", { text: `${num(levelUp.xp)} XP` }),
      el("span.levelup-since", {
        text: `${num(levelUp.cardsSince)} Karten seit Level ${levelUp.from}`,
      }),
    ),
  );

  return overlay;
}

/**
 * #248: the offer, made after a session that left cards a few minutes from
 * due. It says what for before the system dialog comes — iOS asks only once,
 * and a "Nicht erlauben" can only be undone in the iOS settings.
 */
export function pushOfferText(cards) {
  const what = cards === 1 ? "1 Karte kommt" : `${cards} Karten kommen`;
  return `${what} in ein paar Minuten wieder. Soll ich dir Bescheid geben, wenn sie bereit sind?`;
}

export function pushOutcomeText(outcome) {
  if (outcome === "on") return "Gut – ich melde mich, wenn deine nächsten Karten bereit sind. Ausschalten kannst du das in den Einstellungen.";
  if (outcome === "denied") return "In Ordnung, keine Benachrichtigungen. Falls du es dir anders überlegst: iPhone-Einstellungen → Mitteilungen → ことばライン.";
  if (outcome === "error") return "Das hat gerade nicht geklappt. Du kannst es später in den Einstellungen noch einmal versuchen.";
  return undefined;
}

function pushOfferBlock({ cards, outcome }, { onPushYes, onPushNo }) {
  const done = pushOutcomeText(outcome);
  if (done) return el("p.summary-note.push-offer", { text: done });
  return el(
    "div.push-offer",
    {},
    el("p.summary-note", { text: pushOfferText(cards) }),
    el(
      "div.push-offer-actions",
      {},
      el("button.btn-primary", { type: "button", text: "Ja, Bescheid geben", onclick: onPushYes }),
      el("button.push-offer-no", { type: "button", text: "Nein, danke", onclick: onPushNo }),
    ),
  );
}
