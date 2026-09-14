import { ApiError, OfflineError, api } from "../api.js";
import { cardCount } from "../store.js";
import { SHELL_VERSION } from "../shell-version.js";
import { viewportReport } from "../viewport.js";
import { versionNumber } from "../whats-new.js";
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
 * is the entire value of the row.
 *
 * Since #93 a new version waits for her instead of taking over, so "ready"
 * now means "the prompt is due" rather than "quit and reopen" — and the
 * prompt is drawn over this tab too.
 */
async function shellVersion() {
  if (typeof caches === "undefined") return SHELL_VERSION;
  try {
    const ready = (await caches.keys())
      .filter((name) => name.startsWith("kotoba-shell-"))
      .map((name) => name.replace("kotoba-shell-", ""));
    if (ready.length === 0) return `${SHELL_VERSION} · not installed`;
    if (ready.length === 1 && ready[0] === SHELL_VERSION) return SHELL_VERSION;
    // Only the newest. A version that waited and was overtaken by a later one
    // leaves its cache behind until the next takeover clears it, and listing
    // it would name a version that can no longer be installed. Compared as
    // numbers: as strings, "v100" sorts before "v99".
    const newest = ready.reduce((a, b) => (versionNumber(b) > versionNumber(a) ? b : a));
    if (newest === SHELL_VERSION) return SHELL_VERSION;
    return `${SHELL_VERSION} running · ${newest} ready to update`;
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


/** What 話す ("Say it aloud") can draw its prompt from (#77). */
const SPEAK_SOURCES = [
  { value: "word", label: "Word" },
  { value: "sentence", label: "Sentence" },
  { value: "random", label: "Random" },
];

export function settingsScreen({ user, onSignOut, onSettings }) {
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
      // #123: only what configures the app. The Deck group (names and counts,
      // each leading to Browse) and session length went to the Words and
      // Practise tabs, where she is when she needs them.
      sound(),
      script(),
      practice(),
      account(),
      diagnostics(),
    );
  }

  function header() {
    return el("div.settings-head", { text: "Settings" });
  }

  /**
   * The screen failed to load — same treatment as Stats and Browse: told
   * apart in what it says, not in how alarming it looks. `.settings-problem`'s
   * red stays for a control she just touched and that did not take (`write`,
   * `signOut`); a screen that has not loaded yet is not a mistake she made.
   */
  function problem(err) {
    return el("p.settings-offline", {
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

  // New cards per day and the ways of practising belong to a deck since
  // #137: the deck page's Options. What is left here is about her.

  // ── Sound ───────────────────────────────────────────────────────

  /**
   * "Read cards aloud" governs the automatic reading when a card appears. The
   * ♪ button keeps working either way: tapping it is an explicit request, and
   * a setting about what happens on its own should not disable a control the
   * user just pressed.
   *
   * Pitch accent and romaji lived in this group until #135 and are under
   * Japanese now (`script()`), with the switch that decides whether there is
   * any script for them to annotate.
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
    );
  }

  // ── Script ──────────────────────────────────────────────────────

  /**
   * #135: the Japanese script switch, and under it the two settings that
   * annotate the script. They sat under Sound before; they are about what a
   * card shows. With the script off they have nothing to annotate — the word
   * is already romaji and there is no kana line to draw a contour over — so
   * they are not offered rather than offered and ignored.
   */
  function script() {
    const { japaneseScript } = data.settings;
    return group(
      "Japanese",
      row(
        "Japanese script",
        japaneseScript
          ? "Words and buttons in Japanese characters."
          : "Off: words in romaji, example sentences as sound only, buttons in English.",
        toggle(japaneseScript, "Japanese script", (on) => write({ japaneseScript: on })),
      ),
      japaneseScript
        ? row(
            "Show pitch accent",
            // Says what it is for rather than what it is: 花 and 鼻 are both
            // はな and both low-high, and the only thing telling them apart is
            // what the particle after them does.
            "A line over the high part when a card is revealed. 花 and 鼻 are both はな, and sound different.",
            toggle(data.settings.pitchAccent, "Show pitch accent", (on) =>
              write({ pitchAccent: on }),
            ),
          )
        : null,
      japaneseScript
        ? row(
            "Show romaji",
            "The word written in latin letters under the kana, for reading it back without a dictionary.",
            toggle(data.settings.romaji, "Show romaji", (on) => write({ romaji: on })),
          )
        : null,
    );
  }

  // ── Practice ────────────────────────────────────────────────────

  /**
   * What 話す ("Say it aloud") asks her to produce (#77).
   *
   * "Sentence" is what the mode always did — Henning found the word-only path
   * effectively dead, since almost every card carries a sentence and the mode
   * preferred it whenever one existed. This makes the choice a setting instead
   * of an accident of the deck's content, without changing anyone's practice
   * until they touch it: the default stays "Sentence".
   */
  function practice() {
    const { speakSource } = data.settings;
    return group(
      "Practice",
      el(
        "div.field",
        {},
        el("span.field-label", { text: "Say it aloud asks about" }),
        el(
          "div.choice",
          {},
          SPEAK_SOURCES.map(({ value, label }) =>
            el("button", {
              type: "button",
              text: label,
              "aria-pressed": String(value === speakSource),
              onclick: () => value !== speakSource && write({ speakSource: value }),
            }),
          ),
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

function toggle(on, label, onChange, { disabled = false } = {}) {
  return el("button.toggle", {
    type: "button",
    role: "switch",
    "aria-checked": String(on),
    "aria-label": label,
    disabled,
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
