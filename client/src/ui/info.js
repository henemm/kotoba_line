/**
 * The (i) next to a heading, and the short explanation behind it (Henning,
 * 2026-09-20: "Könntest du die App mit (i) info-Popovers garnieren? Z.B. bei
 * den Übungen, was bedeutet 'Laut sagen'? Was bedeuten die Zahlen … wo kann
 * man das ändern?").
 *
 * One component for all of them, like the ♪ and the press: a caller names a
 * text, nothing writes its own box. The texts live here rather than at the
 * call sites so they can be read and corrected in one place — they are for a
 * sixteen-year-old and for a traveller with no Japanese, so they say what
 * the thing is and what to do, in as few sentences as that takes.
 *
 * Every opening is recorded (#228, `seen`), so it can be measured later
 * which of these anyone ever opens — and the ones nobody opens can go.
 */
import { el } from "./dom.js";
import { seen } from "../seen.js";

/** `body` is drawn as paragraphs; a two-column list becomes label + text. */
export const INFO = {
  ways: {
    title: "Die Übungsarten",
    list: [
      ["Laut sagen", "Du siehst die Bedeutung und sagst das Wort auf Japanisch – laut. Danach drehst du die Karte um und vergleichst mit der Aufnahme. Weißt du es noch nicht, hilft „Romaji zeigen“."],
      ["Bedeutung wählen", "Du siehst das japanische Wort und wählst aus vier Bedeutungen die richtige. Die leichteste Übung, gut zum Anfangen."],
      ["Nur hören", "Du hörst einen Satz, ohne ihn zu sehen, und wählst, was er bedeutet. Übt das Verstehen im Gespräch."],
      ["Japanisch tippen", "Du siehst die Bedeutung und tippst das Wort. Romaji, Kana oder Kanji zählen alle als richtig."],
      ["Karte umdrehen", "Die klassische Karteikarte: überlegen, umdrehen, selbst bewerten."],
    ],
  },
  today: {
    title: "Karten für heute",
    body: [
      "Die Zahl sagt, wie viele Karten dieses Deck heute für dich bereithält: neue Wörter und Wiederholungen zusammen.",
      "Wie viele neue Wörter am Tag dazukommen, stellst du in diesem Deck unter „Optionen“ ein. Dort gibt es auch „Maximal pro Tag“ für alles zusammen.",
      "Die Zahl ist kein Muss. Du kannst jederzeit aufhören, der Rest kommt morgen wieder.",
    ],
  },
  bands: {
    title: "Nicht gelernte, In Bearbeitung, Gemeisterte",
    body: [
      "So verteilen sich alle Karten des Decks – dieselben drei Gruppen wie in Noji.",
      "„Nicht gelernte“ hattest du noch nie. „In Bearbeitung“ übst du gerade, sie kommen in Tagen wieder. „Gemeisterte“ sitzen: Sie kommen erst in drei Wochen oder später wieder dran.",
    ],
  },
  ratings: {
    title: "Nochmal oder Gewusst",
    body: [
      "Nach dem Umdrehen sagst du selbst, ob du es wusstest. Danach richtet sich, wann die Karte wiederkommt.",
      "„Nochmal“ heißt nicht gewusst: Die Karte kommt gleich in dieser Übung noch einmal. „Gewusst“ schiebt sie nach hinten, beim nächsten Mal noch weiter.",
      "Die Zeit unter dem Knopf sagt, wann die Karte wiederkäme, wenn du ihn jetzt tippst. Ehrlich zu bewerten bringt mehr, als sich Erfolge zu schenken.",
    ],
  },
  streak: {
    title: "Serie und Joker",
    body: [
      "Die Serie zählt die Tage hintereinander, an denen du geübt hast. Der Tag zählt, sobald du an ihm eine Karte beantwortet hast.",
      "Ein Joker rettet einen Tag, an dem nichts ging: Er wird automatisch eingesetzt, und die Serie läuft weiter. Joker verdienst du dir durch regelmäßiges Üben.",
    ],
  },
};

/**
 * A round (i) to put beside a heading. `name` is a key of INFO above.
 *
 * Deliberately a sibling of the heading, never inside a button: a button in
 * a button is neither valid nor tappable in the way either one wants.
 */
export function infoButton(name, { label } = {}) {
  const info = INFO[name];
  if (!info) throw new Error(`no info text called ${name}`);
  return el("button.info", {
    type: "button",
    text: "i",
    "aria-label": `Erklärung: ${label ?? info.title}`,
    onclick: () => openInfo(name),
  });
}

/**
 * The explanation itself: the app's ordinary sheet, so it looks and closes
 * like every other one. Appended to #app rather than to the body, because
 * `.sheet-scrim` is positioned against the app's own box.
 */
export function openInfo(name) {
  const info = INFO[name];
  if (!info || typeof document === "undefined") return;
  seen("info_opened", name);
  const host = document.getElementById("app") ?? document.body;
  const close = () => {
    scrim.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => e.key === "Escape" && close();
  const scrim = el(
    "div.sheet-scrim.info-sheet",
    { onclick: (e) => e.target === e.currentTarget && close() },
    el(
      "div.sheet",
      { role: "dialog", "aria-label": info.title },
      el("h2.sheet-title", { text: info.title }),
      ...(info.body ?? []).map((text) => el("p.sheet-body", { text })),
      info.list
        ? el(
            "dl.info-list",
            {},
            info.list.flatMap(([term, text]) => [el("dt", { text: term }), el("dd", { text })]),
          )
        : null,
      el("div.sheet-actions", {}, el("button.btn.solid", { type: "button", text: "Verstanden", onclick: close })),
    ),
  );
  document.addEventListener("keydown", onKey);
  host.append(scrim);
  return close;
}

/** A heading with its (i) beside it, the shape every caller uses. */
export function withInfo(heading, name, options) {
  return el("div.has-info", {}, heading, infoButton(name, options));
}
