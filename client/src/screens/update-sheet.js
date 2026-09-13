import { el, render } from "../ui/dom.js";

/**
 * "A new version is ready" and "Updated" (#93).
 *
 * Not in design/: the 52 screens predate this, and none of them asks a
 * question about the app itself. So it is built from the one sheet the app
 * already uses for a two-way decision (50, leaving a session; 30, deleting a
 * word) rather than from a new idea, and shown only where those rules allow —
 * over the tab screens, never over a card, a summary or a form (`app.js`).
 *
 * Two kinds, one shape:
 *
 *   ready    a newer shell is downloaded and waiting — Later / Update
 *   updated  the shell changed without being asked (the app was closed while
 *            one waited) — the notes she has not seen yet, and OK
 *
 * `entries` is newest first and may be empty, when the notes could not be
 * read; then there is simply no "More info".
 */
export function updateSheet({ kind, entries, onUpdate, onLater, onDone }) {
  let open = false;
  let busy = false;
  const newest = entries[0];
  const dismiss = kind === "ready" ? onLater : onDone;

  const root = el("div.sheet-scrim.update-scrim", {
    onclick: (e) => e.target === e.currentTarget && !busy && dismiss(),
  });

  function draw() {
    const summary =
      newest?.summary ?? (kind === "ready" ? "Small fixes and improvements." : undefined);
    render(
      root,
      el(
        "div.sheet.update-sheet",
        { role: "dialog", "aria-modal": "true", "aria-labelledby": "update-title" },
        el("h2.sheet-title", {
          id: "update-title",
          text: kind === "ready" ? "A new version is ready" : "Updated",
        }),
        summary ? el("p.sheet-body", { text: summary }) : null,
        entries.length > 0
          ? el("button.update-more", {
              type: "button",
              "aria-expanded": open ? "true" : "false",
              text: open ? "Less" : "More info",
              onclick: () => {
                open = !open;
                draw();
              },
            })
          : null,
        open ? notes(entries) : null,
        kind === "ready"
          ? el(
              "div.sheet-actions",
              {},
              el("button.btn", { type: "button", text: "Later", disabled: busy, onclick: onLater }),
              // Update is the solid one: it is the answer the question expects,
              // and unlike leaving a session nothing is lost by tapping it.
              el("button.btn.solid", {
                type: "button",
                text: busy ? "Updating…" : "Update",
                disabled: busy,
                onclick: () => {
                  busy = true;
                  draw();
                  onUpdate();
                },
              }),
            )
          : el(
              "div.sheet-actions",
              {},
              el("button.btn.solid", { type: "button", text: "OK", onclick: onDone }),
            ),
      ),
    );
  }

  draw();
  return root;
}

/**
 * Every version she has not seen, each under its own number. The number is
 * the one Settings shows, so the two can be matched up when something is
 * reported as not having arrived.
 */
function notes(entries) {
  return el(
    "div.update-notes",
    {},
    entries.map((entry) =>
      el(
        "section.update-version",
        {},
        el("span.mono-label", { text: entry.version }),
        el(
          "ul",
          {},
          (entry.notes ?? []).map((line) => el("li", { text: line })),
        ),
      ),
    ),
  );
}
