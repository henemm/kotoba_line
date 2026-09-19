import { ApiError, OfflineError, api } from "../api.js";
import { cardCount } from "../store.js";
import { SHELL_VERSION } from "../shell-version.js";
import { viewportReport } from "../viewport.js";
import { sheetSummary, versionNumber } from "../whats-new.js";
import { el, num, render } from "../ui/dom.js";
import { canRecord, micErrorMessage, startRecording, stopAllRecording } from "../recording.js";
import { disablePush, enablePush, pushState } from "../push.js";
import { seen } from "../seen.js";

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
    if (ready.length === 0) return `${SHELL_VERSION} · nicht installiert`;
    if (ready.length === 1 && ready[0] === SHELL_VERSION) return SHELL_VERSION;
    // Only the newest. A version that waited and was overtaken by a later one
    // leaves its cache behind until the next takeover clears it, and listing
    // it would name a version that can no longer be installed. Compared as
    // numbers: as strings, "v100" sorts before "v99".
    const newest = ready.reduce((a, b) => (versionNumber(b) > versionNumber(a) ? b : a));
    if (newest === SHELL_VERSION) return SHELL_VERSION;
    return `${SHELL_VERSION} läuft · ${newest} bereit zum Aktualisieren`;
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
    // The files under sw.js's cap of 300 only: the kana decks' stroke-order
    // drawings (#158) and the kana's own sounds (v84) live here too, uncapped.
    return (await cache.keys()).filter((key) => !/\/media\/(kanjivg|kana)-/.test(new URL(key.url).pathname)).length;
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
  { value: "word", label: "Wort" },
  { value: "sentence", label: "Satz" },
  { value: "random", label: "Zufällig" },
];

/** The three appearances (#137, v65): the same list as the server's CHECK. */
const APPEARANCES = [
  { value: "light", label: "Hell" },
  { value: "dark", label: "Dunkel" },
  // "Automatisch", as iOS itself names it in German; "Wie iPhone" broke over two lines.
  { value: "system", label: "Automatisch" },
];

export function settingsScreen({ user, update, onSignOut, onSettings }) {
  const root = el("div.settings");
  render(root, el("div.loading", { text: "…" }));

  let data;
  let updating = false;

  load();

  async function load() {
    try {
      data = await api.settings();
    } catch (err) {
      // The new version is already on the phone, so offline is no reason to
      // hide it.
      render(root, header(), waitingUpdate(), problem(err));
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
    // Any write() redraws this whole screen, which throws away
    // diagnostics()'s microphoneTest() closure — and the MediaRecorder it
    // might be holding mid-recording, with nothing else left to release it
    // (found in code review, 2026-09-17: flipping any other switch while
    // "2 Sek. testen" was running leaked that stream for good).
    stopAllRecording();
    render(
      root,
      header(),
      waitingUpdate(),
      // #123: only what configures the app. The Deck group (names and counts,
      // each leading to Browse) and session length went to the Words and
      // Practise tabs, where she is when she needs them.
      appearance(),
      sound(),
      script(),
      practice(),
      notifications(),
      account(),
      sources(),
      diagnostics(),
    );
  }

  function header() {
    return el("div.settings-head", { text: "Einstellungen" });
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
          ? "Für die Einstellungen brauchst du Internet. Zum Üben nicht."
          : "Die Einstellungen konnten nicht geladen werden.",
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
              ? "Offline – das wurde nicht gespeichert."
              : "Das wurde nicht gespeichert.",
        }),
      );
      return;
    }
    draw();
  }

  // ── Update ──────────────────────────────────────────────────────

  /**
   * #103 (Henning): the update in Settings, and only when there is one. The
   * sheet asks once per version (#93), and after Später it used to be gone
   * until the app was next started. First on the screen, because it is the
   * one thing here that is news; the diagnostics row further down still says
   * the same in numbers.
   */
  function waitingUpdate() {
    if (!update) return null;
    const { text } = sheetSummary(update.entries);
    return group(
      "App",
      row(
        `Neue Version ${update.version}`,
        text ?? "Kleine Fehlerbehebungen und Verbesserungen.",
      ),
      el("button.update-now", {
        type: "button",
        text: updating ? "Wird aktualisiert …" : "Aktualisieren",
        disabled: updating,
        onclick: () => {
          updating = true;
          data ? draw() : render(root, header(), waitingUpdate());
          update.onUpdate();
        },
      }),
    );
  }

  // New cards per day and the ways of practising belong to a deck since
  // #137: the deck page's Options. What is left here is about her.

  // ── Appearance ──────────────────────────────────────────────────

  /**
   * Light, dark, or whatever the iPhone is set to (#137, v65). Light is the
   * default (Henning, 2026-09-14). The page changes at once; the iPhone's
   * status bar follows at the next start of the app, because iOS reads its
   * colour from the page only as the app launches (index.html).
   */
  function appearance() {
    const current = data.settings.appearance ?? "light";
    return group(
      "Darstellung",
      el(
        "div.field",
        {},
        el(
          "div.choice",
          {},
          APPEARANCES.map(({ value, label }) =>
            el("button", {
              type: "button",
              text: label,
              "aria-pressed": String(value === current),
              onclick: () => value !== current && write({ appearance: value }),
            }),
          ),
        ),
      ),
    );
  }

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
      "Ton",
      row(
        "Karten vorlesen",
        "Aufnahmen, wo das Deck welche hat, sonst Sprachausgabe.",
        toggle(data.settings.readAloud, "Karten vorlesen", (on) =>
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
      "Japanisch",
      row(
        "Japanische Schrift",
        japaneseScript
          ? "Wörter und Knöpfe in japanischen Schriftzeichen."
          : "Aus: Wörter in Romaji, Beispielsätze nur zum Hören, Knöpfe auf Deutsch.",
        toggle(japaneseScript, "Japanische Schrift", (on) => write({ japaneseScript: on })),
      ),
      japaneseScript
        ? row(
            "Tonhöhenakzent zeigen",
            // Says what it is for rather than what it is: 花 and 鼻 are both
            // はな and both low-high, and the only thing telling them apart is
            // what the particle after them does.
            "Eine Linie über dem hohen Teil, wenn die Karte aufgedeckt ist. 花 und 鼻 sind beide はな und klingen verschieden.",
            toggle(data.settings.pitchAccent, "Tonhöhenakzent zeigen", (on) =>
              write({ pitchAccent: on }),
            ),
          )
        : null,
      japaneseScript
        ? row(
            "Romaji zeigen",
            "Das Wort in lateinischen Buchstaben unter den Kana, damit du es ohne Wörterbuch lesen kannst.",
            toggle(data.settings.romaji, "Romaji zeigen", (on) => write({ romaji: on })),
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
    const { speakSource, recordingEnabled, beginner } = data.settings;
    return group(
      "Üben",
      // #252 (Henning, 2026-09-19): a way in for someone starting from
      // nothing — travel phrases, said aloud, one round unlocking the next.
      row(
        "Einstieg",
        beginner
          ? "An: Du siehst nur Reise 1 und Reise 2. Ausschalten zeigt wieder alle Decks – es geht nichts verloren."
          : "Nur die Reise-Sätze zum Laut-Sagen, mit Romaji zum Spicken. Reise 2 wird frei, wenn du jede Karte aus Reise 1 einmal gewusst hast.",
        toggle(beginner, "Einstieg", (on) => {
          seen(on ? "beginner_on" : "beginner_off");
          write({ beginner: on });
        }),
      ),
      el(
        "div.field",
        {},
        el("span.field-label", { text: "Laut sagen fragt nach" }),
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
      row(
        "Aufnahme-Funktion",
        "Deine Antwort aufnehmen und direkt mit der Aussprache der Karte vergleichen – und Muttersprachler-Aufnahmen hinzufügen. Deine eigenen Aufnahmen werden nicht gespeichert.",
        toggle(recordingEnabled, "Aufnahme-Funktion", (on) => write({ recordingEnabled: on })),
      ),
    );
  }

  // ── Notifications (#248) ───────────────────────────────────────

  /**
   * "Deine nächsten Karten sind bereit". What the row can say depends on the
   * device, which only the browser knows — so it is drawn first and filled
   * in when `pushState()` answers.
   */
  function notifications() {
    const slot = el("div.push-row");
    const draw = (state, busy = false) => {
      const detail = PUSH_DETAIL[state] ?? PUSH_DETAIL.off;
      const canToggle = ["on", "off", "ask", "declined"].includes(state);
      render(
        slot,
        row(
          "Wenn Karten bereit sind",
          detail,
          canToggle
            ? toggle(state === "on", "Benachrichtigungen", async (on) => {
                draw(state, true);
                let next;
                try {
                  next = on ? await enablePush() : await disablePush();
                } catch {
                  next = state;
                }
                if (on && next === "on") seen("push_granted", "settings");
                if (on && next === "denied") seen("push_denied", "settings");
                draw(next === "ask" ? "ask" : next);
              }, { disabled: busy })
            : null,
        ),
      );
    };
    draw("off", true);
    pushState().then((state) => draw(state), () => draw("unsupported"));
    return group("Benachrichtigungen", slot);
  }

  // ── Account ─────────────────────────────────────────────────────

  function account() {
    return group(
      "Konto",
      el(
        "div.row",
        {},
        el("span.row-title", { text: user?.handle ?? "" }),
        el("span.row-aside", { text: "angemeldet" }),
      ),
      el("button.signout", { type: "button", text: "Abmelden", onclick: signOut }),
      el("p.settings-note", {
        text: "Beim Abmelden wird dieses Gerät geleert. Dein Fortschritt bleibt auf dem Server.",
      }),
    );
  }

  async function signOut() {
    try {
      await api.logout();
    } catch (err) {
      // A 401 means the cookie was already gone, which is the state we wanted.
      if (!(err instanceof ApiError && err.status === 401)) {
        root.append(el("p.settings-problem", { text: "Abmelden hat nicht geklappt." }));
        return;
      }
    }
    onSignOut?.();
  }

  // ── Sources ─────────────────────────────────────────────────────

  /**
   * Where the words, drawings and example words come from (#158, v78). The
   * licences ask for it: JMdict wants the acknowledgement on a screen of its
   * own in an app, KanjiVG and the JLPT lists want the attribution. Plain
   * text, because a link out of the installed app is a dead end offline.
   */
  function sources() {
    return group(
      "Quellen",
      ...[
        ["Kaishi 1.5k", "Wörter, Beispielsätze und Aufnahmen – github.com/donkuri/Kaishi"],
        ["KanjiVG", "Strichfolge der Kana – kanjivg.tagaini.net, CC BY-SA 3.0"],
        // v84: public domain asks for nothing; the line is there so she knows
        // whose voice it is.
        ["Wikimedia Commons", "Aussprache der einzelnen Kana – Aufnahmen von Hakatanoshio117117, gemeinfrei"],
        // v87: CC BY-SA asks for the attribution, and the speakers are named
        // because it is their voice she hears.
        ["Lingua Libre", "Aussprache von Beispielwörtern der Kana – Aufnahmen von 葵心 und Higa4, Wikimedia Commons, CC BY-SA 4.0"],
        [
          "Tofugu und WaniKani",
          "Aussprache von Beispielwörtern der Kana – github.com/tofugu/japanese-vocabulary-pronunciation-audio, CC BY-SA 4.0",
        ],
        ["Merkbilder", "Zeichnungen zu den Kana – B. Domangue, Wikimedia Commons, CC BY-SA 4.0"],
        // #183, v92/v93: the 33 yōon and 92 example words have no free human
        // recording anywhere, so these are generated – VOICEVOX's own terms
        // require this credit line.
        [
          "VOICEVOX:No.7",
          "Aussprache der Kana mit ゃゅょ (きゃ …), einiger Beispielwörter und aller Wörter ohne Aufnahme – generierte Sprachausgabe, voicevox.hiroshiba.jp",
        ],
        // #183, v118: both only steer the generated audio (which spelling the
        // engine reads, whether its accent is confirmed) — neither's text is
        // shown, but both ask for the credit.
        ["Wadoku", "Schreibweise für die generierte Aussprache deiner Wörter – wadoku.de"],
        ["Kanjium", "Betonung zur Prüfung der generierten Aussprache – github.com/mifunetoshiro/kanjium, CC BY-SA 4.0"],
        ["JLPT-Wortlisten", "Beispielwörter der Kana – Jonathan Waller, tanos.co.uk, CC BY"],
        [
          "JMdict",
          "Bedeutungen dieser Beispielwörter – Electronic Dictionary Research and Development Group, edrdg.org, CC BY-SA 4.0",
        ],
      ].map(([title, detail]) => row(title, detail)),
    );
  }

  // ── Diagnostics ─────────────────────────────────────────────────

  /**
   * Not settings — the only place the sync state is quantified, as the design
   * note says. "Synced" reports the newest review the *server* holds rather
   * than a clock on this device, because that is the thing the other device
   * will read.
   */
  function diagnostics() {
    const { sync } = data;
    return el(
      "div.diagnostics",
      {},
      diagnostic(
        "Synchronisiert",
        sync.lastEventAt ? `${when(sync.lastEventAt)} · ${num(sync.events)} Wiederholungen` : "noch nichts",
      ),
      diagnostic("Karten auf dem Gerät", `${num(data.cachedCards ?? 0)} von ${num(deckTotal())}`),
      diagnostic("Gespeicherte Audios", audioLine()),
      // Two versions, because they answer different questions and they are
      // routinely out of step: "App" is the shell this phone is running and
      // changes only after the app is quit and reopened; "Server" is when the
      // box was last deployed, and from which commit — not package.json's
      // "1.0.0", which never moved (Henning, 2026-09-17).
      diagnostic("App", data.shell ?? SHELL_VERSION),
      diagnostic("Server", serverBuildLine(data.build)),
      // The tab bar sometimes stops short of the bottom edge on her phone and
      // only a force quit clears it. It cannot be reproduced here — desktop
      // WebKit reports the full height for every viewport unit — so these three
      // rows are how the device reports its own numbers while it is wrong.
      // See `src/viewport.js`; remove them once that question is settled.
      ...viewportReport().map(([label, value]) => diagnostic(label, value)),
      // Which Japanese voice the phone actually offers a web app (#182).
      // Henning asked whether the built-in voice is really as poor as we treat
      // it; Safari hands out a different, smaller set of voices than the
      // system has, so the only honest answer comes from her own device.
      diagnostic("Japanische Stimmen", japaneseVoices()),
      microphoneTest(),
    );
  }

  /**
   * A record-and-play-back-locally check (#183 follow-up) — nothing here is
   * uploaded, it never leaves the device. Exists because there is nowhere
   * else in the *installed* app to try `MediaRecorder`: a related API
   * (`webkitSpeechRecognition` in 話す) crashed the installed app on her
   * iPad and was removed outright (#155), so this has to be checked in the
   * standalone context before the recording feature is wired into a session
   * screen — and a plain test page cannot be opened from inside a standalone
   * app, which has no address bar.
   */
  function microphoneTest() {
    const box = el("div.mic-test");
    let controller = null;
    let audioUrl = null;
    // Same guard as ui/voice-circle.js's onStart: without it a second tap in
    // the gap before `startRecording()` resolves opens a stream nothing here
    // keeps a reference to, and it never gets stopped (#185).
    let starting = false;

    const draw = (status) => {
      render(
        box,
        diagnostic("Mikrofon", status),
        el(
          "div.mic-test-row",
          {},
          el("button.btn.small", {
            type: "button",
            text: controller ? "Stopp" : starting ? "Verbindet …" : "2 Sek. testen",
            disabled: starting,
            onclick: onTap,
          }),
          audioUrl ? el("audio", { controls: true, src: audioUrl }) : null,
        ),
      );
    };

    async function onTap() {
      if (controller) {
        const blob = await controller.stop();
        controller = null;
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        audioUrl = URL.createObjectURL(blob);
        draw(`aufgenommen, ${Math.round(blob.size / 1024)} KB – zum Prüfen abspielen`);
        return;
      }
      if (starting) return;
      if (!canRecord()) {
        draw("von diesem Browser nicht unterstützt");
        return;
      }
      starting = true;
      draw(null);
      try {
        controller = await startRecording();
        starting = false;
        draw("Aufnahme läuft – nochmal tippen zum Stoppen");
      } catch (err) {
        starting = false;
        draw(micErrorMessage(err));
      }
    }

    draw(canRecord() ? "bereit" : "von diesem Browser nicht unterstützt");
    return box;
  }

  /** The ja voices `speechSynthesis` offers here, by name — "keine" where there are none. */
  function japaneseVoices() {
    if (typeof speechSynthesis === "undefined") return "nicht verfügbar";
    const ja = speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith("ja"));
    if (ja.length === 0) return "keine";
    return ja.map((v) => `${v.name}${v.localService ? "" : " (online)"}`).join(", ");
  }

  const deckTotal = () => data.decks.reduce((n, d) => n + d.cards, 0);

  /**
   * How much audio is on the device. §7 caps the cache at ~300 files and
   * never bulk-fetches, so this number climbing slowly is the system working
   * — it is not a download that stalled.
   */
  function audioLine() {
    if (data.cachedAudio === undefined) return "nicht gezählt";
    if (data.cachedAudio === 0) return "noch nichts";
    return `${num(data.cachedAudio)} ${data.cachedAudio === 1 ? "Datei" : "Dateien"}`;
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

/** #248: the notification row's sentence, per `pushState()`. */
export const PUSH_DETAIL = {
  on: "Die App meldet sich, wenn deine nächsten Karten nach einer Übung bereit sind. Nicht zwischen 21:30 und 7:00.",
  off: "Eine Nachricht, wenn deine nächsten Karten nach einer Übung bereit sind – so wie bei Noji.",
  ask: "Eine Nachricht, wenn deine nächsten Karten nach einer Übung bereit sind – so wie bei Noji.",
  declined: "Eine Nachricht, wenn deine nächsten Karten nach einer Übung bereit sind – so wie bei Noji.",
  denied: "Ausgeschaltet in den iPhone-Einstellungen. Dort unter Mitteilungen → ことばライン kannst du sie erlauben.",
  install: "Geht nur in der App auf dem Home-Bildschirm: In Safari auf Teilen → „Zum Home-Bildschirm“ tippen und die App von dort öffnen.",
  unsupported: "Dieser Browser kann keine Benachrichtigungen empfangen.",
};

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
/** "17.09.2026, 11:52 · d1772f7" — the "Server" diagnostic, from `/api/settings`'s `build`. */
export function serverBuildLine(build) {
  const parts = [];
  if (build?.builtAt) {
    const d = new Date(build.builtAt * 1000);
    parts.push(
      `${d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}, ${d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`,
    );
  }
  if (build?.commit) parts.push(build.commit);
  return parts.length ? parts.join(" · ") : "unbekannt";
}

export function when(unixSeconds, now = new Date()) {
  const d = new Date(unixSeconds * 1000);
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay
    ? d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("de-DE", { day: "2-digit", month: "short" });
}
