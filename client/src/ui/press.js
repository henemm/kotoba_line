/**
 * Every press, answered in one place (Henning, 2026-09-19: "Ich kenne es so,
 * dass man Atomic Design verwendet und so eine Änderung dann nur einmal
 * machen muss").
 *
 * Until v145 the answer to a press was written per button: 19 `:active`
 * rules and a tap-ring that two components opted into (`acknowledged()`),
 * over 51 kinds of button. Every new kind started without one, and he kept
 * finding them. Now the page itself answers every press — any button, link
 * or role=button, today's and every one written later — so no button has to
 * ask for it and none can forget to.
 *
 * What a press looks like: the button gives — it shrinks a little and dims,
 * and springs back over ~0.45 s, outlasting the ~80 ms a tap takes under a
 * thumb that covers most of it (#116; base.css switches off iOS's own grey
 * highlight). It stays inside the button on purpose: the ♪'s old ring grew
 * past the edge, and every screen here is a scroll box that clips at its
 * edge — measured in WebKit with a ring on every button, a deck row's showed
 * as a line under the row and the start button's lost its left side. Drawn with
 * the Web Animations API on `scale` and `opacity` — `scale` composes with a
 * button's own `transform`, and it runs beside the ♪'s playing pulse, a
 * box-shadow animation, without either rule knowing the other.
 *
 * The `tapped` class is on the button for as long as it runs, for the few
 * that also change colour when pressed (screens.css).
 *
 * The touchstart listener is what makes iOS Safari apply `:active` at all:
 * without one anywhere on the page it never enters that state on a tap, and
 * every `:active` rule in screens.css was dead on her phone.
 */
export const PRESSABLE = 'button, [role="button"], [role="switch"], a[href]';

const PRESS_MS = 450;

export function watchPresses(doc = document) {
  doc.addEventListener("touchstart", () => {}, { passive: true });
  // Pointer first: the answer has to be there when the finger lands, not when
  // it lifts. `click` covers a press with no pointer (keyboard, VoiceOver);
  // after a pointer it does not flash a second time.
  let pointed = null;
  doc.addEventListener(
    "pointerdown",
    (e) => {
      const node = pressed(e.target);
      pointed = node;
      if (node) give(node);
    },
    { capture: true, passive: true },
  );
  doc.addEventListener(
    "click",
    (e) => {
      const node = pressed(e.target);
      if (node && node !== pointed) give(node);
      pointed = null;
    },
    { capture: true, passive: true },
  );
}

function pressed(target) {
  const node = target?.closest?.(PRESSABLE);
  if (!node || node.disabled || node.getAttribute("aria-disabled") === "true") return null;
  return node;
}

const running = new WeakMap();

function give(node) {
  running.get(node)?.cancel();
  node.classList.add("tapped");
  const still = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const animation = node.animate?.(
    [{ scale: still ? "1" : "0.95", opacity: 0.55 }, { scale: "1", opacity: 1 }],
    { duration: PRESS_MS, easing: "ease-out", id: "press" },
  );
  if (!animation) {
    setTimeout(() => node.classList.remove("tapped"), PRESS_MS);
    return;
  }
  running.set(node, animation);
  const done = () => {
    if (running.get(node) !== animation) return;
    running.delete(node);
    node.classList.remove("tapped");
  };
  animation.addEventListener("finish", done);
  animation.addEventListener("cancel", done);
}
