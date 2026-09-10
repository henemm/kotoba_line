# Client

The PWA. Vanilla ES modules, no framework and no build step: the app is a
handful of screens whose only shared state is a deck cache and an outbox, and a
framework would be a toolchain to keep working for years on a box maintained by
one person (`docs/phase-0-plan.md` §1.5).

## Running it

The client must be served under the same prefix as the API, because the session
cookie is `Path=/kotoba` (§10). `dev-server.js` stands in for the nginx block in
`ops/nginx/kotoba.conf` and does exactly that.

```sh
cd server && DATA_DIR=../data COOKIE_SECURE=false npm start   # terminal 1
npm run dev:client -- --media ../media                        # terminal 2
# → http://127.0.0.1:5173/kotoba/
```

`--media` points at the directory the import wrote to. The dev server serves it
at `/kotoba/media/`, which is where nginx serves it in production (§9) — without
that the audio silently falls back to speech and a broken path goes unnoticed.

Serve it anywhere else and the cookie silently stops being sent — see the note
in `server/README.md`.

## What is built

| Screen | Design | State |
|---|---|---|
| Sign in | 01, 14 | done — default, wrong PIN, rate limited |
| Practise tab | 10, 15 | done — normal day and nothing-due, both with the four lines |
| Tab bar | 11 | done — three tabs, active dot, joker badge |
| Offline strip | 25 | done — the three states, driven by the outbox, never during a session |
| Stats | 02, 12, 24 | done — level, streak, jokers, maturity, topics with the truncation rule |
| Settings | 22, 26 | done — daily load, decks, sound, account, diagnostics |
| Session | 16 + prototype | done — all four modes, with めくる's four ratings (§6) |
| Session summary | 09 | done |
| Level up | 03 | done — overlays the summary, dismisses itself |

## Layout

```
index.html            the shell
manifest.webmanifest  §7: standalone, scoped to /kotoba/
src/api.js            one fetch wrapper; distinguishes offline from refused
src/store.js          IndexedDB — the deck, the outbox, a little metadata
src/outbox.js         answers held on disk until the server acknowledges them
src/queue.js          what to practise, including when the server is unreachable
src/deck.js           the deck cache, and choosing wrong answers
src/modes.js          the four lines
src/app.js            shell, tabs, the offline strip, worker registration
src/screens/          one module per screen
sw.js                 the service worker — shell, API and media strategies
src/ui/tokens.css     the design system, and nothing else
src/ui/base.css       shell, status bar, tab bar, buttons
src/ui/screens.css    per-screen layout
src/ui/dom.js         a small el()/render() helper — not a framework
dev-server.js         stands in for nginx
```

## Notes on two decisions

**The PIN is six drawn cells over one hidden input.** The cells are a drawing;
the real field is a hidden `input` so the OS keyboard, autofill and paste all
behave. The message slot below is always present, so nothing reflows when an
error appears.

**"Furthest behind" ignores tiny topics.** The nothing-due screen offers to
drill the topic she is worst at. konbini holds three cards in the real deck
(`docs/tagging.md`), so without a floor it would always win and offer a session
of three. Topics under ten cards are not candidates.

## Offline

The point of the whole phase: she practises on the Ginza line, where there is
no signal, and nothing about that should feel different.

**The deck is in IndexedDB, not memory.** `/api/deck?since=` returns only what
changed, so after the first sync a start costs almost nothing — §1 notes that
mobile data in Japan is metered. `loadDeck()` reads the cache first and treats a
failed refresh as ordinary when there are already cards; it only throws when
there is nothing to fall back on.

**Answers are written before they are sent.** `record()` puts them in the
outbox and only then does `flush()` try the network; entries are removed by id
when the server acknowledges them, never by clearing the store — a card
answered while a flush was in flight would otherwise vanish unsent. Retrying
blindly is safe because `POST /api/events` is `INSERT OR IGNORE` on the
client's UUID (§4). Not `localStorage`: it is synchronous, size-limited, and
iOS clears it more readily.

**The queue is remembered, not recomputed.** Which cards are due is a server
question — that is where `card_state` and the daily limit live. Offline, the
last answer for the same filters is replayed, minus anything already in the
outbox so a card is never offered twice. The session says so rather than
pretending the count is today's, and a filter combination never fetched online
says *that* instead of silently showing nothing.

**Being offline is not being signed out.** Opening the app without a
connection used to land on a sign-in screen she could not complete, because
checking the cookie needs the server and having one does not. The last
signed-in user is remembered on the device; only a real 401 ends the session.

**The service worker, three strategies (§7).** Shell precached and served
cache-first under a versioned name; `/api/*` network-only, because a cached
`/api/stats` would show yesterday's streak and look like a bug rather than like
being offline; `/media/*` cached on first use and capped at 300 files, oldest
evicted. Audio is never bulk-fetched — a recording is cached the first time it
plays, so after a week the cache holds the words she is actually studying.

**Bump `VERSION` in `sw.js` when a shell file changes.** Otherwise a device
that already has the app keeps serving the old one.

## The session

**All four modes.** The canvas draws only 選ぶ, but the prototype works out all
four and the repository calls it the agreed visual direction, so the loop
follows it: 選ぶ picks the word's meaning, 聞く plays the sentence and picks its
meaning, 話す shows the English and she says it aloud, めくる flips the card.
The states the canvas never settled are decided in `design/README.md`.

**めくる is the only mode with four ratings** (§6) — again, hard, good, easy —
because it is the only one where she is already making a judgement. Everything
above *again* counts as a recall for the strip and the tally, which is what
FSRS means by it: counting *hard* as wrong would put a card she knew into
"worth another look".

**話す's microphone is feedback, never grading** (§7). It is feature-detected,
its result only tints the line she said, and she marks the card herself — so
the mode is identical on a device that cannot listen.

**Each answer goes into the outbox as it happens**, not at the end of the
session (§4: *immediately*). Being interrupted is the normal way a session on
a train ends, and closing one used to throw away every answer in it.

**Wrong answers are chosen, not sampled.** The prototype picked three cards at
random, which at 1,482 puts "to eat" against "teacher", "how much" and
"tomorrow" — answerable without recognising the word, and FSRS then reads the
guess as recall. `pickDistractors` narrows the pool first: cards sharing a tag
and sitting nearby in frequency, then either, then anything. (phase-0-plan §1.1)

**The XP figure is the difference between two server answers.** Stats are read
before the session and after the events are posted, so the number on the summary
cannot disagree with the Stats screen. Offline it is absent rather than guessed
at — §8a says the client displays progress and never computes it.

**The emphasis in the example sentence comes from the deck.** Kaishi marks the
target word itself, including conjugated forms like 食べました. It is rebuilt as
elements, never handed to `innerHTML`.
