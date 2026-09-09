# Claude Code — task brief: ことばライン

Paste this as your opening message in Claude Code, with
`kotoba-line-spec.md` and `kotoba-line.html` in the repository.

---

## Context

A Japanese vocabulary PWA for my daughter, who is on a school exchange year in
Tokyo, and a few of her friends. Four practice modes over the Kaishi 1.5k
deck: pick the meaning, listen only, say it aloud, flip the card.

Progress is stored server-side, because she moves between an iPhone and an
iPad and expects the same state on both, and because iOS evicts browser
storage without warning. She practises on trains and at school, so the app has
to work fully offline and reconcile afterwards.

The complete technical design is in `kotoba-line-spec.md`. Read it first.

Server: nginx with Docker available, app hosted under the path `/kotoba/`.
A handful of users, accounts created by me on the command line, no public
registration.

It has XP, levels and a streak — see §8a of the spec. All of it is derived
from the review log rather than stored as counters, so it cannot drift
between her two devices.

## Design

`kotoba-line.html` is a working prototype of the four modes and the intended
visual direction: a Tokyo metro line network, one colour per mode, cards as
stations along a route. Keep this design. It is the agreed look, not a
placeholder — carry the palette, typography and interaction feel into the
real app.

**Language: English throughout.** Her phone and system language are English,
and she learned Japanese through English, so Kaishi's English glosses stay as
they are.

## Ground rules

- Ask rather than assume. If the spec is silent on something that affects
  structure, raise it instead of picking a direction and building on it.
- Ask before installing dependencies beyond those named in the spec.
- Small, focused commits. Work on a branch.

## Phase 0 — plan, then stop

Before writing code:

1. Read the spec and the prototype and tell me anything you would do
   differently, given how the code actually has to be structured.
2. Propose the repository layout and the deployment path on the server.
3. List every decision the spec leaves open that you will need answered
   before phase 2.

**Stop after this and wait for my answer.**

## Phase 1 — backend

Per §2, §3, §5, §9, §10 of the spec. Node 22 + Fastify + better-sqlite3 in a
Docker container bound to `127.0.0.1:8080`, SQLite and media on host volumes,
nginx reverse proxy with rate limiting on login.

Deliver: login and `/api/me` over HTTPS, an `adduser` CLI script, and a
`docker-compose.yml` I can start on the server.

## Phase 2 — event log

The append-only `review_events` table, idempotent bulk insert keyed on
client-generated UUIDs, and `card_state` recomputation.

Build the replay function that rebuilds all derived state from the event log
in this phase, not later. Prove idempotency with a test that posts the same
batch three times and asserts identical state.

## Phase 3 — deck import

Per §8. Attempt the automated `.apkg` conversion first — the deck is a GitHub
release asset, not a file in the repository tree, and the collection inside is
zstd-compressed. Fall back to the manual Anki Desktop export only if the
automated path costs more than about an hour.

Keep the import script in the repository either way. Verify a random sample of
twenty cards renders correctly, audio included.

## Phase 4 — client

The four modes from the prototype, talking to the API, with FSRS scheduling
via `ts-fsrs` (§6). Online only at this stage.

Include XP, level and streak from the start (§8a) — they change how a session
feels, so I want them in the first version I test, not bolted on later. The
client displays these values; it never computes them.

**Also include everything in §5a in this phase**: session filters by topic and
deck, and the browse screen where she can search and star individual cards.
Being unable to choose what to study is why we are replacing the app she
currently pays for. It is not a polish item.

**Stop here and let me test on both devices before continuing.**

## Phase 5 — offline

IndexedDB deck cache, the outbox from §4, service worker and manifest per §7.
Test in airplane mode: complete a full session offline, reconnect, confirm
every event lands exactly once.

## Working agreement

- After each phase: summarise what changed, what you tested, and what you are
  uncertain about.
- When the spec and reality disagree, say so and propose an alternative
  rather than silently working around it.
- Flag anything that will cost me significantly more time than the spec
  implies.
