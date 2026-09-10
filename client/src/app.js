import { ApiError, OfflineError, api } from "./api.js";
import { signInScreen } from "./screens/signin.js";
import { practiseScreen } from "./screens/practise.js";
import { statsScreen } from "./screens/stats.js";
import { browseScreen } from "./screens/browse.js";
import { sessionScreen } from "./screens/session.js";
import { settingsScreen } from "./screens/settings.js";
import { summaryScreen } from "./screens/summary.js";
import { offlineStatus, pending, startFlushing, subscribe } from "./outbox.js";
import { clearPersonal, getMeta, setMeta } from "./store.js";
import { el, render, statusBar } from "./ui/dom.js";

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
  // The server's copy of the settings, so the session length and the sound
  // note agree with the Settings screen on every device. Held here rather
  // than fetched per screen because the practice tab needs it before the
  // Settings tab has ever been opened.
  settings: { newPerDay: 15, sessionLength: 20, readAloud: true, pitchAccent: false },
  online: navigator.onLine,
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
      onStart: startSession,
      onDrillTopic: () => {
        // The topic picker (23) is drawn; wiring it is the next screen.
        startSession({ only: "new" });
      },
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
      renderApp();
      // "Signing out clears this device" (design 22). The deck cache stays —
      // it is public, it is large, and re-downloading it costs metered data.
      await clearPersonal();
      state.pendingEvents = 0;
      renderApp();
    },
  });
}

function openBrowse() {
  state.browse = browseScreen({
    onBack: closeBrowse,
    onPractiseStarred: () => {
      closeBrowse();
      startSession({ only: "starred" });
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
  renderApp();
}

function renderApp() {
  if (!state.user) {
    render(app, signInScreen({ onSignedIn: (user) => {
      state.user = user;
      state.tab = "practise";
      setMeta("user", user);
      loadSettings();
      startFlushing();
      renderApp();
    } }));
    return;
  }

  if (state.summary) {
    render(
      app,
      statusBar(),
      summaryScreen(state.summary, {
        onDone: () => {
          state.summary = undefined;
          renderApp();
        },
        onAgain: () => startSession({ mode: state.summary.mode }),
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
      limit: state.settings.sessionLength,
      readAloud: state.settings.readAloud,
      onExit: () => {
        state.session = undefined;
        renderApp();
      },
      onFinish: (result) => {
        state.session = undefined;
        state.summary = result.empty ? undefined : result;
        if (result.levelUp) state.jokerBadge = state.jokerBadge || false;
        renderApp();
      },
    });
    render(app, statusBar(), state.session.node);
    return;
  }

  // Browse (31) has its own back arrow and its own footer button, and the
  // drawn frame carries no tab bar — it takes the screen the way a session
  // does rather than sitting inside a tab.
  if (state.browse) {
    render(app, statusBar(), state.browse);
    return;
  }

  render(app, statusBar(), offlineBar(), currentScreen(), tabBar());
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
subscribe(({ waiting, sent }) => {
  state.pendingEvents = waiting;
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
  } else if (err instanceof ApiError && err.status === 401) {
    await clearPersonal();
  } else {
    throw err;
  }
}

state.pendingEvents = await pending();

renderApp();

if (state.user) {
  loadSettings();
  // §7: flush eagerly rather than batching for hours — iOS evicts storage
  // under pressure, and an event that never left the device is the one thing
  // here that cannot be reconstructed.
  startFlushing();
}
