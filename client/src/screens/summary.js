import { modeByKey } from "../modes.js";
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
 * mode colour for cleared, red for missed. A session is modal, so there is no
 * tab bar underneath.
 */
export function summaryScreen(result, { onDone, onAgain }) {
  const line = modeByKey(result.mode) ?? modeByKey("choose");
  const root = el("div.summary", { style: { "--rail": line.colour } });

  const shown = result.missed.slice(0, MISSED_SHOWN);
  const more = result.missed.length - shown.length;

  render(
    root,
    el(
      "div.summary-strip",
      {},
      result.results.map((ok) => el("span.station", { class: ok ? "done" : "missed" })),
    ),
    el(
      "div.summary-body",
      {},
      el("span.summary-jp.jp", { text: greeting(result) }),
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
        figure(mmss(result.seconds), "Minutes"),
        figure(String(result.newCards ?? 0), "New"),
      ),
      // At zero missed the block is dropped and the three figures centre on
      // their own.
      shown.length
        ? el(
            "div.missed",
            {},
            el("span.mono-label", { text: "Worth another look" }),
            shown.map((card) =>
              el(
                "div.missed-row",
                {},
                el("span.missed-jp.jp", { text: card.word }),
                el("span.missed-en", { text: card.word_meaning }),
              ),
            ),
            more > 0 ? el("div.missed-more", { text: `and ${more} more` }) : null,
          )
        : null,
      result.synced === false
        ? el("p.summary-note", {
            text: "Saved on this device. It will reach the server when the connection does.",
          })
        : null,
    ),
    el(
      "div.summary-foot",
      {},
      el("button.summary-done", { type: "button", text: "Done", onclick: onDone }),
      el("button.summary-again", { type: "button", text: "Again", onclick: onAgain }),
    ),
  );

  if (result.levelUp) root.append(levelUpOverlay(result));
  return root;
}

function greeting({ right, total }) {
  const share = total > 0 ? right / total : 0;
  if (share === 1) return "完璧！";
  return share >= 0.7 ? "おつかれさま！" : "また明日！";
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
    el("span.levelup-label", { text: "Level up" }),
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
        text: `${num(levelUp.cardsSince)} cards since level ${levelUp.from}`,
      }),
    ),
  );

  return overlay;
}
