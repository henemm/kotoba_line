import { api } from "../api.js";
import { playTracked } from "../audio.js";
import { canRecord, micErrorMessage, startRecording } from "../recording.js";
import { el } from "./dom.js";

const SVG_NS = "http://www.w3.org/2000/svg";
/** `el()` cannot make real SVG nodes (`createElement`, not `createElementNS`)
 * and `className` on an `SVGElement` is not a plain string, so the progress
 * ring is built by hand instead. */
function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}
export const RING_CIRCUMFERENCE = 144.5; // 2π × the ring's r=23

/** RFC 4122-shaped enough for the server's id check (recordings.js). */
export const uuid = () =>
  crypto.randomUUID?.() ??
  `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-4000-8000-${Math.random()
    .toString(16)
    .slice(2, 14)}`;

/**
 * The record/play circle for a native speaker's recording of one card (#183
 * follow-up, #185) — shared by the deck's card menu and the chip under a
 * word's ♪ in a session (session.js's wordSoundParts), so there is no second
 * copy of this state machine to drift out of sync with. Three of this
 * component's past bugs (#194, #195, #196) were exactly that kind of drift
 * inside a single copy; a second copy would only multiply the risk.
 *
 * `getSource()`/`setSource()` are how the caller's own bookkeeping — a Map
 * across every card in a session's queue, or one value fetched for a single
 * card in the deck menu — stays in step with what is actually stored; this
 * component holds no server state of its own beyond what it is handed, and
 * `refresh()` (in the return value) repaints it after the caller updates
 * that bookkeeping out of band (an async fetch that resolves after the
 * circle is already on screen).
 *
 * `shared` is an `{ active }` object for circles that must not record or
 * play at the same time — recording.js's `startRecording()` would otherwise
 * cut a sibling's capture off mid-take. Pass a fresh `{ active: null }` for
 * a circle with no sibling, which since #185 is every caller.
 *
 * Her own voice has no circle (#185, 2026-09-17): it is never stored. What
 * she says is compared in the moment — ui/answer-recorder.js.
 */
export function voiceCircle({
  cardId,
  kind,
  ariaLabel,
  emptyCaption,
  filledCaption = emptyCaption,
  shared,
  getSource,
  setSource,
  rowLayout = false,
}) {
  const root = el("div.voice", { class: [kind, rowLayout ? "row" : null].filter(Boolean).join(" ") });
  const ringFg = svgEl("circle", { class: "ring-fg", cx: 29, cy: 29, r: 23 });
  const ring = svgEl("svg", { class: "voice-ring", viewBox: "0 0 58 58" });
  ring.append(svgEl("circle", { class: "ring-bg", cx: 29, cy: 29, r: 23 }), ringFg);
  const btn = el("button.voice-btn", { type: "button", onclick: onTap });
  // No text: the × is drawn in CSS (two crossed bars), not the "×"
  // character — a text glyph's own centring depends on the font.
  const del = el("button.voice-delete", {
    type: "button",
    "aria-label": `${ariaLabel} löschen`,
    onclick: () => {
      confirm.hidden = false;
    },
  });
  const captionEl = el("span.voice-caption");
  const statusEl = el("span.voice-status");
  const confirm = el(
    "div.voice-confirm",
    { hidden: true },
    el("button.yes", { type: "button", text: "Wirklich löschen", onclick: onConfirmYes }),
    el("button.no", {
      type: "button",
      text: "Abbrechen",
      onclick: () => {
        confirm.hidden = true;
      },
    }),
  );
  root.append(el("div.voice-dial", {}, ring, btn, del), captionEl, statusEl, confirm);

  let controller = null;
  let starting = false;
  // empty | recording | uploading | filled | playing | deleting
  let state = getSource() ? "filled" : "empty";

  function paint() {
    const disabledBySibling = shared.active && shared.active !== kind;
    const iconState = state === "recording" ? "recording" : state === "filled" || state === "playing" ? "filled" : "empty";
    btn.disabled = disabledBySibling || starting || state === "uploading" || state === "deleting";
    btn.classList.toggle("recording", iconState === "recording");
    btn.classList.toggle("filled", iconState === "filled");
    btn.textContent = iconState === "recording" ? "■" : iconState === "filled" ? "♪" : "●";
    btn.setAttribute(
      "aria-label",
      iconState === "recording" ? `${ariaLabel}: Aufnahme beenden` : iconState === "filled" ? `${ariaLabel}, abspielen` : `${ariaLabel} aufnehmen`,
    );
    del.hidden = iconState !== "filled" || state === "recording" || state === "playing";
    ringFg.classList.toggle("recording", state === "recording");
    ringFg.classList.toggle("playing", state === "playing");
    if (state !== "recording" && state !== "playing") ringFg.style.strokeDashoffset = String(RING_CIRCUMFERENCE);
    captionEl.textContent = iconState === "filled" ? filledCaption : emptyCaption;
  }

  function setStatus(text) {
    statusEl.textContent = text ?? "";
  }

  function onTap() {
    if (state === "empty") return onStart();
    if (state === "recording") return onStop();
    // filled or already playing — a second tap restarts it from the
    // beginning, the same as every other ♪ in the app.
    if (state === "filled" || state === "playing") return onPlay();
  }

  async function onStart() {
    if (shared.active || starting) return;
    if (!canRecord()) {
      setStatus("Aufnahme wird von diesem Browser nicht unterstützt.");
      return;
    }
    starting = true;
    shared.active = kind;
    paint();
    try {
      controller = await startRecording();
      starting = false;
      state = "recording";
      paint();
    } catch (err) {
      starting = false;
      shared.active = null;
      setStatus(micErrorMessage(err));
      paint();
    }
  }

  async function onStop() {
    state = "uploading";
    setStatus("wird hochgeladen …");
    paint();
    try {
      const blob = await controller.stop();
      controller = null;
      shared.active = null;
      const id = uuid();
      const { recording } = await api.addRecording(cardId, kind, id, blob);
      if (recording) setSource({ ...recording, card_id: cardId });
      setStatus(null);
      state = "filled";
      paint();
    } catch (err) {
      controller = null;
      shared.active = null;
      setStatus(err?.body?.error === `${kind}_limit` ? "Da ist schon eine Aufnahme." : "Konnte die Aufnahme nicht speichern.");
      state = getSource() ? "filled" : "empty";
      paint();
    }
  }

  function onPlay() {
    const rec = getSource();
    if (!rec) return;
    shared.active = kind;
    state = "playing";
    ringFg.style.strokeDashoffset = String(RING_CIRCUMFERENCE); // restart from empty, even mid-play
    paint();
    playTracked(rec.file, {
      onProgress: (p) => {
        ringFg.style.strokeDashoffset = String(RING_CIRCUMFERENCE - RING_CIRCUMFERENCE * p);
      },
      onEnded: () => {
        shared.active = null;
        state = "filled";
        paint();
      },
    });
  }

  async function onConfirmYes() {
    confirm.hidden = true;
    const rec = getSource();
    if (!rec) return;
    state = "deleting";
    setStatus("wird gelöscht …");
    paint();
    try {
      await api.deleteRecording(cardId, rec.id);
      setSource(null);
    } catch {
      // Left in place: a failed delete is not silently pretended to have worked.
    }
    setStatus(null);
    state = getSource() ? "filled" : "empty";
    paint();
  }

  paint();

  // For a caller whose `getSource()` only becomes accurate after an async
  // fetch resolves (the deck menu: it has no recording data before that) —
  // re-derives `state` from the now-current source and repaints. Guarded to
  // idle states only, so a fetch that resolves late never clobbers an
  // interaction already in progress (recording, uploading, playing, a
  // pending delete).
  function refresh() {
    if (state === "empty" || state === "filled") {
      state = getSource() ? "filled" : "empty";
      paint();
    }
  }

  return { root, refresh };
}
