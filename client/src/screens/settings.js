import { ApiError, OfflineError, api } from "../api.js";
import { cardCount } from "../store.js";
import { SHELL_VERSION } from "../shell-version.js";
import { viewportReport } from "../viewport.js";
import { el, num, render } from "../ui/dom.js";

/**
 * Which app shell this device is running, and which one it has ready.
 *
 * Not the same question as the server's version. An installed PWA is resumed
 * rather than reloaded, so a deploy can be live for days while the phone still
 * serves the old shell — and this row used to answer it with
 * `server/package.json`, which has read "1.0.0" since the first commit.
 *
 * The first attempt read the cache name alone. That was still the wrong
 * question, and it gave a wrong answer within hours: the worker calls
 * `skipWaiting()` and `clients.claim()`, so v16 installed, deleted v15's cache
 * and took control while the open page went on running the v15 modules it had
 * already loaded. Settings said "App v16" and the diagnostics were missing a
 * field only v16 has. A row that says a fix has arrived when it has not is
 * worse than no row.
 *
 * So: `SHELL_VERSION` is what is *running* — a constant compiled into this
 * code, which is the only thing that travels with it — and the cache name is
 * what is *ready*. They agree almost always, and when they do not, saying so
 * is the entire value of the row: quit the app and reopen it.
 */
async function shellVersion() {
  if (typeof caches === "undefined") return SHELL_VERSION;
  try {
    const ready = (await caches.keys())
      .filter((name) => name.startsWith("kotoba-shell-"))
      .map((name) => name.replace("kotoba-shell-", ""));
    if (ready.length === 0) return `${SHELL_VERSION} · not installed`;
    if (ready.length === 1 && ready[0] === SHELL_VERSION) return SHELL_VERSION;
    return `${SHELL_VERSION} running · ${ready.sort().join(" ")} ready — quit and reopen`;
  } catch {
    return SHELL_VERSION;
  }
}

/** How many audio files the service worker is holding (§7). */
async function countCachedAudio() {
  if (typeof caches === "undefined") return undefined;
  try {
    if (!(await caches.has("kotoba-media"))) return 0;
    const cache = await caches.open("kotoba-media");
    return (await cache.keys()).length;
  } catch {
    return undefined;
  }
}

/**
 * Design 22 (iPhone) and 26 (iPad). Four groups, no search, no nesting, and no
 * Save button — every control writes as it is touched.
 *
 * That last part is the whole shape of this screen. A control writes
 * optimistically, redraws from what the server sends back, and puts itself
 * back the way it was if the write failed. So the screen can never show a
 * value the server does not hold, which matters here more than elsewhere: the
 * new-card limit is read by the queue on the *server*, so a setting that
 * looked saved and was not would change how many cards arrive tomorrow.
 */

/**
 * The stepper moves in fives. The range is 5–40 (§12, and the floor is the
 * product owner's ruling — see docs/phase-0-plan.md §3.1 E), and a step of one
 * would be thirty-five taps to cross it on a phone.
 */
const NEW_PER_DAY_STEP = 5;
const NEW_PER_DAY_MIN = 5;
const NEW_PER_DAY_MAX = 40;

/** 60 is MAX_SESSION_LENGTH on the server; the screen calls it "All". */
const SESSION_LENGTHS = [
  { value: 10, label: "10" },
  { value: 20, label: "20" },
  { value: 60, label: "All" },
];

export function settingsScreen({ user, onSignOut, onSettings, onBrowse }) {
  const root = el("div.settings");
  render(root, el("div.loading", { text: "…" }));

  let data;

  load();

  async function load() {
    try {
      data = await api.settings();
    } catch (err) {
      render(root, header(), problem(err));
      return;
    }
    draw();

    // The device's own figures come from the browser, not the server, so they
    // arrive after the screen rather than holding it up.
    const [cachedCards, cachedAudio, shell] = await Promise.all([
      cardCount(),
      countCachedAudio(),
      shellVersion(),
    ]);
    data = { ...data, cachedCards, cachedAudio, shell };
    draw();
  }

  function draw() {
    render(
      root,
      header(),
      dailyLoad(),
      deckGroup(),
      sound(),
      account(),
      diagnostics(),
    );
  }

  function header() {
    return el("div.settings-head", { text: "Settings" });
  }

  function problem(err) {
    return el("p.settings-problem", {
      text:
        err instanceof OfflineError
          ? "Settings need a connection. Practice does not."
          : "Could not load settings.",
    });
  }

  /**
   * Write one field. Redraws from the server's answer, and on failure puts the
   * screen back rather than leaving a control showing something untrue.
   */
  async function write(patch) {
    const previous = data.settings;
    data = { ...data, settings: { ...previous, ...patch } };
    draw();

    try {
      const res = await api.updateSettings(patch);
      data = { ...data, settings: res.settings };
      onSettings?.(res.settings);
    } catch (err) {
      data = { ...data, settings: previous };
      draw();
      root.append(
        el("p.settings-problem", {
          text:
            err instanceof OfflineError
              ? "Offline — that one did not save."
              : "That did not save.",
        }),
      );
      return;
    }
    draw();
  }

  // ── Daily load ──────────────────────────────────────────────────

  function dailyLoad() {
    const { newPerDay, sessionLength } = data.settings;

    return group(
      "Daily load",
      row(
        "New cards per day",
        "Reviews are scheduled on top of this.",
        el(
          "div.stepper",
          {},
          stepButton("−", "Fewer new cards", newPerDay - NEW_PER_DAY_STEP),
          el("span.value.tabular", { text: String(newPerDay) }),
          stepButton("+", "More new cards", newPerDay + NEW_PER_DAY_STEP),
        ),
      ),
      el(
        "div.field",
        {},
        el("span.field-label", { text: "Session length" }),
        el(
          "div.choice",
          {},
          SESSION_LENGTHS.map(({ value, label }) =>
            el("button", {
              type: "button",
              text: label,
              "aria-pressed": String(value === sessionLength),
              onclick: () => value !== sessionLength && write({ sessionLength: value }),
            }),
          ),
        ),
      ),
    );
  }

  function stepButton(glyph, label, target) {
    const clamped = Math.min(Math.max(target, NEW_PER_DAY_MIN), NEW_PER_DAY_MAX);
    const disabled = clamped === data.settings.newPerDay;
    return el("button.step", {
      type: "button",
      text: glyph,
      "aria-label": label,
      disabled,
      onclick: () => write({ newPerDay: clamped }),
    });
  }

  // ── Deck ────────────────────────────────────────────────────────

  /**
   * Names and counts, no toggles — decided, not deferred (#20).
   *
   * Design 22 draws a switch beside each deck. The original reason for leaving
   * it out was that there was only one deck, so the switch could only turn the
   * app off. That reason is gone: her own deck exists. The row stays out
   * anyway, for a better one.
   *
   * "Which decks does this session use" is already a question the choose-set
   * sheet answers — Both / Kaishi / Mine, per session, right where she starts
   * one. A standing switch here would be a second way to ask the same thing,
   * and the two would disagree the first time she used both.
   *
   * It is also the more dangerous of the two. A per-session filter is visible
   * in the summary line above the four lines; a setting turned off weeks ago
   * is not. She would add a word, never be shown it, and have nothing on the
   * screen to explain why.
   *
   * The row for the personal deck stays at zero cards, exactly as the design
   * intends — so the second import has somewhere to land.
   */
  function deckGroup() {
    return group(
      "Deck",
      ...data.decks.map((deck) => {
        const detail =
          deck.cards === 0 ? "0 cards, nothing imported yet" : `${num(deck.cards)} cards`;
        // 31: browse is reached from Stats → Cards seen and from here. A deck
        // with nothing in it has nothing to browse.
        if (!onBrowse || deck.cards === 0) return row(deck.label, detail);
        return el(
          "button.row.tappable",
          { type: "button", onclick: onBrowse },
          el(
            "span.row-copy",
            {},
            el("span.row-title", { text: deck.label }),
            el("span.row-detail", { text: detail }),
          ),
          el("span.row-chevron", { text: "›" }),
        );
      }),
    );
  }

  // ── Sound ───────────────────────────────────────────────────────

  /**
   * "Read cards aloud" governs the automatic reading when a card appears. The
   * ♪ button keeps working either way: tapping it is an explicit request, and
   * a setting about what happens on its own should not disable a control the
   * user just pressed.
   *
   * Pitch accent used to be missing from this group. The deck carries it on
   * 1,500 of its 1,501 notes, but as a drawing, and nothing mapped it — so the
   * switch would have written a value nothing read. The import now reduces
   * that drawing to the mora the pitch drops after (#21) and the reveal draws
   * the contour, so the switch has something to govern.
   */
  function sound() {
    return group(
      "Sound",
      row(
        "Read cards aloud",
        "Recorded audio where the deck has it, speech otherwise.",
        toggle(data.settings.readAloud, "Read cards aloud", (on) =>
          write({ readAloud: on }),
        ),
      ),
      row(
        "Show pitch accent",
        // Says what it is for rather than what it is: 花 and 鼻 are both はな
        // and both low-high, and the only thing telling them apart is what the
        // particle after them does.
        "A line over the high part when a card is revealed. 花 and 鼻 are both はな, and sound different.",
        toggle(data.settings.pitchAccent, "Show pitch accent", (on) =>
          write({ pitchAccent: on }),
        ),
      ),
    );
  }

  // ── Account ─────────────────────────────────────────────────────

  function account() {
    return group(
      "Account",
      el(
        "div.row",
        {},
        el("span.row-title", { text: user?.handle ?? "" }),
        el("span.row-aside", { text: "signed in" }),
      ),
      el("button.signout", { type: "button", text: "Sign out", onclick: signOut }),
      el("p.settings-note", {
        text: "Signing out clears this device. Progress lives on the server.",
      }),
    );
  }

  async function signOut() {
    try {
      await api.logout();
    } catch (err) {
      // A 401 means the cookie was already gone, which is the state we wanted.
      if (!(err instanceof ApiError && err.status === 401)) {
        root.append(el("p.settings-problem", { text: "Could not sign out." }));
        return;
      }
    }
    onSignOut?.();
  }

  // ── Diagnostics ─────────────────────────────────────────────────

  /**
   * Not settings — the only place the sync state is quantified, as the design
   * note says. "Synced" reports the newest review the *server* holds rather
   * than a clock on this device, because that is the thing the other device
   * will read.
   */
  function diagnostics() {
    const { sync, version } = data;
    return el(
      "div.diagnostics",
      {},
      diagnostic(
        "Synced",
        sync.lastEventAt ? `${when(sync.lastEventAt)} · ${num(sync.events)} reviews` : "nothing yet",
      ),
      diagnostic("Cards on device", `${num(data.cachedCards ?? 0)} of ${num(deckTotal())}`),
      diagnostic("Audio cached", audioLine()),
      // Two versions, because they answer different questions and they are
      // routinely out of step: "App" is the shell this phone is running and
      // changes only after the app is quit and reopened; "Server" is what the
      // box is serving.
      diagnostic("App", data.shell ?? SHELL_VERSION),
      diagnostic("Server", version),
      // The tab bar sometimes stops short of the bottom edge on her phone and
      // only a force quit clears it. It cannot be reproduced here — desktop
      // WebKit reports the full height for every viewport unit — so these three
      // rows are how the device reports its own numbers while it is wrong.
      // See `src/viewport.js`; remove them once that question is settled.
      ...viewportReport().map(([label, value]) => diagnostic(label, value)),
    );
  }

  const deckTotal = () => data.decks.reduce((n, d) => n + d.cards, 0);

  /**
   * How much audio is on the device. §7 caps the cache at ~300 files and
   * never bulk-fetches, so this number climbing slowly is the system working
   * — it is not a download that stalled.
   */
  function audioLine() {
    if (data.cachedAudio === undefined) return "not counted";
    if (data.cachedAudio === 0) return "nothing yet";
    return `${num(data.cachedAudio)} ${data.cachedAudio === 1 ? "file" : "files"}`;
  }

  function diagnostic(label, value) {
    return el(
      "div.diagnostic",
      {},
      el("span", { text: label }),
      el("span", { text: value }),
    );
  }

  return root;
}

// ── Shared bits ───────────────────────────────────────────────────

function group(label, ...children) {
  return el(
    "section.group",
    {},
    el("span.group-label", { text: label }),
    ...children,
  );
}

function row(title, detail, control) {
  return el(
    "div.row",
    {},
    el(
      "span.row-copy",
      {},
      el("span.row-title", { text: title }),
      detail ? el("span.row-detail", { text: detail }) : null,
    ),
    control ?? null,
  );
}

function toggle(on, label, onChange) {
  return el("button.toggle", {
    type: "button",
    role: "switch",
    "aria-checked": String(on),
    "aria-label": label,
    onclick: () => onChange(!on),
  }, el("span.knob"));
}

/** A time the way the diagnostics block shows one: today as a clock, else a date. */
export function when(unixSeconds, now = new Date()) {
  const d = new Date(unixSeconds * 1000);
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay
    ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}
