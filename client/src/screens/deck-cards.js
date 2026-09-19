import { OfflineError, api } from "../api.js";
import { say } from "../audio.js";
import { deckCatchingUp, loadDeck } from "../deck.js";
import { stopAllRecording } from "../recording.js";
import { wordSound } from "../sound.js";
import { showsScript, shownWord } from "../script.js";
import { byTopicLabel, topicLabel } from "../topics.js";
import { exactFirst, matchesQuery } from "./browse.js";
import { cardHistoryBlock } from "./card-history.js";
import { el, num, render } from "../ui/dom.js";
import { voiceCircle } from "../ui/voice-circle.js";

/**
 * The cards in one deck, under its practise controls (#137) — Noji's "Karten
 * im Deck", which is where Charlotte adds a card while she is in the deck.
 *
 * Read from the deck already cached on the phone, not from the server: the
 * list works on a train, and it costs no data to open. What the cache does not
 * hold — stars, how well a card is known — is left off rather than guessed,
 * the rule Browse follows offline (#22).
 */

/** Rows drawn before "Show more". Her 1000 list has 232; a page should not draw them all. */
export const ROWS_PER_PAGE = 50;

/**
 * Which cached cards belong to one of her decks, in the order of her list with
 * the newest card on top (own ids are negative epoch milliseconds, so
 * ascending id is exactly that). A search puts an exact romaji match first.
 *
 * Her decks only (v69): Kaishi's page has no card list. Its 1,500 cards are
 * not hers to edit, so a row there led nowhere (Henning, 2026-09-14), and
 * finding a Kaishi word is what Search is for.
 *
 * `list_name` stands in for `deck_id` on a card cached before migration 016
 * reached this phone; the next sync replaces it.
 */
export function cardsOfDeck(deck, cards, q = "") {
  const inDeck = (c) => c.deck === "personal" && (c.deck_id === deck.id || (c.deck_id == null && c.list_name === deck.name));
  const found = cards.filter((c) => !c.deleted_at && inDeck(c) && matchesQuery(c, q));
  return found.sort(exactFirst(q, (a, b) => a.id - b.id));
}

export function deckCardsBlock({ deck, japanese = true, onCard, onAdd }) {
  const root = el("div.deck-cards");
  const list = el("div.deck-cards-list");
  const heading = el("span.set-label");
  let q = "";
  let shown = ROWS_PER_PAGE;
  let all;

  const search = el("input.deck-cards-search", {
    type: "search",
    inputmode: "search",
    autocapitalize: "none",
    autocorrect: "off",
    spellcheck: "false",
    placeholder: "In diesem Deck suchen",
    "aria-label": `In ${deck.name} suchen`,
  });
  search.addEventListener("input", () => {
    q = search.value.trim();
    shown = ROWS_PER_PAGE;
    drawList();
  });

  // "+ Karte hinzufügen" sits right above the search, with the cards it adds
  // to (Henning, v78). It floated over the page before, as Noji's does, and
  // covered whatever was under it — the sound switch on an iPad, a card row on
  // the phone. One place on every screen size, in the page's own flow.
  const add = onAdd ? el("button.deck-cards-add", { type: "button", onclick: onAdd, text: "+ Karte hinzufügen" }) : null;

  render(root, heading, add, search, list);
  load();

  async function load() {
    try {
      all = [...(await loadDeck()).values()];
    } catch {
      all = [];
    }
    drawList();
    // A phone that cached its cards before this version learns which deck
    // each is in from the first sync of the run; draw again once it is in.
    await deckCatchingUp();
    all = [...(await loadDeck()).values()];
    drawList();
  }

  function drawList() {
    if (!all) {
      heading.textContent = "Karten in diesem Deck";
      render(list, el("div.loading", { text: "…" }));
      return;
    }
    const cards = cardsOfDeck(deck, all);
    const matching = q ? cardsOfDeck(deck, all, q) : cards;
    heading.textContent = `Karten in diesem Deck · ${num(cards.length)}`;
    if (cards.length === 0) {
      render(list, el("p.deck-cards-note", { text: "Noch keine Karten. Tippe auf + Karte hinzufügen, um die erste zu schreiben." }));
      return;
    }
    if (matching.length === 0) {
      render(list, el("p.deck-cards-note", { text: `In ${deck.name} passt nichts zu „${q}“.` }));
      return;
    }
    render(
      list,
      el("div.deck-cards-rows", {}, matching.slice(0, shown).map(row)),
      matching.length > shown
        ? el("button.deck-cards-more", {
            type: "button",
            text: `Mehr zeigen · noch ${num(matching.length - shown)}`,
            onclick: () => {
              shown += ROWS_PER_PAGE;
              drawList();
            },
          })
        : null,
    );
  }

  /** Her cards lead with the German she wrote, as on the front in Noji. */
  function row(card) {
    const word = el(showsScript(card, japanese) ? "span.deck-card-word.jp" : "span.deck-card-word", {
      text: shownWord(card, japanese),
    });
    const meaning = el("span.deck-card-meaning", { text: card.word_meaning ?? "" });
    return el("button.deck-card", { type: "button", onclick: () => onCard?.(card) }, el("span.copy", {}, meaning, word));
  }

  return root;
}

/**
 * What a tap on one of her cards offers (#137): edit, move, delete — Noji's
 * card menu without the entries nobody has asked for yet. "Move" turns the
 * same sheet into the list of her other decks, so there is no second sheet to
 * find the way back from.
 *
 * #98: the menu also shows the card's own record, under the actions — built
 * once, so going to "move" and back does not ask the server again.
 *
 * #185 follow-up (2026-09-17): a native speaker going through her cards with
 * her does not have to start a review to record one — the word is already
 * on screen here, so the same circle from the review modes fits. Only the
 * Muttersprachler voice, not her own: this menu is for managing the card,
 * not for practising it. Fetched once, the same "built once" reasoning as
 * the history block below, since the deck's card list itself carries no
 * recording data — unlike a review session's queue.
 */
export function cardActionsSheet({
  card,
  japanese = true,
  decks = [],
  recordingEnabled = true,
  // #187: from Suche the row knows the star. From the deck page it does not
  // (the list is the phone's copy), so there `starred` is undefined and the
  // star is read from the card's record, which the sheet asks for anyway —
  // Henning, 2026-09-19: star and topic straight from the deck's list.
  starred,
  canStar = false,
  onStar,
  // 2026-09-19: her topics on this card, toggled right here instead of only
  // behind Bearbeiten → "Lesung, Beispielsatz, Thema". `topicNames()`
  // resolves to every topic in use, for the chips she can add; `onTopics`
  // saves the card's new list and rejects if that did not work.
  topicNames,
  onTopics,
  onEdit,
  onMove,
  onDelete,
  onClose,
}) {
  // Not on a card whose own recording is already a native speaker's — a
  // Kaishi word she linked (#185, 2026-09-17: 何 was offered one anyway).
  const scrim = el("div.sheet-scrim.card-actions", {
    onclick: (e) => e.target === e.currentTarget && closeWithCleanup(),
  });
  const sheet = el("div.sheet.card-sheet", { role: "dialog", "aria-label": card.word_meaning ?? shownWord(card, japanese) });
  scrim.append(sheet);
  const record = api.cardHistory(card.id);
  record.catch(() => {});
  const history = cardHistoryBlock({ cardId: card.id, request: record });
  // Unknown until the record says, and inert until then — never a guessed ☆
  // (#22). Offline it stays inert, as in Suche.
  let starKnown = starred !== undefined;
  if (!starKnown && onStar) {
    record
      .then((r) => {
        starred = Boolean(r.starred);
        starKnown = true;
        draw();
      })
      .catch(() => {});
  }

  let topics = [...(card.tags ?? [])];
  let allTopics = [];
  let choosing = false;
  let coining = false;
  let topicProblem;
  const MAX_TOPICS = 5;

  let nativeRecording;
  const deckNative = wordSound(card).deckNative;
  const nativeCircle = recordingEnabled && !deckNative
    ? voiceCircle({
        cardId: card.id,
        kind: "native",
        ariaLabel: "Muttersprachler",
        emptyCaption: "Muttersprachler-Aufnahme hinzufügen",
        filledCaption: "Muttersprachler-Aufnahme bearbeiten",
        shared: { active: null },
        rowLayout: true,
        getSource: () => nativeRecording,
        setSource: (rec) => {
          nativeRecording = rec;
        },
      })
    : null;
  if (nativeCircle) {
    api
      .cardRecordings(card.id)
      .then(({ recordings }) => {
        nativeRecording = recordings?.find((r) => r.kind === "native") ?? null;
        nativeCircle.refresh();
      })
      .catch(() => {
        // Left as the placeholder empty state: a listing that fails leaves
        // recording still possible, not blocked on a retry of its own.
      });
  }

  let step = "menu";
  let problem;
  draw();

  /**
   * The card's topics as chips she can take off, and "+ Thema" for the rest.
   * The rest stays folded: 29 of Kaishi's and any of hers would bury the
   * card's menu under chips. The same interaction as the add-a-word form and
   * the Kaishi card's sheet (#35) otherwise — a tap toggles, "+ neu" coins.
   * Each tap saves at once, like the star beside it.
   */
  function topicGroup() {
    const others = allTopics.filter((t) => !topics.includes(t));
    return el(
      "div.topics-mine.card-topics",
      {},
      el("span.set-label", { text: "Thema" }),
      el(
        "div.chips",
        {},
        topics.map((tag) => topicChip(tag, true)),
        choosing ? others.map((tag) => topicChip(tag, false)) : null,
        choosing
          ? coining
            ? newTopicField()
            : el("button.chip.new-tag", { type: "button", text: "+ neu", onclick: () => ((coining = true), draw(), sheet.querySelector(".new-tag-input")?.focus()) })
          : el("button.chip.new-tag", { type: "button", text: "+ Thema", onclick: openChoice }),
      ),
      topicProblem ? el("p.add-problem", { text: topicProblem }) : null,
    );
  }

  function topicChip(tag, on) {
    return el("button.chip", {
      type: "button",
      text: topicLabel(tag),
      "aria-pressed": String(on),
      disabled: !on && topics.length >= MAX_TOPICS,
      onclick: () => setTopics(on ? topics.filter((t) => t !== tag) : [...topics, tag]),
    });
  }

  async function openChoice() {
    choosing = true;
    draw();
    try {
      allTopics = [...new Set(await topicNames())].sort(byTopicLabel);
    } catch {
      allTopics = [];
    }
    if (step === "menu") draw();
  }

  async function setTopics(next) {
    const before = topics;
    topics = next;
    topicProblem = undefined;
    draw();
    try {
      await onTopics(next);
      card.tags = next;
    } catch (err) {
      topics = before;
      topicProblem =
        err instanceof OfflineError
          ? "Für Themen brauchst du eine Verbindung – sie liegen auf dem Server, nicht nur auf diesem Handy."
          : "Das Speichern hat nicht geklappt.";
    }
    if (step === "menu") draw();
  }

  /** Enter and blur both finish, once — the add-a-word form's guard, same reason. */
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
      if (name && !topics.includes(name) && topics.length < MAX_TOPICS) setTopics([...topics, name]);
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

  function closeWithCleanup() {
    stopAllRecording();
    onClose?.();
  }

  function draw() {
    // Menu is the only step that shows the recording circle — leaving it
    // (move, delete) must not leave a capture running unattended, the same
    // rule session.js follows whenever it replaces the DOM node a
    // native circle lives in.
    if (step !== "menu") stopAllRecording();
    const title = [el("h2.sheet-title", { text: card.word_meaning ?? "" }), el("p.sheet-body", { text: shownWord(card, japanese) })];
    if (step === "menu") {
      render(
        sheet,
        // #187: the same head as the Kaishi card's sheet — the star, and ♪
        // for what the card plays. The star only from Suche (see `onStar`
        // above); a tap on it writes at once, like the row's.
        el(
          "div.card-actions-head",
          {},
          el("div.card-actions-title", {}, ...title),
          onStar
            ? el("button.topics-star", {
                type: "button",
                disabled: !canStar || !starKnown,
                "aria-label": canStar
                  ? starred
                    ? `Markierung entfernen: ${shownWord(card, japanese)}`
                    : `${shownWord(card, japanese)} markieren`
                  : "Markieren braucht Internet",
                "aria-pressed": String(Boolean(canStar && starred)),
                text: canStar && starred ? "★" : "☆",
                onclick: () => {
                  starred = !starred;
                  draw();
                  onStar(starred);
                },
              })
            : null,
          // Its recording, or its generated file (#183); never the phone's
          // voice, same as the Kaishi card's sheet.
          card.word_audio || card.word_audio_generated
            ? el("button.topics-hear", {
                type: "button",
                "aria-label": `${shownWord(card, japanese)} anhören`,
                text: "♪",
                onclick: () => say(undefined, card.word_audio || card.word_audio_generated),
              })
            : null,
        ),
        onTopics ? topicGroup() : null,
        nativeCircle ? el("div.card-recording-row", {}, nativeCircle.root) : null,
        // #187 (Henning, 2026-09-17): a card that already has a native
        // recording — a Kaishi word she linked — got no circle and no word
        // about why, so the circle looked like it had gone missing. Say what
        // the ♪ above plays instead.
        recordingEnabled && deckNative
          ? el("p.card-recording-note", { text: "Muttersprachler-Aufnahme vorhanden – das ♪ spielt sie." })
          : null,
        el(
          "div.action-list",
          {},
          el("button.action", { type: "button", text: "Bearbeiten", onclick: () => (stopAllRecording(), onEdit?.(card)) }),
          decks.length > 0
            ? el("button.action", { type: "button", text: "In ein anderes Deck verschieben", onclick: () => ((step = "move"), draw()) })
            : null,
          el("button.action.danger", { type: "button", text: "Löschen", onclick: () => ((step = "delete"), draw()) }),
        ),
        history,
      );
    } else if (step === "move") {
      render(
        sheet,
        el("h2.sheet-title", { text: "Verschieben nach" }),
        el(
          "div.action-list",
          {},
          decks.map((d) => el("button.action", { type: "button", text: d.name, onclick: () => move(d) })),
        ),
        problem ? el("p.add-problem", { text: problem }) : null,
        el("button.action.quiet", { type: "button", text: "Zurück", onclick: () => ((step = "menu"), (problem = undefined), draw()) }),
      );
    } else {
      // Asked, like deleting a word always was (design 30); the safe choice is
      // the solid one, because a tap that lands on "Delete" is often a mistake.
      render(
        sheet,
        el("h2.sheet-title", { text: `„${card.word_meaning ?? shownWord(card, japanese)}“ löschen?` }),
        el("p.sheet-body", { text: "Die Karte verschwindet aus diesem Deck und deinen Übungen. Was du schon geübt hast, zählt weiter für deine Serie und deine XP." }),
        problem ? el("p.add-problem", { text: problem }) : null,
        el(
          "div.sheet-actions",
          {},
          el("button.btn", { type: "button", text: "Löschen", onclick: remove }),
          el("button.btn.solid", { type: "button", text: "Behalten", onclick: closeWithCleanup }),
        ),
      );
    }
  }

  async function move(deck) {
    problem = await onMove?.(card, deck);
    if (problem) draw();
  }

  async function remove() {
    problem = await onDelete?.(card);
    if (problem) draw();
  }

  return scrim;
}

/**
 * A deck's name, for a new deck and for renaming one (#137). One field and one
 * button; the name she already uses for another deck is refused with a
 * sentence rather than a code.
 */
export function deckNameSheet({ title, name = "", action, onSubmit, onClose }) {
  const scrim = el("div.sheet-scrim.deck-name", { onclick: (e) => e.target === e.currentTarget && onClose?.() });
  const sheet = el("div.sheet", { role: "dialog", "aria-label": title });
  scrim.append(sheet);
  const input = el("input.deck-name-input", {
    type: "text",
    maxlength: "60",
    autocapitalize: "sentences",
    autocorrect: "off",
    placeholder: "Name des Decks",
    "aria-label": "Name des Decks",
  });
  input.value = name;
  let problem;
  let busy = false;
  const note = el("div.deck-name-note");
  const button = el("button.btn-primary.deck-name-save", { type: "button", text: action, onclick: submit });
  input.addEventListener("input", () => {
    button.disabled = !input.value.trim() || busy;
  });
  input.addEventListener("keydown", (e) => e.key === "Enter" && submit());
  button.disabled = !name.trim();

  render(
    sheet,
    el("div.options-head", {}, el("h2.sheet-title", { text: title }), el("button.options-done", { type: "button", text: "Abbrechen", onclick: () => onClose?.() })),
    input,
    note,
    button,
  );
  // After the sheet is on the page; focusing a detached input does nothing.
  setTimeout(() => input.focus(), 50);

  async function submit() {
    const value = input.value.trim();
    if (!value || busy) return;
    busy = true;
    button.disabled = true;
    problem = await onSubmit?.(value);
    busy = false;
    button.disabled = false;
    render(note, problem ? el("p.add-problem", { text: problem }) : null);
  }

  return scrim;
}
