import { ApiError, OfflineError, api } from "../api.js";
import { el, render } from "../ui/dom.js";

const PIN_LENGTH = 6;

/**
 * The PIN control, shared by 01 and 52.
 *
 * Six drawn cells over one hidden input — the cells are a drawing so they can
 * be styled, the real field is an `input` so the OS keyboard, autofill and
 * paste all behave. The message slot below is always present, so nothing
 * reflows when an error appears.
 *
 * It owns the three states and the rate-limit countdown, because both screens
 * that ask for a PIN need all of it and the countdown is the fiddly part.
 * The caller supplies the container, the button's word and what submitting
 * actually does; `onState` is how the screen's own root gets `data-state`,
 * which is what the CSS colours the cells from.
 */
export function pinEntry({ buttonText, onSubmit, canSubmit = () => true, onState }) {
  let pin = "";
  let state = "default"; // default | error | limited
  let message = "";
  let retryAt = 0;
  let countdownTimer;

  const capture = el("input.capture", {
    type: "tel",
    inputmode: "numeric",
    autocomplete: "one-time-code",
    maxlength: String(PIN_LENGTH),
    "aria-label": "PIN, six digits",
  });

  const cells = el("div.cells");
  const messageSlot = el("div.message");
  const button = el("button.btn-primary", { type: "button" }, buttonText);

  function drawCells() {
    render(
      cells,
      Array.from({ length: PIN_LENGTH }, (_, i) => {
        const filled = i < pin.length;
        const focused = i === pin.length && state !== "limited";
        return el(
          "div.cell",
          { class: focused ? "focus" : undefined },
          filled ? el("span.filled") : focused ? el("span.caret") : null,
        );
      }),
    );
  }

  function drawMessage() {
    render(
      messageSlot,
      message ? el("span.dot") : null,
      message ? el("span", { text: message }) : null,
    );
  }

  function setState(next, text = "") {
    state = next;
    message = text;
    onState?.(state);
    drawCells();
    drawMessage();
    updateButton();
  }

  function updateButton() {
    if (state === "limited") {
      const left = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
      const mm = Math.floor(left / 60);
      const ss = String(left % 60).padStart(2, "0");
      button.textContent = `Try again in ${mm}:${ss}`;
      button.disabled = true;
      button.classList.add("tabular");
      return;
    }
    button.classList.remove("tabular");
    button.textContent = buttonText;
    button.disabled = pin.length !== PIN_LENGTH || !canSubmit();
  }

  /** Re-enables on zero without a reload, as the design note requires. */
  function startCountdown(seconds) {
    retryAt = Date.now() + seconds * 1000;
    clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      if (Date.now() >= retryAt) {
        clearInterval(countdownTimer);
        setState("default");
        return;
      }
      updateButton();
    }, 250);
    setState("limited", `Too many attempts. Five per minute.`);
  }

  capture.addEventListener("input", () => {
    pin = capture.value.replace(/\D/g, "").slice(0, PIN_LENGTH);
    capture.value = pin;
    if (state === "error") setState("default");
    else {
      drawCells();
      updateButton();
    }
  });

  cells.addEventListener("click", () => capture.focus());

  async function submit() {
    if (button.disabled) return;
    button.disabled = true;

    try {
      await onSubmit(pin);
      clearInterval(countdownTimer);
    } catch (err) {
      // The PIN clears, the name is kept, focus returns to cell one.
      pin = "";
      capture.value = "";

      if (err instanceof OfflineError) {
        setState("error", "No connection. Try again in a moment.");
      } else if (err instanceof ApiError && err.status === 429) {
        // nginx rate-limits to five a minute (§9). It cannot tell us how long
        // is left, so the countdown runs the full window.
        startCountdown(60);
        return;
      } else {
        setState("error", "That PIN doesn't match.");
        capture.focus();
      }
    }
  }

  button.addEventListener("click", submit);
  capture.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });

  drawCells();
  drawMessage();
  updateButton();

  return {
    cells,
    capture,
    messageSlot,
    button,
    /** Call when something *outside* the PIN changes whether it can be sent. */
    refresh: updateButton,
    focus: () => capture.focus(),
    destroy: () => clearInterval(countdownTimer),
  };
}

/**
 * Design 01. Three states: default, wrong PIN, and rate limited.
 *
 * There is no sign-up and no reset — accounts are made on the server (§10) —
 * so the screen's whole job is two fields and one action.
 */
export function signInScreen({ onSignedIn }) {
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
    placeholder: "your name",
    "aria-label": "Name",
  });

  const pin = pinEntry({
    buttonText: "Start",
    canSubmit: () => nameInput.value.trim().length > 0,
    onState: (state) => {
      form.dataset.state = state;
    },
    onSubmit: async (value) => {
      const user = await api.login(nameInput.value.trim(), value);
      onSignedIn(user);
    },
  });

  nameInput.addEventListener("input", pin.refresh);

  const form = el(
    "div.signin",
    { dataset: { state: "default" } },
    el("div.rail"),
    el(
      "div.block.title",
      {},
      el("span.stop"),
      el("h1.jp", { text: "ことばライン" }),
      el("p.tagline", { text: "Four practice modes over one Japanese deck." }),
    ),
    el(
      "div.block.name",
      {},
      el("span.stop"),
      el("div.mono-label", { text: "Name" }),
      nameInput,
    ),
    el(
      "div.block.pin.pin-entry",
      {},
      el("span.stop"),
      el("div.mono-label", { text: "PIN · six digits" }),
      pin.cells,
      pin.capture,
      pin.messageSlot,
    ),
  );

  const foot = el(
    "div.signin-foot",
    {},
    el("span.rail-end"),
    el("span.stop"),
    pin.button,
    el("p.note", { text: "No sign-up and no reset. Accounts are created on the server." }),
  );

  render(root, form, foot);

  queueMicrotask(() => nameInput.focus());

  root.destroy = pin.destroy;
  return root;
}
