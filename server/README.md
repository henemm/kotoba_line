# Server

Node 22 + Fastify + better-sqlite3. Implements §2, §3, §5 (auth only, so far),
§9 and §10 of `../docs/kotoba-line-spec.md`.

## Running it

```sh
npm install
npm test
npm start                      # 127.0.0.1:8080
```

Create an account — there is no public registration (§10):

```sh
npm run adduser -- --handle mira --display Mira
# prompts for the PIN twice, with echo off
```

`--pin 483920` skips the prompt, for scripts. PINs are at least six digits and
are stored as argon2id hashes.

In the container:

```sh
docker compose -f ../ops/docker-compose.yml exec api node bin/adduser.js --handle mira
```

## Endpoints

| Method | Path | |
|---|---|---|
| `POST` | `/api/auth/login` | `{ handle, pin }` → sets the session cookie, returns the user |
| `POST` | `/api/auth/logout` | clears the cookie |
| `GET` | `/api/me` | the current user, or 401 |
| `POST` | `/api/events` | `{ events: [...] }` → `{ accepted, rejected, states }` |
| `GET` | `/api/deck` | `?since=` → cards changed since then, with their tags |
| `GET` | `/api/queue` | `?mode=&limit=&deck=&tag=&only=` → card ids in scheduler order |
| `GET` | `/api/browse` | `?q=&deck=&tag=&starred=&page=` → searchable card list |
| `GET` | `/api/queue` | …and, for `mode=flip`, the four intervals per card |
| `POST` | `/api/stars` | `{ cardId, starred }` → pin or unpin a card |
| `GET` | `/api/stats` | XP, level, streak, jokers, maturity bands, per-topic counts |
| `GET` | `/api/settings` | the four settings, the deck rows, the sync state, the version |
| `PATCH` | `/api/settings` | a partial update — writes one control at a time |
| `GET` | `/api/health` | liveness, no auth |

## The event log

`review_events` is append-only and is the whole synchronisation mechanism (§4).
`card_state` is a cache of what the scheduler derived from it, and can be thrown
away at any time:

```js
import { replayCardState } from "./src/replay.js";
replayCardState(db);                 // everyone
replayCardState(db, { userId: 1 });  // one user
```

Three properties hold, and each has a test:

**Posting the same batch twice changes nothing.** `INSERT OR IGNORE` on the
client's UUID, so the outbox can retry blindly without tracking what succeeded.
Every post acknowledges every event it accepted, new or not — the ack means "you
may drop this", not "this was new".

**Arrival order does not matter.** A card's state is folded from its entire
history every time, never patched incrementally. Two devices append to one log
and an event can turn up after a later one has been processed; folding from the
start makes the result depend only on the set of events.

**A replay lands on the same answer.** Which is why `enable_fuzz` is off in
`src/scheduler.js`. Fuzz randomises each interval by a few percent so cards do
not clump — good for a scheduler, fatal for a rebuild, because §3's "delete
card_state and replay" promise is worthless if the rebuild moves every due date.

An event the server will never accept — a card that no longer exists, a
timestamp a day in the future — comes back in `rejected` with a reason rather
than failing the batch. A blindly retrying outbox would otherwise wedge on it
forever.

## The cookie path will surprise you

The session cookie is set with `Path=/kotoba` (§10), because in production
nginx serves the whole app under that one prefix and strips it before proxying
(§9). The paths line up in a browser hitting `https://host/kotoba/api/me`.

They do **not** line up when you talk to the container directly. `curl` against
`http://127.0.0.1:8080/api/me` with a cookie jar will get a 401, because the jar
correctly refuses to send a `/kotoba` cookie to `/api`. That is the cookie
behaving as specified, not a bug.

To exercise the flow directly, either send the token yourself:

```sh
curl -b "kotoba_session=$TOKEN" http://127.0.0.1:8080/api/me
```

or start the server with `COOKIE_PATH=/`.

## Configuration

Environment variables, all with defaults in `src/config.js`.

| | | |
|---|---|---|
| `HOST` | `127.0.0.1` | `0.0.0.0` inside the container; the published port is loopback |
| `PORT` | `8080` | |
| `DATA_DIR` | `./data` | holds `kotoba.sqlite` and its WAL sidecars |
| `DB_FILE` | `$DATA_DIR/kotoba.sqlite` | |
| `COOKIE_PATH` | `/kotoba` | must match the nginx prefix |
| `COOKIE_SECURE` | `true` | only turn off for plain-HTTP development |
| `SESSION_MAX_AGE` | one year | enforced server-side too, not just as `Max-Age` |
| `LOG_LEVEL` | `info` | |

## Layout

```
src/config.js       environment, one place
src/db.js           connection and the migration runner
src/cookies.js      read/write one cookie — no dependency for this
src/sessions.js     token creation, lookup, expiry
src/users.js        PIN hashing and verification
src/scheduler.js    ts-fsrs; folds a card's events into its state
src/events.js       idempotent ingest and card_state recomputation
src/replay.js       rebuild card_state from the log
src/stats.js        XP, levels, streak and jokers — all derived (§8a)
src/queue.js        session composition, browse and stars (§5, §5a)
src/routes/auth.js  login, logout, /api/me
src/routes/events.js  POST /api/events
src/routes/stats.js   GET /api/stats
src/routes/settings.js  GET and PATCH /api/settings
src/routes/deck.js    deck, queue, browse, stars
src/app.js          assembly; takes a database so tests can pass one in
migrations/         numbered SQL, applied once, in filename order
```

## Notes on a few decisions

**No cookie plugin.** The app sets one cookie holding one opaque token, so
`src/cookies.js` is shorter than the plugin's configuration would be. The brief
asks before adding dependencies beyond those the spec names; this avoided one.

**Login spends the same work on an unknown handle.** `checkPin` verifies against
a decoy hash when no user matches, so latency does not reveal which handles
exist. The tests assert that both failures return an identical response.

**Rate limiting is nginx's job** (§9). It has to reject before the request costs
an argon2 verification, which it cannot do from inside the application.

**Sessions expire server-side.** A client can keep sending a cookie past its
`Max-Age`, so the same lifetime is enforced against `created_at`, and an expired
row is deleted rather than merely refused.

## Progress is derived, never counted

`GET /api/stats` computes XP, level, streak, joker balance, maturity bands and
per-topic counts from `review_events` on every request (§8a). Nothing is stored
as a counter, so two devices cannot disagree and a wrong number is fixed by
replaying the log.

Three decisions the spec leaves open, settled in `src/stats.js`:

**The day boundary is Asia/Tokyo, server-side.** Not the device's timezone and
not UTC — a streak that resets because a phone changed zones is the kind of bug
that ends the habit.

**Today never breaks the streak.** The day is not over. A streak that collapsed
at midnight Tokyo time because she had not practised *yet* would be wrong every
morning.

**The streak counts days practised, not days elapsed.** A joker keeps the run
alive across a gap; it does not invent a day of study. Five days practised, one
covered by a joker, one practised is a streak of six.

Levels follow §8a literally — level *n* starts at `100·n·(n+1)/2`, so level 7
begins at 2,800 XP, which is what the Stats design draws. The one adjustment is
that level 1 absorbs everything below level 2's threshold, because the formula
would otherwise put a beginner on level 0 and no screen draws one.

## Choosing what to study (§5a)

`/api/queue` mixes three groups in order — due today oldest first, anything
lapsed in the last three days, then new cards by frequency — then shuffles
within the session so the same cards do not always arrive in the same order.
It returns **ids only**: the client already holds the deck, and re-sending card
content on every session start would waste the bandwidth §1 is trying to save.

`deck=`, `tag=` and `only=` (`starred`, `lapsed`, `new`) narrow it. When any of
them is set the session counts as one she chose, and §5a's rule applies: the
daily new-card limit is for unfiltered sessions only, so a deliberately picked
session is never capped.

"All" is capped at 60 cards (phase-0-plan §3.1 D). After a week away the backlog
can be several hundred, and a session nobody finishes is worse than a short one.

### Search anchors to word starts

`/api/browse?q=eat` returned eighteen cards before this was fixed, among them
"to **cr**eat**e**", "gr**eat**" and "w**eat**her". A plain substring match on an
English gloss is mostly noise.

The Japanese word and its reading still match as substrings — Japanese has no
word boundaries. The English gloss is padded, its punctuation flattened to
spaces, and matched from the start of a word, so "eat" finds *to eat*, *let's
eat!* and *eating* but none of the three above. There is no stemming: "ate" will
not find "eat".
