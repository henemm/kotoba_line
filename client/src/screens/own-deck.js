import { OfflineError, api } from "../api.js";
import { loadDeck } from "../deck.js";
import { kaishiMatches, kaishiOf } from "../kaishi-match.js";
import { inScript, showsScript, shownWord } from "../script.js";
import { plainSentence } from "./session.js";
import { topicLabel } from "../topics.js";
import { el, render } from "../ui/dom.js";
import { soundButton } from "../ui/sound-button.js";
import { seen } from "../seen.js";

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
/**
 * #284: the `reverse` a save sends. A new card says what the switch says;
 * an edit only what she changed — the switch can start from a phone's copy
 * of the deck that is behind, and a typo fixed on such a phone must not
 * switch off a reverse it had not heard of yet. Pure, for the test.
 */
export function reverseField({ editing, reverse, moved }) {
  return !editing || moved ? { reverse } : {};
}

export function addWordScreen({
  tags = [],
  initialWord = "",
  card,
  // The deck the card goes into: `{ id, name }` (#137).
  deck,
  onSaved,
  onDeleted,
  onCancel,
  // #284: a new card starts as the deck's „Auch andersherum abfragen" stands.
  reverse: reverseDefault = false,
  // #135: the placeholders 日本語, かな and 文を書く are decoration too.
  japanese = true,
}) {
  const root = el("div.add-word");
  // #85: the same form edits a word she already has. It is the same five
  // fields and the same rules, and a second form would drift from this one.
  const editing = Boolean(card);
  // Coerced rather than trusted: this arrives from two call sites, and one of
  // them is a click handler that would otherwise hand over the event.
  // v70: a card with a Kaishi recording stores Kaishi's spelling (大きい), which
  // with the script off she has only ever seen as "ookii" — so that is what
  // the field shows, and what she can correct.
  const startWord = editing ? (card.word_audio ? shownWord(card, japanese) : card.word ?? "") : "";
  // A Kaishi sentence marks its word as <b>…</b>; the field shows it plain,
  // and an untouched sentence is sent back as it was, recording and all.
  const startSentence = editing ? plainSentence(card.sentence) ?? "" : "";
  const draft = editing
    ? {
        word: startWord,
        reading: card.word_reading ?? "",
        meaning: card.word_meaning ?? "",
        sentence: startSentence,
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

  // v70: the Kaishi words on this phone, the one whose recording the card has
  // (`link`), and whether she took one off or typed it away (`linkDropped`).
  let kaishi = [];
  let link;
  let linkDropped = false;
  const offers = el("div.kaishi-offer");

  // #284: "Auch andersherum abfragen", as Noji's Reverse. Whether an edited
  // card has one: `card.reverse` where the card came from the server, else
  // the phone's copy of the deck, where a reverse is a card of its own
  // (`reverse_of`). That copy can be behind the server — a reverse switched
  // on elsewhere may not have reached it — so what the switch shows is only
  // sent when she has moved it. An edit that leaves it alone leaves the
  // reverse alone, whatever this phone believed.
  let reverse = editing ? Boolean(card.reverse) : Boolean(reverseDefault);
  let reverseMoved = false;
  const reverseSlot = el("div.add-reverse");
  loadDeck()
    .then((deck) => {
      kaishi = [...deck.values()].filter((c) => c.deck === "kaishi");
      if (editing && !linkDropped) link = kaishiOf(card, kaishi);
      drawOffers();
      if (editing && card.reverse === undefined && !reverseMoved) {
        reverse = [...deck.values()].some((c) => c.reverse_of === card.id && !c.deleted_at);
        drawReverse();
      }
    })
    .catch(() => {
      /* no cache yet: the form works, it just offers nothing */
    });

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
      if (key === "word") drawOffers();
    });
    fields[key] = input;
    return input;
  }

  const canSave = () => draft.word.trim() && draft.meaning.trim() && !saving;

  const header = el("div.add-head");
  const nextButton = el("button.btn-primary.add-next", {
    type: "button",
    text: "Speichern und nächste",
    onclick: () => save({ next: true }),
  });
  function refreshHeader() {
    nextButton.disabled = !canSave();
    render(
      header,
      el("button.add-cancel", { type: "button", text: "Abbrechen", onclick: onCancel }),
      el("span.add-title", { text: editing ? "Karte bearbeiten" : "Karte hinzufügen" }),
      // 28: "Save stays #3D465C until word and meaning both have content."
      el("button.add-save", {
        type: "button",
        text: saving ? "…" : "Speichern",
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
        deck && !editing ? el("p.add-deck", { text: `Neue Karte in „${deck.name}“` }) : null,
        lastSaved ? el("p.add-saved", { text: `Gespeichert: ${lastSaved}` }) : null,
        group("Deutsch", el("div.field", {}, field("meaning", { placeholder: "Die Vorderseite der Karte", lang: "de" }))),
        group(
          "Japanisch",
          el("div.field.big", {}, field("word", { placeholder: japanese ? "日本語" : "Romaji oder Kana", big: true, lang: japanese ? "ja" : "romaji" })),
          el("p.add-hint", { text: "In Romaji oder Kana, so wie du es in Noji schreiben würdest." }),
          offers,
        ),
        reverseSlot,
        ...(moreOpen
          ? [
              group(
                "Lesung · optional",
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
              text: "Wenn du eine Karte änderst, bleibt dein Lernstand erhalten.",
            }),
            el("button.btn-secondary.add-delete", {
              type: "button",
              text: "Diese Karte löschen",
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
              // no recording unless she takes Kaishi's (v70), and since v66 romaji
              // is never read by a guessing voice.
              text: "Wenn Kaishi das Wort hat, kannst du seine Aufnahme für deine Karte übernehmen. Sonst liest die japanische Stimme des Handys Kana und Kanji vor; Romaji bleibt stumm.",
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
   * #284: the switch, in its own slot like the Kaishi offers, so setting it
   * never redraws the fields under her keyboard. Not reset by "Speichern und
   * nächste": in Noji, too, it stays on for the cards that follow.
   */
  function drawReverse() {
    render(
      reverseSlot,
      el(
        "span.copy",
        {},
        el("span.name", { text: "Auch andersherum abfragen" }),
        el("span.note", {
          text: "Beim Karte-Umdrehen kommt sie dann ein zweites Mal, mit der anderen Seite vorne. Jede Richtung hat ihren eigenen Lernstand, wie in Noji.",
        }),
      ),
      el(
        "button.toggle",
        {
          type: "button",
          role: "switch",
          "aria-checked": String(reverse),
          "aria-label": "Auch andersherum abfragen",
          onclick: () => {
            reverse = !reverse;
            reverseMoved = true;
            seen(reverse ? "reverse_on" : "reverse_off", "form");
            drawReverse();
          },
        },
        el("span.knob"),
      ),
    );
  }

  /**
   * What came with a Kaishi word goes with it: its reading and its example
   * sentence, where the form still holds them unchanged. Found in the browser
   * run: "kiku" retyped as "kiite" kept きく as its reading and a sentence
   * about 聞く.
   */
  function dropLink() {
    for (const [key, value] of [["reading", link.word_reading], ["sentence", plainSentence(link.sentence)]]) {
      if (value && draft[key].trim() === value) {
        draft[key] = "";
        if (fields[key]) fields[key].value = "";
      }
    }
    link = undefined;
    linkDropped = true;
  }

  /**
   * v70: under the Japanese, the Kaishi words that are exactly what she typed,
   * each with its English meaning, a ♪ to hear it and "Use" — or the one her
   * card already takes its recording from, with "Remove". Drawn into its own
   * slot, like the header, so typing never loses the keyboard.
   */
  function drawOffers() {
    // Typed into something else: the recording was of another word.
    if (link && !kaishiMatches(draft.word, [link]).length) dropLink();
    const word = (k) =>
      el("span.kaishi-word", {}, el(showsScript(k, japanese) ? "b.jp" : "b", { text: shownWord(k, japanese) }), el("span", { text: k.word_meaning ?? "" }));
    const hear = (k) =>
      soundButton({ sound: { file: k.word_audio }, className: ".kaishi-hear", label: `${shownWord(k, japanese)} anhören` });
    if (link) {
      render(
        offers,
        el("span.kaishi-label", { text: "Aufnahme aus Kaishi" }),
        el(
          "div.kaishi-row.linked",
          {},
          word(link),
          hear(link),
          el("button.kaishi-use", {
            type: "button",
            text: "Entfernen",
            onclick: () => {
              dropLink();
              drawOffers();
            },
          }),
        ),
      );
      return;
    }
    const found = kaishiMatches(draft.word, kaishi).filter((k) => k.word_audio);
    if (found.length === 0) return render(offers);
    render(
      offers,
      el("span.kaishi-label", { text: found.length === 1 ? "Kaishi hat dieses Wort" : "Kaishi hat diese Wörter" }),
      ...found.map((k) =>
        el(
          "div.kaishi-row",
          {},
          word(k),
          hear(k),
          el("button.kaishi-use", {
            type: "button",
            text: "Übernehmen",
            "aria-label": `Aufnahme von ${shownWord(k, japanese)} übernehmen, „${k.word_meaning}“`,
            onclick: () => {
              link = k;
              drawOffers();
            },
          }),
        ),
      ),
      el("p.kaishi-note", {
        text: found.length === 1 ? "Nur wenn es dein Deutsch bedeutet: Seine Aufnahme kommt dann auf deine Karte." : "Wähl das, was dein Deutsch bedeutet: Seine Aufnahme kommt dann auf deine Karte.",
      }),
    );
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
        el("h2.sheet-title", { text: `${shownWord(card, japanese)} löschen?` }),
        el("p.sheet-body", {
          text: "Die Karte verschwindet aus deinem Deck und deinen Übungen. Was du schon geübt hast, zählt weiter für deine Serie und deine XP.",
        }),
        el(
          "div.sheet-actions",
          {},
          el("button.btn", {
            type: "button",
            text: "Löschen",
            onclick: () => {
              sheet.remove();
              remove();
            },
          }),
          el("button.btn.solid", { type: "button", text: "Behalten", onclick: () => sheet.remove() }),
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
          ? "Zum Löschen brauchst du eine Verbindung – die Karte liegt auf dem Server, nicht nur auf diesem Handy."
          : "Das Löschen hat nicht geklappt.";
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
      el("span", { text: "Lesung, Beispielsatz, Thema" }),
      el("span.chevron", { text: "›" }),
    );
  }

  function sentenceGroup() {
    return group(
      "Beispielsatz",
      el("div.field", {}, field("sentence", { placeholder: japanese ? "文を書く" : "Auf Japanisch", big: false })),
      el("div.field", {}, field("sentenceMeaning", { placeholder: "Was er bedeutet", lang: "en" })),
      // 29: the speaker reads it back, which is the only honest way to check
      // the synthesis got the reading right — and if it did not, the reading
      // field is what fixes it.
      // Only what the phone's voice can read honestly (v66): Japanese characters.
      inScript(draft.sentence.trim() || draft.reading.trim() || draft.word.trim())
        ? soundButton({
            sound: () => ({ text: draft.sentence.trim() || draft.reading.trim() || draft.word.trim(), rate: 0.85 }),
            className: ".add-speak",
            label: "Anhören",
            content: "♪ Anhören",
          })
        : null,
    );
  }

  function topicGroup() {
    return group(
      "Thema",
      el(
        "div.chips.add-chips",
        {},
        tags.map(({ tag }) =>
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
        // 29: "a new one can be coined on the spot — this is how the twelve-tag
        // list in stats comes about." An inline field rather than a native
        // prompt(): in a standalone PWA that dialog is the browser's, not the
        // app's, and it looks like one.
        coining ? newTagField() : el("button.chip.new-tag", {
          type: "button",
          text: "+ neu",
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
      placeholder: "Thema",
      autocapitalize: "none",
      autocorrect: "off",
      "aria-label": "Neues Thema benennen",
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

    // v70: the Kaishi word she chose, or null where she took one off. Neither —
    // a card whose Kaishi word this phone does not have — sends the stored
    // spelling back if she left the field alone, so the server keeps the
    // recording of an unchanged word.
    const kaishiId = link ? link.id : editing && linkDropped ? null : undefined;
    const untouched = editing && kaishiId === undefined && draft.word.trim() === startWord.trim();
    const body = {
      word: untouched ? card.word : draft.word.trim(),
      reading: draft.reading.trim() || undefined,
      meaning: draft.meaning.trim(),
      sentence: (editing && card.sentence && draft.sentence.trim() === startSentence.trim() ? card.sentence : draft.sentence.trim()) || undefined,
      sentenceMeaning: draft.sentenceMeaning.trim() || undefined,
      tags: [...chosen],
      deckId: deck?.id,
      kaishiId,
      ...reverseField({ editing, reverse, moved: reverseMoved }),
    };
    try {
      // Editing sends the whole card; a field she emptied is left out and the
      // server stores it as empty.
      const { card: saved } = editing ? await api.updateCard(card.id, body) : await api.addCard(body);
      if (next) {
        // The same deck, an empty form, the German field ready for the next card.
        lastSaved = body.meaning;
        Object.assign(draft, { word: "", reading: "", meaning: "", sentence: "", sentenceMeaning: "" });
        link = undefined;
        drawOffers();
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
            ? "Zum Ändern brauchst du eine Verbindung – die Karte liegt auf dem Server, nicht nur auf diesem Handy."
            : "Zum Hinzufügen brauchst du eine Verbindung – die Karte kommt auf den Server, nicht nur auf dieses Handy."
          : "Das Speichern hat nicht geklappt.";
    }
    saving = false;
    draw();
  }

  draw();
  drawReverse();
  return root;
}
