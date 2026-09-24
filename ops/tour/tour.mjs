#!/usr/bin/env node
/**
 * The app tour (#255): every screen, every button, the way Henning finds
 * them — by what is on the screen, not by a pattern in the code.
 *
 * He kept finding buttons that did not answer a tap or did not show that
 * they were playing, one after another ("Warum finde ich besser als du?").
 * Each check before this one looked at what had just changed, and searched
 * the source for the one symbol it was about; a button that looked
 * different, or that the test browser never drew (the recorder, without a
 * MediaRecorder), was never seen at all. This walks the app instead.
 *
 * What it does:
 *   1. copies the live database (SQLite backup, never the file itself) into
 *      a scratch directory and adds a throwaway account to the copy;
 *   2. starts the API on the copy and client/dev-server.js in front of it,
 *      with the real audio, on free ports — never PUSH_SENDER, so nothing
 *      reaches her phone;
 *   3. opens every screen in WebKit at her iPhone's size, with a fake
 *      microphone that "records" a real deck recording;
 *   4. taps every button once (one of each kind — the same button on ten
 *      screens is one button) and measures, at the click, before the app
 *      handles it (most taps redraw the screen):
 *        press    the press answer (ui/press.js): class `tapped` and its
 *                 animation running;
 *        pulse    for a button whose tap started a sound: class `playing`
 *                 while it runs;
 *   5. writes report.md and report.json, and exits 1 when a button fails.
 *
 * Usage (on the server, where the database and the audio are):
 *   npm ci --prefix ops/tour
 *   node ops/tour/tour.mjs [--db /srv/kotoba/data/kotoba.sqlite]
 *                          [--media /srv/kotoba/media] [--out DIR] [--screen NAME]
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { webkit } from "playwright";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, a, i, all) => (a.startsWith("--") ? [...pairs, [a.slice(2), all[i + 1]]] : pairs), []),
);
const DB = args.db ?? "/srv/kotoba/data/kotoba.sqlite";
const MEDIA = args.media ?? "/srv/kotoba/media";
const OUT = args.out ?? mkdtempSync(join(tmpdir(), "kotoba-tour-"));
const HANDLE = "tour";
/** The code the tour makes for itself, so the sign-up screen has one. */
const TOUR_INVITE = "TOURCODE";
/** Of one kind of button on one screen, how many are pressed (see the loop). */
const PER_KIND = 3;
const PIN = "602915";
/** Buttons the tour looks at but does not press: they end the tour's own session or ask the OS. */
const NOT_PRESSED = [/^Abmelden$/, /^Aktualisieren$/, /Benachrichtigung/, /^Wenn Karten bereit sind$/];

// ── the copy, the account, the servers ─────────────────────────────────

const require = createRequire(join(ROOT, "server", "package.json"));
const Database = require("better-sqlite3");

async function freePort() {
  return new Promise((ok) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

async function waitFor(url, ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`${url} did not come up`);
}

async function prepare() {
  const data = join(OUT, "data");
  mkdirSync(data, { recursive: true });
  const live = new Database(DB, { readonly: true, fileMustExist: true });
  await live.backup(join(data, "kotoba.sqlite"));
  live.close();
  // Through the server's own code, so the copy gets any migration this
  // checkout has and the live database does not yet.
  const { openDatabase } = await import(pathToFileURL(join(ROOT, "server", "src", "db.js")));
  const { createUser } = await import(pathToFileURL(join(ROOT, "server", "src", "users.js")));
  const { createInvite } = await import(pathToFileURL(join(ROOT, "server", "src", "invites.js")));
  const db = openDatabase(join(data, "kotoba.sqlite"));
  await createUser(db, { handle: HANDLE, display: "Rundgang", pin: PIN });
  createInvite(db, { code: TOUR_INVITE, label: "Rundgang", settings: { beginner: true }, maxUses: 50, days: 1 });
  db.close();

  const apiPort = await freePort();
  const webPort = await freePort();
  const env = { ...process.env, DATA_DIR: data, COOKIE_SECURE: "false", PORT: String(apiPort) };
  delete env.PUSH_SENDER;
  const children = [
    spawn(process.execPath, ["src/server.js"], { cwd: join(ROOT, "server"), env, stdio: "ignore" }),
    spawn(process.execPath, ["client/dev-server.js", "--api", `http://127.0.0.1:${apiPort}`, "--port", String(webPort), "--media", MEDIA], {
      cwd: ROOT,
      stdio: "ignore",
    }),
  ];
  const base = `http://127.0.0.1:${webPort}/kotoba/`;
  await waitFor(`http://127.0.0.1:${apiPort}/api/health`);
  await waitFor(base);
  return { base, children, dbPath: join(data, "kotoba.sqlite") };
}

/** A deck of her own with two cards, so its page, its list and its card sheet exist. */
async function seed(base) {
  const login = await fetch(new URL("api/auth/login", base), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: HANDLE, pin: PIN }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const call = (method, path, body) =>
    fetch(new URL(path, base), { method, headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
  const { deck } = await call("POST", "api/decks", { name: "Rundgang" });
  await call("POST", "api/cards", { word: "たべる", meaning: "essen", deckId: deck.id });
  await call("POST", "api/cards", { word: "のむ", meaning: "trinken", deckId: deck.id });
  return { call };
}

/**
 * The account as it was after seeding, put back before every screen: a
 * tour that presses every switch switches things off — the first full run
 * hid three ways of practising in Kaishi's options and then could not reach
 * them. Sessions and ui_events stay: the browser's cookie is a session made
 * after this snapshot.
 */
function snapshot(dbPath) {
  const db = new Database(dbPath);
  const userId = db.prepare("SELECT id FROM users WHERE handle = ?").get(HANDLE).id;
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((t) => t.name)
    .filter((t) => !["users", "sessions", "ui_events"].includes(t))
    .filter((t) => db.prepare(`PRAGMA table_info(${t})`).all().some((c) => c.name === "user_id"));
  const owned = ["decks", "cards"];
  const rows = Object.fromEntries([
    ...tables.map((t) => [t, db.prepare(`SELECT * FROM ${t} WHERE user_id = ?`).all(userId)]),
    ...owned.map((t) => [t, db.prepare(`SELECT * FROM ${t} WHERE owner_id = ?`).all(userId)]),
  ]);
  const insert = (t, row) =>
    db.prepare(`INSERT INTO ${t} (${Object.keys(row).join(", ")}) VALUES (${Object.keys(row).map(() => "?").join(", ")})`).run(...Object.values(row));
  // Her decks and cards are put back in place, not removed and re-added:
  // other rows point at them, and a deleted one is only marked (rule 4).
  const update = (t, row) =>
    db.prepare(`UPDATE ${t} SET ${Object.keys(row).map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...Object.values(row), row.id);
  return db.transaction(() => {
    for (const t of tables) db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(userId);
    for (const t of owned) for (const row of rows[t]) update(t, row);
    for (const t of tables) for (const row of rows[t]) insert(t, row);
  });
}

// ── the browser ────────────────────────────────────────────────────────

function fakeDevices(mp3) {
  // A microphone that "records" a real deck recording (the trick from #185):
  // without it WebKit has no MediaRecorder, and the app does not draw the
  // recorder at all — which is how its ▶ went unseen.
  const bytes = Uint8Array.from(atob(mp3), (c) => c.charCodeAt(0));
  Object.defineProperty(MediaDevices.prototype, "getUserMedia", {
    configurable: true,
    value: async () => ({ getTracks: () => [{ stop() {} }] }),
  });
  window.MediaRecorder = class extends EventTarget {
    static isTypeSupported(t) {
      return t === "audio/mp4";
    }
    constructor() {
      super();
      this.mimeType = "audio/mpeg";
    }
    start() {}
    stop() {
      const e = new Event("dataavailable");
      e.data = new Blob([bytes], { type: "audio/mpeg" });
      this.dispatchEvent(e);
      this.dispatchEvent(new Event("stop"));
    }
  };
  // The press answer, read in the instant between the finger landing and the
  // app handling the click — most taps redraw the screen, and the button
  // measured afterwards would be a new one that was never pressed. Capture
  // on window runs before any listener of the page's own.
  window.__press = null;
  window.addEventListener(
    "click",
    (e) => {
      const n = e.target.closest?.('button, [role="button"], [role="switch"], a[href]');
      if (!n) return;
      window.__press = {
        tapped: n.classList.contains("tapped"),
        moving: n.getAnimations().some((a) => a.id === "press"),
      };
    },
    { capture: true },
  );
  // How the tour names a button, the same in every call.
  window.__tour = {
    visible: (n) => {
      const r = n.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(n).visibility !== "hidden";
    },
    label: (n) => (n.getAttribute("aria-label") || n.innerText || n.title || "").trim().replace(/\s+/g, " ").slice(0, 60),
    kind: (n) =>
      `${n.tagName.toLowerCase()}${[...n.classList].filter((c) => !["tapped", "playing", "sound"].includes(c)).map((c) => `.${c}`).join("")}`,
  };
  // Every sound the page starts, so a tap can be told apart from one that played.
  window.__sounds = 0;
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...a) {
    window.__sounds++;
    return play.apply(this, a);
  };
  if (window.speechSynthesis) {
    const speak = speechSynthesis.speak.bind(speechSynthesis);
    speechSynthesis.speak = (u) => {
      window.__sounds++;
      return speak(u);
    };
  }
}

/** Her phone's geometry, the fake microphone and the tour's own helpers. */
async function phone(browser) {
  const mp3 = readFileSync(join(MEDIA, readdirSync(MEDIA).find((f) => f.endsWith(".mp3")))).toString("base64");
  const context = await browser.newContext({
    viewport: { width: 394, height: 852 },
    deviceScaleFactor: 3,
    isMobile: true,
    // Playwright's WebKit on Linux reports itself as Linux, and the app asks
    // (install.js `isApple`). Measured 2026-09-20: without this the tour drew
    // the Chromium instructions — "Tippe oben rechts auf die drei Punkte" —
    // on every run, so the steps her phone actually gets had never once been
    // rendered by anything. The geometry was her iPhone's; the name was not.
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1",
    hasTouch: true,
    serviceWorkers: "block",
  });
  await context.addInitScript(fakeDevices, mp3);
  return context.newPage();
}

async function signedInPage(browser, base) {
  const page = await phone(browser);
  await page.goto(base);
  await page.getByLabel("Name").fill(HANDLE);
  await page.getByLabel("PIN, sechs Ziffern").fill(PIN);
  await page.locator("button.btn-primary").click();
  await page.waitForSelector("nav.tabbar", { timeout: 90000 });
  return page;
}

// ── the screens ────────────────────────────────────────────────────────
// Each starts from a fresh load of the app, signed in, on the deck list.

const tab = (name) => async (page) => page.locator("nav.tabbar button", { hasText: name }).click();
const deck = (name) => async (page) => page.locator("button.deck-row", { hasText: name }).first().click();
const tapText = (text) => async (page) => page.getByRole("button", { name: text, exact: true }).first().click();
const way = (name) => async (page) => page.locator("button.deck-way", { hasText: name }).click();
const beginner = async (page) => {
  await page.evaluate(() =>
    fetch("/kotoba/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ beginner: true }) }),
  );
  await page.reload();
  await page.waitForSelector("nav.tabbar");
  await page.waitForTimeout(800);
};
/** Answers one card of 選ぶ, so leaving asks first (with nothing answered it just leaves). */
async function answerOne(page) {
  await page.locator(".opt").first().click();
  await page.waitForTimeout(400);
  const next = page.getByRole("button", { name: "Weiter", exact: true });
  if (await next.count()) await next.click();
  await page.waitForTimeout(2800);
}
/**
 * Answers until the session ends — Hiragana's five new cards a day. Since
 * #273 the end can be the streak screen first: the tour account's answers
 * take the day to ten, and it comes before the summary.
 */
async function finish(page) {
  for (let i = 0; i < 20 && !(await page.locator(".summary, .streak-screen").count()); i++) await answerOne(page);
}
/** #273: past the streak screen, to the summary it leads to. */
async function pastStreak(page) {
  const go = page.getByRole("button", { name: "Fortfahren", exact: true });
  if (await go.count()) await go.click();
}
const idle = (ms) => async (page) => page.waitForTimeout(ms);

/** Turns the card, whatever the mode asks for first. */
async function reveal(page) {
  const record = page.locator(".answer-dial");
  if (await record.count()) {
    await record.click();
    await page.waitForTimeout(300);
    await record.click();
    await page.waitForTimeout(300);
  }
  for (const name of ["Antwort zeigen", "Umdrehen", "Prüfen"]) {
    const b = page.getByRole("button", { name, exact: true });
    if (await b.count()) return b.first().click();
  }
  const typed = page.locator("input.type-answer, .card-area input");
  if (await typed.count()) {
    await typed.first().fill("taberu");
    return typed.first().press("Enter");
  }
  const option = page.locator(".opt");
  if (await option.count()) return option.first().click();
}

/** The name of a way of practising, and what its button on the deck page
 *  says since v149 (START_LABELS in client/src/screens/practise.js). */
const MODES = [
  ["Bedeutung wählen", "Bedeutungen wählen"],
  ["Nur hören", "Karten anhören"],
  ["Laut sagen", "Karten laut sagen"],
  ["Japanisch tippen", "Wörter tippen"],
  ["Karte umdrehen", "Karten umdrehen"],
];

export const SCREENS = [
  // Signed out, in a browser of its own: the tour signs in first, so it had
  // never seen these two — which is how the metro line survived on sign-in
  // until Henning found it (v148).
  { name: "Anmeldung", steps: [], fresh: true },
  { name: "Einladung", steps: [], fresh: true, path: `?einladung=${TOUR_INVITE}` },
  { name: "Decks", steps: [] },
  { name: "Kaishi", steps: [deck("Kaishi")] },
  { name: "Kaishi · Optionen", steps: [deck("Kaishi"), tapText("Optionen")] },
  { name: "Kaishi · Nach Thema üben", steps: [deck("Kaishi"), (p) => p.locator("button.deck-more").click()] },
  ...MODES.flatMap(([mode, button]) => [
    { name: `${mode} · vorne`, steps: [deck("Kaishi"), way(button), idle(1500)] },
    { name: `${mode} · Rückseite`, steps: [deck("Kaishi"), way(button), idle(1500), reveal, idle(900)] },
  ]),
  { name: "Übung verlassen?", steps: [deck("Kaishi"), way("Bedeutungen wählen"), idle(1200), answerOne, (p) => p.locator("button.session-close").click()] },
  { name: "Serie", steps: [deck("Hiragana"), way("Bedeutungen wählen"), idle(1200), finish, idle(1500)] },
  { name: "Zusammenfassung", steps: [deck("Hiragana"), way("Bedeutungen wählen"), idle(1200), finish, idle(1500), pastStreak, idle(1500)] },
  { name: "Hiragana", steps: [deck("Hiragana")] },
  { name: "Hiragana · Zeichen", steps: [deck("Hiragana"), idle(800), (p) => p.locator("button.kana-tile").first().click()] },
  { name: "Eigenes Deck", steps: [deck("Rundgang")] },
  { name: "Eigenes Deck · Karte", steps: [deck("Rundgang"), idle(800), (p) => p.locator("button.deck-card").first().click()] },
  { name: "Eigenes Deck · Neue Karte", steps: [deck("Rundgang"), idle(800), (p) => p.locator(".deck-cards-add").first().click()] },
  { name: "Suche", steps: [tab("Suche")] },
  {
    name: "Suche · Treffer",
    steps: [tab("Suche"), (p) => p.locator("input.browse-search-input").fill("taberu"), idle(1500), (p) => p.locator("button.row-copy").first().click()],
  },
  { name: "Statistik", steps: [tab("Statistik")] },
  { name: "Einstellungen", steps: [tab("Einstellungen")] },
  // #260: the sheet the travellers are sent to. It is the only screen written
  // entirely from a screenshot of someone else's phone, so it is the one most
  // worth drawing here — the client suite can only test installSteps() as a
  // function, because it has no DOM. Reached from Einstellungen, which is
  // where it lives after the one automatic offer.
  { name: "Zum Home-Bildschirm", steps: [tab("Einstellungen"), tapText("Anleitung")] },
  // #260 follow-up: the same sheet as it arrives by itself, which is the only
  // form that carries "Nicht mehr zeigen" — from Einstellungen the sheet was
  // asked for, so switching it off there would mean nothing. Opened directly
  // for the same reason as the one below: the automatic offer comes once per
  // device, and the tour's device has been told already.
  {
    name: "Zum Home-Bildschirm · von selbst",
    steps: [
      tab("Einstellungen"),
      async (page) =>
        page.evaluate(async () => {
          const m = await import("./src/install.js");
          m.openInstallHint("start");
        }),
      idle(300),
    ],
  },
  // #99: the sheet that asks for the notification permission on a start. The
  // tour cannot reach it the way she does — it needs the reminder on *and* a
  // device that could still be asked, and Playwright's WebKit reports the
  // state of an iPhone outside the home-screen app, where asking leads
  // nowhere. So it is opened directly, with a stand-in for the system dialog
  // that answers "denied": the buttons are what this checks.
  {
    name: "Erinnerung erlauben",
    steps: [
      tab("Einstellungen"),
      async (page) =>
        page.evaluate(async () => {
          const m = await import("./src/remind-offer.js");
          m.openReminderOffer({ onEnable: async () => "denied" });
        }),
      idle(300),
    ],
  },
  { name: "Einstieg · Decks", steps: [beginner] },
  { name: "Reise 1", steps: [beginner, deck("Reise 1")] },
  { name: "Reise 1 · vorne", steps: [beginner, deck("Reise 1"), way("Karten laut sagen"), idle(1500)] },
  { name: "Reise 1 · Romaji gezeigt", steps: [beginner, deck("Reise 1"), way("Karten laut sagen"), idle(1500), tapText("Romaji zeigen")] },
  {
    name: "Reise 1 · Rückseite nach Romaji",
    steps: [beginner, deck("Reise 1"), way("Karten laut sagen"), idle(1500), tapText("Romaji zeigen"), reveal, idle(900)],
  },
];

// ── measuring ──────────────────────────────────────────────────────────

const PRESSABLE = 'button, [role="button"], [role="switch"], a[href]';

/** One line per button on screen: what it is, and how to find it again. */
async function buttonsOn(page) {
  return page.evaluate((sel) => {
    const t = window.__tour;
    return [...document.querySelectorAll(sel)].filter(t.visible).map((n) => ({
      label: t.label(n),
      kind: t.kind(n),
      disabled: n.disabled || n.getAttribute("aria-disabled") === "true",
    }));
  }, PRESSABLE);
}

/**
 * Marks the button to press, found by what it is rather than where it was:
 * a list that grows while scrolling redraws its rows, and a handle taken
 * before that points at a row that is no longer there. Returns whether it is
 * there and whether a finger could reach it (not under a sheet).
 */
async function markButton(page, button) {
  return page.evaluate(
    ([sel, kind, label]) => {
      const t = window.__tour;
      for (const n of document.querySelectorAll("[data-tour]")) n.removeAttribute("data-tour");
      const all = [...document.querySelectorAll(sel)].filter(t.visible);
      // A session draws its cards in a new order each time, so a card's star
      // or answer carries another word on the next visit: the same kind of
      // button is the same button.
      const n = all.find((m) => t.kind(m) === kind && t.label(m) === label) ?? all.find((m) => t.kind(m) === kind);
      if (!n) return "gone";
      n.dataset.tour = "1";
      const r = n.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !hit || r.top + r.height / 2 > innerHeight || r.top + r.height / 2 < 0 || n.contains(hit) ? "ok" : "covered";
    },
    [PRESSABLE, button.kind, button.label],
  );
}

async function measure(page, button) {
  if ((await markButton(page, button)) === "gone") return { error: "nicht wiedergefunden" };
  // To the middle of the screen: at the bottom edge, the floating tab bar is
  // over it, and a finger would not press it there either.
  await page.evaluate(() => document.querySelector('[data-tour="1"]')?.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(150);
  const where = await markButton(page, button);
  if (where === "gone") return { error: "nicht wiedergefunden" };
  if (where === "covered") return { skipped: "verdeckt – hier nicht erreichbar" };
  const before = await page.evaluate(() => {
    window.__press = null;
    return window.__sounds;
  });
  await page.locator('[data-tour="1"]').tap({ timeout: 5000 });
  await page.waitForTimeout(300);
  const press = await page.evaluate(() => window.__press);
  const sounds = await page.evaluate(() => window.__sounds);
  // The same button after the redraw, if the screen still has it: whether it
  // pulses while the sound its tap started is running. Gone means another
  // screen opened, whose sound is not this button's.
  const playing = await page.evaluate(
    ([sel, kind, label]) => {
      const t = window.__tour;
      const marked = document.querySelector('[data-tour="1"]');
      const n = marked ?? [...document.querySelectorAll(sel)].find((m) => t.visible(m) && t.kind(m) === kind && t.label(m) === label);
      if (!n) return undefined;
      // What has to be visible is that something plays, on whichever ♪ it
      // belongs to: an answer in 選ぶ starts the word, and the word's ♪ is what
      // pulses, not the answer.
      if (n.classList.contains("playing")) return "here";
      return document.querySelector(".playing") ? "elsewhere" : "none";
    },
    [PRESSABLE, button.kind, button.label],
  );
  const started = sounds > before && playing !== undefined;
  return {
    ring: press ? press.tapped && press.moving : "kein Klick",
    sound: started,
    pulse: started ? (playing === "here" ? true : playing === "elsewhere" ? "am ♪ der Karte" : false) : null,
  };
}

let restore = () => {};

async function go(page, base, screen) {
  restore();
  // Pressing "Konto anlegen" really does make one and sign it in, so the
  // signed-out screens start from no cookie every time.
  if (screen.fresh) await page.context().clearCookies();
  await page.goto(base + (screen.path ?? ""));
  // A signed-out screen has no tab bar; it has its own form.
  await page.waitForSelector(screen.fresh ? ".signin" : "nav.tabbar", { timeout: 60000 });
  await page.waitForTimeout(800);
  for (const step of screen.steps) {
    await step(page);
    await page.waitForTimeout(500);
  }
}

// ── the tour ───────────────────────────────────────────────────────────

const { base, children, dbPath } = await prepare();
// Stopped from outside, the servers go too — a stray server here would hold a port and a database copy.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    for (const c of children) c.kill();
    process.exit(130);
  });
}
const results = [];
let browser;
try {
  await seed(base);
  restore = snapshot(dbPath);
  browser = await webkit.launch();
  const page = await signedInPage(browser, base);
  // A second browser that never signed in, for the screens that only exist
  // signed out. Made once, on the first such screen.
  let guest;
  const pageFor = async (screen) => {
    if (!screen.fresh) return page;
    guest ??= await phone(browser);
    return guest;
  };
  const seen = new Set();
  const screens = args.screen ? SCREENS.filter((s) => args.screen.split(",").includes(s.name)) : SCREENS;
  for (const screen of screens) {
    const on = await pageFor(screen);
    try {
      await go(on, base, screen);
    } catch (err) {
      results.push({ screen: screen.name, error: `nicht erreicht: ${err.message.split("\n")[0]}` });
      await on.screenshot({ path: join(OUT, `nicht-erreicht-${screen.name.replace(/[^\wäöüÄÖÜ]+/g, "-")}.png`) }).catch(() => {});
      continue;
    }
    await on.screenshot({ path: join(OUT, `${screen.name.replace(/[^\wäöüÄÖÜ]+/g, "-")}.png`) });
    const buttons = await buttonsOn(on);
    // Forty days of the calendar or a hundred kana tiles are one component
    // each: three of a kind are pressed, the rest are counted.
    const ofKind = new Map();
    for (const b of buttons) {
      const key = `${b.kind}|${b.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const n = (ofKind.get(b.kind) ?? 0) + 1;
      ofKind.set(b.kind, n);
      if (n > PER_KIND) continue;
      const row = { screen: screen.name, ...b };
      if (b.disabled) row.skipped = "gesperrt";
      else if (NOT_PRESSED.some((re) => re.test(b.label))) row.skipped = "nicht gedrückt";
      else {
        try {
          await go(on, base, screen);
          Object.assign(row, await measure(on, b));
        } catch (err) {
          row.error = err.message.split("\n")[0];
        }
      }
      results.push(row);
      process.stdout.write(`${row.error ? "?" : row.skipped ? "-" : row.ring === false || row.pulse === false ? "✗" : "✓"}`);
    }
    for (const [kind, n] of ofKind) {
      if (n > PER_KIND) results.push({ screen: screen.name, label: `… und ${n - PER_KIND} weitere derselben Art`, kind, skipped: "gleiche Art, nicht einzeln gedrückt" });
    }
  }
} finally {
  await browser?.close();
  for (const c of children) c.kill();
}

const failing = results.filter((r) => r.ring === false || r.pulse === false);
const unsure = results.filter((r) => r.error);
const mark = (v) => (v === true ? "ja" : v === false ? "**NEIN**" : v === null || v === undefined ? "–" : v);
writeFileSync(join(OUT, "report.json"), JSON.stringify(results, null, 2));
writeFileSync(
  join(OUT, "report.md"),
  [
    `# Rundgang (#255)`,
    ``,
    `${results.filter((r) => r.label !== undefined && !r.label.startsWith("…")).length} Knöpfe auf ${new Set(results.map((r) => r.screen)).size} Bildschirmen · ${failing.length} ohne Rückmeldung · ${unsure.length} nicht messbar`,
    ``,
    `| Bildschirm | Knopf | Art | Drücken | Ton | Puls | Anmerkung |`,
    `|---|---|---|---|---|---|---|`,
    ...results.map((r) =>
      `| ${r.screen} | ${r.label ?? ""} | \`${r.kind ?? ""}\` | ${mark(r.ring)} | ${r.sound ? "ja" : "–"} | ${mark(r.pulse)} | ${r.skipped ?? r.error ?? ""} |`,
    ),
  ].join("\n"),
);
console.log(`\n${results.length} Zeilen, ${failing.length} ohne Rückmeldung, ${unsure.length} nicht messbar → ${OUT}/report.md`);
process.exitCode = failing.length ? 1 : 0;
