/**
 * Design 52 — signed out by the server, mid-practice.
 *
 * Distinct from being offline (25): the server is reachable, the cookie is not.
 * So this is not the offline bar with different words — it is a screen, because
 * there is something for her to do, and one thing she must be told before she
 * does it.
 *
 * Three decisions come straight off the drawing and its note:
 *
 *   The name is remembered, so only the PIN is asked. Her handle is on the
 *   device already; making her retype it would imply the app had forgotten
 *   who she was, which is not what happened.
 *
 *   The outbox count is stated twice — in the bar above and again in the
 *   paragraph — because "sign in again" is exactly the moment she would fear
 *   losing work. Both numbers are what is *waiting*; neither is what was last
 *   sent, and printing one where the other belongs is the one arithmetic
 *   mistake this screen can make.
 *
 *   She can dismiss it and keep practising. Answers go to the outbox whether
 *   the server knows who she is or not, so a session interrupted by this
 *   screen would cost her nothing but would still be an interruption.
 */
import { el, render } from "../ui/dom.js";
import { pinEntry } from "./signin.js";

/**
 * What 52 says, as values rather than as DOM — so the counts can be tested
 * without a browser, which is where the mistake would otherwise hide.
 *
 * "from this morning" is on the drawing and is deliberately not reproduced:
 * the screen has no idea when she practised, and at nine in the evening the
 * sentence would be a small lie in the middle of a reassurance.
 */
export function signedOutCopy(waiting = 0) {
  const title = "Sign in again to keep syncing";
  const ran = "Your session on the server ran out.";

  if (waiting === 0) {
    // Nothing queued: the reassurance has nothing to reassure her about, and
    // an invented count would be worse than none. 25's empty branch does the
    // same thing — "Offline" with no number after it.
    return { title, body: `${ran} Nothing is waiting to send.` };
  }
  const answers =
    waiting === 1
      ? "The one answer waiting here is safe on this device"
      : `The ${waiting} answers waiting here are safe on this device`;
  return { title, body: `${ran} ${answers} and will send as soon as you are back in.` };
}

/**
 * @param handle  her handle, for the label — `PIN · <handle>`. The same value
 *                `api.login` takes, which is why it is the handle and not the
 *                display name.
 * @param waiting how many answers are in the outbox, for the paragraph.
 * @param onSignIn  called with the PIN; must reject the way `api.login` does,
 *                  so a wrong PIN and a 429 behave exactly as they do on 01.
 * @param onDismiss  the ×.
 */
export function signedOutScreen({ handle, waiting = 0, onSignIn, onDismiss }) {
  const root = el("div.screen.signed-out", {
    dataset: { state: "default" },
    style: { flex: "1", display: "flex", flexDirection: "column" },
  });

  const pin = pinEntry({
    buttonText: "Sign in",
    onState: (state) => {
      root.dataset.state = state;
    },
    onSubmit: (value) => onSignIn(value),
  });

  const { title, body } = signedOutCopy(waiting);

  const head = el(
    "div.signed-out-head",
    {},
    // The same × the session uses. Dismissing is a route the app already has
    // a word for, and inventing a second one here would teach her two.
    el("button.session-close", {
      type: "button",
      "aria-label": "Dismiss and keep practising",
      text: "×",
      onclick: () => onDismiss?.(),
    }),
  );

  const bodyBlock = el(
    "div.signed-out-body",
    {},
    el("div.signed-out-text", {}, el("h1", { text: title }), el("p", { text: body })),
    el(
      "div.pin-entry",
      {},
      el("div.mono-label", { text: `PIN · ${handle ?? ""}`.trimEnd() }),
      pin.cells,
      pin.capture,
      pin.messageSlot,
    ),
  );

  const foot = el(
    "div.signed-out-foot",
    {},
    pin.button,
    el("p.note", {
      text: "Practising works offline in the meantime. Nothing is lost either way.",
    }),
  );

  render(root, head, bodyBlock, foot);

  queueMicrotask(() => pin.focus());

  root.destroy = pin.destroy;
  return root;
}
