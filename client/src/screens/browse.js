import { OfflineError, answerSoon, api } from "../api.js";
import { loadDeck } from "../deck.js";
import { isKana } from "../script.js";
import { romajiQuery, searchRomaji } from "../romaji.js";
import { showsScript, shownWord, wordRomaji } from "../script.js";
import { setStar } from "../stars.js";
import { topicLabel } from "../topics.js";
import { el, num, render } from "../ui/dom.js";

/**
 * The Words tab — Browse, screens 31 to 34, and the way into her own words.
 * §5a's "browse and star".
 *
 * #123: Browse used to take the screen with a back arrow, and it was reached
 * from the practise tab, from Stats and from Settings. It is a tab of its own
 * now: searching, starring and adding words are work with the deck, and none
 * of them had a single home. So there is no back arrow, the title is the
 * tab's name, and her own words (27, 30) sit at the top of the idle list,
 * where the practise tab used to carry them.
 *
 * #137: the tab is "Search" now. Her own words moved into her decks, where she
 * adds a card while she is in the deck (as in Noji), so this is where a word is
 * found across all of them — each of hers labelled with its deck — and where
 * the stars are.
 *
 * The point of the screen is the starred set, not the search: starring is how
 * she builds a session out of exactly the cards she wants, and everything else
 * here exists to help her find one. So idle is not empty (31) — it opens on
 * what she has already starred.
 *
 * Design 34's "Practise N starred" footer is gone (Henning, 2026-09-14): a
 * session is started from the Practise tab, where "What to practise" offers
 * ★ Starred alongside the other sets, and a second start button here was one
 * more place that looked like the way in.
 */

/** 32: "the list renders 50 rows and pages on scroll". */
const PAGE_SIZE = 50;

/** How close to the bottom the list gets before the next page is asked for. */
const PREFETCH_PX = 400;

/**
 * The maturity square (31's note).
 *
 * The same four bands as Stats, but a step lighter and the darkest one ringed:
 * "isolated on a dark row the darkest ramp value disappears", and a row whose
 * marker is invisible reads as a row with no marker rather than as a new card.
 */
export function maturityBand(card) {
  if (!card.reps) return "new";
  const days = (card.due_at - (card.last_review ?? card.due_at)) / 86400;
  if (days < 1) return "learning";
  if (days < 21) return "young";
  return "mature";
}

/**
 * Whether a card matches a Browse search offline (#22).
 *
 * Mirrors the `q` half of `browseCards()`'s SQL in `server/src/queue.js` —
 * the only filter this screen ever sends alongside it is `starred`, which has
 * no offline answer at all (see `fetchOfflinePage`), so there is no `deck` or
 * `tag` case to mirror here. A plain substring match against the word and its
 * readings, and a word-start match against the gloss (padded, lowercased, its
 * punctuation flattened to spaces) so searching "eat" does not also turn up
 * "great" or "weather".
 */
export function matchesQuery(card, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  if (card.word?.toLowerCase().includes(needle)) return true;
  if (card.word_reading?.toLowerCase().includes(needle)) return true;
  if (card.word_furigana?.toLowerCase().includes(needle)) return true;
  // v69: by the romaji the app shows with the script off, from a word's start.
  const key = romajiQuery(q);
  if (key && searchRomaji(card.word, card.word_reading).includes(` ${key}`)) return true;
  const gloss = ` ${(card.word_meaning ?? "").toLowerCase().replace(/[,;()[\]/.!?'"-]/g, " ")} `;
  return gloss.includes(` ${needle}`);
}

/**
 * v69: a card whose romaji is exactly the search comes first — "eki" puts 駅
 * above ekimae — and the list keeps its own order after that. The server
 * sorts the same way.
 */
export function exactFirst(q, then) {
  const key = romajiQuery(q);
  if (!key) return then;
  const exact = (c) => (searchRomaji(c.word, c.word_reading).includes(` ${key}|`) ? 0 : 1);
  return (a, b) => exact(a) - exact(b) || then(a, b);
}

/** The server's ORDER BY, so an offline list reads the same as an online one. */
export function byFrequencyThenId(a, b) {
  const aNull = a.frequency_rank == null;
  const bNull = b.frequency_rank == null;
  if (aNull !== bNull) return aNull ? 1 : -1;
  if (!aNull && a.frequency_rank !== b.frequency_rank) return a.frequency_rank - b.frequency_rank;
  return a.id - b.id;
}

/**
 * The word in romaji under it (#75), same rule as the reveal screens: no
 * reading is better than a guess.
 *
 * `word_reading` is the fallback between the Kaishi deck's `word_furigana`
 * and the bare word: Browse lists both decks, and a personal card never has
 * `word_furigana` (it is NULL by construction — `server/src/cards.js`), so
 * skipping straight to `card.word` would try to read her own kanji as if it
 * were kana and produce nothing for every card she typed a reading for.
 */
function romajiSpan(card) {
  const text = wordRomaji(card);
  return text ? el("span.row-romaji", { text }) : null;
}

export function browseScreen({
  onTopics,
  onOwnCard,
  romaji = false,
  japanese = true,
}) {
  const root = el("div.browse.words");

  const state = {
    q: "",
    starredOnly: false,
    cards: [],
    total: 0,
    page: 0,
    more: false,
    loading: false,
    error: undefined,
    starred: undefined, // how many cards are starred overall
    // #22: the deck cache has no star or maturity data, so an offline result
    // has to draw its rows differently — never as a guessed ☆.
    offline: false,
  };

  // Which fetchPage() is the latest (#297). Up here, not beside it: the
  // first search runs before the code below the draw() call is reached.
  let asked = 0;

  const list = el("div.browse-list", { onscroll: maybePage });
  const search = el("input.browse-search-input", {
    type: "search",
    inputmode: "search",
    autocapitalize: "none",
    autocorrect: "off",
    spellcheck: "false",
    placeholder: "In allen Decks suchen",
    "aria-label": "In allen Decks suchen",
  });

  // Typing is not a request per keystroke. 200ms is long enough to swallow a
  // burst and short enough that the list feels like it is following her.
  let debounce;
  search.addEventListener("input", () => {
    state.q = search.value.trim();
    clearTimeout(debounce);
    debounce = setTimeout(() => reload(), 200);
    drawChrome();
  });

  draw();
  reload();
  countStarred();

  // ── chrome ──────────────────────────────────────────────────────

  function draw() {
    render(root, chrome(), list);
    drawList();
  }

  function chrome() {
    return el(
      "div.browse-chrome",
      {},
      el(
        "div.browse-head",
        {},
        el("span.browse-title", { text: "Suche" }),
        el("span.browse-count.tabular", { text: countLabel() }),
      ),
      el(
        "div.browse-search",
        { class: state.q ? "filled" : undefined },
        search,
        state.q
          ? el("button.browse-clear", {
              type: "button",
              "aria-label": "Suche löschen",
              text: "×",
              onclick: () => {
                search.value = "";
                state.q = "";
                reload();
                drawChrome();
              },
            })
          : null,
      ),
      el(
        "div.chips",
        {},
        // 34: "the starred chip is a filter like the other two, so the same
        // screen serves as the starred list — no second view to build."
        el("button.chip", {
          type: "button",
          // #22: offline, the deck cache cannot answer "which of these are
          // starred" — so turning the filter on is refused before the tap
          // rather than after, but turning it back off always works.
          disabled: state.offline && !state.starredOnly,
          "aria-pressed": String(state.starredOnly),
          text: `★ ${state.starred === undefined ? "markiert" : `${num(state.starred)} markiert`}`,
          onclick: () => {
            state.starredOnly = !state.starredOnly;
            reload();
            drawChrome();
          },
        }),
      ),
    );
  }

  /** Redraw the chrome without touching the list or the input's focus. */
  function drawChrome() {
    // Reading this after chrome() would always be false: building the fresh
    // tree reparents `search` into a still-detached subtree, and a focused
    // element blurs the moment it is detached -- before replaceChild ever
    // reattaches it. Capture the pre-redraw focus state first instead.
    const hadFocus = document.activeElement === search;
    const fresh = chrome();
    root.replaceChild(fresh, root.firstChild);
    // The input node is reused, so its value and caret survive the redraw;
    // only focus itself needs restoring, since detaching it blurred it.
    if (hadFocus) search.focus();
  }

  function countLabel() {
    if (state.loading && state.cards.length === 0) return "…";
    if (state.q || state.starredOnly) return `${num(state.total)} gefunden`;
    return num(state.total);
  }

  // ── the list ────────────────────────────────────────────────────

  function drawList() {
    if (state.error) {
      render(list, el("p.browse-note", { text: state.error }));
      return;
    }
    if (state.loading && state.cards.length === 0) {
      render(list, el("div.loading", { text: "…" }));
      return;
    }
    if (state.cards.length === 0) return render(list, ...nothingMatches());

    const idle = !state.q && !state.starredOnly;
    render(
      list,
      // 31 has idle open on the starred set, under "Starred recently". The
      // idle list has only ever been the whole deck, most common first — the
      // request sends no `starred` — so that heading sat over する and 事 as
      // soon as one card anywhere was starred (seen 2026-09-14 with 食べる
      // starred). The heading says what the list is; the ★ chip above is the
      // starred set.
      idle ? el("span.browse-section", { text: "Alle Wörter, die häufigsten zuerst" }) : null,
      el("div.rows", {}, state.cards.map(row)),
      !state.q && !state.starredOnly
        ? el("p.browse-note", {
            text: "Tippe, um in all deinen Decks zu suchen, oder markiere hier Karten, die du extra üben willst.",
          })
        : null,
    );
  }

  // 32: "one tap on the star writes immediately and the count changes under
  // her hand — that is the whole confirmation." One function for the row's
  // star and the sheet's (#187), so the two cannot drift apart: the card
  // object, the count in the ★ chip, and the write to the server.
  function toggleStar(card, wanted) {
    card.starred = wanted;
    state.starred = Math.max(0, (state.starred ?? 0) + (wanted ? 1 : -1));
    drawChrome();
    setStar(card.id, wanted);
  }

  function row(card) {
    // #22: an offline row comes from the deck cache, which carries no star or
    // maturity data — both live in server-side tables the cache never syncs.
    // Guessing ☆ would tell her a starred card is not starred; saying nothing
    // is the honest answer, same as `romajiLine`'s rule that no reading beats
    // a wrong one.
    const hasLiveData = !state.offline;

    const star = el("button.star", {
      type: "button",
      disabled: !hasLiveData,
      "aria-label": hasLiveData
        ? card.starred
          ? `Markierung entfernen: ${shownWord(card, japanese)}`
          : `${shownWord(card, japanese)} markieren`
        : "Markieren braucht Internet",
      "aria-pressed": String(Boolean(card.starred)),
      text: hasLiveData && card.starred ? "★" : "☆",
    });

    // Through `setStar`, the one way a star reaches the server. This used to
    // call the API's star request itself, and #83 made the server require the
    // `changedAt` that only `setStar` sends: every star tapped here since came
    // back 400 and was put back, so starring on this tab did nothing (measured
    // on the live server, 2026-09-14). `setStar` never throws — a star with no
    // connection waits in its queue — so there is nothing to undo here. The
    // row patches its own glyph rather than redrawing the list, so the list
    // does not move under the finger that just tapped.
    if (hasLiveData) {
      star.addEventListener("click", () => {
        const wanted = !card.starred;
        toggleStar(card, wanted);
        star.textContent = wanted ? "★" : "☆";
        star.setAttribute("aria-label", wanted ? `Markierung entfernen: ${shownWord(card, japanese)}` : `${shownWord(card, japanese)} markieren`);
        star.setAttribute("aria-pressed", String(wanted));
      });
    }

    // v69: one of her cards opens edit, move and delete, as in its deck; a
    // Kaishi card its topics, with its recording to hear. A tap that did
    // nothing was the complaint (Henning, 2026-09-14).
    // #187: either sheet carries the same star as this row. It goes through
    // the same write, and the row behind the sheet is repainted rather than
    // patched, because the sheet does not hold the row's node.
    const list = {
      changed: drawList,
      canStar: hasLiveData,
      starred: Boolean(card.starred),
      star: (wanted) => {
        toggleStar(card, wanted);
        drawList();
      },
    };
    const own = card.deck === "personal" && onOwnCard;
    const tap = own
      ? () => onOwnCard(card, { ...list, changed: keepSearch })
      : onTopics
        ? () => onTopics(card, list)
        : undefined;

    return el(
      "div.row",
      {},
      el("span.band", { class: hasLiveData ? maturityBand(card) : undefined }),
      // #35: the word and its gloss open the card. The star is a sibling, not
      // inside — one tap must not mean two things, and the star is the one
      // gesture on this screen that has to stay a single tap.
      el(
        tap ? "button.row-copy" : "span.row-copy",
        tap
          ? {
              type: "button",
              "aria-label": own ? `Bearbeiten, verschieben oder löschen: ${shownWord(card, japanese)}` : `Themen für ${shownWord(card, japanese)}`,
              // The redraw is handed over rather than left to the caller:
              // the row is drawn from this card object, and app.js has no
              // way to repaint one row of a list it does not own.
              onclick: tap,
            }
          : {},
        // #135: with the script off the word is its romaji, and the romaji
        // line under it would repeat it.
        el(showsScript(card, japanese) ? "span.row-word.jp" : "span.row-word", {
          text: shownWord(card, japanese),
        }),
        romaji && japanese ? romajiSpan(card) : null,
        el("span.row-gloss", { text: card.word_meaning }),
        // Which of her decks, for a card of hers (#137); Kaishi's need no label.
        card.deck_name ? el("span.row-deck", { text: card.deck_name }) : null,
        // Her topics, on the row that carries them, so the list shows what she
        // has organised without her opening anything.
        card.myTags?.length
          ? el(
              "span.row-mine",
              {},
              card.myTags.map((t) => el("span.row-tag", { text: topicLabel(t) })),
            )
          : null,
      ),
      star,
    );
  }

  /** 33. Not an error state — the frame is the same screen, minus the list. */
  function nothingMatches() {
    if (state.starredOnly && !state.q) {
      return [
        el("p.browse-empty-title", { text: "Noch nichts markiert." }),
        el("p.browse-note", { text: "Markiere in der Suche eine Karte, dann erscheint sie hier." }),
      ];
    }
    return [
      el("p.browse-empty-title", { text: `In deinen Decks passt nichts zu „${state.q}“.` }),
      el("p.browse-note", {
        // Called out because typing "yakitori" on an English keyboard is the
        // likeliest way to arrive here.
        text: "Die Suche findet jedes Wort so, wie es geschrieben ist, in Romaji, über seine Lesung und über seine Bedeutung.",
      }),
      // 33 led from here into adding the word. Adding is in a deck now (#137),
      // which is where the card has to go.
    ];
  }

  // ── loading ─────────────────────────────────────────────────────

  async function countStarred() {
    try {
      const { total } = await api.browse({ starred: true, pageSize: 1 });
      state.starred = total;
    } catch (err) {
      // Offline: the deck cache carries no star data, so this cannot be
      // answered — leaving it `undefined` reads as "★ starred" with no count,
      // which is honest. Reporting zero would be a guess, and probably wrong.
      if (!(err instanceof OfflineError)) state.starred = 0;
    }
    drawChrome();
    drawList();
  }

  /**
   * The same search again after one of her cards changed (v69). A repaint is
   * not enough: a moved card has a new deck label and a deleted one is gone.
   */
  function keepSearch() {
    reload();
    countStarred();
  }

  async function reload() {
    state.page = 0;
    state.cards = [];
    state.loading = true;
    state.error = undefined;
    drawList();
    await fetchPage();
  }

  /**
   * #297: the device's own answer goes up once the server has had its
   * PATIENCE_MS, not once the request gives up. It used to wait for the
   * latter, so on a stalled connection every search sat on "…" for the whole
   * REQUEST_TIMEOUT_MS (measured on the live app in WebKit, API stalled: the
   * list at 10.1 s) while the deck it searches was on the device all along.
   * A late answer still replaces it — unless she has typed on since, which
   * `asked` notices, or it is a further page of a list the device drew.
   */
  async function fetchPage() {
    const page = state.page;
    const mine = ++asked;
    const request = api.browse({
      q: state.q || undefined,
      starred: state.starredOnly || undefined,
      page,
      pageSize: PAGE_SIZE,
    });
    let outcome = await answerSoon(request);
    let fromDevice = false;
    if (!outcome && !state.starredOnly) {
      await fetchOfflinePage(page);
      if (mine !== asked) return;
      fromDevice = true;
      state.loading = false;
      drawChrome();
      drawList();
    }
    outcome ??= await request.then((value) => ({ value }), (error) => ({ error }));
    if (mine !== asked) return;
    if (outcome.value && !(fromDevice && page > 0)) {
      const answer = outcome.value;
      state.cards = page === 0 ? answer.cards : [...state.cards, ...answer.cards];
      state.total = answer.total;
      state.more = state.cards.length < answer.total;
      state.offline = false;
      state.error = undefined;
    } else if (fromDevice) {
      // What the device drew stands; a late failure has nothing better.
    } else if (outcome.error instanceof OfflineError) {
      await fetchOfflinePage(page);
    } else if (outcome.error) {
      state.error = "Das Deck konnte nicht geladen werden.";
    }
    state.loading = false;
    drawChrome();
    drawList();
  }

  /**
   * #22: search over the deck already cached on the device (the same one
   * practice runs from offline), since design 32 always meant for search to
   * work this way.
   *
   * Starring stays out of scope here on purpose (see the issue): the cache
   * has no per-card star state, so honouring "★ starred" offline would mean
   * either a stale answer or an empty list that reads as "nothing is
   * starred" — both worse than saying plainly that this one filter needs a
   * connection.
   */
  async function fetchOfflinePage(page) {
    state.offline = true;
    if (state.starredOnly) {
      state.cards = [];
      state.total = 0;
      state.more = false;
      state.error = "Markierungen brauchen Internet. Die Suche nicht.";
      return;
    }
    const deck = await loadDeck().catch(() => new Map());
    if (deck.size === 0) {
      // Offline on a device that has never synced a deck — search has
      // nothing to search. Distinct from "nothing matches", which means the
      // deck is there and the query just found nothing in it.
      state.cards = [];
      state.total = 0;
      state.more = false;
      state.error = "Offline, und auf diesem Gerät ist noch nichts zum Durchsuchen gespeichert.";
      return;
    }
    const matches = [...deck.values()]
      // Words only, as on the server (#158): not the kana decks' letters.
      // Nor a reverse (#284): the same word again, as on the server.
      .filter((c) => !c.deleted_at && c.reverse_of == null && !isKana(c) && matchesQuery(c, state.q))
      .sort(exactFirst(state.q, byFrequencyThenId));
    state.total = matches.length;
    state.cards = matches.slice(0, (page + 1) * PAGE_SIZE);
    state.more = state.cards.length < matches.length;
    state.error = undefined;
  }

  /** 32: "an unfiltered browse never materialises the whole deck." */
  function maybePage() {
    if (state.loading || !state.more) return;
    if (list.scrollTop + list.clientHeight < list.scrollHeight - PREFETCH_PX) return;
    state.loading = true;
    state.page += 1;
    fetchPage();
  }

  /**
   * Redraw with fresh numbers, keeping her search (#123). For an own-words
   * count that changed while the tab was kept. The star count is asked
   * again too: a session run from here may have starred or unstarred cards.
   */
  root.refresh = () => {
    countStarred();
  };

  return root;
}
