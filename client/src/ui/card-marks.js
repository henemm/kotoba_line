import { OfflineError } from "../api.js";
import { byTopicLabel, topicLabel } from "../topics.js";
import { el, render } from "./dom.js";

/**
 * The star and the topic chips a card's sheet shows — one implementation for
 * every sheet a card opens in (Henning, 2026-09-19: "hast du sichergestellt,
 * dass sich alle Decks exakt gleich verhalten?" — they did not: her decks
 * saved topics at the tap, Kaishi's sheet behind a Speichern button, and a
 * kana's sheet had no star at all). Each sheet now builds these two and
 * nothing of its own, so the next change to one is a change to all.
 *
 * Both write at the tap. The star, like the session's (#22), and the topics,
 * like the star beside them: a sheet with two controls that saved in two
 * different ways was the inconsistency being removed.
 */

/** Her topics per card, as the server enforces it. */
export const MAX_TOPICS = 5;

/**
 * ☆/★ for one card. `starred` is what the caller knows; where it knows
 * nothing (a deck's list, the kana grid — both read from the phone's copy,
 * which holds no stars) it passes `lookup`, a promise of the answer, and the
 * star is inert until that settles. Never a guessed ☆ (#22).
 */
export function starButton({ word, starred, lookup, onToggle, disabled = false }) {
  let on = starred;
  let known = starred !== undefined;
  const button = el("button.topics-star", { type: "button" });
  button.addEventListener("click", () => {
    if (!known || disabled) return;
    on = !on;
    paint();
    onToggle(on);
  });
  paint();
  if (!known && lookup) {
    lookup
      .then((value) => {
        on = Boolean(value);
        known = true;
        paint();
      })
      .catch(() => {
        /* offline: stays inert, and says why */
      });
  }

  function paint() {
    const usable = known && !disabled;
    button.disabled = !usable;
    button.textContent = usable && on ? "★" : "☆";
    button.setAttribute("aria-pressed", String(Boolean(usable && on)));
    button.setAttribute(
      "aria-label",
      !usable ? "Markieren braucht Internet" : on ? `Markierung entfernen: ${word}` : `${word} markieren`,
    );
  }
  return button;
}

/**
 * The card's topics as chips. `fixed` are a deck's own (Kaishi's), shown and
 * not removable — they belong to the deck, not to her. `chosen` are hers: a
 * tap takes one off. "+ Thema" unfolds every other topic in use and "+ neu"
 * coins one; folded by default, because 29 topics would bury the sheet.
 *
 * `names()` resolves to every topic in use. `save(next)` writes her list and
 * rejects when that did not work; the chips go back and say why.
 */
export function topicChips({ fixed = [], chosen = [], names, save }) {
  const root = el("div.topics-mine.card-topics");
  let mine = [...chosen];
  let all = [];
  let open = false;
  let coining = false;
  let problem;
  draw();

  function draw() {
    const others = all.filter((t) => !mine.includes(t) && !fixed.includes(t));
    render(
      root,
      el("span.set-label", { text: fixed.length + mine.length === 1 ? "Thema" : "Themen" }),
      el(
        "div.chips",
        {},
        fixed.map((tag) => el("span.chip.fixed", { text: topicLabel(tag) })),
        mine.map((tag) => chip(tag, true)),
        open ? others.map((tag) => chip(tag, false)) : null,
        open
          ? coining
            ? newTopicField()
            : el("button.chip.new-tag", {
                type: "button",
                text: "+ neu",
                onclick: () => {
                  coining = true;
                  draw();
                  root.querySelector(".new-tag-input")?.focus();
                },
              })
          : el("button.chip.new-tag", { type: "button", text: "+ Thema", onclick: unfold }),
      ),
      problem ? el("p.add-problem", { text: problem }) : null,
    );
  }

  function chip(tag, on) {
    return el("button.chip", {
      type: "button",
      text: topicLabel(tag),
      "aria-pressed": String(on),
      disabled: !on && mine.length >= MAX_TOPICS,
      onclick: () => change(on ? mine.filter((t) => t !== tag) : [...mine, tag]),
    });
  }

  async function unfold() {
    open = true;
    draw();
    try {
      all = [...new Set(await names())].sort(byTopicLabel);
    } catch {
      all = [];
    }
    draw();
  }

  async function change(next) {
    const before = mine;
    mine = next;
    problem = undefined;
    draw();
    try {
      await save(next);
    } catch (err) {
      mine = before;
      problem =
        err instanceof OfflineError
          ? "Für Themen brauchst du eine Verbindung – sie liegen auf dem Server, nicht nur auf diesem Handy."
          : "Das Speichern hat nicht geklappt.";
    }
    draw();
  }

  /**
   * Coined inline rather than through prompt(), which in an installed app is
   * the browser's dialog. Enter and blur both finish, once: on a phone Enter
   * causes a blur, and redrawing twice threw (the add-a-word form's guard).
   */
  function newTopicField() {
    const input = el("input.chip.new-tag-input", {
      type: "text",
      placeholder: "Thema",
      autocapitalize: "none",
      autocorrect: "off",
      "aria-label": "Neues Thema benennen",
    });
    let done = false;
    const commit = () => {
      if (done) return;
      done = true;
      coining = false;
      const name = input.value.trim().toLowerCase().replace(/\s+/g, " ");
      if (name && !mine.includes(name) && !fixed.includes(name) && mine.length < MAX_TOPICS) change([...mine, name]);
      else draw();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      }
      if (e.key === "Escape") {
        done = true;
        coining = false;
        draw();
      }
    });
    input.addEventListener("blur", commit);
    return input;
  }

  return root;
}
