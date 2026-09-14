import { OfflineError, api } from "../api.js";
import { say, unlock } from "../audio.js";
import { inScript, shownWord } from "../script.js";
import { acknowledged, el, render } from "../ui/dom.js";

/**
 * Her own words — designs 28, 29 and 30.
 *
 * The point is the word she just heard at the dinner table. Everything here is
 * shaped by where she is when she types it: on a train, one-handed, with the
 * conversation still going on around her.
 */

/** 28: "three fields required to save, of which one is optional to type well." */
const MAX_TAGS = 5;

/**
 * Add a card to a deck, or change one (28, 29; #137).
 *
 * The word and the meaning are what make it savable; the reading and the
 * example sentence are what make it good. The sentence is behind a disclosure
 * "because on a train she will not write one, and an empty sentence field
 * would only reproach her".
 *
 * #137: laid out the way she writes a card in Noji — the German first, as the
 * front, then the Japanese, as the back, in romaji or kana (Henning agreed the
 * two fields on 2026-09-14). The reading, the example sentence and the topic
 * are one disclosure below them. "Save and add next" keeps the form open on
 * the same deck, for a list typed in one go.
 */
export function addWordScreen({
  tags = [],
  initialWord = "",
  card,
  // The deck the card goes into: `{ id, name }` (#137).
  deck,
  onSaved,
  onDeleted,
  onCancel,
  // #135: the placeholders 日本語, かな and 文を書く are decoration too.
  japanese = true,
}) {
  const root = el("div.add-word");
  // #85: the same form edits a word she already has. It is the same five
  // fields and the same rules, and a second form would drift from this one.
  const editing = Boolean(card);
  // Coerced rather than trusted: this arrives from two call sites, and one of
  // them is a click handler that would otherwise hand over the event.
  const draft = editing
    ? {
        word: card.word ?? "",
        reading: card.word_reading ?? "",
        meaning: card.word_meaning ?? "",
        sentence: card.sentence ?? "",
        sentenceMeaning: card.sentence_meaning ?? "",
      }
    : {
        word: typeof initialWord === "string" ? initialWord : "",
        reading: "",
        meaning: "",
        sentence: "",
        sentenceMeaning: "",
      };
  let chosen = new Set(editing ? card.tags ?? [] : []);
  // A topic on the card that the list does not carry still has to be a chip,
  // or saving would silently take it off.
  for (const tag of chosen) {
    if (!tags.some((t) => t.tag === tag)) tags = [...tags, { tag, n: 1 }];
  }
  let moreOpen = editing && Boolean(draft.reading || draft.sentence || draft.sentenceMeaning || chosen.size);
  let coining = false;
  let saving = false;
  let problem;
  // "Saved: Wo ist der Bahnhof" after Save and add next, so a cleared form is
  // not mistaken for a card that was lost.
  let lastSaved;
  let focusAsked = false;

  const fields = {};

  function field(key, { placeholder, big = false, lang = "ja" }) {
    const input = el(big ? "textarea" : "input", {
      class: `field-input${big ? " big" : ""}${lang === "ja" ? " jp" : ""}`,
      placeholder,
      value: draft[key],
      rows: big ? "2" : undefined,
      type: big ? undefined : "text",
      autocapitalize: lang === "de" ? "sentences" : "none",
      autocorrect: "off",
      spellcheck: "false",
    });
    // Set as a property, not through el(): a `value` attribute means nothing
    // to a <textarea>, so the word field came up empty while the draft behind
    // it held the word — in the edit form (#85), and on the way in from an
    // empty browse search, where Save then stored a word she could not see.
    input.value = draft[key];
    input.addEventListener("input", () => {
      draft[key] = input.value;
      // Only the header needs redrawing — a full redraw would take the
      // keyboard's focus away between two characters.
      refreshHeader();
    });
    fields[key] = input;
    return input;
  }

  const canSave = () => draft.word.trim() && draft.meaning.trim() && !saving;

  const header = el("div.add-head");
  const nextButton = el("button.btn-primary.add-next", {
    type: "button",
    text: "Save and add next",
    onclick: () => save({ next: true }),
  });
  function refreshHeader() {
    nextButton.disabled = !canSave();
    render(
      header,
      el("button.add-cancel", { type: "button", text: "Cancel", onclick: onCancel }),
      el("span.add-title", { text: editing ? "Edit card" : "Add a card" }),
      // 28: "Save stays #3D465C until word and meaning both have content."
      el("button.add-save", {
        type: "button",
        text: saving ? "…" : "Save",
        disabled: !canSave(),
        onclick: save,
      }),
    );
  }

  function group(label, ...children) {
    return el("div.add-group", {}, el("span.add-label", { text: label }), ...children);
  }

  function draw() {
    refreshHeader();
    render(
      root,
      header,
      el(
        "div.add-body",
        {},
        deck && !editing ? el("p.add-deck", { text: `Adding to “${deck.name}”` }) : null,
        lastSaved ? el("p.add-saved", { text: `Saved: ${lastSaved}` }) : null,
        group("German", el("div.field", {}, field("meaning", { placeholder: "The front of the card", lang: "de" }))),
        group(
          "Japanese",
          el("div.field.big", {}, field("word", { placeholder: japanese ? "日本語" : "Romaji or kana", big: true, lang: japanese ? "ja" : "romaji" })),
          el("p.add-hint", { text: "In romaji or kana, the way you would write it in Noji." }),
        ),
        ...(moreOpen
          ? [
              group(
                "Reading · optional",
                el("div.field", {}, field("reading", { placeholder: japanese ? "かな" : "Kana" })),
              ),
              sentenceGroup(),
              topicGroup(),
            ]
          : [disclosure()]),
        problem ? el("p.add-problem", { text: problem }) : null,
      ),
      editing
        ? el(
            "div.add-foot",
            {},
            el("p.add-note", {
              // Said because it is the question she would have: correcting a
              // word does not throw away what she already knows of it.
              text: "Changing a card keeps its progress.",
            }),
            el("button.btn-secondary.add-delete", {
              type: "button",
              text: "Delete this card",
              disabled: saving,
              onclick: askToDelete,
            }),
          )
        : el(
            "div.add-foot",
            {},
            nextButton,
            el("p.add-note", {
              // Said before she commits rather than after: a card she writes has
              // no recording, and since v66 romaji is never read by a guessing voice.
              text: "Cards you add have no recording. A word in kana or kanji is read by the phone's Japanese voice; romaji stays silent.",
            }),
          ),
    );
    // The German first, once per empty form: after the page is on screen, since
    // focusing a detached field does nothing, and not on every redraw, which
    // would pull the keyboard away from the field she is in.
    if (!editing && !focusAsked) {
      focusAsked = true;
      setTimeout(() => fields.meaning?.focus(), 50);
    }
  }

  /**
   * Design 30 asked for deleting to be confirmed, and it is the one thing on
   * this screen that cannot be taken back from the app. The same sheet as
   * leaving a session (50), and for the same reason the safe choice is the
   * solid one: a tap that lands on "Delete" is often a mistake.
   */
  function askToDelete() {
    const sheet = el(
      "div.sheet-scrim",
      { onclick: (e) => e.target === e.currentTarget && sheet.remove() },
      el(
        "div.sheet",
        {},
        el("h2.sheet-title", { text: `Delete ${shownWord(card, japanese)}?` }),
        el("p.sheet-body", {
          text: "It leaves your deck and your sessions. What you have already practised still counts towards your streak and XP.",
        }),
        el(
          "div.sheet-actions",
          {},
          el("button.btn", {
            type: "button",
            text: "Delete",
            onclick: () => {
              sheet.remove();
              remove();
            },
          }),
          el("button.btn.solid", { type: "button", text: "Keep it", onclick: () => sheet.remove() }),
        ),
      ),
    );
    root.append(sheet);
  }

  async function remove() {
    saving = true;
    problem = undefined;
    draw();
    try {
      await api.deleteCard(card.id);
      onDeleted?.(card);
      return;
    } catch (err) {
      problem =
        err instanceof OfflineError
          ? "Deleting a card needs a connection — it is on the server, not just this phone."
          : "That did not delete.";
    }
    saving = false;
    draw();
  }

  function disclosure() {
    return el(
      "button.add-disclosure",
      {
        type: "button",
        onclick: () => {
          moreOpen = true;
          draw();
          fields.reading?.focus();
        },
      },
      el("span", { text: "Reading, example sentence, topic" }),
      el("span.chevron", { text: "›" }),
    );
  }

  function sentenceGroup() {
    return group(
      "Example sentence",
      el("div.field", {}, field("sentence", { placeholder: japanese ? "文を書く" : "In Japanese", big: false })),
      el("div.field", {}, field("sentenceMeaning", { placeholder: "What it means", lang: "en" })),
      // 29: the speaker reads it back, which is the only honest way to check
      // the synthesis got the reading right — and if it did not, the reading
      // field is what fixes it.
      // Only what the phone's voice can read honestly (v66): Japanese characters.
      inScript(draft.sentence.trim() || draft.reading.trim() || draft.word.trim())
        ? el("button.add-speak", {
            type: "button",
            text: "♪ Hear it",
            ...acknowledged(() => {
              unlock();
              say(draft.sentence.trim() || draft.reading.trim() || draft.word.trim(), null, {
                rate: 0.85,
              });
            }),
          })
        : null,
    );
  }

  function topicGroup() {
    return group(
      "Topic",
      el(
        "div.chips.add-chips",
        {},
        tags.map(({ tag }) =>
          el("button.chip", {
            type: "button",
            text: tag,
            "aria-pressed": String(chosen.has(tag)),
            onclick: () => {
              if (chosen.has(tag)) chosen.delete(tag);
              else if (chosen.size < MAX_TAGS) chosen.add(tag);
              draw();
            },
          }),
        ),
        // 29: "a new one can be coined on the spot — this is how the twelve-tag
        // list in stats comes about." An inline field rather than a native
        // prompt(): in a standalone PWA that dialog is the browser's, not the
        // app's, and it looks like one.
        coining ? newTagField() : el("button.chip.new-tag", {
          type: "button",
          text: "+ new",
          onclick: () => {
            coining = true;
            draw();
            fields.newTag?.focus();
          },
        }),
      ),
    );
  }

  function newTagField() {
    const input = el("input.chip.new-tag-input", {
      type: "text",
      placeholder: "topic",
      autocapitalize: "none",
      autocorrect: "off",
      "aria-label": "Name a new topic",
    });
    fields.newTag = input;

    // Enter and blur are both ways of finishing, and on a phone Enter *causes*
    // a blur — so this has to run once whichever arrives first. Redrawing
    // twice threw: the second pass tried to replace a node the first had
    // already detached.
    let done = false;
    const commit = () => {
      if (done) return;
      done = true;
      const name = input.value.trim().toLowerCase();
      coining = false;
      if (name && !tags.some((t) => t.tag === name)) tags = [...tags, { tag: name, n: 0 }];
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
    // On a phone the keyboard's "done" is a blur, so a topic she typed and did
    // not confirm would otherwise vanish.
    input.addEventListener("blur", commit);
    return input;
  }

  async function save({ next = false } = {}) {
    if (!canSave()) return;
    saving = true;
    problem = undefined;
    refreshHeader();

    const body = {
      word: draft.word.trim(),
      reading: draft.reading.trim() || undefined,
      meaning: draft.meaning.trim(),
      sentence: draft.sentence.trim() || undefined,
      sentenceMeaning: draft.sentenceMeaning.trim() || undefined,
      tags: [...chosen],
      deckId: deck?.id,
    };
    try {
      // Editing sends the whole card; a field she emptied is left out and the
      // server stores it as empty.
      const { card: saved } = editing ? await api.updateCard(card.id, body) : await api.addCard(body);
      if (next) {
        // The same deck, an empty form, the German field ready for the next card.
        lastSaved = body.meaning;
        Object.assign(draft, { word: "", reading: "", meaning: "", sentence: "", sentenceMeaning: "" });
        chosen = new Set();
        moreOpen = false;
        saving = false;
        focusAsked = false;
        onSaved?.(saved, { next: true });
        draw();
        return;
      }
      // 29: "saving returns … with the count incremented, no confirmation
      // screen." To the deck she added it from (#137).
      onSaved?.(saved);
      return;
    } catch (err) {
      problem =
        err instanceof OfflineError
          ? editing
            ? "Changing a card needs a connection — it is on the server, not just this phone."
            : "Adding a card needs a connection — it goes on the server, not just this phone."
          : "That did not save.";
    }
    saving = false;
    draw();
  }

  draw();
  return root;
}
