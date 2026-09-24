import { api } from "../api.js";
import { showsScript, shownWord } from "../script.js";
import { reverseSwitch, starButton, topicChips } from "../ui/card-marks.js";
import { soundButton } from "../ui/sound-button.js";
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

export function cardTopicsSheet({ card, topics = [], topicNames, onSaved, onClose, onStar, onReverse, canStar = false, japanese = true }) {
  const root = el("div.sheet-scrim", {
    onclick: (e) => e.target === root && onClose?.(),
  });

  // #98: her record of this card, under her topics.
  const history = cardHistoryBlock({ cardId: card.id });
  // #187: the row behind this sheet has a star, and this is the same one —
  // the same component as every card sheet since 2026-09-19. Written to the
  // card object the row is drawn from too: one object, one truth. Offline the
  // card came from the deck cache, which knows nothing about stars, so as in
  // Browse (#22) the star is inert rather than a guessed ☆.
  const star = onStar
    ? starButton({
        word: shownWord(card, japanese),
        starred: Boolean(card.starred),
        disabled: !canStar,
        onToggle: (on) => {
          card.starred = on;
          onStar(on);
        },
      })
    : null;
  // The deck's own topics are shown and fixed: they belong to Kaishi, not to
  // her, and without them the card would look untagged and invite a
  // duplicate. Hers save at the tap, as in her own decks (2026-09-19) — this
  // sheet used to wait for a Speichern button, the only one that did.
  const topicsBlock = topicChips({
    fixed: card.tags ?? [],
    chosen: card.myTags ?? [],
    names: topicNames ?? (async () => topics.map((t) => t.tag)),
    save: async (next) => {
      const { tags } = await api.setCardTags(card.id, next);
      card.myTags = tags;
      onSaved?.(tags);
    },
  });

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
        star,
        // v69: something to do with a Kaishi word found in Search — hear it.
        // Its recording, or its generated file (#183); this sheet never
        // falls back to the phone's voice.
        card.word_audio || card.word_audio_generated
          ? soundButton({
              sound: { file: card.word_audio || card.word_audio_generated },
              className: ".topics-hear",
              label: `${shownWord(card, japanese)} anhören`,
            })
          : null,
        el("button.topics-close", {
          type: "button",
          "aria-label": "Schließen",
          text: "×",
          onclick: onClose,
        }),
      ),
      topicsBlock,
      // #284: this word the other way round too, for her alone. `canStar`
      // is whether the row came from the server — the same condition, since
      // `card.reverse` is only known there.
      onReverse
        ? reverseSwitch({
            on: card.reverse,
            disabled: !canStar,
            onToggle: async (on) => {
              await onReverse(on);
              card.reverse = on;
            },
          })
        : null,
      history,
    ),
  );

  return root;
}
