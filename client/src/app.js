import { ApiError, OfflineError, api, isSessionExpired, onSessionExpired } from "./api.js";
import { signInScreen } from "./screens/signin.js";
import { signedOutScreen } from "./screens/signed-out.js";
import { updateSheet } from "./screens/update-sheet.js";
import { practiseScreen } from "./screens/practise.js";
import { decksScreen } from "./screens/decks.js";
import { deckOptionsSheet } from "./screens/deck-options.js";
import { jokerSpentScreen, statsScreen, streakResetScreen } from "./screens/stats.js";
import { browseScreen } from "./screens/browse.js";
import { cardTopicsSheet } from "./screens/card-topics.js";
import { addWordScreen } from "./screens/own-deck.js";
import { cardActionsSheet, deckCardsBlock, deckNameSheet } from "./screens/deck-cards.js";
import { kanaCardSheet, kanaGridBlock } from "./screens/kana-deck.js";
import { firstRunScreen } from "./screens/first-run.js";
import { DEFAULT_FILTERS, activeLabel, chooseSetScreen, isDefault, scopeOf } from "./screens/choose-set.js";
import { sessionScreen } from "./screens/session.js";
import { settingsScreen } from "./screens/settings.js";
import { summaryScreen } from "./screens/summary.js";
import { flush, offlineStatus, pending, startFlushing, subscribe } from "./outbox.js";
import { setStar, startFlushingStars } from "./stars.js";
import { cardCount, clearPersonal, getMeta, setMeta } from "./store.js";
import { deckCatchingUp, loadDeck, syncDeck } from "./deck.js";
import { forget, openSession } from "./resume.js";
import { SHELL_VERSION } from "./shell-version.js";
import { applyUpdate, lastSeen, markSeen, readChangelog, watchForUpdates } from "./update.js";
import { watchViewport } from "./viewport.js";
import { notesSince, startingPoint, versionNumber } from "./whats-new.js";
import { el, render } from "./ui/dom.js";
import { appName } from "./script.js";
import { seen } from "./seen.js";
import { declinePush, enablePush, pushState, refreshPush } from "./push.js";
import { deckTopics } from "./topics.js";
import { stopAllRecording } from "./recording.js";

// #123: four, where design 11 draws three. Words is where she searches, stars
// and adds words; each of those used to be reached from somewhere else, and
// Browse from three places. Settings keeps only what configures the app.
const TABS = [
  // #137: named for what they hold now. Practise starts from her decks, and a
  // deck is also where its cards are added; Words is left with finding a word
  // across all of them, and the stars.
  { key: "practise", label: "Decks" },
  { key: "words", label: "Suche" },
  { key: "stats", label: "Statistik" },
  { key: "settings", label: "Einstellungen" },
];

const app = document.getElementById("app");

/** Reise 1 and 2 (#252), the decks Einstieg lists. */
const isTravelDeck = (key) => typeof key === "string" && key.startsWith("travel:");

/**
 * The most one sitting asks — MAX_SESSION_LENGTH on the server. Since v74 there
 * is no "How long" (#123, reversed): a session is the deck's cards for today,
 * as in Noji, which the server keeps to the deck's "Max cards per day" if she
 * set one. She can stop at any time, and Carry on keeps the rest.
 */
const SESSION_MAX = 60;

/*
 * There is no sidebar any more (#159, v76). v72 (#151) drew the tabs and her
 * decks beside the deck on a landscape iPad, and the deck in two columns.
 * Charlotte wants one screen at a time, as in Noji — "Einzelscreen keine
 * Kombination, alles auf Klarheit" — so a landscape iPad is the same page as
 * an upright one: the tab bar, one column, "‹ Decks" back to the list. Do not
 * bring the split back as an improvement; it was tried and she chose this.
 */

// Before the first render: the shell's height depends on `--viewport-h`, and a
// first paint at the wrong height is the bug this fixes.
watchViewport();

const state = {
  user: undefined,
  tab: "practise",
  // A session is modal: it replaces the tabs entirely, so a card is never
  // covered and the tab bar never competes with an answer.
  session: undefined,
  summary: undefined,
  // The Words tab (#123; Browse, 31). Held as a node rather than rebuilt with
  // the other tabs, for the same reason the session is: rebuilding it on an
  // unrelated redraw would throw away her search, her scroll position and the
  // page of results underneath it. Built fresh each time she comes to the tab.
  words: undefined,
  // What the "Choose a set" sheet last held (36). Kept here rather than in the
  // practise tab because it outlives it: tapping a line starts a session with
  // these, and the session that runs says so (39).
  filters: { ...DEFAULT_FILTERS },
  // The deck whose page is open, as /api/decks describes it — key, name,
  // counts, `ways` and its own `settings` (#137) — or undefined on the deck
  // list. Not kept across starts: like Noji, the app opens on the decks.
  deck: undefined,
  // The sign-in screen's name for the app, from the settings this device last
  // saw (#139). Set at boot and by keepSettings.
  signInScript: true,
  topics: [],
  sheet: undefined,
  // `overlay` is the card form or the card-topics sheet, which take the screen.
  overlay: undefined,
  // The open deck's card list (#137), kept across rebuilds of the page so a
  // search she is typing is not wiped by a count arriving: `{ key, block }`.
  deckCards: undefined,
  // The last deck list, for names: "Move to" and a resumed session's deck.
  lastDecks: [],
  // 51: an unfinished session, if there is one worth offering.
  resumable: undefined,
  // 49: this device has no deck yet, so the first thing after signing in is
  // getting one.
  firstRun: false,
  // The server's copy of the settings, so the sound note and the script
  // agree with the Settings screen on every device. Held here rather
  // than fetched per screen because the practice tab needs it before the
  // Settings tab has ever been opened.
  //
  // Also kept on the device (`keepSettings`), since #133/#135: an offline
  // start used to fall back to these defaults, which was invisible while the
  // settings were about sound — and would put back the Japanese script and
  // every line she had hidden, on exactly the train with no signal.
  settings: {
    newPerDay: 15,
    sessionLength: 20,
    readAloud: true,
    pitchAccent: false,
    romaji: false,
    speakSource: "sentence",
    japaneseScript: true,
    hiddenModes: [],
    // #137, v65: the default Henning chose, and what index.html drew with.
    appearance: "light",
    recordingEnabled: true,
    // #252: Einstieg — the deck list is Reise 1 and 2 (server/src/queue.js).
    beginner: false,
  },
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
  // Design 11: the diamond on Stats "the first time a new joker is earned,
  // cleared once the tab is opened" (#86). Kept in meta as well, so quitting
  // the app before looking does not lose it.
  jokerBadge: false,
  // Designs 04/19 (#86) and 08/20 (#89): the notice being shown — a joker
  // covered the gap, or the gap ended the streak — and the last one already
  // shown. The second is also in meta; holding it here too means a device
  // without IndexedDB sees the notice once per run rather than on every redraw
  // of the practise tab.
  jokerNotice: undefined,
  jokerNoticed: undefined,
  // #93: the update sheet, built once and kept so "More info" stays open
  // across the redraws the outbox triggers. `updateDeferred` is the version
  // she said Later to: asked again on the next launch, not on every return
  // from the background.
  update: undefined,
  updateNode: undefined,
  updateDeferred: undefined,
  // #103: the version downloaded and waiting, `{ worker, version, entries }`,
  // kept after Later so Settings can still offer it — Later used to leave no
  // way to update until the app was next started.
  waiting: undefined,
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

/**
 * Swap the strip in place, on the screens that draw one first (the tabs and
 * 52), for a change of connection state that should not rebuild
 * the screen under it. Anywhere else the next redraw picks it up.
 */
function replaceOfflineBar() {
  if (!app.querySelector(":scope > nav.tabbar, :scope > .signed-out")) return false;
  const current = app.querySelector(":scope > .offline-bar");
  const next = offlineBar();
  if (current && next) current.replaceWith(next);
  else if (current) current.remove();
  else if (next) app.prepend(next);
  return true;
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
          onclick: () => goToTab(tab.key),
        },
        // Inside the label, so it hangs off the word however wide the word is.
        el("span.label", {}, tab.label, state.jokerBadge && tab.key === "stats" ? el("span.joker-badge") : null),
      ),
    ),
  );
}

function goToTab(key) {
  // Leaving Settings mid mic-test used to leave its stream running — nothing
  // else calls `stop()` on it once its screen is gone (#185, recording.js).
  if (state.tab === "settings" && key !== "settings") stopAllRecording();
  if (key === "stats" && state.jokerBadge) {
    state.jokerBadge = false;
    setMeta("joker.badge", false);
  }
  // #106: coming back to the tab is a moment to recount — the day may have
  // turned while she was on Stats.
  if (key === "practise" && state.tab !== "practise") numbersChanged();
  // Tapping Practise on a deck page goes back to the decks, the way a tab bar
  // does on iOS.
  else if (key === "practise") closeDeck();
  // Arriving at Words starts from its idle list; staying on it keeps her search.
  if (key === "words" && state.tab !== "words") state.words = undefined;
  state.tab = key;
  state.overlay = undefined;
  renderApp();
}

function currentScreen() {
  if (state.tab === "practise" && !state.deck) {
    return decksScreen({
      decks: deckList(),
      onOpen: openDeck,
      // #252: Einstieg lists no decks of her own to add to.
      onNewDeck: state.settings.beginner ? undefined : openNewDeck,
      // …and no session to carry on from a deck it hides.
      resumable: state.settings.beginner && !isTravelDeck(state.resumable?.filters?.deckKey) ? undefined : state.resumable,
      beginner: state.settings.beginner,
      onResume: resumeSession,
      japanese: state.settings.japaneseScript,
      scrollTop: app.querySelector(":scope > .practise")?.scrollTop ?? 0,
    });
  }
  if (state.tab === "practise") {
    return practiseScreen({
      deck: state.deck,
      onBack: closeDeck,
      onOptions: openDeckOptions,
      readAloud: state.settings.readAloud,
      japanese: state.settings.japaneseScript,
      hiddenModes: state.deck?.settings?.hiddenModes ?? [],
      cardsBlock: deckCards(),
      onAddCard: state.deck?.own ? openAddCard : undefined,
      // Best effort for the sound switch under the lines: muting on a train
      // with no signal should still mute this session.
      onReadAloud: (on) => {
        keepSettings({ ...state.settings, readAloud: on });
        api.updateSettings({ readAloud: on }).catch(() => {});
      },
      // 36: "tapping a line still starts a session with whatever the sheet
      // last held, so the two-tap path survives."
      // A line carries only its mode, and runs whatever the sheet last held.
      // An offer from the nothing-due block carries `only` as well (#90): it
      // is its own set — "cards due in the next two days", "recent mistakes" —
      // and not a narrowing of the sheet's. Taking just `{ mode }` from it
      // dropped the `only` on the floor, so both offers started the day's
      // queue, which on that screen is empty by definition, and the tap did
      // nothing at all (measured on the live app, 2026-09-13).
      //
      // Both stay inside the deck or list she practises in (#137): the outlook
      // that counted the offer was counted there too.
      onStart: ({ mode, only } = {}) =>
        startSession(
          only
            ? { mode, ...DEFAULT_FILTERS, ...scopeOf(state.filters), only }
            : { mode, ...state.filters },
        ),
      filters: state.filters,
      // #252: a Reise deck is one way of practising and nothing to narrow —
      // the sheet's Start would begin a session in a way the deck does not have.
      onChooseSet: isTravelDeck(state.deck?.key) ? undefined : openSheet,
      onDrillTopic: openSheet,
      topicsHere: topicsHere(),
      // #179: one more batch of new cards into today. The deck's own settings
      // are kept in step so the page can say how big the next batch is, and
      // the numbers are thrown away so the page redraws with cards on it.
      onReleaseNew: () =>
        api
          .releaseNewCards(state.deck.key)
          .then(({ settings }) => {
            if (state.deck) state.deck = { ...state.deck, settings };
          })
          .catch(() => {})
          .finally(() => {
            numbersChanged();
            renderApp();
          }),
      numbers: practiseNumbers(),
      // #118: a rebuild used to put her back at the top — under her finger,
      // mid-swipe, whenever the settings, the own-deck count or a sync
      // arrived. Read before render() replaces the old tab.
      scrollTop: app.querySelector(":scope > .practise")?.scrollTop ?? 0,
    });
  }
  if (state.tab === "words") return (state.words ??= wordsScreen());
  // "Cards seen" leads to the words behind the number.
  if (state.tab === "stats") return statsScreen({ onBrowse: () => goToTab("words") });
  return settingsScreen({
    user: state.user,
    // #103: only while a version waits. Update here is the same swap as the
    // sheet's, without asking again: tapping it is the answer.
    update: state.waiting && {
      version: state.waiting.version,
      entries: state.waiting.entries,
      onUpdate: () => applyUpdate(state.waiting.worker, state.waiting.version),
    },
    onSettings: keepSettings,
    onSignOut: async () => {
      // Leaves Settings the same way goToTab() does when she taps another
      // tab — but this path never went through goToTab(), so a mic test
      // left running here survived signing out entirely (code review,
      // 2026-09-17).
      stopAllRecording();
      state.user = undefined;
      // Her decks are hers (#137); whoever signs in next starts on the list.
      state.filters = { ...DEFAULT_FILTERS };
      state.deck = undefined;
      state.deckCards = undefined;
      state.lastDecks = [];
      numbersChanged();
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
 * The practise tab's numbers — the day's queue and the stats — asked once and
 * shared by every rebuild of the tab (#106).
 *
 * The tab is rebuilt by nearly everything: the settings arriving, the own-deck
 * count arriving, the outbox, the Synced strip clearing itself. It used to ask
 * `/api/queue` and `/api/stats` each time, so a normal start sent both three
 * times (measured on the live app, v41), on metered data, and every rebuild
 * showed "…" until they came back.
 *
 * Asked again when something that changes them has happened —
 * `numbersChanged()` — or when the answer is a minute old, so a tab rebuilt
 * much later does not show a count from earlier in the day. A failed answer is
 * not kept, so the next rebuild tries again; one still in flight is, so a
 * rebuild on a stalled connection does not start a second wait (v41's
 * `replaceOfflineBar()` exists for the same reason).
 */
const NUMBERS_KEPT_MS = 60 * 1000;
let numbers;

function practiseNumbers() {
  if (numbers && Date.now() - numbers.at < NUMBERS_KEPT_MS) return numbers.promise;
  const entry = {
    at: Date.now(),
    // Inside the open deck (#137), which is what a line runs.
    promise: Promise.all([api.queue({ limit: 60, ...scopeOf(state.filters) }), api.stats()]).then(([queue, stats]) => {
      // #86: the joker notice is decided from these same numbers, so they are
      // not fetched twice.
      considerJokerNotice(stats);
      return {
        due: queue.cardIds.length,
        today: queue.today,
        outlook: queue.outlook,
        maxReached: queue.maxReached,
        // #159: the open deck in Noji's three bands.
        progress: queue.progress,
        stats,
      };
    }),
  };
  entry.promise.catch(() => {
    if (numbers === entry) numbers = undefined;
  });
  numbers = entry;
  return entry.promise;
}

function numbersChanged() {
  numbers = undefined;
  decks = undefined;
}

/**
 * The deck list's numbers (#137), asked and kept like the deck page's. The
 * last answer is kept on the device, so a start without signal still lists
 * her decks — with yesterday's counts rather than none.
 */
let decks;

function deckList() {
  if (decks && Date.now() - decks.at < NUMBERS_KEPT_MS) return decks.promise;
  const entry = {
    at: Date.now(),
    promise: api.decks().then(
      (answer) => {
        setMeta("decks", answer).catch(() => {});
        state.lastDecks = answer.decks ?? [];
        return answer;
      },
      async (error) => {
        const kept = await getMeta("decks");
        if (kept) {
          state.lastDecks = kept.decks ?? [];
          return kept;
        }
        throw error;
      },
    ),
  };
  entry.promise.catch(() => {
    if (decks === entry) decks = undefined;
  });
  decks = entry;
  return entry.promise;
}

/** Into a deck's page (#137). Anything narrowed in another deck is left behind. */
function openDeck(deck) {
  state.deck = deck;
  state.deckCards = undefined;
  state.filters = { ...DEFAULT_FILTERS, deckKey: deck.key };
  numbersChanged();
  renderApp();
  loadDeckTopics();
}

/**
 * #209: the topics of the open deck of hers, from the cards on this phone —
 * so they are there offline, and counted inside this deck only.
 */
async function loadDeckTopics() {
  const deck = state.deck;
  if (!deck?.own) return;
  const count = (cards) => {
    if (state.deck?.id !== deck.id) return;
    state.deckTopics = { id: deck.id, list: deckTopics([...cards.values()], deck.id) };
    renderApp();
    if (chooseSetOpen()) openSheet();
  };
  try {
    count(await loadDeck());
    // A cached deck comes back before the server's difference does, and the
    // difference is where new topics arrive — the first start after v130 has
    // every one of hers in it. Counted only from the cache, her deck said
    // "Weitere Auswahl" until it was opened again (measured live, v130).
    await deckCatchingUp();
    count(await loadDeck());
  } catch {
    /* no copy of the deck yet: the sheet shows no topics, as before */
  }
}

/** Whether the open deck has topics to choose from: Kaishi's, or hers (#209). */
function topicsHere() {
  if (state.deck?.key === "kaishi") return true;
  return Boolean(state.deck?.own && state.deckTopics?.id === state.deck.id && state.deckTopics.list.length > 0);
}

/**
 * The open deck's options (#137). Written as each control is touched, like
 * Settings, and kept in the open deck at once so the page behind the sheet
 * already shows the change; a write that fails offline is tried again the
 * next time the options change, as the stored list is sent whole.
 */
function openDeckOptions() {
  if (!state.deck) return;
  state.sheet = deckOptionsSheet({
    deck: state.deck,
    japanese: state.settings.japaneseScript,
    onChange: (patch, settings) => {
      state.deck = { ...state.deck, settings };
      numbersChanged();
      api
        .updateDeckSettings(state.deck.key, {
          hiddenModes: settings.hiddenModes,
          newPerDay: settings.newPerDay,
          maxPerDay: settings.maxPerDay ?? null,
        })
        .catch(() => {});
    },
    onRename: state.deck.own ? openRenameDeck : undefined,
    onDelete: state.deck.own ? deleteOpenDeck : undefined,
    onClose: closeSheet,
  });
  renderApp();
}

/** A deck from `/api/decks`' shape, for one just made and not yet counted. */
function emptyDeck({ id, name }) {
  return {
    key: `deck:${id}`,
    id,
    name,
    own: true,
    cards: 0,
    seen: 0,
    today: { total: 0, fresh: 0, review: 0 },
    ways: { choose: 0, listen: 0, speak: 0, type: 0, flip: 0 },
    settings: { hiddenModes: [], newPerDay: 10 },
  };
}

/** What a deck request's failure says, in her words (#137). */
function deckProblem(err, name) {
  if (err instanceof OfflineError) return "Dafür brauchst du Internet: Deine Decks liegen auf dem Server, nicht nur auf diesem Handy.";
  if (err instanceof ApiError && err.status === 409) return `Du hast schon ein Deck namens „${name}“.`;
  return "Das hat nicht geklappt. Versuch es gleich noch einmal.";
}

/** "New deck" on the deck list (#137): a name, then straight into the empty deck. */
function openNewDeck() {
  state.sheet = deckNameSheet({
    title: "Neues Deck",
    action: "Deck anlegen",
    onSubmit: async (name) => {
      try {
        const { deck } = await api.createDeck(name);
        state.sheet = undefined;
        openDeck(emptyDeck(deck));
        return undefined;
      } catch (err) {
        return deckProblem(err, name);
      }
    },
    onClose: closeSheet,
  });
  renderApp();
}

function openRenameDeck() {
  const deck = state.deck;
  state.sheet = deckNameSheet({
    title: "Deck umbenennen",
    name: deck.name,
    action: "Speichern",
    onSubmit: async (name) => {
      try {
        const { deck: renamed } = await api.renameDeck(deck.id, name);
        state.deck = { ...state.deck, name: renamed.name };
        state.deckCards = undefined;
        state.sheet = undefined;
        numbersChanged();
        renderApp();
        return undefined;
      } catch (err) {
        return deckProblem(err, name);
      }
    },
    onClose: closeSheet,
  });
  renderApp();
}

/** Asked in the options sheet first; returns a sentence when it did not happen. */
async function deleteOpenDeck() {
  try {
    await api.deleteDeck(state.deck.id);
  } catch (err) {
    return deckProblem(err, state.deck.name);
  }
  state.sheet = undefined;
  closeDeck();
  await cardsChanged();
  renderApp();
  return undefined;
}

/**
 * The open deck's card list (#137), made once per deck and kept across the
 * page's rebuilds — the page is rebuilt whenever a count or the settings
 * arrive, and a new list each time would lose her search mid-word.
 */
function deckCards() {
  // Her decks, and the kana decks' letters (#208). Not Kaishi (v69): see
  // cardsOfDeck.
  const kana = state.deck?.key === "hiragana" || state.deck?.key === "katakana";
  if (!state.deck?.own && !kana) return undefined;
  if (state.deckCards?.key !== state.deck.key) {
    state.deckCards = {
      key: state.deck.key,
      block: kana
        ? kanaGridBlock({ deck: state.deck, onCard: openKanaCard })
        : deckCardsBlock({
            deck: state.deck,
            japanese: state.settings.japaneseScript,
            onCard: openCardActions,
            onAdd: openAddCard,
          }),
    };
  }
  return state.deckCards.block;
}

/** One kana from the deck's grid (#208): hear it, see its picture, record a native speaker. */
function openKanaCard(card) {
  state.sheet = kanaCardSheet({
    card,
    recordingEnabled: state.settings.recordingEnabled,
    onClose: closeSheet,
  });
  renderApp();
}

/** The open deck's counts again, after one of its cards changed. */
async function refreshOpenDeck({ redraw = true } = {}) {
  const key = state.deck?.key;
  if (!key) return;
  try {
    const { decks: fresh } = await deckList();
    const found = fresh.find((d) => d.key === key);
    if (found && state.deck?.key === key) state.deck = { ...found };
  } catch {
    /* the page keeps the counts it had */
  }
  if (redraw && !state.overlay) renderApp();
}

/**
 * A tap on one of her cards (#137): edit, move, delete — in a deck, and from
 * Search (v69), where `onChanged` redoes the search she is in.
 */
function openCardActions(card, { onChanged, starred, canStar, onStar } = {}) {
  const afterChange = async () => {
    await cardsChanged();
    if (onChanged) {
      onChanged();
      renderApp();
    } else await refreshOpenDeck();
  };
  const bodyOf = (deckId) => ({
    word: card.word,
    reading: card.word_reading || undefined,
    meaning: card.word_meaning,
    sentence: card.sentence || undefined,
    sentenceMeaning: card.sentence_meaning || undefined,
    tags: card.tags ?? [],
    deckId,
  });
  const failed = (err, what) =>
    err instanceof OfflineError
      ? `${what} braucht Internet: Die Karte liegt auf dem Server, nicht nur auf diesem Handy.`
      : `Das hat nicht geklappt. Versuch es gleich noch einmal.`;
  state.sheet = cardActionsSheet({
    card,
    japanese: state.settings.japaneseScript,
    recordingEnabled: state.settings.recordingEnabled,
    // #187: Suche knows the star (the row carries it). From the deck page
    // the sheet reads it from the card's record (2026-09-19).
    starred,
    canStar: onStar ? canStar : true,
    onStar: onStar ?? ((on) => setStar(card.id, on)),
    topicNames,
    onTopics: async (tags) => {
      await api.updateCard(card.id, { ...bodyOf(card.deck_id), tags });
      card.tags = tags;
      // The deck's topic counts and the phone's copy, without closing this
      // sheet: the list under it is redrawn, the sheet stays.
      await cardsChanged();
      if (onChanged) onChanged();
      renderApp();
    },
    decks: state.lastDecks.filter((d) => d.own && d.id !== card.deck_id),
    onEdit: () => {
      state.sheet = undefined;
      openEditCard(card, { onChanged });
    },
    onMove: async (_, deck) => {
      try {
        await api.updateCard(card.id, bodyOf(deck.id));
      } catch (err) {
        return failed(err, "Eine Karte verschieben");
      }
      state.sheet = undefined;
      await afterChange();
      return undefined;
    },
    onDelete: async () => {
      try {
        await api.deleteCard(card.id);
      } catch (err) {
        return failed(err, "Eine Karte löschen");
      }
      state.sheet = undefined;
      await afterChange();
      return undefined;
    },
    onClose: closeSheet,
  });
  renderApp();
}

function closeDeck() {
  if (!state.deck) return;
  state.deck = undefined;
  state.deckCards = undefined;
  state.filters = { ...DEFAULT_FILTERS };
  state.sheet = undefined;
  numbersChanged();
  renderApp();
}

/**
 * Designs 04/19 (#86): whether the practise tab's fresh stats call for the
 * joker notice. The server only reports `jokerGap` on the first day after a
 * covered gap; this makes it once per gap on this device.
 */
async function considerJokerNotice(stats) {
  // #89: a gap that ended the streak is the same moment with the other screen
  // (design 08). The server never reports both for one gap.
  const kind = stats?.jokerGap ? "joker" : stats?.streakReset ? "reset" : undefined;
  if (!kind) return;
  const gap = kind === "joker" ? stats.jokerGap : stats.streakReset;
  const key = `${kind}:${gap.lastDay}`;
  if (state.jokerNotice || state.jokerNoticed === key) return;
  // The joker key predates #89 and stays as it was, so a device that has
  // already seen a notice is not shown it again after this update.
  const metaKey = kind === "joker" ? "joker.noticed" : "streak.reset.noticed";
  if ((await getMeta(metaKey)) === gap.lastDay) {
    state.jokerNoticed = key;
    return;
  }
  // Only over the practise tab as it stands: never over a session, a summary,
  // an open sheet or a form she is typing into.
  if (state.tab !== "practise" || state.session || state.summary || state.overlay || state.sheet) {
    return;
  }
  state.jokerNotice = { stats, kind, key, metaKey, lastDay: gap.lastDay };
  renderApp();
}

function dismissJokerNotice() {
  const { key, metaKey, lastDay } = state.jokerNotice;
  state.jokerNoticed = key;
  state.jokerNotice = undefined;
  setMeta(metaKey, lastDay);
  renderApp();
}

/**
 * 36. The sheet sits over the practise tab rather than replacing it, so the
 * tab underneath is rendered first and this is appended on top.
 */
function openSheet() {
  state.sheet = chooseSetSheet = chooseSetScreen({
    filters: state.filters,
    topics: state.deck?.own ? (state.deckTopics?.list ?? []) : state.topics,
    showTopics: topicsHere(),
    sessionLength: SESSION_MAX,
    // #120: what the sheet holds is the set, Start or no Start. Written here
    // on every tap rather than on close, because loadTopics() below rebuilds
    // the sheet from state.filters — a tap made before the topics arrived
    // would otherwise be undone by the redraw.
    onChange: keepFilters,
    onClose: closeSheet,
    onApply: (filters) => {
      keepFilters(filters);
      closeSheet();
      startSession({ ...filters });
    },
  });
  renderApp();
  loadTopics();
}

/**
 * The choose-set sheet, while it is the one open. Topic counts arriving late
 * rebuild *that* sheet; before 2026-09-19 they rebuilt whatever sheet was
 * open, so saving a topic from a card's sheet would have swapped it for this
 * one.
 */
let chooseSetSheet;
const chooseSetOpen = () => state.sheet !== undefined && state.sheet === chooseSetSheet;

/** Every topic in use, for a card sheet's "+ Thema" (ui/card-marks.js). */
async function topicNames() {
  if (state.topics.length === 0) state.topics = (await api.stats()).topics ?? [];
  return state.topics.map((t) => t.tag);
}

/** What the sheet holds becomes the set (#120), inside the open deck (#137). */
function keepFilters(filters) {
  state.filters = { ...filters, ...scopeOf(state.filters) };
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
    if (chooseSetOpen()) {
      // Redraw the sheet now that the chips have something to show.
      openSheet();
    }
    if (state.topicsFor) {
      openCardTopics(state.topicsFor.card, state.topicsFor.list);
    }
  } catch {
    /* the sheet works without them; the topic row is just "Any" */
  }
}

/**
 * 28/29, inside a deck (#137). Takes the screen: it is a form, and a tab bar
 * under a keyboard is noise. "Save and add next" keeps it open; Save goes back
 * to the deck, where the new card is at the top of its list.
 */
function openAddCard() {
  const deck = state.deck;
  if (!deck?.own) return;
  state.overlay = addWordScreen({
    tags: state.topics.map((t) => ({ tag: t.tag, n: t.total ?? t.n ?? 0 })),
    deck: { id: deck.id, name: deck.name },
    japanese: state.settings.japaneseScript,
    onCancel: closeOverlay,
    onSaved: async (_, { next = false } = {}) => {
      if (!next) state.overlay = undefined;
      await cardsChanged();
      // Redraws only once the form is closed: after "Save and add next" she may
      // tap Cancel before the count arrives, and the page under it must not
      // stay the empty deck it was.
      await refreshOpenDeck();
    },
  });
  loadTopics();
  renderApp();
}

/**
 * #85: one of her cards, opened from its deck or from Search (v69). Saving or
 * deleting goes back to where she came from.
 */
function openEditCard(card, { onChanged } = {}) {
  const back = async () => {
    state.overlay = undefined;
    await cardsChanged();
    if (onChanged) {
      onChanged();
      renderApp();
    } else await refreshOpenDeck();
  };
  const deck = state.lastDecks.find((d) => d.own && d.id === card.deck_id);
  state.overlay = addWordScreen({
    tags: state.topics.map((t) => ({ tag: t.tag, n: t.total ?? t.n ?? 0 })),
    card,
    deck: deck ? { id: deck.id, name: deck.name } : undefined,
    japanese: state.settings.japaneseScript,
    onCancel: closeOverlay,
    onSaved: back,
    onDeleted: back,
  });
  loadTopics();
  renderApp();
}

/**
 * After a card was added, changed, moved or deleted: the counts, the topic
 * list (a card can bring a new topic or take the last card out of one), the
 * deck list, and the cards on this phone — without that last one the next
 * session cannot see the change until the app is restarted (#85). Settles once
 * the phone has the change, so the deck's list is drawn with it.
 */
function cardsChanged() {
  numbersChanged();
  state.deckCards = undefined;
  state.topics = [];
  loadTopics();
  // A card can bring a topic into its deck or take the last one out (#209).
  const synced = syncDeck();
  synced.then(loadDeckTopics, () => {});
  return synced;
}

function closeOverlay() {
  state.overlay = undefined;
  renderApp();
}

/** The Search tab (#123, #137): every deck searched, and the stars. */
function wordsScreen() {
  return browseScreen({
    romaji: state.settings.romaji,
    japanese: state.settings.japaneseScript,
    // #35: tapping a Kaishi row files it under one of her own topics.
    onTopics: openCardTopics,
    // v69: one of hers opens what it opens in its deck. A row carries only
    // what the list shows, so the card comes from the phone, where it has its
    // sentence: an edit from the row would have saved the card without it.
    onOwnCard: async (row, list) => {
      if (state.lastDecks.length === 0) await deckList().catch(() => {});
      const cached = async () => (await loadDeck().catch(() => new Map())).get(row.id);
      // Written on another phone since this one last synced: fetch it first.
      let card = await cached();
      if (!card) {
        await syncDeck().catch(() => {});
        card = await cached();
      }
      if (card) return openCardActions(card, { onChanged: list.changed, starred: list.starred, canStar: list.canStar, onStar: list.star });
      // Not on this phone and no way to fetch it: say so, rather than a tap
      // that does nothing — which is what this replaced.
      state.sheet = el(
        "div.sheet-scrim.card-actions",
        { onclick: (e) => e.target === e.currentTarget && closeSheet() },
        el(
          "div.sheet",
          { role: "dialog" },
          el("h2.sheet-title", { text: row.word_meaning ?? "" }),
          el("p.sheet-body", { text: "Diese Karte ist noch nicht auf diesem Handy. Geh einmal ins Internet und versuch es dann noch einmal." }),
          el("div.sheet-actions", {}, el("button.btn.solid", { type: "button", text: "OK", onclick: closeSheet })),
        ),
      );
      renderApp();
    },
  });
}

/**
 * Her topics for one card (#35).
 *
 * An overlay above Browse rather than a replacement for it: it is a decision
 * about one row of the list behind it, and taking the screen would lose the
 * search she may have typed to get there.
 */
function openCardTopics(card, list = {}) {
  // Kept so loadTopics can rebuild this sheet if the list arrives after it
  // opened — the same trick openSheet uses, for the same reason.
  state.topicsFor = { card, list };
  state.overlay = cardTopicsSheet({
    card,
    topics: state.topics,
    japanese: state.settings.japaneseScript,
    // #187: the star, written by the list that owns the row and its count.
    canStar: list.canStar,
    onStar: list.star,
    topicNames,
    onClose: () => {
      state.topicsFor = undefined;
      closeOverlay();
    },
    // Every tap saves (2026-09-19), and the sheet stays open for the next.
    onSaved: (tags) => {
      // The row keeps the object it was drawn from, so writing back to it and
      // asking Browse to repaint is what makes the chips appear without
      // reloading the search she is in the middle of.
      card.myTags = tags;
      list.changed?.();
      // A newly coined topic has to reach the picker, and the counts of the
      // ones she moved a card into have changed: asked again when next
      // needed. Not reloaded now — that rebuilds this sheet (see loadTopics).
      state.topics = [];
      renderApp();
    },
  });
  renderApp();
}

function startSession({ mode = "choose", ...filters } = {}) {
  // #209: whether she practises by topic, now that her own decks have them.
  if (filters.tag) seen("topic_session_started", filters.deckKey);
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
  // Back to the deck it belongs to when it ends (#137). A session saved
  // before decks had one ends on the deck list.
  const key = state.filters.deckKey;
  const known = state.lastDecks.find((d) => d.key === key);
  const names = { kaishi: "Kaishi", hiragana: "Hiragana", katakana: "Katakana" };
  state.deck = key ? (known ?? { key, name: names[key] ?? (key.startsWith("list:") ? key.slice(5) : "Dein Deck") }) : undefined;
  state.deckCards = undefined;
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
  numbersChanged();
  renderApp();
  loadSettings();
  // The whole reason the screen exists: the answers go up now.
  flush().catch(() => {});
}

function renderApp() {
  if (!state.user) {
    render(app, signInScreen({ japanese: state.signInScript, onSignedIn: (user) => {
      state.user = user;
      state.tab = "practise";
      clearSignedOut();
      numbersChanged();
      setMeta("user", user);
      checkDeck();
      loadSettings();
      // #35: the topic list is needed anywhere she files or filters by one,
      // and Browse can be reached in two taps from here. Loading it only when
      // the set sheet opened meant the card-topics sheet came up offering
      // nothing but "+ new" — every existing topic invisible, and a duplicate
      // one keystroke away.
      loadTopics();
      startFlushing();
      startFlushingStars();
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
      japanese: state.settings.japaneseScript,
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
        japanese: state.settings.japaneseScript,
        onPushYes: answerPushOffer,
        onPushNo: () => {
          seen("push_offer_no");
          declinePush().catch(() => {});
          if (state.summary) state.summary.pushOffer = undefined;
          renderApp();
        },
        onDone: () => {
          state.summary = undefined;
          renderApp();
        },
        onAgain: () => startSession({ mode: state.summary.mode, ...scopeOf(state.filters) }),
        // 40: back to the day's real queue, which means clearing the filters
        // as well as starting a session — otherwise "carry on" would run the
        // chosen set again.
        //
        // The day's queue is the one in her deck or list (#137), so that part
        // stays.
        onCarryOn: () => {
          const mode = state.summary.mode;
          state.filters = { ...DEFAULT_FILTERS, ...scopeOf(state.filters) };
          startSession({ mode, ...state.filters });
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
      limit: SESSION_MAX,
      readAloud: state.settings.readAloud,
      // #21: off by default, and read here rather than inside the session so
      // the setting is in one place with the others.
      pitchAccent: state.settings.pitchAccent,
      // #73: same reasoning as pitchAccent above.
      romaji: state.settings.romaji,
      japanese: state.settings.japaneseScript,
      // #77: same reasoning — read here so every setting lives in one place.
      // #252: Reise asks for the phrase itself. Its cards' example sentences
      // are Kaishi's, and "say this sentence" is not a beginner's first step.
      speakSource: isTravelDeck(state.session.filters?.deckKey) ? "word" : state.settings.speakSource,
      recordingEnabled: state.settings.recordingEnabled,
      onExit: () => {
        state.session = undefined;
        // Her answers change the count (#106).
        numbersChanged();
        renderApp();
        // 51 is not only for coming back tomorrow: she taps × and the offer
        // should be there when the tab redraws, not after a restart.
        offerResume();
      },
      onFinish: (result) => {
        state.session = undefined;
        numbersChanged();
        state.resumable = undefined;
        state.summary = result.empty ? undefined : result;
        offerPush(state.summary);
        // Design 11. This used to read `state.jokerBadge || false` on a level
        // up, so the badge could never light (#86).
        if (result.jokerEarned) {
          state.jokerBadge = true;
          setMeta("joker.badge", true);
        }
        renderApp();
      },
    });
    render(app, state.session.node);
    return;
  }

  // Her own deck's screens take the whole screen: 28 is a form, and a tab bar
  // under a keyboard is noise. The card-topics sheet too, over the Words tab.
  if (state.overlay) {
    render(app, state.overlay);
    return;
  }

  // Designs 04/19 and 08/20: before the mode picker, and without the tab bar —
  // read once and put away, like the level-up moment.
  if (state.jokerNotice) {
    const notice = state.jokerNotice.kind === "reset" ? streakResetScreen : jokerSpentScreen;
    render(app, offlineBar(), notice({ stats: state.jokerNotice.stats, onContinue: dismissJokerNotice }));
    return;
  }

  // #93: only here, over the tab screens. Every branch above returns first, so
  // the prompt never covers a card, a summary, a form or 52 — it waits, and
  // appears on the next redraw that reaches the tabs. The set sheet wins while
  // it is open; she is in the middle of choosing.
  render(app, offlineBar(), currentScreen(), tabBar(), state.sheet ?? state.updateNode);
}

/**
 * #93. Which shell to list notes from: the last one this device was shown, or
 * — on a device that has never recorded one — see `startingPoint`. A promise,
 * because the first update can be announced before the deck count is known.
 */
let notesFrom = (async () => {
  const seen = lastSeen();
  let hasDeck = false;
  if (seen === undefined) hasDeck = (await cardCount().catch(() => 0)) > 0;
  const from = startingPoint({ seen, running: SHELL_VERSION, hasDeck });
  return versionNumber(from) > versionNumber(SHELL_VERSION) ? SHELL_VERSION : from;
})();

/** A newer shell is downloaded and waiting. */
async function offerUpdate({ worker, version }) {
  if (state.updateDeferred === version || state.update?.version === version) return;
  const entries = notesSince(await readChangelog(version), await notesFrom, version);
  state.waiting = { worker, version, entries };
  showUpdate({ kind: "ready", worker, version, entries });
}

/**
 * The shell changed without her being asked — the app was closed while a
 * version waited, and the next launch started on it. Tell her once what came
 * with it.
 */
async function noteUpdated() {
  const from = await notesFrom;
  const entries = notesSince(await readChangelog(SHELL_VERSION), from, SHELL_VERSION);
  if (entries.length === 0) {
    markSeen(SHELL_VERSION);
    return;
  }
  // A waiting version's prompt already lists these, from the same point.
  if (state.update) return;
  showUpdate({ kind: "updated", entries });
}

function showUpdate(update) {
  state.update = update;
  state.updateNode = updateSheet({
    kind: update.kind,
    entries: update.entries,
    onUpdate: () => applyUpdate(update.worker, update.version),
    onLater: () => {
      state.updateDeferred = update.version;
      closeUpdate();
    },
    onDone: closeUpdate,
  });
  // Same rule as 52: nothing is drawn over a session, and its exit redraws.
  if (!state.session) renderApp();
}

/** Whatever she did, the notes up to the running shell have now been shown. */
function closeUpdate() {
  markSeen(SHELL_VERSION);
  notesFrom = Promise.resolve(SHELL_VERSION);
  state.update = undefined;
  state.updateNode = undefined;
  renderApp();
}

window.addEventListener("online", () => {
  state.online = true;
  numbersChanged();
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
    // What went up is now in the server's count (#106).
    numbersChanged();
    state.justSent = sent;
    clearTimeout(clearBarTimer);
    clearBarTimer = setTimeout(() => {
      state.justSent = 0;
      // #118: only the strip changes, so only the strip is swapped. This used
      // to rebuild the practise tab two seconds after every sync, which threw
      // her back to the top of it while she was scrolling.
      if (!replaceOfflineBar()) renderApp();
    }, 2000);
  }
  // Design 25: the strip belongs to the tab screens. During a session there is
  // nothing on screen for this to change, so it does not ask for a redraw.
  if (state.session) return;
  // Reviews that went up change the due count, which the tab has to be
  // rebuilt to show. A count of waiting ones changes the strip and nothing
  // else (#118).
  if (sent > 0 || !replaceOfflineBar()) renderApp();
});

// §7 and #93: registers the worker, and asks her when a newer one is waiting.
watchForUpdates(offerUpdate);

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

/** The settings as they now stand, in memory and on the device for offline starts. */
function keepSettings(settings) {
  // #252: Einstieg changes which decks there are, so the open one and its
  // numbers belong to the list that was.
  if (Boolean(settings.beginner) !== Boolean(state.settings.beginner)) {
    state.deck = undefined;
    state.deckCards = undefined;
    state.filters = { ...DEFAULT_FILTERS };
    numbersChanged();
  }
  state.settings = settings;
  state.signInScript = settings.japaneseScript;
  nameTheDocument(settings.japaneseScript);
  applyAppearance(settings.appearance);
  setMeta("settings", settings).catch(() => {});
}

/**
 * Light or dark (#137, v65), now and at the next start. index.html reads the
 * copy kept here before the page draws; IndexedDB, where the rest of the
 * settings are kept, cannot be read that early.
 */
function applyAppearance(appearance = "light") {
  document.documentElement.setAttribute("data-appearance", appearance);
  try {
    localStorage.setItem("appearance", appearance);
  } catch {
    /* private mode: the next start is light, which is the default anyway */
  }
}

/** The tab and app-switcher title follow the script switch too (#139). */
function nameTheDocument(japanese) {
  document.title = appName(japanese);
}

async function loadSettings() {
  try {
    const { settings } = await api.settings();
    const changed = JSON.stringify(settings) !== JSON.stringify(state.settings);
    keepSettings(settings);
    // Same as the own-deck count: most starts bring back what is already here.
    if (changed) renderApp();
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
 *
 * And the remembered user does not wait for the server either (#72). Nothing
 * is painted until boot gets past this point, and on a weak signal `me()`
 * takes its full timeout to fail: measured on the live app with the API
 * stalled, 10 s of an empty dark page before the tab bar appeared. When this
 * device already knows who she is, the app draws at once and the answer is
 * applied when it comes. Only a device with nobody remembered — the first
 * start, or after signing out — waits, because the sign-in screen needs the
 * server anyway.
 */
async function checkSession() {
  try {
    const user = await api.me();
    await setMeta("user", user);
    return { user };
  } catch (err) {
    if (err instanceof OfflineError) return { offline: true };
    if (isSessionExpired(err)) return { expired: true };
    throw err;
  }
}

const remembered = await getMeta("user");
const sessionCheck = checkSession();
// #133/#135: the settings this device last saw stand in until the server's
// arrive, so an offline start keeps her script and her lines. Laid over the
// defaults, so a setting newer than the copy on the device still has a value.
const kept = await getMeta("settings");
if (remembered && kept) state.settings = { ...state.settings, ...kept };
// #139: the sign-in screen names the app the way this device last showed it.
// Only the name — whoever signs in next may have other settings, and theirs
// arrive with them.
state.signInScript = kept?.japaneseScript ?? true;
nameTheDocument(state.settings.japaneseScript);

if (remembered) {
  state.user = remembered;
  // Caught at once: on a device that is already drawing, a server error is not
  // a reason to stop it, and the next request that matters reports its own.
  sessionCheck.catch(() => {});
} else {
  const result = await sessionCheck;
  state.user = result.user;
  if (result.offline) state.online = false;
}

state.pendingEvents = await pending();

/**
 * Registered after the boot check above, which handles its own 401 — otherwise
 * that one 401 would arm the screen before there is a count to put in it.
 * From here on any request can be the one that finds the cookie gone.
 */
onSessionExpired(noteSignedOut);

renderApp();

if (remembered) {
  sessionCheck.then((result) => {
    if (result.user) {
      // Only a change worth a redraw gets one: the practise tab fetches its
      // numbers as it is built, so redrawing on every start would ask twice.
      const changed =
        result.user.id !== remembered.id ||
        result.user.handle !== remembered.handle ||
        result.user.display !== remembered.display;
      state.user = result.user;
      if (changed && !state.session) renderApp();
    } else if (result.offline) {
      state.online = false;
      // Not renderApp(): that rebuilds the practise tab, whose own requests
      // went out alongside this one and are about to give up too — a fresh tab
      // would ask again and show "…" for another full timeout.
      replaceOfflineBar();
    } else {
      // The same state as a cookie that expires mid-practice, so it takes the
      // same screen: the remembered handle stands in until she signs in again.
      //
      // This used to call clearPersonal(), which clears the outbox — so
      // opening the app after the cookie had lapsed destroyed every answer
      // that had not been sent yet, which is precisely what 52 promises is
      // safe, and took the remembered handle with it. Only signing out on
      // purpose clears this device.
      noteSignedOut();
    }
  }, () => {});
}

noteUpdated();

/**
 * #248: the summary offers "Deine nächsten Karten sind bereit" when the session
 * ended with cards whose minutes were not up — the moment the offer means
 * something — and only on a device that can receive it and was never asked.
 */
function offerPush(summary) {
  if (!summary?.waitingSoon) return;
  pushState().then(
    (s) => {
      if (s !== "ask" || state.summary !== summary) return;
      summary.pushOffer = { cards: summary.waitingSoon };
      seen("push_offer_shown", undefined, { oncePerDay: true });
      renderApp();
    },
    () => {},
  );
}

async function answerPushOffer() {
  const summary = state.summary;
  seen("push_offer_yes");
  let outcome;
  try {
    outcome = await enablePush();
  } catch {
    outcome = "error";
  }
  if (outcome === "on") seen("push_granted");
  if (outcome === "denied") seen("push_denied");
  if (summary?.pushOffer) summary.pushOffer = { ...summary.pushOffer, outcome };
  renderApp();
}

/** A notification tapped (sw.js): opened with ?from=push, or focused. */
function notePushOpened() {
  if (new URLSearchParams(location.search).get("from") === "push") {
    seen("push_opened");
    history.replaceState(null, "", location.pathname);
  }
  navigator.serviceWorker?.addEventListener("message", (event) => {
    if (event.data?.type === "push-opened") seen("push_opened");
  });
}
notePushOpened();

if (state.user) {
  if (await getMeta("joker.badge")) {
    state.jokerBadge = true;
    renderApp();
  }
  await checkDeck();
  loadSettings();
  offerResume();
  // §7: flush eagerly rather than batching for hours — iOS evicts storage
  // under pressure, and an event that never left the device is the one thing
  // here that cannot be reconstructed.
  startFlushing();
  startFlushingStars();
  // #248: a subscribed device tells the server its zone again (quiet hours).
  refreshPush();
}
