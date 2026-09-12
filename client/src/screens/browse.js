import { OfflineError, api } from "../api.js";
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
    const star = el("button.star", {
      type: "button",
      "aria-label": card.starred ? `Unstar ${card.word}` : `Star ${card.word}`,
      "aria-pressed": String(Boolean(card.starred)),
      text: card.starred ? "★" : "☆",
    });

    // 32: "one tap on the star writes immediately and the footer count changes
    // under her hand — that is the whole confirmation."
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

    return el(
      "div.row",
      {},
      el("span.band", { class: maturityBand(card) }),
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
    } catch {
      state.starred = 0;
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
    } catch (err) {
      state.error =
        err instanceof OfflineError
          ? "Browse needs a connection. Practice does not."
          : "Could not load the deck.";
    }
    state.loading = false;
    drawChrome();
    drawList();
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
