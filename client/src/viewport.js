/**
 * The screen height iOS forgets.
 *
 * `100dvh` is meant to be "the viewport that is actually visible", and on her
 * phone it usually is. But in the installed app it intermittently comes back
 * as the *layout* viewport instead — 798px inside an 859px screen, the same
 * 61px `base.css` describes — and it stays wrong until the app is force quit.
 * Measured from a screenshot on 2026-09-11: the tab bar sat 185 device px
 * (61 CSS px at scale 3) above the bottom edge with the page colour showing
 * underneath it. The deployed stylesheet was v14, the current one, so this is
 * not a stale shell; and it is intermittent, so the unit is not unsupported.
 *
 * Two things bring it on, and they are one mechanism: switching back into the
 * installed app, and dismissing the keyboard — the "+ new" topic field calls
 * focus() directly (`screens/card-topics.js`), which is what "played with the
 * categories and came back" did. Both are moments where iOS recomputes
 * viewport metrics, and sometimes hands back the old ones.
 *
 * So this remembers rather than measures. `--viewport-h` is the *largest*
 * height seen at the current width, and `base.css` takes the larger of it and
 * `100dvh`. Taking the maximum is what makes the timing not matter: reading
 * `innerHeight` at the wrong moment gives a value that is too small, and a
 * value that is too small is ignored. There is no race to lose and nothing to
 * tune, which is the difference between this and re-measuring on resume.
 *
 * Keyed by width because the manifest allows rotation: landscape is a
 * genuinely shorter viewport, not a stale one, and a height remembered from
 * portrait would push the tab bar off the bottom of it.
 */

/** width in CSS px → the tallest viewport seen at that width */
const tallest = new Map();

/** The smallest height seen this session. Diagnostics only. */
let lowest = 0;

/** Exported for the client test suite, which has no window to drive. */
export function fold(previous, { width, height }) {
  if (!width || !height) return previous;
  return {
    tallest: Math.max(previous.tallest ?? 0, height),
    lowest: previous.lowest ? Math.min(previous.lowest, height) : height,
  };
}

function note() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  // A hidden or backgrounded page can report 0, and that is not a measurement.
  if (!width || !height) return;
  const next = fold({ tallest: tallest.get(width) ?? 0, lowest }, { width, height });
  tallest.set(width, next.tallest);
  lowest = next.lowest;
  document.documentElement.style.setProperty("--viewport-h", `${next.tallest}px`);
}

export function watchViewport() {
  note();
  // `resize` covers rotation and the keyboard; the lifecycle events cover
  // coming back into the app, which is the case dvh gets wrong and where no
  // resize is guaranteed to fire.
  for (const event of ["resize", "orientationchange", "pageshow", "focus"]) {
    addEventListener(event, note);
  }
  addEventListener("visibilitychange", () => {
    if (!document.hidden) note();
  });
}

/**
 * What the phone believes right now, for the diagnostics block in Settings.
 *
 * This exists because the bug cannot be reproduced on the server: desktop
 * WebKit reports one height for every one of these units, so the only way to
 * learn which of them iOS gets wrong was to ask the device while it was wrong.
 * It answered on 2026-09-11 — `dvh 812 · lvh 874` on an 874px display — and
 * `base.css` now asks for `lvh` in standalone because of it.
 *
 * The rows stay, because that answer created the next question. The rule is
 * inside `@media (display-mode: standalone)`, and a media query that quietly
 * fails to match looks exactly like a fix that did not work, so `mode` reports
 * whether it matched. Once a reading shows `mode standalone` with the bar at
 * the bottom, all of this can come out (#59).
 */
/** Which of the manifest's display modes the browser thinks it is showing. */
function displayMode() {
  if (typeof matchMedia !== "function") return "?";
  for (const mode of ["standalone", "fullscreen", "minimal-ui", "browser"]) {
    if (matchMedia(`(display-mode: ${mode})`).matches) return mode;
  }
  return "?";
}

export function viewportReport() {
  const measure = (css) => {
    const probe = document.createElement("div");
    probe.style.cssText =
      `position:absolute;top:0;left:0;width:1px;height:${css};` +
      "visibility:hidden;pointer-events:none";
    document.body.append(probe);
    const height = Math.round(probe.getBoundingClientRect().height);
    probe.remove();
    return height;
  };

  // Where a `position: fixed` bottom edge actually lands. This is the one
  // number the screenshot could not give: it says whether the layout viewport
  // is short, or merely offset from the top of the screen.
  const pinned = document.createElement("div");
  pinned.style.cssText =
    "position:fixed;left:0;bottom:0;width:1px;height:1px;visibility:hidden;pointer-events:none";
  document.body.append(pinned);
  const fixedBottom = Math.round(pinned.getBoundingClientRect().bottom);
  pinned.remove();

  const app = document.getElementById("app");
  const held = tallest.get(window.innerWidth) ?? 0;

  return [
    // `screen.height` belongs to the display, not the viewport, so it takes no
    // part in the staleness and is the yardstick the rest are read against.
    // `mode` is whether the standalone rule in base.css matched at all — the
    // one thing that separates "the fix is wrong" from "the fix never ran".
    [
      "Screen",
      `${window.innerWidth} × ${window.innerHeight} · screen ${window.screen?.height ?? 0}` +
        ` · held ${held} · low ${lowest} · mode ${displayMode()}`,
    ],
    ["Units", `dvh ${measure("100dvh")} · lvh ${measure("100lvh")} · svh ${measure("100svh")}`],
    [
      "Layout",
      `page ${document.documentElement.clientHeight} · fixed ${fixedBottom} · app ${
        app ? Math.round(app.getBoundingClientRect().height) : 0
      }`,
    ],
    // #118: `page 812 · app 874` means the page itself can scroll by 62px,
    // underneath the tab that is meant to. This says whether it has. It had
    // not (`page moved 0 of 62`, read off Henning's phone with the tab stuck).
    [
      "Scroll",
      (() => {
        const root = document.scrollingElement ?? document.documentElement;
        return `page moved ${Math.round(root.scrollTop)} of ${root.scrollHeight - root.clientHeight}`;
      })(),
    ],
    [
      "List",
      list.at
        ? `moved ${list.at} · touches ${list.touches} · scrolls ${list.scrolls} · built ${list.builds}× · on ${list.target}`
        : "not touched yet",
    ],
  ];
}

/**
 * #118: what the practise tab's list was doing when she last touched it.
 *
 * On her phone the tab takes one swipe and then will not move either way, and
 * nothing here can make an iPhone's touch scroll. So the phone reports it, for
 * Settings to show afterwards — the list itself is gone by then:
 *
 *   moved X of Y   its scroll position and room, at the last touch
 *   touches        touches that started on the tab
 *   scrolls        scroll events the list fired
 *   built          how often the tab was rebuilt since the app opened
 *   on             the element the last touch landed on
 *
 * Touches rising while scrolls do not says the gesture arrives and the list
 * refuses it; `of 0` says the list has no room left; touches not rising says
 * something on top catches them. Passive, so it cannot block a scroll itself.
 */
const list = { at: "", touches: 0, scrolls: 0, builds: 0, target: "" };

function readList(node) {
  list.at = `${Math.round(node.scrollTop)} of ${node.scrollHeight - node.clientHeight}`;
}

export function watchList() {
  const options = { passive: true, capture: true };
  // A rebuild replaces the list element under her finger; count them.
  const app = document.getElementById("app");
  if (app && typeof MutationObserver !== "undefined") {
    new MutationObserver((records) => {
      for (const r of records) {
        for (const n of r.addedNodes) if (n.classList?.contains("practise")) list.builds++;
      }
    }).observe(app, { childList: true });
  }
  addEventListener(
    "touchstart",
    (event) => {
      const tab = event.target?.closest?.(".practise");
      if (!tab) return;
      list.touches++;
      const t = event.target;
      list.target = `${t.tagName.toLowerCase()}${t.classList.length ? "." + [...t.classList].join(".") : ""}`;
      readList(tab);
    },
    options,
  );
  addEventListener(
    "scroll",
    (event) => {
      if (!event.target?.classList?.contains("practise")) return;
      list.scrolls++;
      readList(event.target);
    },
    options,
  );
}
