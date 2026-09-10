import { OfflineError, api, isSessionExpired, onSessionExpired } from "./api.js";
import { signInScreen } from "./screens/signin.js";
import { signedOutScreen } from "./screens/signed-out.js";
import { practiseScreen } from "./screens/practise.js";
import { statsScreen } from "./screens/stats.js";
import { browseScreen } from "./screens/browse.js";
import { cardTopicsSheet } from "./screens/card-topics.js";
import { addWordScreen, ownDeckScreen } from "./screens/own-deck.js";
import { firstRunScreen } from "./screens/first-run.js";
import { DEFAULT_FILTERS, activeLabel, chooseSetScreen, isDefault } from "./screens/choose-set.js";
import { sessionScreen } from "./screens/session.js";
import { settingsScreen } from "./screens/settings.js";
import { summaryScreen } from "./screens/summary.js";
import { flush, offlineStatus, pending, startFlushing, subscribe } from "./outbox.js";
import { cardCount, clearPersonal, getMeta, setMeta } from "./store.js";
import { forget, openSession } from "./resume.js";
import { el, render } from "./ui/dom.js";

const TABS = [
  { key: "practise", label: "Practise" },
  { key: "stats", label: "Stats" },
  { key: "settings", label: "Settings" },
];

const app = document.getElementById("app");

const state = {
  user: undefined,
  tab: "practise",
  // A session is modal: it replaces the tabs entirely, so a card is never
  // covered and the tab bar never competes with an answer.
  session: undefined,
  summary: undefined,
  // Browse (31) is not a tab — it is reached from Stats and from Settings, and
  // it replaces the tab screens while it is open. Held as a node rather than a
  // flag for the same reason the session is: rebuilding it on an unrelated
  // redraw would throw away her search, her scroll position and the page of
  // results underneath it.
  browse: undefined,
  // What the "Choose a set" sheet last held (36). Kept here rather than in the
  // practise tab because it outlives it: tapping a line starts a session with
  // these, and the session that runs says so (39).
  filters: { ...DEFAULT_FILTERS },
  topics: [],
  sheet: undefined,
  // Her own deck (27–30). `ownWords` is the count on the practise tab's
  // dashed station; `overlay` is the add screen or the list, which take the
  // screen the way browse does.
  ownWords: 0,
  overlay: undefined,
  // 51: an unfinished session, if there is one worth offering.
  resumable: undefined,
  // 49: this device has no deck yet, so the first thing after signing in is
  // getting one.
  firstRun: false,
  // The server's copy of the settings, so the session length and the sound
  // note agree with the Settings screen on every device. Held here rather
  // than fetched per screen because the practice tab needs it before the
  // Settings tab has ever been opened.
  settings: { newPerDay: 15, sessionLength: 20, readAloud: true, pitchAccent: false },
  online: navigator.onLine,
  // 52: the server is reachable and the cookie is not. Two flags, because the
  // state and the screen have different lifetimes — she can put the screen
  // away and go on practising while still being signed out, and the bar has
  // to keep saying so.
  signedOut: false,
  signedOutDismissed: false,
  signedOutNode: undefined,
  pendingEvents: 0,
  // How many went up in the last flush — the green bar's number, which is not
  // the same as the number still waiting.
  justSent: 0,
  jokerBadge: false,
};

/**
 * The strip from design 25 — informational, never an error, and never during
 * a session, so a card is never covered. What it says is decided by
 * `offlineStatus`; this only draws it.
 */
function offlineBar() {
  const status = offlineStatus({
    online: state.online,
    waiting: state.pendingEvents,
    justSent: state.justSent,
    signedOut: state.signedOut,
  });
  if (!status) return null;
  return el(
    `div.offline-bar${status.tone === "synced" ? ".synced" : ""}`,
    {},
    el("span.dot"),
    el("span", { text: status.text }),
  );
}

function tabBar() {
  return el(
    "nav.tabbar",
    {},
    TABS.map((tab) =>
      el(
        "button",
        {
          type: "button",
          "aria-current": state.tab === tab.key ? "page" : undefined,
          onclick: () => {
            if (tab.key === "stats") state.jokerBadge = false;
            state.tab = tab.key;
            state.browse = undefined;
            state.overlay = undefined;
            renderApp();
          },
        },
        el("span.dot"),
        el("span.label", { text: tab.label }),
        state.jokerBadge && tab.key === "stats" ? el("span.joker-badge") : null,
      ),
    ),
  );
}

function currentScreen() {
  if (state.tab === "practise") {
    return practiseScreen({
      sessionLength: state.settings.sessionLength,
      readAloud: state.settings.readAloud,
      onSessionLength: (len) => {
        state.settings = { ...state.settings, sessionLength: len };
        // Best effort: the picker is a shortcut into the same stored setting,
        // and a session started offline should not be blocked by it.
        api.updateSettings({ sessionLength: len }).catch(() => {});
      },
      // 36: "tapping a line still starts a session with whatever the sheet
      // last held, so the two-tap path survives."
      onStart: ({ mode } = {}) => startSession({ mode, ...state.filters }),
      filters: state.filters,
      onChooseSet: openSheet,
      onDrillTopic: openSheet,
      // #35: Browse is where a card gets starred, and the practise tab is
      // where she is when she wants to.
      onBrowse: openBrowse,
      ownWords: state.ownWords,
      onAddWord: openAddWord,
      onOwnDeck: openOwnDeck,
      resumable: state.resumable,
      onResume: resumeSession,
    });
  }
  if (state.tab === "stats") return statsScreen({ onBrowse: openBrowse });
  return settingsScreen({
    user: state.user,
    onBrowse: openBrowse,
    onSettings: (settings) => {
      state.settings = settings;
    },
    onSignOut: async () => {
      state.user = undefined;
      state.tab = "practise";
      state.session = undefined;
      state.summary = undefined;
      // Leaving on purpose settles the question 52 was asking.
      clearSignedOut();
      renderApp();
      // "Signing out clears this device" (design 22). The deck cache stays —
      // it is public, it is large, and re-downloading it costs metered data.
      await clearPersonal();
      state.pendingEvents = 0;
      renderApp();
    },
  });
}

/**
 * 36. The sheet sits over the practise tab rather than replacing it, so the
 * tab underneath is rendered first and this is appended on top.
 */
function openSheet() {
  state.sheet = chooseSetScreen({
    filters: state.filters,
    topics: state.topics,
    sessionLength: state.settings.sessionLength,
    onClose: closeSheet,
    onApply: (filters) => {
      state.filters = filters;
      closeSheet();
      startSession({ ...filters });
    },
  });
  renderApp();
  loadTopics();
}

function closeSheet() {
  state.sheet = undefined;
  renderApp();
}

/** The topic counts the sheet shows come from the same place Stats gets them. */
async function loadTopics() {
  if (state.topics.length > 0) return;
  try {
    const stats = await api.stats();
    state.topics = stats.topics ?? [];
    if (state.sheet) {
      // Redraw the sheet now that the chips have something to show.
      openSheet();
    }
    if (state.topicsFor) {
      openCardTopics(state.topicsFor.card, state.topicsFor.onChanged);
    }
  } catch {
    /* the sheet works without them; the topic row is just "Any" */
  }
}

/** 28/29. Takes the screen: it is a form, and a tab bar under a keyboard is noise. */
function openAddWord(initialWord = "") {
  state.overlay = addWordScreen({
    tags: state.topics.map((t) => ({ tag: t.tag, n: t.total ?? t.n ?? 0 })),
    initialWord,
    onCancel: closeOverlay,
    onSaved: () => {
      // 29: "saving returns to the practise tab with the count incremented,
      // no confirmation screen."
      state.overlay = undefined;
      state.tab = "practise";
      loadOwnDeck();
      renderApp();
    },
  });
  loadTopics();
  renderApp();
}

/** 30. */
function openOwnDeck() {
  state.overlay = ownDeckScreen({ onBack: closeOverlay, onAdd: () => openAddWord() });
  renderApp();
}

function closeOverlay() {
  state.overlay = undefined;
  renderApp();
}

/** The count on 27's dashed station. */
async function loadOwnDeck() {
  try {
    const { cards } = await api.cards();
    state.ownWords = cards.length;
    renderApp();
  } catch {
    /* the row still offers to add one */
  }
}

function openBrowse() {
  state.browse = browseScreen({
    onBack: closeBrowse,
    onPractiseStarred: () => {
      closeBrowse();
      startSession({ only: "starred" });
    },
    // 33: "a word she cannot find is usually a word she should add, so the
    // empty result leads straight into 28 with the query carried over."
    onAddWord: (query) => {
      closeBrowse();
      openAddWord(query);
    },
    // #35: tapping a row files it under one of her own topics.
    onTopics: openCardTopics,
  });
  renderApp();
}

/**
 * Her topics for one card (#35).
 *
 * An overlay above Browse rather than a replacement for it: it is a decision
 * about one row of the list behind it, and taking the screen would lose the
 * search she may have typed to get there.
 */
function openCardTopics(card, onChanged) {
  // Kept so loadTopics can rebuild this sheet if the list arrives after it
  // opened — the same trick openSheet uses, for the same reason.
  state.topicsFor = { card, onChanged };
  state.overlay = cardTopicsSheet({
    card,
    topics: state.topics,
    onClose: () => {
      state.topicsFor = undefined;
      closeOverlay();
    },
    onSaved: (tags) => {
      state.topicsFor = undefined;
      // The row keeps the object it was drawn from, so writing back to it and
      // asking Browse to repaint is what makes the chips appear without
      // reloading the search she is in the middle of.
      card.myTags = tags;
      onChanged?.();
      state.overlay = undefined;
      // A newly coined topic has to reach the picker, and the counts of the
      // ones she moved a card into have changed. Cheaper to re-ask than to
      // reproduce the server's arithmetic here and get it subtly wrong.
      state.topics = [];
      loadTopics();
      renderApp();
    },
  });
  renderApp();
}

function closeBrowse() {
  state.browse = undefined;
  renderApp();
}

function startSession({ mode = "choose", ...filters } = {}) {
  state.session = { mode, filters };
  state.summary = undefined;
  state.resumable = undefined;
  // Starting fresh abandons the saved one: 51 offers a choice, and taking the
  // other branch is an answer.
  forget().catch(() => {});
  renderApp();
}

/** Re-read the saved session and offer it if it is still worth offering. */
async function offerResume() {
  const saved = await openSession();
  if (saved) {
    state.resumable = saved;
    renderApp();
  }
}

/** 51. A chosen set resumes with its filter intact, dashed rule and all. */
function resumeSession(saved) {
  state.filters = saved.filters ?? { ...DEFAULT_FILTERS };
  state.session = { mode: saved.mode, filters: state.filters, resuming: saved };
  state.summary = undefined;
  state.resumable = undefined;
  renderApp();
}

/**
 * Any request can be the one that discovers the cookie is gone; from then on
 * the bar says so, and 52 takes the screen unless she has put it away.
 *
 * It deliberately does not throw the screen away: while she is looking at 52
 * a background request can still 401, and rebuilding it under her would clear
 * the digits she has typed.
 *
 * 25's rule, which 52 inherits: nothing covers a card. Her answers reach the
 * outbox regardless, so waiting for the session to end costs her nothing —
 * and the session's own exit redraws, which is when this surfaces.
 */
function noteSignedOut() {
  // Only the first one redraws. The practise tab reads /api/queue and
  // /api/stats as it is built, so redrawing on every 401 built a tab that
  // fired two more of them — a render loop that hammered the server for as
  // long as the cookie stayed dead.
  if (state.signedOut) return;
  state.signedOut = true;
  if (!state.session) renderApp();
}

/**
 * The flush found the cookie gone.
 *
 * This is the one thing that undoes a dismissal, because it is the one the
 * design names: "she can dismiss it and keep practising; it returns when the
 * outbox next tries to flush." Any other 401 must not — the practise tab reads
 * /api/stats and /api/queue behind her, and letting those revive the screen
 * made the × do nothing at all.
 */
function reviveSignedOut() {
  const changed = !state.signedOut || state.signedOutDismissed;
  state.signedOut = true;
  if (state.signedOutDismissed) {
    // Built fresh, so the count in the paragraph is the count as it is now:
    // she has been practising since she put it away.
    state.signedOutDismissed = false;
    dropSignedOutNode();
  }
  if (changed && !state.session) renderApp();
}

function dropSignedOutNode() {
  state.signedOutNode?.destroy?.();
  state.signedOutNode = undefined;
}

/** Back in. Only the shell state — the caller decides what to reload. */
function clearSignedOut() {
  state.signedOut = false;
  state.signedOutDismissed = false;
  dropSignedOutNode();
}

/**
 * Signing in again from 52.
 *
 * Deliberately not the sign-in screen's handler: that one runs `checkDeck()`,
 * which on a device mid-practice would be a no-op but on a freshly evicted
 * cache would replace the tab she was on with the first-run download. She was
 * already in; this restores a cookie, it does not set the app up.
 *
 * Errors are left to propagate — the PIN control turns a rejection into 01's
 * wrong-PIN state and a 429 into its countdown, which is what 52's note asks
 * for.
 */
async function signInAgain(pin) {
  const user = await api.login(state.user?.handle, pin);
  state.user = user;
  await setMeta("user", user);
  clearSignedOut();
  renderApp();
  loadSettings();
  loadOwnDeck();
  // The whole reason the screen exists: the answers go up now.
  flush().catch(() => {});
}

function renderApp() {
  if (!state.user) {
    render(app, signInScreen({ onSignedIn: (user) => {
      state.user = user;
      state.tab = "practise";
      clearSignedOut();
      setMeta("user", user);
      checkDeck();
      loadSettings();
      // #35: the topic list is needed anywhere she files or filters by one,
      // and Browse can be reached in two taps from here. Loading it only when
      // the set sheet opened meant the card-topics sheet came up offering
      // nothing but "+ new" — every existing topic invisible, and a duplicate
      // one keystroke away.
      loadTopics();
      loadOwnDeck();
      startFlushing();
      renderApp();
    } }));
    return;
  }

  // 52, before the first-run download: a deck cannot be fetched with a cookie
  // the server has forgotten, and before the tabs, because it takes the screen.
  // Never over a running session or its summary — a card is never covered, and
  // the number she just earned is not something to interrupt.
  if (state.signedOut && !state.signedOutDismissed && !state.session && !state.summary) {
    // Built once and kept, like the session: rebuilding it on an unrelated
    // redraw would throw away the digits she has typed and the rate-limit
    // countdown with them.
    state.signedOutNode ??= signedOutScreen({
      handle: state.user?.handle,
      waiting: state.pendingEvents,
      onSignIn: signInAgain,
      onDismiss: () => {
        state.signedOutDismissed = true;
        dropSignedOutNode();
        renderApp();
      },
    });
    render(app, offlineBar(), state.signedOutNode);
    return;
  }

  // 49: before anything else, because without a deck there is nothing to do.
  if (state.firstRun) {
    state.firstRunNode ??= firstRunScreen({
      onReady: () => {
        state.firstRun = false;
        state.firstRunNode = undefined;
        renderApp();
      },
    });
    render(app, state.firstRunNode);
    return;
  }

  if (state.summary) {
    render(
      app,
      summaryScreen(state.summary, {
        onDone: () => {
          state.summary = undefined;
          renderApp();
        },
        onAgain: () => startSession({ mode: state.summary.mode }),
        // 40: back to the day's real queue, which means clearing the filters
        // as well as starting a session — otherwise "carry on" would run the
        // chosen set again.
        onCarryOn: () => {
          const mode = state.summary.mode;
          state.filters = { ...DEFAULT_FILTERS };
          startSession({ mode });
        },
      }),
    );
    return;
  }

  if (state.session) {
    // Built once and kept. A session owns its queue, its position and its
    // recorded answers; constructing it again — which any renderApp() during
    // a session used to do — throws all of that away and silently starts a
    // different session over the top of it. The outbox now triggers renders,
    // so this is no longer hypothetical: it hung the summary at the end of
    // every offline session.
    state.session.node ??= sessionScreen({
      mode: state.session.mode,
      filters: state.session.filters,
      resuming: state.session.resuming,
      // 39 only labels a session she chose, not one the scheduler laid.
      chosenLabel: isDefault(state.session.filters)
        ? undefined
        : activeLabel(state.session.filters),
      limit: state.settings.sessionLength,
      readAloud: state.settings.readAloud,
      // #21: off by default, and read here rather than inside the session so
      // the setting is in one place with the others.
      pitchAccent: state.settings.pitchAccent,
      onExit: () => {
        state.session = undefined;
        renderApp();
        // 51 is not only for coming back tomorrow: she taps × and the offer
        // should be there when the tab redraws, not after a restart.
        offerResume();
      },
      onFinish: (result) => {
        state.session = undefined;
        state.resumable = undefined;
        state.summary = result.empty ? undefined : result;
        if (result.levelUp) state.jokerBadge = state.jokerBadge || false;
        renderApp();
      },
    });
    render(app, state.session.node);
    return;
  }

  // Browse (31) has its own back arrow and its own footer button, and the
  // drawn frame carries no tab bar — it takes the screen the way a session
  // does rather than sitting inside a tab.
  // Her own deck's screens take the whole screen, like browse: 28 is a form,
  // and a tab bar under a keyboard is noise.
  if (state.overlay) {
    render(app, state.overlay);
    return;
  }

  if (state.browse) {
    render(app, state.browse);
    return;
  }

  render(app, offlineBar(), currentScreen(), tabBar(), state.sheet);
}

window.addEventListener("online", () => {
  state.online = true;
  renderApp();
});
window.addEventListener("offline", () => {
  state.online = false;
  renderApp();
});

/**
 * The strip is driven by the outbox rather than by a counter this file keeps:
 * a review recorded during a session, one flushed in the background and one
 * left over from a previous run all have to move the same number, and only
 * the outbox sees all three.
 */
let clearBarTimer;
subscribe(({ waiting, sent, status }) => {
  state.pendingEvents = waiting;
  // 52: a flush the server turned away for want of a cookie. This is the only
  // signal allowed to bring the screen back after she has dismissed it, and it
  // renders on its own account.
  if (status === 401) {
    reviveSignedOut();
    return;
  }
  // Design 25: "Synced · N reviews sent" is a confirmation, not a state — it
  // shows what just went up and then removes itself after two seconds.
  if (sent > 0) {
    state.justSent = sent;
    clearTimeout(clearBarTimer);
    clearBarTimer = setTimeout(() => {
      state.justSent = 0;
      renderApp();
    }, 2000);
  }
  // Design 25: the strip belongs to the tab screens. During a session there is
  // nothing on screen for this to change, so it does not ask for a redraw.
  if (!state.session) renderApp();
});

/**
 * §7: the worker has to come from /kotoba/sw.js so its scope is /kotoba/. A
 * worker at the domain root cannot reliably control a subpath app, and the
 * failure is silent — so the path here is relative to the app, deliberately.
 */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register(new URL("../sw.js", import.meta.url)).catch((err) => {
    // No offline support, but the app works. Worth a line in the console
    // rather than a message she cannot act on.
    console.warn("service worker did not register", err);
  });
}

/**
 * Fetch the stored settings and redraw. Failure is not an error worth showing
 * on the practice tab: the defaults above match the schema's, so the worst an
 * offline start costs is a session length she can change on the next screen.
 */
/** 49: a device with no cards has to get them before it can offer a session. */
async function checkDeck() {
  state.firstRun = (await cardCount()) === 0;
  if (state.firstRun) renderApp();
}

async function loadSettings() {
  try {
    const { settings } = await api.settings();
    state.settings = settings;
    renderApp();
  } catch {
    /* keep the defaults */
  }
}

/**
 * Restore the session if the cookie is still good, otherwise sign in.
 *
 * Offline is *not* "otherwise". Opening the app on a train used to drop her at
 * a sign-in screen she could not complete, because the check for a valid
 * cookie needs the server and the cookie itself does not. So the last signed-in
 * user is remembered on the device and stands in until the server can be
 * reached — the events she records go into the outbox either way, and a 401
 * when it *can* be reached is what actually ends a session.
 */
try {
  state.user = await api.me();
  await setMeta("user", state.user);
} catch (err) {
  if (err instanceof OfflineError) {
    state.online = false;
    state.user = await getMeta("user");
  } else if (isSessionExpired(err)) {
    // The same state as a cookie that expires mid-practice, so it takes the
    // same screen: the remembered handle stands in until she signs in again.
    //
    // This used to call clearPersonal(), which clears the outbox — so opening
    // the app after the cookie had lapsed destroyed every answer that had not
    // been sent yet, which is precisely what 52 promises is safe, and took the
    // remembered handle with it. Only signing out on purpose clears this
    // device.
    state.user = await getMeta("user");
    state.signedOut = true;
  } else {
    throw err;
  }
}

state.pendingEvents = await pending();

/**
 * Registered after the boot check above, which handles its own 401 — otherwise
 * that one 401 would arm the screen before there is a count to put in it.
 * From here on any request can be the one that finds the cookie gone.
 */
onSessionExpired(noteSignedOut);

renderApp();

if (state.user) {
  await checkDeck();
  loadSettings();
  loadOwnDeck();
  offerResume();
  // §7: flush eagerly rather than batching for hours — iOS evicts storage
  // under pressure, and an event that never left the device is the one thing
  // here that cannot be reconstructed.
  startFlushing();
}
