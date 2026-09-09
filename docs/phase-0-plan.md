# Phase 0 — plan

What the task brief asks for before any code is written: what I would do
differently, the proposed repository layout and deployment path, and every
decision the specification leaves open.

Read against `kotoba-line-spec.md`, `claude-code-brief.md`, the prototype in
`prototype/kotoba-line.html`, and the 26 screens in `design/`.

---

## 1. What I would do differently

Six things. The first two change how well the app teaches; the rest are
structural.

### 1.1 Multiple-choice distractors must be chosen, not sampled

The prototype picks three random cards as wrong answers:

```js
function distractors(idx, n = 3) {
  return shuffle(DECK.map((_, i) => i).filter(i => i !== idx)).slice(0, n);
}
```

At twenty cards that is fine. At 1,482 it is not: "to eat" against "teacher",
"how much" and "tomorrow" is not a question. She will answer correctly without
recognising the word, FSRS will read that as genuine recall, and the interval
will stretch on evidence that was never there. Two of the four modes — 選ぶ and
聞く — grade this way, so half the review load would be built on it.

**Proposal.** Draw distractors from a candidate pool near the answer: same
part of speech where the deck's field allows it, otherwise a neighbouring
`frequency_rank` band, and prefer cards sharing a tag. Fall back to random only
when the pool is too small. Roughly thirty lines in the queue builder, and it
is the difference between a quiz and a test.

This is worth doing in phase 4, not later — retuning it afterwards means the
scheduling history collected until then is partly noise.

### 1.2 聞く currently tests a different skill than the spec describes

The specification's table says 聞く is *audio only, no text → pick the meaning*,
trains listening. The prototype plays the whole **sentence** and offers four
**sentence** meanings as options:

```js
$("#sp").addEventListener("click", () => Voice.say(c.sentence, 0.85));
b.textContent = DECK[i].sentenceMeaning;
```

Two consequences. Sentence glosses are far more distinctive than word glosses,
so 聞く is markedly easier than 選ぶ — and because §6 shares one `card_state`
row across all four modes, an easy mode inflates intervals for the hard ones.
And what it actually trains is sentence comprehension, not word recognition.

**Proposal.** Decide which one 聞く is (see §3, this is a product decision), and
make the prototype and the spec agree before porting. If it stays
sentence-level, it should arguably not feed the same scheduler row.

### 1.3 XP during an offline session needs an explicit rule

§8a says the client *displays* XP and never computes it. §4 says a full session
must work with no connection. The designed session summary (screen 09) shows
`+190 XP` at the end of every session. Offline, all three cannot hold.

**Proposal.** Split the two. *Session* XP is computed on the client from the
published formula and labelled as this session's gain — it is a sum over events
the client just produced, so it cannot drift. *Total* XP, level, streak and
joker balance stay server-derived and are only ever displayed from
`/api/stats`; offline they show the last synced value with the offline bar
(screen 25) already explaining why. The level-up moment (screen 03) fires only
on a server response, so it may appear on the next sync rather than at the end
of the session that earned it.

This keeps §8a's guarantee — the client never computes anything that could
disagree between two devices — while letting the summary say something true.

### 1.4 Freeze the prototype, do not evolve it

`prototype/kotoba-line.html` is the agreed look and the reference for the four
modes' interaction feel. It also holds a twenty-card literal deck, in-memory
Leitner boxes, and no persistence. Porting it in place would blur which
behaviour is intentional and which is scaffolding.

**Proposal.** Treat it as read-only reference material. The client is written
fresh against the designs; the prototype stays in the repository unchanged so
any disagreement can be settled by looking at it.

### 1.5 No client framework

The client is about ten screens with no shared-state complexity beyond a deck
cache and an outbox. A framework would add a toolchain that has to keep working
for years on a self-hosted box maintained by one person.

**Proposal.** Vanilla ES modules, no framework. One small build step — perhaps
thirty lines — that hashes assets and generates the service worker's precache
list, because doing that by hand is exactly how a versioned cache goes stale
silently. No bundler beyond that.

### 1.6 "All" needs a ceiling

`state.sessionLen || DECK.length` is harmless against twenty cards. Against a
backlog of several hundred due cards after a week away, "All" starts a session
nobody finishes, and the station strip — one marker per card — becomes unreadable.

**Proposal.** Cap "All" at a sane number (60 is a reasonable first guess) and
say so in the picker. Confirm against the design: the strip is drawn with 20
markers and its note says twenty is where they become countable.

---

## 2. Repository layout and deployment

### 2.1 Layout

```
kotoba_line/
├── docs/            spec, brief, this plan
├── design/          canvas, exported icons, the next design brief
├── prototype/       the original prototype — frozen reference
│
├── server/          Node 22 + Fastify + better-sqlite3
│   ├── src/
│   │   ├── app.js           server assembly, route registration
│   │   ├── db.js            connection, migration runner
│   │   ├── auth.js          login, session tokens, cookie
│   │   ├── events.js        POST /api/events, idempotent insert
│   │   ├── scheduler.js     ts-fsrs wrapper, card_state recomputation
│   │   ├── queue.js         queue composition and the §5a filters
│   │   ├── browse.js        search, paging, stars
│   │   ├── stats.js         XP, level, streak, jokers — all derived
│   │   └── replay.js        rebuild card_state from the event log
│   ├── migrations/          001_init.sql, ...
│   ├── bin/adduser.js
│   ├── test/
│   └── package.json
│
├── client/          the PWA
│   ├── index.html
│   ├── src/
│   │   ├── screens/         one module per designed screen
│   │   ├── modes/           choose, listen, speak, flip
│   │   ├── store/           IndexedDB deck cache and outbox
│   │   ├── api.js
│   │   └── app.js
│   ├── sw.js
│   ├── manifest.webmanifest
│   ├── assets/icons/        copied from design/icons at build time
│   └── build.js
│
├── import/          deck acquisition, conversion, tagging
│   ├── fetch-deck.js
│   ├── convert.js
│   └── tag.js
│
├── ops/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── nginx/kotoba.conf
│
└── .github/workflows/ci.yml
```

Server and client stay separate top-level directories rather than a monorepo
with a shared package: they share almost nothing, and the one thing they do
share — the XP and level formula — is twenty lines that are clearer duplicated
with a comment pointing at §8a than extracted into a package that has to be
built and versioned.

`import/` is deliberately outside `server/`. It runs on a workstation, not in
the container, and it is the only part of the project that reaches the network
for third-party data.

### 2.2 Deployment

Exactly as §2 and §9 of the specification describe. No changes proposed.

```
/srv/kotoba/app/     static shell — the built client, rsynced
/srv/kotoba/data/    kotoba.sqlite, host volume
/srv/kotoba/media/   audio, host volume
```

Container binds `127.0.0.1:8080`; nginx is the sole entry point. Service worker
served from `/kotoba/sw.js` so its scope matches the manifest scope and the
cookie path — the specification is right that getting those three out of step is
the usual reason a path-hosted PWA silently fails to install on iOS.

One addition the spec does not mention: **a CI workflow from phase 1 onward**,
running lint and the server test suite on every push. The idempotency test in
phase 2 is exactly the kind of thing that must not be run once by hand and then
trusted forever.

### 2.3 Deck data never enters the repository

The Kaishi deck is a third-party release asset with its own licence, and its
audio is a few hundred megabytes. `import/` fetches and converts it; the output
goes to the host volume. Nothing generated from it is committed.

---

## 3. Open decisions

### 3.1 Product decisions — these need an answer

**A. The topic tag vocabulary.** Kaishi ships without topic tags and §5a depends
entirely on them. The spec proposes an LLM pass over 1,500 entries against a
short fixed list, then a hundred spot-checked by hand. The list determines what
she can actually filter by, so it is a product choice, not a technical one. The
spec suggests: school, konbini, food, travel, small talk, family, health, money,
time. The designs assume five. Which list ships?

**B. What 聞く tests.** Word or sentence — see §1.2. If it stays at sentence
level, does it feed the same scheduler row as the other three modes, or its own?

**C. Does 話す ship in the first version she tests?** §7 says
`webkitSpeechRecognition` is unreliable in standalone mode on iOS, and the
prototype already treats the result as feedback rather than a grade. The mode
works without recognition — she self-grades — but one of its four states is
"this device cannot listen". Ship it with the fallback, or hold the mode back?

**D. Session length ceiling.** What does "All" mean when 300 cards are due
(§1.6)?

**E. Daily new-card limit at zero.** Settings (screen 22) allows 0–40 and its
note calls 0 legitimate — reviews only. Confirm that is intended, because it
means the app can be put into a state where no new material ever appears.

### 3.2 Technical decisions — I will decide these unless told otherwise

- No client framework; vanilla ES modules with a minimal build step (§1.5).
- Distractor selection from a near pool rather than random (§1.1).
- Session XP computed client-side, all totals server-derived (§1.3).
- Argon2id via `@node-rs/argon2` rather than bcrypt — the spec offers both.
- Migrations as numbered SQL files with a hand-written runner, no migration
  library.
- CI on every push from phase 1.
- The prototype stays frozen (§1.4).

### 3.3 Blocked on design, not on a decision

`design/next-brief.md` lists what the canvas does not cover. The items that
block phase 4 specifically: the browse-and-star screen, the deck and `only=`
dimensions at session start, any indication that a filtered session is running,
めくる's four rating buttons, and all of 話す.

Phases 1 through 3 are unaffected — they are server, event log and import, and
none of them need a screen.

---

## 4. Cost flags

Two things will take noticeably longer than the specification implies.

**Tagging the deck.** The spec frames it as part of the import script. In
practice it is an LLM pass over 1,500 entries, a hundred hand-checked, and a
re-run each time the deck updates. Budget a day, not an hour, and expect to
revisit the tag list once she has used it.

**The `.apkg` conversion.** The spec allows an hour before falling back to a
manual Anki Desktop export. That estimate is optimistic for the zstd-compressed
collection format plus the media index remapping. The fallback is real work too,
and it is not repeatable — every deck update means redoing it by hand.

---

## 5. Recommended order

Unchanged from the brief, with one adjustment: **phases 1–3 can start now.**
They need no screens, and the design gaps in §3.3 only bind phase 4. Running the
next design round in parallel with the backend keeps the critical path short.

The brief's stop point after phase 4 stands.
