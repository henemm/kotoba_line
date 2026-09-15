import { OfflineError, api } from "../api.js";
import { say } from "../audio.js";
import { showsScript, shownWord } from "../script.js";
import { topicLabel } from "../topics.js";
import { el, render } from "../ui/dom.js";
import { cardHistoryBlock } from "./card-history.js";

/**
 * Put one card into her own topics (#35).
 *
 * Reported as "ich möchte aus eigenen Kategorien lernen können. Die eigenen
 * Kategorien müssen leicht zugänglich sein." She could already coin a topic
 * while adding a word of her own — but only words she had typed herself could
 * go in one, so a topic like "my exam" could never hold a Kaishi card.
 *
 * The same interaction as the topic row on the add-a-word screen (29), on
 * purpose: chips she toggles, plus one that coins a new name. There is no
 * reason for the second place she picks topics to work differently from the
 * first, and she has already learnt this one.
 *
 * A sheet rather than a screen. It is a decision about one row of the list
 * behind it, and taking the whole screen would lose her place in a search she
 * may have typed to get here.
 */

/** The same ceiling the personal deck uses, and the server enforces. */
const MAX_TAGS = 5;

export function cardTopicsSheet({ card, topics = [], onSaved, onClose, japanese = true }) {
  const root = el("div.sheet-scrim", {
    onclick: (e) => e.target === root && onClose?.(),
  });

  // Only hers are editable here. The deck's own tags are shown, greyed, so the
  // screen does not look like the card had no topics until she added one —
  // that would misrepresent the deck and invite a duplicate.
  const deckTags = card.tags ?? [];
  const chosen = new Set(card.myTags ?? []);
  // Names she can pick from: everything already in use anywhere, minus the
  // deck's own tags on *this* card, which she cannot remove and need not add.
  let offered = [...new Set(topics.map((t) => t.tag))].filter((t) => !deckTags.includes(t));

  let coining = false;
  let saving = false;
  let problem;
  const fields = {};
  // #98: her record of this card, under her topics. Built once: every chip
  // she toggles redraws the sheet, and that should not ask the server again.
  const history = cardHistoryBlock({ cardId: card.id });

  draw();

  function draw() {
    render(
      root,
      el(
        "div.sheet.card-sheet",
        {},
        el(
          "div.topics-head",
          {},
          el(
            "span.topics-title",
            {},
            // v69: which deck the card is in. "From the deck" above its topic
            // read as the deck's name (Henning, 2026-09-14).
            el("span.topics-deck-name", { text: card.deck_name ?? "Kaishi" }),
            // #135
            el(showsScript(card, japanese) ? "span.topics-word.jp" : "span.topics-word", { text: shownWord(card, japanese) }),
            el("span.topics-gloss", { text: card.word_meaning ?? "" }),
          ),
          // v69: something to do with a Kaishi word found in Search — hear it.
          // Only its recording: this sheet never falls back to speech.
          card.word_audio
            ? el("button.topics-hear", {
                type: "button",
                "aria-label": `${shownWord(card, japanese)} anhören`,
                text: "♪",
                onclick: () => say(undefined, card.word_audio),
              })
            : null,
          el("button.topics-close", {
            type: "button",
            "aria-label": "Schließen",
            text: "×",
            onclick: onClose,
          }),
        ),
        deckTags.length > 0
          ? el(
              "div.topics-deck",
              {},
              el("span.set-label", { text: deckTags.length === 1 ? "Thema" : "Themen" }),
              el(
                "div.chips",
                {},
                deckTags.map((t) => el("span.chip.fixed", { text: topicLabel(t) })),
              ),
            )
          : null,
        el(
          "div.topics-mine",
          {},
          el("span.set-label", { text: "Deine Themen" }),
          el(
            "div.chips",
            {},
            offered.map((tag) =>
              el("button.chip", {
                type: "button",
                text: topicLabel(tag),
                "aria-pressed": String(chosen.has(tag)),
                onclick: () => {
                  if (chosen.has(tag)) chosen.delete(tag);
                  else if (chosen.size < MAX_TAGS) chosen.add(tag);
                  draw();
                },
              }),
            ),
            coining
              ? newTagField()
              : el("button.chip.new-tag", {
                  type: "button",
                  text: "+ neu",
                  onclick: () => {
                    coining = true;
                    draw();
                    fields.newTag?.focus();
                  },
                }),
          ),
        ),
        history,
        problem ? el("p.add-problem", { text: problem }) : null,
        el(
          "div.sheet-actions",
          {},
          el("button.btn.solid", {
            type: "button",
            text: saving ? "…" : "Speichern",
            disabled: saving,
            onclick: save,
          }),
        ),
      ),
    );
  }

  /**
   * Coining a name inline rather than through prompt(): in a standalone PWA
   * that dialog is the browser's, not the app's, and it looks like one.
   *
   * Enter and blur are both ways of finishing, and on a phone Enter *causes* a
   * blur — so this runs once whichever arrives first. The same guard as the
   * add-a-word screen, for the same reason: redrawing twice threw, because the
   * second pass tried to replace a node the first had already detached.
   */
  function newTagField() {
    const input = el("input.chip.new-tag-input", {
      type: "text",
      placeholder: "Thema",
      autocapitalize: "none",
      autocorrect: "off",
      "aria-label": "Neues Thema benennen",
    });
    fields.newTag = input;

    let done = false;
    const commit = () => {
      if (done) return;
      done = true;
      const name = input.value.trim().toLowerCase().replace(/\s+/g, " ");
      coining = false;
      if (name && !offered.includes(name)) offered = [...offered, name];
      if (name && chosen.size < MAX_TAGS) chosen.add(name);
      draw();
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

  async function save() {
    saving = true;
    problem = undefined;
    draw();
    try {
      const { tags } = await api.setCardTags(card.id, [...chosen]);
      onSaved?.(tags);
      return;
    } catch (err) {
      problem =
        err instanceof OfflineError
          ? "Für Themen brauchst du eine Verbindung – sie liegen auf dem Server, nicht nur auf diesem Handy."
          : "Das Speichern hat nicht geklappt.";
    }
    saving = false;
    draw();
  }

  return root;
}
