import { api } from "../api.js";
import { el, num, render } from "../ui/dom.js";
import { getMeta, putCards, setMeta } from "../store.js";

/**
 * Getting the deck — design 49.
 *
 * The first thing she ever sees after signing in, so it states the size before
 * it states the progress, and offers the way out for a metered connection.
 * §1 is blunt about why: mobile data in Japan is metered, and §7 forbids
 * bulk-fetching audio for the same reason — which is what the card in the
 * middle of the screen is there to say, before she wonders.
 *
 * Without this the deck arrived silently on the first session, which on a slow
 * connection looks exactly like an app that has hung.
 */

/** 49: "progress uses the station strip at twelve segments regardless of card count." */
const SEGMENTS = 12;

/** How many cards a page of the download carries. */
const PAGE = 250;

/** Roughly what a card costs on the wire, for the megabyte figure. */
const BYTES_PER_CARD = 1400;

const PAUSED = "deck.paused";
const SINCE = "deck.since";

export const megabytes = (cards) => (cards * BYTES_PER_CARD) / 1e6;

/** Whether this device still has a deck to fetch. */
export async function needsDeck(cardCount) {
  return cardCount === 0;
}

export function firstRunScreen({ onReady }) {
  const root = el("div.first-run");
  const state = { got: 0, total: undefined, paused: false, failed: false };

  start();

  async function start() {
    state.paused = Boolean(await getMeta(PAUSED));
    draw();
    if (!state.paused) download();
  }

  async function download() {
    state.failed = false;
    state.paused = false;
    await setMeta(PAUSED, undefined);
    draw();

    try {
      // Paged, so "you can start practising as soon as the first cards arrive"
      // is true rather than a hopeful sentence: each page is written to
      // IndexedDB before the next is asked for.
      let latest = 0;
      for (;;) {
        if (state.paused) return;
        const answer = await api.deck(0, { offset: state.got, limit: PAGE });
        const rows = answer.cards ?? [];
        state.total = answer.total ?? state.total;
        latest = answer.latest ?? latest;

        if (rows.length > 0) {
          await putCards(rows);
          state.got += rows.length;
          draw();
        }
        if (rows.length < PAGE) break;
      }
      await setMeta(SINCE, latest);
      onReady?.();
    } catch {
      // 49: a failed download shows the same screen with "Stopped at 870 — tap
      // to carry on", and the button becomes Retry. The cards already written
      // stay written; resuming continues from the last received card.
      //
      // Offline and refused look the same here on purpose: either way the
      // answer is to try again later, and the distinction is the developer's.
      state.failed = true;
      draw();
    }
  }

  async function pause() {
    state.paused = true;
    await setMeta(PAUSED, true);
    draw();
  }

  function draw() {
    const done = state.total ? Math.min(state.got / state.total, 1) : 0;
    const lit = Math.round(done * SEGMENTS);

    render(
      root,
      el(
        "div.first-body",
        {},
        el("h1.first-title.jp", { text: "ことばライン" }),
        el(
          "div.first-progress",
          {},
          el("span.first-heading", { text: heading() }),
          el(
            "div.segments",
            {},
            Array.from({ length: SEGMENTS }, (_, i) =>
              el("span.segment", { class: i < lit ? "on" : undefined }),
            ),
          ),
          el(
            "div.first-figures",
            {},
            el("span", {
              text: state.total
                ? `${num(state.got)} of ${num(state.total)} cards`
                : `${num(state.got)} cards`,
            }),
            el("span", {
              text: state.total
                ? `${megabytes(state.got).toFixed(1)} of ${megabytes(state.total).toFixed(1)} MB`
                : "",
            }),
          ),
        ),
        // §7, said before she asks: audio is never bulk-fetched.
        el(
          "div.first-card",
          {},
          el("span.first-card-title", { text: "Text only, once" }),
          el("p.first-card-body", {
            text: "Audio is never downloaded in bulk. Each recording is kept the first time you hear it, so the app stays small on mobile data.",
          }),
        ),
      ),
      el(
        "div.first-foot",
        {},
        el("p.first-note", { text: "You can start practising as soon as the first cards arrive." }),
        state.paused || state.failed
          ? el("button.btn-secondary", { type: "button", text: "Carry on", onclick: download })
          : el("button.btn-secondary", {
              type: "button",
              text: "Pause until Wi-Fi",
              onclick: pause,
            }),
      ),
    );
  }

  function heading() {
    if (state.failed) return `Stopped at ${num(state.got)} — tap to carry on`;
    if (state.paused) return `Paused at ${num(state.got)}`;
    return "Getting the deck";
  }

  return root;
}
