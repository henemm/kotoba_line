import { ApiError, OfflineError, api } from "./api.js";
import { signInScreen } from "./screens/signin.js";
import { practiseScreen } from "./screens/practise.js";
import { statsScreen } from "./screens/stats.js";
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
  sessionLength: 20,
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

function placeholder(title, note) {
  return el(
    "div",
    { style: { flex: "1", display: "flex", flexDirection: "column" } },
    el("div", { style: { padding: "6px 26px 22px", fontSize: "17px", fontWeight: "700" }, text: title }),
    el("p", {
      style: { margin: "0", padding: "0 26px", fontSize: "14px", lineHeight: "1.6", color: "var(--ink-muted)" },
      text: note,
    }),
  );
}

function currentScreen() {
  if (state.tab === "practise") {
    return practiseScreen({
      sessionLength: state.sessionLength,
      onSessionLength: (len) => {
        state.sessionLength = len;
      },
      onStart: (opts) => {
        // The session itself lands next; the four modes are designed, the
        // rating rows for めくる and 話す are not (design/next-brief.md).
        console.info("start session", opts);
      },
      onDrillTopic: () => {
        console.info("topic picker");
      },
    });
  }
  if (state.tab === "stats") return statsScreen();
  return placeholder("Settings", "Designed in 22; wiring comes next.");
}

function renderApp() {
  if (!state.user) {
    render(app, signInScreen({ onSignedIn: (user) => {
      state.user = user;
      state.tab = "practise";
      renderApp();
    } }));
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

/** Restore the session if the cookie is still good, otherwise sign in. */
try {
  state.user = await api.me();
} catch (err) {
  if (err instanceof OfflineError) state.online = false;
  else if (!(err instanceof ApiError && err.status === 401)) throw err;
}

renderApp();
