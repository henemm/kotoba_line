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
| Joker spent | 04, 19 | done — once per covered gap, before the practise tab; "Continue" rather than "Start today's session" (#86) |
| Streak reset | 08 | not built (#89) |
| Browse | 31–34 | done — search, star, the starred list, practise the set |
| Choose a set | 36–40 | done — three filter dimensions, the live count, the dashed rule, its own summary |
| Her own words | 27–30 | done — the dashed station, add a word, the list; tap a word to edit or delete it (30 draws a swipe, see `own-deck.js`; #85) |
| First run | 49 | done — paged download, pause, carry on |
| Coming back | 51 | done — the resume row, four hours or the Tokyo day |
| Signed out by the server | 52 | done — the bar, the PIN-only screen, dismissible |
| A new version is ready | — | done — not in design/; the leaving sheet (50) with the notes folded under "More info", Later / Update, and "Updated" once after a silent update (#93) |

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
src/app.js            shell, tabs, the offline strip, where the update sheet may appear
src/update.js         worker registration, update checks, the swap and reload (#93)
src/whats-new.js      which changelog entries she has not seen — pure, tested
changelog.json        one entry per shell VERSION, shown under "More info"
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

## Browse (31–34)

The point of the screen is the starred set, not the search: starring is how she
builds a session out of exactly the cards she wants. So idle is not empty — it
opens on what she has already starred, with the practise button live, and
everything else is there to help her find one more.

**The star writes on the tap and the footer count changes under her hand.**
That is the whole confirmation the design allows, so a failed write has to put
the star back rather than leave one the server does not have.

**The starred chip is a filter, not a second screen.** The same view serves as
the starred list; at zero starred the button goes inert rather than
disappearing.

**Not built yet:** the deck and topic chips beside it. They belong to the
filter sheet (36), which offers all three dimensions at once, and a chip here
that opened a different picker would be a second way to do the same thing.
The "add it as your own word" route out of an empty search (33) waits on the
personal deck.

## Choose a set (36–39)

A sheet over the practise tab, never a screen of its own. It opens from one
line above the four lines and is never in the way of them, so tapping a line
still starts a session with whatever the sheet last held — the two-tap path
survives.

**The count above the button recomputes on every tap**, and that is what keeps
it from being a settings screen: she is watching a number, not filling a form.
It comes from `/api/queue`'s `available`, which counts what the filters match
*before* the session cap — the button reads "Start 20 of 40", and returning
only the capped list would make both numbers the same.

**A thin topic is not hidden.** Topics under five cards are dimmed but
selectable, and the button says "Start 3" plainly: three cards is a legitimate
session, and hiding it would hide the shape of the deck.

**An empty set marks its cause.** The chips that produced it are outlined in
red — the only use of red outside a wrong answer — and the button goes inert
rather than disappearing.

**A chosen session says so while it runs** (39): a dashed rule under the
station strip carrying only what she changed, "Your set · konbini". Dashed
because the route is provisional — the scheduler did not lay it. It occupies a
fixed 18px and is absent entirely on an ordinary session, so the card never
moves.

**And its summary says finishing a set is not finishing the day** (40). The
rule carries over, one sentence names the set and what the real queue still
holds, and the way back to that queue is the loudest thing on the screen.
"Carry on" clears the filters as well as starting a session — otherwise it
would run the same set again. Offline the outstanding count is unknowable, so
the sentence stops short rather than guessing, and the two buttons collapse
into one when nothing else is due.

## Her own words (27–30)

The word she just heard at the dinner table. Everything here is shaped by where
she is when she types it: on a train, one-handed, with the conversation still
going on.

**The way in is a dashed station below the last stop** — on the network, not
part of it. Under the four lines rather than in a header, because it is used far
less than starting a session and must never be what a thumb hits by accident.
Its count doubles as the way into the list.

**Two fields make a card savable**, not three: the word and the meaning. The
reading and the example sentence are what make it *good*. The sentence sits
behind a disclosure, because on a train she will not write one and an empty
field would only reproach her.

**A topic can be coined on the spot**, in an inline field rather than a native
`prompt()` — in a standalone PWA that dialog belongs to the browser, not to the
app, and looks like it. Enter and blur are both ways of finishing and on a phone
Enter causes a blur, so the commit runs once whichever arrives first.

**The speaker reads the card back** once the word has content, which is the only
honest way to check the synthesis got the reading right; if it did not, the
reading field is what fixes it. Her cards never have a recording, so they always
meet 47's synthesis state — and the note under the form says so before she
commits rather than after.

## First run and coming back (49, 51)

**The deck arrives visibly, in pages.** It used to arrive silently on the first
session, which on a slow connection looks exactly like an app that has hung. The
screen states the size before the progress and offers "Pause until Wi-Fi",
because §1 says mobile data in Japan is metered — and the card in the middle
says what §7 requires anyway: audio is never bulk-fetched. Paging is what makes
"you can start practising as soon as the first cards arrive" true rather than
hopeful: each page is written to IndexedDB before the next is asked for, so a
pause or a failure keeps everything already received.

**An unfinished session comes back as one row** above the four lines, in its
mode colour, with the lines exactly where they were. Her *answers* always
survived an interruption — they go into the outbox as she gives them — but the
session did not, so being interrupted meant starting over, which is the normal
way a session on a train ends.

It expires after four hours **or** at the Tokyo day boundary, whichever comes
first: past either edge the remaining cards are simply due again, and a queue
built yesterday is one the scheduler has since revised. The day boundary is the
same one §8a counts streaks by, so a session and the day it counts towards
cannot disagree. A chosen set resumes with its filter intact, dashed rule and
all.

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

**And being signed out is not being signed off** (52). When the cookie lapses
the server is still reachable, so this is its own screen rather than the
offline strip with different words: her handle is remembered, only the PIN is
asked, and the outbox count is stated twice — in the bar and in the paragraph —
because "sign in again" is the moment she would fear losing work.

Three rules hold it together, and each of them was a bug first:

- **Only signing out on purpose clears the device.** A 401 at startup used to
  call `clearPersonal()`, which clears the outbox — so opening the app after
  the cookie had lapsed destroyed every answer that had not been sent, which is
  exactly what the screen promises is safe.
- **Only the outbox's own flush brings the screen back** once she has dismissed
  it. The practise tab reads `/api/queue` and `/api/stats` as it is built, so
  letting any 401 revive it meant the × did nothing — and redrawing on every
  401 was a render loop, because the redraw fired two more of them.
- **An expired cookie falls back the way no connection does.** `sessionQueue`
  replays the cached queue for a 401 as well as for an unreachable server,
  which is what makes "practising works offline in the meantime" true. It is
  the one sentence on the screen the app could have got wrong silently.

The two 401s are told apart by their body, not their path: `unauthenticated`
from the session guard, `invalid_credentials` from the login route. A wrong PIN
typed *into* 52 must not re-fire the screen it was typed into.

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

**話す quotes what it heard; it never scores it** (§7 and screen 44). No tick,
no colour, no yes/no — and a sentence under the transcript, because a
transcript on a practice screen reads as a verdict unless something says
otherwise. The first build tinted it green or red, which is the thing the
design rules out. A refused or missing microphone is not an error state: the
record button is simply absent and one sentence says what to do instead, once
per session.

**Only めくる shows intervals** (screen 41). Each of its four buttons carries
the interval FSRS would give — that number is the reason four buttons are worth
the width — and they come from the scheduler, over `/api/queue`, cached with
the queue so a session on a train still has them. A rule of thumb printed under
a button would be worse than no number, because she would learn to trust it.

**Sound follows the mode.** In 聞く the audio is the question, so synthesis
stands in for a missing recording and says so. In 選ぶ it is a bonus, so a card
without a recording simply has no speaker — no inert control, no explanation,
and no synthetic voice where she is not listening for the pronunciation. The
revealed side of a card carries no speaker at all: it has already been read.

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
