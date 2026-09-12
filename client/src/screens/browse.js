import { OfflineError, api } from "../api.js";
import { loadDeck } from "../deck.js";
import { toRomaji } from "../romaji.js";
import { kanaReading } from "./session.js";
import { el, num, render } from "../ui/dom.js";

/**
 * Browse — screens 31 to 34. §5a's "browse and star".
 *
 * The point of the screen is the starred set, not the search: starring is how
 * she builds a session out of exactly the cards she wants, and everything else
 * here exists to help her find one. So idle is not empty (31) — it opens on
 * what she has already starred, with the practise button already live.
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
  const gloss = ` ${(card.word_meaning ?? "").toLowerCase().replace(/[,;()[\]/.!?'"-]/g, " ")} `;
  return gloss.includes(` ${needle}`);
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
  const text = toRomaji(kanaReading(card.word_furigana) ?? card.word_reading ?? card.word);
  return text ? el("span.row-romaji", { text }) : null;
}

export function browseScreen({ onBack, onPractiseStarred, onAddWord, onTopics, romaji = false }) {
  const root = el("div.browse");

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

  const list = el("div.browse-list", { onscroll: maybePage });
  const search = el("input.browse-search-input", {
    type: "search",
    inputmode: "search",
    autocapitalize: "none",
    autocorrect: "off",
    spellcheck: "false",
    placeholder: "Japanese or English",
    "aria-label": "Search the deck",
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
    render(root, chrome(), list, footer());
    drawList();
  }

  function chrome() {
    return el(
      "div.browse-chrome",
      {},
      el(
        "div.browse-head",
        {},
        el("button.browse-back", {
          type: "button",
          "aria-label": "Back",
          text: "←",
          onclick: onBack,
        }),
        el("span.browse-title", { text: "Browse" }),
        el("span.browse-count.tabular", { text: countLabel() }),
      ),
      el(
        "div.browse-search",
        { class: state.q ? "filled" : undefined },
        search,
        state.q
          ? el("button.browse-clear", {
              type: "button",
              "aria-label": "Clear the search",
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
          text: `★ ${state.starred === undefined ? "starred" : `${num(state.starred)} starred`}`,
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
    root.replaceChild(footer(), root.lastChild);
  }

  function countLabel() {
    if (state.loading && state.cards.length === 0) return "…";
    if (state.q || state.starredOnly) return `${num(state.total)} found`;
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

    render(
      list,
      // 31: idle opens on the starred set, and says so.
      !state.q && !state.starredOnly && state.starred
        ? el("span.browse-section", { text: "Starred recently" })
        : null,
      el("div.rows", {}, state.cards.map(row)),
      !state.q && !state.starredOnly
        ? el("p.browse-note", {
            text: "Type to search the whole deck, or star cards here to build a set you can practise on its own.",
          })
        : null,
    );
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
          ? `Unstar ${card.word}`
          : `Star ${card.word}`
        : "Stars need a connection",
      "aria-pressed": String(Boolean(card.starred)),
      text: hasLiveData && card.starred ? "★" : "☆",
    });

    // 32: "one tap on the star writes immediately and the footer count changes
    // under her hand — that is the whole confirmation."
    if (hasLiveData) {
      star.addEventListener("click", async () => {
        const wanted = !card.starred;
        card.starred = wanted;
        state.starred = Math.max(0, (state.starred ?? 0) + (wanted ? 1 : -1));
        star.textContent = wanted ? "★" : "☆";
        star.setAttribute("aria-pressed", String(wanted));
        drawChrome();

        try {
          await api.star(card.id, wanted);
        } catch {
          // Put it back rather than leave a star that is not on the server.
          card.starred = !wanted;
          state.starred = Math.max(0, (state.starred ?? 0) + (wanted ? -1 : 1));
          star.textContent = card.starred ? "★" : "☆";
          star.setAttribute("aria-pressed", String(card.starred));
          drawChrome();
        }
      });
    }

    return el(
      "div.row",
      {},
      el("span.band", { class: hasLiveData ? maturityBand(card) : undefined }),
      // #35: the word and its gloss open her topics for this card. The star is
      // a sibling, not inside — one tap must not mean two things, and the star
      // is the one gesture on this screen that has to stay a single tap.
      el(
        onTopics ? "button.row-copy" : "span.row-copy",
        onTopics
          ? {
              type: "button",
              "aria-label": `Topics for ${card.word}`,
              // The redraw is handed over rather than left to the caller:
              // the row is drawn from this card object, and app.js has no
              // way to repaint one row of a list it does not own.
              onclick: () => onTopics(card, drawList),
            }
          : {},
        el("span.row-word.jp", { text: card.word }),
        romaji ? romajiSpan(card) : null,
        el("span.row-gloss", { text: card.word_meaning }),
        // Her topics, on the row that carries them, so the list shows what she
        // has organised without her opening anything.
        card.myTags?.length
          ? el(
              "span.row-mine",
              {},
              card.myTags.map((t) => el("span.row-tag", { text: t })),
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
        el("p.browse-empty-title", { text: "Nothing starred yet." }),
        el("p.browse-note", { text: "Star a card in browse and it shows up here." }),
      ];
    }
    return [
      el("p.browse-empty-title", { text: `Nothing in the deck matches “${state.q}”.` }),
      el("p.browse-note", {
        // Called out because typing "yakitori" on an English keyboard is the
        // likeliest way to arrive here.
        text: "Search covers Japanese, the reading and the English gloss — but not romaji.",
      }),
      // 33: not an error state — a word she cannot find is usually a word she
      // should add, so it leads straight into 28 with the query carried over.
      onAddWord
        ? el(
            "button.browse-add",
            { type: "button", onclick: () => onAddWord(state.q) },
            el("span.dashed-station", { text: "+" }),
            el("span", { text: "Add it as your own word" }),
          )
        : null,
    ];
  }

  // ── footer ──────────────────────────────────────────────────────

  function footer() {
    // 34: "at zero starred the button goes inert."
    const n = state.starred ?? 0;
    return el(
      "div.browse-foot",
      {},
      el("button.btn-primary", {
        type: "button",
        disabled: n === 0,
        text: n === 0 ? "Practise starred" : `Practise ${num(n)} starred`,
        onclick: () => onPractiseStarred?.(),
      }),
    );
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

  async function reload() {
    state.page = 0;
    state.cards = [];
    state.loading = true;
    state.error = undefined;
    drawList();
    await fetchPage();
  }

  async function fetchPage() {
    const page = state.page;
    try {
      const answer = await api.browse({
        q: state.q || undefined,
        starred: state.starredOnly || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      state.cards = page === 0 ? answer.cards : [...state.cards, ...answer.cards];
      state.total = answer.total;
      state.more = state.cards.length < answer.total;
      state.offline = false;
    } catch (err) {
      if (err instanceof OfflineError) await fetchOfflinePage(page);
      else state.error = "Could not load the deck.";
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
      state.error = "Stars need a connection. Search does not.";
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
      state.error = "Offline, and nothing has been cached to browse yet.";
      return;
    }
    const matches = [...deck.values()].filter((c) => matchesQuery(c, state.q)).sort(byFrequencyThenId);
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

  return root;
}
