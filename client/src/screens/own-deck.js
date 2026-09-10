import { OfflineError, api } from "../api.js";
import { say, unlock } from "../audio.js";
import { maturityBand } from "./browse.js";
import { el, num, render } from "../ui/dom.js";

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
 * Add a word (28, 29).
 *
 * The word and the meaning are what make it savable; the reading and the
 * example sentence are what make it good. The sentence is behind a disclosure
 * "because on a train she will not write one, and an empty sentence field
 * would only reproach her".
 */
export function addWordScreen({ tags = [], initialWord = "", onSaved, onCancel }) {
  const root = el("div.add-word");
  // Coerced rather than trusted: this arrives from two call sites, and one of
  // them is a click handler that would otherwise hand over the event.
  const draft = {
    word: typeof initialWord === "string" ? initialWord : "",
    reading: "",
    meaning: "",
    sentence: "",
    sentenceMeaning: "",
  };
  const chosen = new Set();
  let sentenceOpen = false;
  let coining = false;
  let saving = false;
  let problem;

  const fields = {};

  function field(key, { placeholder, big = false, lang = "ja" }) {
    const input = el(big ? "textarea" : "input", {
      class: `field-input${big ? " big" : ""}${lang === "ja" ? " jp" : ""}`,
      placeholder,
      value: draft[key],
      rows: big ? "2" : undefined,
      type: big ? undefined : "text",
      autocapitalize: lang === "en" ? "sentences" : "none",
      autocorrect: "off",
      spellcheck: "false",
    });
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
  function refreshHeader() {
    render(
      header,
      el("button.add-cancel", { type: "button", text: "Cancel", onclick: onCancel }),
      el("span.add-title", { text: "Add a word" }),
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
        group("Word", el("div.field.big", {}, field("word", { placeholder: "日本語", big: true }))),
        group(
          "Reading · optional",
          el("div.field", {}, field("reading", { placeholder: "かな" })),
        ),
        group(
          "Meaning",
          el("div.field", {}, field("meaning", { placeholder: "In English", lang: "en" })),
        ),
        sentenceOpen ? sentenceGroup() : disclosure(),
        topicGroup(),
        problem ? el("p.add-problem", { text: problem }) : null,
      ),
      el(
        "div.add-foot",
        {},
        el("p.add-note", {
          // The same fact 47's caption states, said before she commits rather
          // than after: her own cards never have a recording.
          text: "No recording — your own words are read by the phone's Japanese voice. The card enters the queue as new, tomorrow.",
        }),
      ),
    );
    // Coming from an empty browse search, the word is already typed.
    if (initialWord && !draft.meaning) fields.meaning?.focus();
  }

  function disclosure() {
    return el(
      "button.add-disclosure",
      {
        type: "button",
        onclick: () => {
          sentenceOpen = true;
          draw();
          fields.sentence?.focus();
        },
      },
      el("span", { text: "Add an example sentence" }),
      el("span.chevron", { text: "›" }),
    );
  }

  function sentenceGroup() {
    return group(
      "Example sentence",
      el("div.field", {}, field("sentence", { placeholder: "文を書く", big: false })),
      el("div.field", {}, field("sentenceMeaning", { placeholder: "What it means", lang: "en" })),
      // 29: the speaker reads it back, which is the only honest way to check
      // the synthesis got the reading right — and if it did not, the reading
      // field is what fixes it.
      draft.word.trim()
        ? el("button.add-speak", {
            type: "button",
            text: "♪ Hear it",
            onclick: () => {
              unlock();
              say(draft.sentence.trim() || draft.reading.trim() || draft.word.trim(), null, {
                rate: 0.85,
              });
            },
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

  async function save() {
    if (!canSave()) return;
    saving = true;
    problem = undefined;
    refreshHeader();

    try {
      const { card } = await api.addCard({
        word: draft.word.trim(),
        reading: draft.reading.trim() || undefined,
        meaning: draft.meaning.trim(),
        sentence: draft.sentence.trim() || undefined,
        sentenceMeaning: draft.sentenceMeaning.trim() || undefined,
        tags: [...chosen],
      });
      // 29: "saving returns to the practise tab with the count incremented, no
      // confirmation screen."
      onSaved?.(card);
      return;
    } catch (err) {
      problem =
        err instanceof OfflineError
          ? "Adding a word needs a connection — it goes on the server, not just this phone."
          : "That did not save.";
    }
    saving = false;
    draw();
  }

  draw();
  return root;
}

/**
 * Her list (30).
 *
 * Maturity per row in words rather than a bar: five rows do not need a chart.
 */
export function ownDeckScreen({ onBack, onAdd }) {
  const root = el("div.own-deck");
  let cards;
  let problem;

  load();

  async function load() {
    try {
      ({ cards } = await api.cards());
    } catch (err) {
      problem =
        err instanceof OfflineError
          ? "Your own deck needs a connection. Practice does not."
          : "Could not load your deck.";
    }
    draw();
  }

  function draw() {
    render(
      root,
      el(
        "div.own-head",
        {},
        el("button.browse-back", { type: "button", "aria-label": "Back", text: "←", onclick: onBack }),
        el("span.browse-title", { text: "Your own deck" }),
        el("span.browse-count.tabular", {
          text: cards ? `${num(cards.length)} ${cards.length === 1 ? "word" : "words"}` : "",
        }),
      ),
      el("p.own-note", { text: "Scheduled alongside the Kaishi deck." }),
      problem ? el("p.browse-note", { text: problem }) : body(),
      el(
        "div.own-foot",
        {},
        el("button.btn-primary", { type: "button", text: "Add a word", onclick: onAdd }),
      ),
    );
  }

  function body() {
    if (!cards) return el("div.loading", { text: "…" });
    if (cards.length === 0) {
      // 30: the empty state keeps the header and the button and replaces the
      // list with one line.
      return el("p.browse-note", {
        text: "Words you add here are scheduled like any other card.",
      });
    }
    return el("div.own-list", {}, cards.map(row));
  }

  function row(card) {
    return el(
      "div.own-row",
      {},
      el(
        "span.own-copy",
        {},
        el("span.own-word.jp", { text: card.word }),
        el("span.own-gloss", { text: card.word_meaning }),
      ),
      el("span.own-band", { text: maturityWord(card) }),
    );
  }

  return root;
}

/**
 * 30 says the band in words rather than as a square.
 *
 * The thresholds live in one place — browse's `maturityBand` — because two
 * copies of "twenty-one days" is two things to change and one to forget.
 */
export const maturityWord = maturityBand;
