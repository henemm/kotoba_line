import { ApiError, OfflineError, api } from "../api.js";
import { appName } from "../script.js";
import { el, render } from "../ui/dom.js";
import { pinEntry } from "./signin.js";

/**
 * Sign up with an invitation code (#260).
 *
 * Reached only by the link the code is in — `…/kotoba/?einladung=REISE26` —
 * because accounts are not otherwise made from the web (§10) and the app is
 * on a public address. Henning, 2026-09-20: Julia travels with about fifteen
 * doctoral students whose names he does not know, so a code for the group
 * rather than an account per person.
 *
 * The screen is the sign-in screen with one more thing to choose: the PIN is
 * hers to pick, not one she is given. Everything else — the cells, the
 * rate-limit countdown, the error states — is `pinEntry`, the same control.
 */
const REFUSED = {
  unknown: "Diesen Einladungscode gibt es nicht. Prüf den Link.",
  expired: "Dieser Einladungscode ist abgelaufen.",
  full: "Dieser Einladungscode ist aufgebraucht.",
  handle_taken: "Diesen Namen gibt es schon. Nimm einen anderen.",
  bad_handle: "Dieser Name geht nicht. Buchstaben und Zahlen, bitte.",
  bad_pin: "Die PIN muss sechs Ziffern haben.",
};

export function registerScreen({ code, onSignedIn, onGiveUp, japanese = true }) {
  const root = el("div.screen.signin-screen", {
    style: { flex: "1", display: "flex", flexDirection: "column" },
  });

  const nameInput = el("input", {
    type: "text",
    autocomplete: "username",
    autocapitalize: "none",
    autocorrect: "off",
    spellcheck: "false",
    maxlength: "22",
    placeholder: "dein Name",
    "aria-label": "Name",
    enterkeyhint: "next",
  });

  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      pin.focus();
    }
  });

  const pin = pinEntry({
    buttonText: "Konto anlegen",
    canSubmit: () => nameInput.value.trim().length > 0,
    errorMessage: registerMessage,
    clearOnError: false,
    onState: (state) => form.setAttribute("data-state", state),
    onSubmit: async (value) => {
      const user = await api.register(code, nameInput.value.trim(), value);
      onSignedIn(user);
    },
  });

  nameInput.addEventListener("input", pin.refresh);

  // What the code is for, once the server has said whether it still works.
  // Drawn as a line above the fields rather than as a screen of its own: a
  // code that is full or expired has to say so before anyone types a PIN.
  const invite = el("p.invite-state", { text: "Einladung wird geprüft …" });

  const form = el(
    "div.signin",
    { dataset: { state: "default" } },
    el(
      "div.block.title",
      {},
      el(japanese ? "h1.jp" : "h1", { text: appName(japanese) }),
      el("p.tagline", { text: "Such dir einen Namen und eine PIN aus. Beides brauchst du zum Anmelden." }),
      invite,
    ),
    el("div.block.name", {}, el("div.mono-label", { text: "Name" }), nameInput),
    el(
      "div.block.pin.pin-entry",
      {},
      el("div.mono-label", { text: "PIN · sechs Ziffern, die du dir merkst" }),
      pin.cells,
      pin.capture,
      pin.messageSlot,
    ),
  );

  const foot = el(
    "div.signin-foot",
    {},
    pin.button,
    el(
      "p.note",
      {},
      "Dein Lernstand gehört zu diesem Konto. Die PIN kann niemand zurücksetzen – schreib sie dir auf. ",
      onGiveUp ? el("button.link", { type: "button", text: "Ich habe schon ein Konto", onclick: onGiveUp }) : null,
    ),
  );

  render(root, form, foot);

  api.invite(code).then(
    (state) => {
      if (state.ok) {
        render(invite, el("span", { text: `${state.label} · noch ${state.left} ${state.left === 1 ? "Platz" : "Plätze"}` }));
        return;
      }
      render(invite, el("span.invite-bad", { text: REFUSED[state.reason] ?? REFUSED.unknown }));
      pin.setDisabled?.(true);
    },
    () => render(invite, el("span.invite-bad", { text: "Keine Verbindung. Versuch es gleich noch einmal." })),
  );

  queueMicrotask(() => nameInput.focus());

  root.destroy = pin.destroy;
  return root;
}

/** The reason the server gave, as a sentence — for pinEntry's message slot. */
export function registerMessage(err) {
  if (err instanceof OfflineError) return "Keine Verbindung. Versuch es gleich noch einmal.";
  if (err instanceof ApiError) return REFUSED[err.body?.error] ?? "Das hat nicht geklappt.";
  return "Das hat nicht geklappt.";
}
