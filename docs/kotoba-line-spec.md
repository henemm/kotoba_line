# ことばライン — Build Specification

A Japanese vocabulary PWA for a small group of users (an exchange student and
a few friends), self-hosted behind an existing nginx instance via Docker.

This document is written to be handed to Claude Code as the source of truth.
Work through the milestones in order; each one should leave the app in a
running state.

---

## 1. Goals and constraints

**What the app does.** Four practice modes over a shared vocabulary deck:

| Mode | Prompt | Answer | Trains |
|---|---|---|---|
| 選ぶ choose | Japanese word (+ audio) | pick the meaning | recognition |
| 聞く listen | audio only, no text | pick the meaning | listening |
| 話す speak | English meaning | say it aloud, then self-grade | production |
| めくる flip | Japanese word | reveal, then self-grade | review |

**Hard constraints:**

- Primary devices are iPhone and iPad, same user, used interchangeably.
  Progress must be identical on both without manual syncing.
- Sessions happen on trains and at school, often with poor or no
  connectivity. The app must be fully usable offline and reconcile later.
- Mobile data in Japan is metered. Do not bulk-download audio.
- Deployment target is an existing nginx host with Docker available.

**Explicit non-goals for v1:** kanji writing practice, grammar explanation,
social features, public sign-up.

---

## 2. Architecture

```
Browser (PWA)
    │  HTTPS
    ▼
nginx  ─── /kotoba/ ───────► static app shell (served from a mounted volume)
       ─── /kotoba/api/ ───► Docker container: Node + Fastify  ──► SQLite file
       ─── /kotoba/media/ ─► audio files (served directly by nginx)
```

The app lives under the path `/kotoba/` on the existing host. Everything —
shell, API and media — sits under that one prefix, which keeps the service
worker scope, the manifest scope and the session cookie path aligned. Getting
those three out of step is the most common reason a path-hosted PWA fails to
install on iOS.

**Why this split.** nginx serves the static shell and the ~1,500 audio files
directly, which it is far better at than Node. The Node container only handles
authentication and the review event log. The SQLite file and the media
directory live on host volumes so a container rebuild never destroys data.

**Stack:**

- Node 22 (alpine base image)
- Fastify — small, fast, good schema validation
- `better-sqlite3` — synchronous SQLite driver; at this scale, transactions
  complete in microseconds and async adds nothing but complexity
- `ts-fsrs` — the FSRS scheduling algorithm, if you want proper spaced
  repetition rather than Leitner boxes (see §6)
- `@node-rs/argon2` or `bcrypt` for PIN hashing

No ORM. The schema is six tables; hand-written SQL is clearer and shorter.

---

## 3. Data model

```sql
-- Users are created by the administrator. No public registration.
CREATE TABLE users (
  id          INTEGER PRIMARY KEY,
  handle      TEXT NOT NULL UNIQUE,      -- lowercase login name
  display     TEXT NOT NULL,             -- shown in the UI
  pin_hash    TEXT NOT NULL,             -- argon2id, never the PIN itself
  created_at  INTEGER NOT NULL           -- unix seconds
);

CREATE TABLE sessions (
  token       TEXT PRIMARY KEY,          -- 32 random bytes, base64url
  user_id     INTEGER NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL
);

-- The deck. Field names mirror the Kaishi 1.5k note type so importing
-- the real deck is a column mapping and nothing more.
CREATE TABLE cards (
  id                INTEGER PRIMARY KEY,
  word              TEXT NOT NULL,
  word_furigana     TEXT,
  word_meaning      TEXT NOT NULL,
  word_audio        TEXT,                -- filename under /media/, may be NULL
  sentence          TEXT,
  sentence_furigana TEXT,
  sentence_meaning  TEXT,
  sentence_audio    TEXT,
  frequency_rank    INTEGER,             -- deck order; drives introduction order
  deck              TEXT NOT NULL DEFAULT 'kaishi'
);

CREATE TABLE tags (
  card_id  INTEGER NOT NULL REFERENCES cards(id),
  tag      TEXT NOT NULL,                -- 'school', 'konbini', 'food', ...
  PRIMARY KEY (card_id, tag)
);

-- ── The important one ──────────────────────────────────────────────
-- Append-only. Never updated, never deleted. This is the entire
-- synchronisation mechanism; see §4.
CREATE TABLE review_events (
  id          TEXT PRIMARY KEY,          -- UUID generated on the CLIENT
  user_id     INTEGER NOT NULL REFERENCES users(id),
  card_id     INTEGER NOT NULL REFERENCES cards(id),
  mode        TEXT NOT NULL,             -- choose | listen | speak | flip
  rating      INTEGER NOT NULL,          -- 1 again, 2 hard, 3 good, 4 easy
  reviewed_at INTEGER NOT NULL,          -- unix seconds, client clock
  received_at INTEGER NOT NULL           -- unix seconds, server clock
);
CREATE INDEX idx_events_user_card ON review_events(user_id, card_id, reviewed_at);

-- Cards she has explicitly chosen to prioritise. See §5a.
CREATE TABLE card_stars (
  user_id  INTEGER NOT NULL REFERENCES users(id),
  card_id  INTEGER NOT NULL REFERENCES cards(id),
  added_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, card_id)
);

-- Derived state. Rebuildable from review_events at any time; kept as a
-- table purely so the "what is due" query stays fast.
CREATE TABLE card_state (
  user_id     INTEGER NOT NULL REFERENCES users(id),
  card_id     INTEGER NOT NULL REFERENCES cards(id),
  due_at      INTEGER NOT NULL,
  stability   REAL,                      -- FSRS
  difficulty  REAL,                      -- FSRS
  reps        INTEGER NOT NULL DEFAULT 0,
  lapses      INTEGER NOT NULL DEFAULT 0,
  last_review INTEGER,
  PRIMARY KEY (user_id, card_id)
);
```

**The rule that keeps this simple:** `review_events` is the truth,
`card_state` is a cache. If scheduling ever produces something odd, delete
`card_state` and replay the event log. Build that replay function in
milestone 2, not later — it is thirty lines and it will save you.

---

## 4. Synchronisation

The client never uploads its computed progress. It uploads what happened.

**Client side.** Every answered card produces an event that goes immediately
into an IndexedDB outbox with a client-generated UUID. A background flush
posts the outbox whenever the network is available, and clears the entries the
server acknowledges. If the app is closed mid-session, the outbox survives.

Do not use `localStorage` for this. It is synchronous, size-limited, and on
iOS it is cleared more aggressively than IndexedDB.

**Server side.** `POST /api/events` takes an array and does
`INSERT OR IGNORE` keyed on the client UUID. Replaying the same batch is
therefore harmless, which means the client can retry blindly without tracking
what succeeded. After insertion, recompute `card_state` for the affected
cards and return the updated rows.

**Why this handles two devices.** iPhone and iPad each append to the same log.
There is no shared mutable state to conflict over, so there is nothing to
merge. Ordering is by `reviewed_at`; if clocks disagree slightly, the
scheduler is unaffected at this granularity.

---

## 5. API

All endpoints under `/kotoba/api/`. (Paths below are written without the
prefix for readability; nginx strips it before proxying.) JSON in, JSON out. Auth via an httpOnly cookie
holding the session token.

```
POST   /api/auth/login      { handle, pin }        → sets cookie, returns user
POST   /api/auth/logout                            → clears cookie
GET    /api/me                                     → current user or 401

GET    /api/deck?since=<ts>                        → cards changed since ts
                                                     (client caches the deck)
GET    /api/queue?mode=&limit=&deck=&tag=&only=    → card ids, scheduler order
GET    /api/browse?q=&deck=&tag=&page=             → searchable card list
POST   /api/stars           { cardId, starred }    → pin / unpin a card
POST   /api/events          { events: [...] }      → ack ids + updated states
GET    /api/stats                                  → counts, streak, per-tag progress
```

`GET /api/queue` should return card ids only. The client already holds the
full deck in IndexedDB, so sending card content again on every session start
wastes the very bandwidth we are trying to protect.

**Queue composition** — mix, do not sort strictly by due date:

1. all cards due today, oldest due first
2. cards lapsed in the last three days, regardless of due date
3. new cards, in `frequency_rank` order, capped at a configurable daily limit
   (default 15)

Then shuffle within the session so the same cards do not always appear in the
same order.

### 5a. Letting her choose — not optional

The app she is replacing decided for her what to learn and when to stop. That
is the entire reason this project exists, so selection is a first-class
feature, not a later refinement.

Three levels of control, all of them in the first version she tests:

1. **Filter a session by topic.** `tag=school`, `tag=konbini`, `tag=food`.
   She picks a line, then optionally a topic, then starts. Two taps.
2. **Filter by deck.** `deck=kaishi` or `deck=personal` — the frequency
   foundation versus her own collected words.
3. **Star individual cards.** A browse screen with search, where she can pin
   anything she wants next. `only=starred` builds a session from exactly
   those cards, ignoring the scheduler.

`only=` also takes `lapsed` (things she recently got wrong) and `new`
(introduce fresh cards regardless of what is due).

**When a filter is active, the scheduler advises rather than decides.** Due
cards still come first within the filtered set, but the set is hers. If she
wants to drill twenty konbini phrases the evening before she needs them, the
app does that and does not tell her she has finished for today.

The daily new-card limit applies to unfiltered sessions only. A deliberately
chosen session is never capped.

---

## 6. Scheduling

Use `ts-fsrs`. It is a drop-in library, it is what modern Anki uses, and it
outperforms fixed-interval Leitner boxes noticeably.

Map the four ratings straight through: the self-grade buttons in 話す and
めくる give *again* and *good*; the multiple-choice modes give *again* on a
wrong answer and *good* on a correct one. Offer *hard* and *easy* only in
めくる, where the user is already making a judgement.

**Per-mode state is deliberately not modelled.** One `card_state` row per
card per user, shared across all four modes. Recognising a word and being able
to produce it are different skills, and modelling them separately is
defensible — but it quadruples the review load, and a half-empty queue is
better than an abandoned one. Revisit only if she asks for it.

---

## 7. PWA behaviour

**Manifest** (`/kotoba/manifest.webmanifest`): `display: "standalone"`,
`start_url: "/kotoba/"`, `scope: "/kotoba/"`, `theme_color: "#141824"`,
`background_color: "#141824"`,
icons at 192, 512, and a maskable 512. Additionally a
`<link rel="apple-touch-icon" href="/icon-180.png">` — iOS ignores manifest
icons for the home screen.

**Service worker, three strategies:**

| Path | Strategy |
|---|---|
| app shell (HTML, CSS, JS) | precache on install, cache-first, versioned cache name |
| `/kotoba/api/*` | network-only; the outbox handles offline, not the cache |
| `/kotoba/media/*` | cache-on-first-use, capped at ~300 entries, LRU eviction |

Register the service worker from `/kotoba/sw.js` so its scope is `/kotoba/`.
A worker served from the domain root cannot control a subpath app reliably,
and the failure is silent.

Audio is never bulk-fetched. A card's audio lands in the cache the first time
it is played and stays there. After a week of use the cache holds exactly the
words she is actually studying.

**iOS specifics to plan for:**

- There is no install prompt. The app must show a one-time hint explaining
  the Share → *Add to Home Screen* path, and only in Safari.
- Speech synthesis requires a user gesture before it will produce sound.
  Trigger a silent utterance on the first tap of the session.
- `webkitSpeechRecognition` exists in Safari but is unreliable in standalone
  mode. Feature-detect, and treat the result as feedback, never as grading.
- Storage can be evicted under pressure. This is survivable because the
  server holds the truth — but it is exactly why the outbox must flush
  eagerly rather than batching for hours.

---

## 8. Deck import

**The GitHub repository does not contain the deck data.** `donkuri/Kaishi`
holds only the README and screenshots — verified by downloading the tree.
The deck itself ships as an `.apkg` release asset. There is no TSV or JSON in
the repo to import, which is why this step needs a conversion.

An `.apkg` is a zip containing an SQLite collection plus numbered media files
mapped by a JSON index. Anki 2.1.50 and later compress the collection with
zstd, so it is not directly readable by sqlite3 without a decompression step.

**Try the automated route first.** Download the release asset, unzip, zstd-
decompress `collection.anki21b` if present, read the notes table, split the
fields, and rename media files via the JSON index. This is an hour of work
and it is *repeatable* — which matters, because the deck gets updates and you
will want to re-run it.

**Fall back to the manual route if that fights back:** import the `.apkg`
into Anki Desktop once, use *Notes → Export Notes as Text* for a clean TSV,
and copy the media out of the Anki profile folder. Twenty minutes of clicking,
but it has to be redone by hand every time.

Either way, keep the import script in the repository. You will run it again
when adding her own vocabulary.

**Kaishi ships without topic tags**, and §5a depends on them. The import needs
a tagging pass that assigns each card one or more of a small fixed vocabulary
of tags — school, konbini, food, travel, small talk, family, health, money,
time. Keep the tag set short; twelve useful tags beat sixty precise ones she
never uses.

Do this in the import script with an LLM pass over the 1,500 entries, then
spot-check a hundred by hand. Tagging is the one place where automated
classification is genuinely reliable, because a wrong tag costs nothing —
the card simply shows up in a slightly odd session.

**Second deck, later.** Personal cards — words she meets at school or with her
host family — go into the same `cards` table with `deck = 'personal'` and no
audio (speech synthesis covers those). Each belongs to the account that wrote
it (`owner_id`): nobody else meets it in a list, a queue, a topic or a synced
deck, and she can edit or delete her own (#84, #85). The UI should let her filter a session
by deck or tag. This is the part of the app that will matter most after the
first month, so leave room for it in the queue logic now.

---

## 8a. XP, levels and streak

Both are **derived from `review_events`**, not stored as counters. No new
tables, no extra sync path, and no way for the two devices to disagree about
her XP. If the numbers ever look wrong, replay the log.

```
XP per event:   correct  10
                wrong     3   -- an attempt still counts; a wrong answer
                               that costs nothing teaches the wrong lesson
                first-time correct on a new card  +15

Level:          level n starts at 100 * n * (n + 1) / 2 XP
                (100, 300, 600, 1000, 1500, ...) — slow enough that
                levelling stays meaningful past the first week
```

**Streak = consecutive days with at least 10 reviews.** Two details that are
easy to get wrong and painful to fix later:

- **Fix the day boundary to `Asia/Tokyo`, server-side.** Not device-local
  time, not UTC. Device timezone changes, and a streak that resets because a
  phone switched zones is the kind of bug that ends the habit.
- **Compute the streak on the server** from `reviewed_at`, and send it with
  `/api/stats`. The client displays it and never calculates it, so an offline
  device cannot show a streak that the log does not support.

Endpoint `/api/stats` returns: total XP, level, XP to next level, current
streak, longest streak, cards seen, cards at each FSRS maturity band, and
per-tag counts.

**Streak jokers.** Five consecutive qualifying days earn one joker. Maximum
three held at once. A missed day spends a joker automatically and the streak
continues unbroken; with no joker in hand, the streak resets to zero.

Like everything else here, the joker balance is *derived*, never stored:
walk the day sequence from the first event, awarding one joker every fifth
consecutive day (capped at three) and spending one on each gap. This keeps
jokers immune to clock skew and to the two devices syncing out of order.

The count earned resets with the streak — a fresh streak starts with whatever
jokers were still unspent, and the five-day counter begins again.

Show the joker balance next to the streak, and tell her when one is spent.
A safety net she does not know about does not reduce the pressure it exists
to reduce.

---

## 9. nginx

```nginx
limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;

location /kotoba/api/auth/login {
    limit_req zone=login burst=3 nodelay;
    proxy_pass http://127.0.0.1:8080/api/auth/login;
    proxy_set_header X-Forwarded-For $remote_addr;
}

location /kotoba/api/ {
    proxy_pass http://127.0.0.1:8080/api/;   # trailing slash strips the prefix
    proxy_set_header X-Forwarded-For $remote_addr;
}

location /kotoba/media/ {
    alias /srv/kotoba/media/;
    expires 1y;
    add_header Cache-Control "public, immutable";
}

location /kotoba/ {
    alias /srv/kotoba/app/;
    try_files $uri $uri/ /kotoba/index.html;
    add_header Cache-Control "no-cache";   # shell revalidates; SW does the caching
}
```

`alias` combined with `try_files` is a known source of confusing 404s in
nginx; if it misbehaves, move the app into a `kotoba` subdirectory and use
`root /srv/kotoba;` instead. Verify a deep link such as
`/kotoba/stats` reloads correctly before moving on.

TLS via Let's Encrypt, HTTP redirected to HTTPS. Service workers and speech
APIs both refuse to run otherwise.

**Docker compose** mounts two host volumes: `/srv/kotoba/data` for the SQLite
file and `/srv/kotoba/media` for audio. Bind the container port to
`127.0.0.1:8080` only — nginx is the sole entry point.

---

## 10. Security, proportionate to the data

The data here is vocabulary progress. Nobody is attacking this. Four measures
are worth the effort, and nothing beyond them is:

1. HTTPS everywhere.
2. PINs hashed with argon2id. Minimum six digits — a four-digit PIN over an
   unthrottled endpoint falls in minutes.
3. Rate limiting on login, as above.
4. Session cookie `httpOnly`, `Secure`, `SameSite=Lax`, `Path=/kotoba`,
   one-year expiry.

Accounts are created with a CLI script (`npm run adduser`), not through the
web interface. With a handful of users this is less work than building
registration, and it removes an entire class of abuse.

---

## 11. Milestones

Each milestone ends with something deployable.

1. **Backend skeleton.** Fastify, SQLite schema, `adduser` script, login and
   `/api/me`. Docker container running behind nginx over HTTPS.
2. **Event log.** `POST /api/events` with idempotent insert, `card_state`
   recomputation, and the replay-from-log function. Test by posting the same
   batch three times and confirming identical state.
3. **Deck import.** TSV → `cards`, audio → media volume. Verify a random
   sample of twenty cards renders correctly, audio included.
4. **Client, online only.** Port the existing prototype's four modes to talk
   to the API, *including the topic and deck filters and the browse-and-star
   screen from §5a*. No service worker yet.
5. **Offline.** IndexedDB deck cache, outbox, service worker, manifest.
   Test in airplane mode: full session offline, then reconnect and confirm
   the events land.
6. **Polish.** Stats screen with XP, level and streak (§8a), the iOS install
   hint, the personal deck for her own words.

Ship after 5. Milestone 6 is optional and should be driven by what she
actually asks for after using it.

---

## 12. Open decisions

- ~~Interface language.~~ **Decided: English throughout.** Her phone and
  system language are English, and she learned Japanese through English, so
  Kaishi's English glosses need no translation.
- **Pitch accent.** Kaishi carries pitch accent data in a separate field. It
  is genuinely useful for pronunciation and genuinely off-putting to
  beginners. Import the field, hide it, add a toggle later.
- **Daily new-card limit.** Default 15. Exposed in settings — the whole reason
  for building this rather than using the subscription app was that it made
  these decisions for her.
