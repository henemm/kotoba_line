/**
 * "Zum Home-Bildschirm" — the step nobody takes by themselves (#260).
 *
 * Fifteen travellers will open an invitation link from their mail app, sign
 * up, and stay in a browser tab: half the screen height, no notifications,
 * and next time they have to find the address again. Henning, 2026-09-20:
 * "Auf iOS 27 ist die Option noch versteckter" — the share sheet moved
 * behind the ••• in the address bar, so the instructions say both places.
 *
 * Shown once per device, after signing in or signing up, and only while the
 * app is *not* already installed. Afterwards it lives in Settings, because
 * the one thing worse than a hint nobody wanted is a hint nobody can find
 * again.
 */
import { seen } from "./seen.js";
import { el } from "./ui/dom.js";

/** Whether this is the installed app rather than a browser tab. */
export function isStandalone() {
  const nav = globalThis.navigator ?? {};
  return nav.standalone === true || globalThis.matchMedia?.("(display-mode: standalone)").matches === true;
}

const isApple = () => {
  const nav = globalThis.navigator ?? {};
  return /iPhone|iPad|iPod/.test(nav.userAgent ?? "") || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
};

/**
 * Chromium keeps its own install prompt and offers it through this event;
 * caught as early as the module loads, because the browser fires it once and
 * a prompt that was not kept cannot be shown later.
 */
let deferredPrompt;
if (typeof addEventListener === "function") {
  addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });
}

/** The steps for this browser, as a heading and a list of sentences. Pure. */
export function installSteps({ apple = isApple() } = {}) {
  if (apple) {
    return {
      title: "Auf den Home-Bildschirm legen",
      why: "So wird ことばライン eine App: ganzer Bildschirm, offline nutzbar, und Erinnerungen sind überhaupt erst möglich.",
      steps: [
        "Tippe in der Adresszeile auf das Teilen-Symbol – ein Quadrat mit einem Pfeil nach oben. Auf neueren iPhones steckt es hinter den drei Punkten rechts in der Adresszeile.",
        "Wisch in der Liste nach unten, bis „Zum Home-Bildschirm“ kommt, und tippe darauf.",
        "Oben rechts auf „Hinzufügen“. Danach startest du die App über das neue Symbol, nicht mehr über den Link.",
      ],
    };
  }
  return {
    title: "Als App installieren",
    why: "So wird ことばライン eine App: ganzer Bildschirm, offline nutzbar, und Erinnerungen sind überhaupt erst möglich.",
    steps: [
      "Tippe oben rechts im Browser auf die drei Punkte.",
      "Wähle „App installieren“ oder „Zum Startbildschirm hinzufügen“.",
      "Danach startest du die App über das neue Symbol, nicht mehr über den Link.",
    ],
  };
}

/**
 * The sheet itself. `reason` is only for the record: "signup", "signin" or
 * "settings", so it can be told later which of them anyone read.
 */
export function openInstallHint(reason = "settings") {
  if (typeof document === "undefined") return;
  const { title, why, steps } = installSteps();
  seen("install_hint_shown", reason);
  // On the body, not in #app: signing up is followed by the first-run
  // download, and every redraw of #app would take the sheet with it. The
  // scrim is `position: fixed` for exactly this.
  const host = document.body;
  const close = (how) => {
    seen("install_hint_closed", how);
    scrim.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => e.key === "Escape" && close("escape");

  // Chromium can do it in one tap; Safari cannot, and there the list is all
  // there is. A button that only sometimes exists is better than a button
  // that sometimes does nothing.
  const install = deferredPrompt
    ? el("button.btn.solid", {
        type: "button",
        text: "Installieren",
        onclick: async () => {
          const prompt = deferredPrompt;
          deferredPrompt = undefined;
          prompt.prompt();
          const { outcome } = await prompt.userChoice.catch(() => ({ outcome: "dismissed" }));
          seen(outcome === "accepted" ? "install_accepted" : "install_dismissed", reason);
          close(outcome);
        },
      })
    : null;

  const scrim = el(
    "div.sheet-scrim.info-sheet",
    { onclick: (e) => e.target === e.currentTarget && close("scrim") },
    el(
      "div.sheet",
      { role: "dialog", "aria-label": title },
      el("h2.sheet-title", { text: title }),
      el("p.sheet-body", { text: why }),
      el("ol.install-steps", {}, steps.map((text) => el("li", { text }))),
      el(
        "div.sheet-actions",
        {},
        el("button.btn", { type: "button", text: install ? "Später" : "Verstanden", onclick: () => close("ok") }),
        install,
      ),
    ),
  );
  document.addEventListener("keydown", onKey);
  host.append(scrim);
}

/**
 * Whether this device has been told already. Kept in localStorage rather
 * than in IndexedDB: it is one flag, it is read at a moment when the rest of
 * the start is already busy, and losing it costs one extra hint.
 */
const SEEN_KEY = "installHint";

export function hintPending() {
  if (isStandalone()) return false;
  try {
    return localStorage.getItem(SEEN_KEY) !== "1";
  } catch {
    return true;
  }
}

export function markHintShown() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* private mode: the hint comes once more, which is not a fault */
  }
}

/** Show it once, after a start in a browser tab. */
export function offerInstall(reason) {
  if (!hintPending()) return;
  markHintShown();
  openInstallHint(reason);
}
