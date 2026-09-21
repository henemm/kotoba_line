/**
 * Asking for the notification permission at a moment she will actually see
 * (#99 follow-up, Henning 2026-09-21).
 *
 * The offer for "Deine nächsten Karten sind bereit" (#248) appears on the
 * session summary — after a session that ended with cards waiting soon. For
 * the reminder that circle does not close: she has to practise to be offered
 * the thing that reminds her to practise. Measured 2026-09-21: Charlotte had
 * answered no card for three days, `push_subscriptions` was empty, and her
 * reminder was on and could reach nobody.
 *
 * So when the switch is on and this device cannot deliver, the app asks on a
 * start — once per device, on a tab screen, never over a card.
 *
 * It does not ask in the "denied" state: iOS takes that answer once and only
 * its own settings can undo it, so a second sheet would be a dead end. The
 * Settings row says where to go instead.
 */
import { seen } from "./seen.js";
import { el, render } from "./ui/dom.js";

/** The device states where asking can still lead somewhere. */
const ASKABLE = ["ask", "off", "declined"];

const SEEN_KEY = "remindOffer";

/**
 * Whether to offer, given the setting and what `pushState()` reported. Pure,
 * because the interesting part is which states are left out.
 */
export function shouldOffer({ reminder, pushState, asked }) {
  if (!reminder) return false;
  if (asked) return false;
  return ASKABLE.includes(pushState);
}

/** Once per device. A lost flag costs one extra sheet, which is not a fault. */
export function offerAsked() {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markOfferAsked() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* private mode */
  }
}

/**
 * The sheet. `onEnable` does the asking (push.js `enablePush`) and resolves to
 * the state afterwards, so this module holds no browser API of its own.
 */
export function openReminderOffer({ onEnable, onDecline } = {}) {
  if (typeof document === "undefined") return;
  seen("remind_offer_shown");
  const close = (how) => {
    seen("remind_offer_closed", how);
    scrim.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => e.key === "Escape" && close("escape");

  const say = (text) => {
    render(
      body,
      el("p.sheet-body", { text }),
    );
    render(actions, el("button.btn.solid", { type: "button", text: "Alles klar", onclick: () => close("done") }));
  };

  const body = el("div.sheet-body-slot");
  const actions = el("div.sheet-actions");

  const scrim = el(
    "div.sheet-scrim.info-sheet",
    { onclick: (e) => e.target === e.currentTarget && close("scrim") },
    el(
      "div.sheet",
      { role: "dialog", "aria-label": "Erinnerung einschalten" },
      el("h2.sheet-title", { text: "Soll ich dich erinnern?" }),
      body,
      actions,
    ),
  );

  render(
    body,
    el("p.sheet-body", {
      text: "Du hast die Erinnerung eingeschaltet: eine Nachricht um 18:00 an einem Tag, an dem noch keine Karte dran war. Dafür muss dein iPhone sie einmal erlauben.",
    }),
  );
  render(
    actions,
    el("button.btn", {
      type: "button",
      text: "Später",
      onclick: () => {
        seen("remind_offer_no");
        onDecline?.();
        close("later");
      },
    }),
    el("button.btn.solid", {
      type: "button",
      text: "Erlauben",
      onclick: async (e) => {
        seen("remind_offer_yes");
        e.currentTarget.disabled = true;
        const next = await onEnable?.().catch(() => "error");
        if (next === "on") {
          seen("push_granted", "remind_offer");
          say("Gut – ich melde mich um 18:00, wenn an dem Tag noch nichts dran war. Ausschalten kannst du das in den Einstellungen.");
          return;
        }
        if (next === "denied") {
          seen("push_denied", "remind_offer");
          say("In Ordnung, keine Benachrichtigungen. Falls du es dir anders überlegst: iPhone-Einstellungen → Mitteilungen → ことばライン.");
          return;
        }
        say("Das hat gerade nicht geklappt. Du kannst es später in den Einstellungen noch einmal versuchen.");
      },
    }),
  );

  document.addEventListener("keydown", onKey);
  document.body.append(scrim);
}
