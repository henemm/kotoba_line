import { MODES } from "../modes.js";
import { modeName } from "../script.js";
import { el, num, render } from "../ui/dom.js";

/**
 * One deck's options (#137): which ways of practising its page offers, and how
 * many new cards it brings a day.
 *
 * On the deck's page, top right, where Noji keeps a deck's menu — Henning
 * asked where per-deck settings should go, and the answer is where the deck
 * is. Settings keeps what is about her, not about a deck.
 *
 * A way the deck cannot do is shown switched off and greyed, with the reason,
 * rather than left out: "Listen only" vanishing from one deck and not another
 * would look like a fault. Counts are `/api/decks`' `ways` — the same rule
 * the session applies card by card.
 */
const NEW_PER_DAY_CHOICES = [5, 10, 15, 20, 30];

/**
 * v74, migration 017: how many cards the deck asks for a day, new and review
 * together — Noji's "Max cards per day", which took the place of "How long"
 * on the deck page. `null` is no limit and every deck's default.
 */
const MAX_PER_DAY_CHOICES = [null, 20, 30, 50, 100];

const CANNOT = {
  listen: "Hier nicht möglich: keine Beispielsätze mit Übersetzung",
  type: "Hier nicht möglich: keine Wörter mit Lesung zum Prüfen",
};

/**
 * #158: in a kana deck 話す and 書く would ask with the reading, which is the
 * answer, and 聞く has no sentences to play.
 */
const CANNOT_IN_KANA = "Bei Kana nicht möglich – übe sie mit „Bedeutung wählen“ oder „Karte umdrehen“";

export function deckOptionsSheet({ deck, japanese = true, onChange, onRename, onDelete, onClose, onPrefetchAudio }) {
  let settings = { hiddenModes: [], ...(deck.settings ?? {}) };
  const ways = deck.ways ?? {};
  // #290: undefined before the first tap, "running" while it is in flight,
  // else what it found — a result to show in place of the explanation, the
  // same shape "Löschen" gives with `problem` in `askToDelete` below.
  let prefetchStatus;

  const scrim = el("div.sheet-scrim.deck-options", {
    onclick: (e) => e.target === e.currentTarget && onClose?.(),
  });
  const sheet = el("div.sheet", { role: "dialog", "aria-label": `Optionen für ${deck.name}` });
  scrim.append(sheet);
  draw();

  function possible(mode) {
    return ways[mode.key] === undefined || ways[mode.key] > 0;
  }

  function draw() {
    const hidden = settings.hiddenModes ?? [];
    const on = MODES.filter((m) => possible(m) && !hidden.includes(m.key));
    render(
      sheet,
      el(
        "div.options-head",
        {},
        el("h2.sheet-title", { text: `Übungen für „${deck.name}“` }),
        el("button.options-done", { type: "button", text: "Fertig", onclick: () => onClose?.() }),
      ),
      el("p.sheet-body", { text: "Nur für dieses Deck." }),
      el(
        "div.options-list",
        {},
        MODES.map((mode) => {
          const can = possible(mode);
          const shown = can && !hidden.includes(mode.key);
          // The last way still on cannot be switched off: a deck page with
          // nothing to tap is not a setting anyone wants, and the server
          // refuses to store it.
          const last = shown && on.length === 1;
          const count = ways[mode.key];
          const note = !can
            ? (deck.key === "hiragana" || deck.key === "katakana" ? CANNOT_IN_KANA : CANNOT[mode.key]) ?? "Hier nicht möglich"
            : mode.key === "type" && count < deck.cards
              ? `${num(count)} von ${num(deck.cards)} Karten lassen sich tippen`
              : null;
          return el(
            "div.option-row",
            { class: can ? undefined : "cannot" },
            el(
              "span.copy",
              {},
              el(japanese ? "span.name.jp" : "span.name", { text: modeName(mode, japanese) }),
              japanese ? el("span.note", { text: mode.en }) : null,
              note ? el("span.note", { text: note }) : null,
            ),
            el("button.toggle", {
              type: "button",
              role: "switch",
              "aria-checked": String(shown),
              "aria-label": `${mode.en} anzeigen`,
              disabled: !can || last,
              onclick: () =>
                change({
                  hiddenModes: shown ? [...hidden, mode.key] : hidden.filter((k) => k !== mode.key),
                }),
            }, el("span.knob")),
          );
        }),
      ),
      flipFrontChoice(),
      el("span.options-label", { id: "new-per-day-label", text: "Neue Karten pro Tag" }),
      el(
        "div.choice",
        { role: "group", "aria-labelledby": "new-per-day-label" },
        choicesFor(settings.newPerDay).map((n) =>
          el("button", {
            type: "button",
            text: String(n),
            "aria-pressed": String(n === settings.newPerDay),
            onclick: () => n !== settings.newPerDay && change({ newPerDay: n }),
          }),
        ),
      ),
      el("span.options-label", { id: "max-per-day-label", text: "Höchstens pro Tag" }),
      el(
        "div.choice",
        { role: "group", "aria-labelledby": "max-per-day-label" },
        maxChoicesFor(settings.maxPerDay ?? null).map((n) =>
          el("button", {
            type: "button",
            text: n === null ? "Unbegrenzt" : String(n),
            "aria-pressed": String(n === (settings.maxPerDay ?? null)),
            onclick: () => n !== (settings.maxPerDay ?? null) && change({ maxPerDay: n }),
          }),
        ),
      ),
      el("p.options-hint", { text: "Neue und zu wiederholende Karten zusammen. Du kannst jederzeit früher aufhören." }),
      // #290: any deck, not only hers — the point is to fetch audio ahead of
      // a train ride, and Kaishi is where most of her cards live.
      onPrefetchAudio
        ? el(
            "div.options-prefetch",
            {},
            el("button.action", {
              type: "button",
              text: prefetchStatus === "running" ? "Lädt …" : "Nächste Karten für unterwegs laden",
              disabled: prefetchStatus === "running",
              onclick: () => runPrefetch(),
            }),
            el("p.options-hint", {
              text:
                prefetchStatus && prefetchStatus !== "running"
                  ? prefetchStatus
                  : "Lädt den Ton der als Nächstes fälligen Karten, damit er unterwegs ohne Netz da ist.",
            }),
          )
        : null,
      // #137: a deck of hers can be renamed and deleted here, where Noji keeps
      // a deck's menu. Kaishi is everyone's and cannot.
      deck.own && (onRename || onDelete)
        ? el(
            "div.options-deck",
            {},
            el("span.options-label", { text: "Dieses Deck" }),
            onRename ? el("button.action", { type: "button", text: "Umbenennen", onclick: () => onRename() }) : null,
            onDelete ? el("button.action.danger", { type: "button", text: "Deck löschen", onclick: () => askToDelete() }) : null,
          )
        : null,
    );
  }

  /**
   * #275: which side „Karte umdrehen" shows first, for this deck. Charlotte
   * asked whether Kaishi's Japanese-first could be set; Henning wanted a
   * setting, and a deck's settings live here. Not in a kana deck, whose
   * front is the character, nor where the way is switched off or impossible.
   */
  function flipFrontChoice() {
    const flip = MODES.find((m) => m.key === "flip");
    if (!settings.flipFront || !possible(flip) || (settings.hiddenModes ?? []).includes("flip")) return null;
    if (deck.key === "hiragana" || deck.key === "katakana") return null;
    const sides = [
      ["meaning", "Deutsch"],
      ["word", "Japanisch"],
    ];
    return [
      el("span.options-label", { id: "flip-front-label", text: `${flip.en}: vorne steht` }),
      el(
        "div.choice",
        { role: "group", "aria-labelledby": "flip-front-label" },
        sides.map(([side, text]) =>
          el("button", {
            type: "button",
            text,
            "aria-pressed": String(side === settings.flipFront),
            onclick: () => side !== settings.flipFront && change({ flipFront: side }),
          }),
        ),
      ),
      // #284: Henning, 2026-09-24 — „je Deck sagen, ob man auch in die
      // Gegenrichtung lernen will". Every card of the deck at once, as Noji's
      // "Select all → Reverse"; one card can still be set apart on its own.
      el(
        "div.option-row.reverse-row",
        {},
        el(
          "span.copy",
          {},
          el("span.name", { text: "Auch andersherum abfragen" }),
          el("span.note", {
            text: "Jede Karte kommt ein zweites Mal, mit der anderen Seite vorne. Jede Richtung hat ihren eigenen Lernstand. Einzelne Karten kannst du auch einzeln umstellen.",
          }),
        ),
        el("button.toggle", {
          type: "button",
          role: "switch",
          "aria-checked": String(Boolean(settings.reverse)),
          "aria-label": "Auch andersherum abfragen",
          onclick: () => change({ reverse: !settings.reverse }),
        }, el("span.knob")),
      ),
    ];
  }

  /** Asked first, with what goes: every card in it. The safe choice is the solid one. */
  function askToDelete() {
    const n = deck.cards ?? 0;
    render(
      sheet,
      el("h2.sheet-title", { text: `„${deck.name}“ löschen?` }),
      el("p.sheet-body", {
        text:
          n > 0
            ? `${n === 1 ? "Die 1 Karte darin wird" : `Die ${num(n)} Karten darin werden`} mitgelöscht. Was du schon geübt hast, zählt weiter für deine Serie und deine XP.`
            : "Es hat keine Karten.",
      }),
      el(
        "div.sheet-actions",
        {},
        el("button.btn", {
          type: "button",
          text: "Löschen",
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            // A sentence when it did not happen — offline, say — shown here.
            const problem = await onDelete();
            if (problem) sheet.append(el("p.add-problem", { text: problem }));
          },
        }),
        el("button.btn.solid", { type: "button", text: "Behalten", onclick: () => draw() }),
      ),
    );
  }

  function change(patch) {
    settings = { ...settings, ...patch };
    draw();
    onChange?.(patch, settings);
  }

  async function runPrefetch() {
    prefetchStatus = "running";
    draw();
    prefetchStatus = await onPrefetchAudio();
    draw();
  }

  return scrim;
}

/** The maximum's choices, and hers among them if it was stored as something else (the server allows 10 to 500). */
export function maxChoicesFor(current) {
  if (MAX_PER_DAY_CHOICES.includes(current)) return MAX_PER_DAY_CHOICES;
  return [null, ...[...MAX_PER_DAY_CHOICES.slice(1), current].sort((a, b) => a - b)];
}

/** The five choices, and hers among them if it was set to something else (Settings allowed 5 to 40 in fives). */
export function choicesFor(current) {
  if (current == null || NEW_PER_DAY_CHOICES.includes(current)) return NEW_PER_DAY_CHOICES;
  return [...NEW_PER_DAY_CHOICES, current].sort((a, b) => a - b);
}
