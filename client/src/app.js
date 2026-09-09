import { ApiError, OfflineError, api } from "./api.js";
import { signInScreen } from "./screens/signin.js";
import { practiseScreen } from "./screens/practise.js";
import { statsScreen } from "./screens/stats.js";
import { sessionScreen } from "./screens/session.js";
import { settingsScreen } from "./screens/settings.js";
import { summaryScreen } from "./screens/summary.js";
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
  // The server's copy of the settings, so the session length and the sound
  // note agree with the Settings screen on every device. Held here rather
  // than fetched per screen because the practice tab needs it before the
  // Settings tab has ever been opened.
  settings: { newPerDay: 15, sessionLength: 20, readAloud: true, pitchAccent: false },
  online: navigator.onLine,
  pendingEvents: 0,
  jokerBadge: false,
};

/** The strip from design 25 — informational, never an error. */
function offlineBar() {
  if (state.online && state.pendingEvents === 0) return null;
  if (!state.online) {
    return el(
      "div.offline-bar",
      {},
      el("span.dot"),
      el("span", {
        text:
          state.pendingEvents > 0
            ? `Offline · ${state.pendingEvents} reviews waiting`
            : "Offline",
      }),
    );
  }
  return el(
    "div.offline-bar.synced",
    {},
    el("span.dot"),
    el("span", { text: `Synced · ${state.pendingEvents} reviews sent` }),
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
  if (state.tab === "stats") return statsScreen();
  return settingsScreen({
    user: state.user,
    onSettings: (settings) => {
      state.settings = settings;
    },
    onSignOut: () => {
      state.user = undefined;
      state.tab = "practise";
      state.session = undefined;
      state.summary = undefined;
      renderApp();
    },
  });
}

function startSession({ mode = "choose", ...filters } = {}) {
  // Only 選ぶ is drawn (design 16). The other three lines need their card
  // states designed before they can be honest — design/next-brief.md.
  state.session = { mode: mode === "choose" ? mode : "choose", filters, requested: mode };
  state.summary = undefined;
  renderApp();
}

function renderApp() {
  if (!state.user) {
    render(app, signInScreen({ onSignedIn: (user) => {
      state.user = user;
      state.tab = "practise";
      loadSettings();
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
    const { mode, filters } = state.session;
    render(
      app,
      statusBar(),
      sessionScreen({
        mode,
        filters,
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
      }),
    );
    return;
  }

  render(app, statusBar(), offlineBar(), currentScreen(), tabBar());
}

window.addEventListener("online", () => {
  state.online = true;
  renderApp();
  // The bar removes itself after two seconds once everything is sent.
  if (state.pendingEvents === 0) setTimeout(renderApp, 2000);
});
window.addEventListener("offline", () => {
  state.online = false;
  renderApp();
});

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

/** Restore the session if the cookie is still good, otherwise sign in. */
try {
  state.user = await api.me();
} catch (err) {
  if (err instanceof OfflineError) state.online = false;
  else if (!(err instanceof ApiError && err.status === 401)) throw err;
}

renderApp();
if (state.user) loadSettings();
