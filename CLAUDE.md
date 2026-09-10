# Working on ことばライン

A Japanese vocabulary PWA for one exchange student in Tokyo and a few friends,
self-hosted behind an existing nginx instance. `docs/kotoba-line-spec.md` is the
source of truth; this file is the set of things that are easy to break and hard
to notice.

**Who it is for matters.** One sixteen-year-old, on trains, on metered mobile
data, in a country whose language she is learning. That is why the app works
offline, why audio is never bulk-downloaded, and why the copy is plain. It is
not a product for a market; do not generalise features "for other users".

## The five rules that are not negotiable

**1. `review_events` is append-only, and `card_state` is a cache.**
It is the entire synchronisation mechanism (§4). Two devices append to one log,
and an event can arrive after a later one has already been processed. So state
is always folded from a card's *whole* history, never updated incrementally —
that is what makes the same batch posted three times land on identical state.
`card_state` must be deletable and rebuildable at any time. Never write an
UPDATE that assumes it is current.

**2. FSRS runs with `enable_fuzz: false`.**
Fuzz randomises each interval by a few percent, which is useful and makes the
rebuild in rule 1 non-deterministic. A replay that quietly moves every due date
is not a rebuild. Do not turn it on.

**3. Everything lives under `/kotoba/`.**
The service worker scope, the manifest scope and the session cookie path all
have to agree. Getting them out of step is the usual reason a path-hosted PWA
silently fails to install on iOS. Serving the client from anywhere else — a dev
server included — stops the cookie being sent.

**4. Card ids are Anki note ids. Her own cards get negative ids.**
That is how the two id spaces can never collide (`server/src/cards.js`). A
personal card's id is negative *on purpose*: any schema or validation that
demands a positive integer is a bug. Deleting a card she has reviewed is a soft
delete (`deleted_at`), because `review_events.card_id` is a foreign key.

**5. Bump `VERSION` in `client/sw.js` whenever anything under `client/`
changes.**
The precache is keyed by that name and nothing else about the content is
consulted, so a device that already installed the old shell keeps serving it and
never sees the change. CI enforces this against the base branch (the
`shell-version` job) — it exists because two branches once picked "v8"
independently and git merged them without a conflict.

## Shape of the thing

| | |
|---|---|
| `server/` | Node 22, Fastify 5, better-sqlite3, `@node-rs/argon2`, `ts-fsrs`. The only place with dependencies. |
| `client/` | Vanilla ES modules. **No framework, no build step, zero dependencies.** Deploying it is a copy. |
| `import/` | Turns the Kaishi `.apkg` into the database. No third-party imports of its own — it borrows `better-sqlite3` out of `server/node_modules`. |
| `ops/` | Dockerfile, compose file, nginx config, and the deployment runbook. |
| `design/` | The Claude Design export: 52 numbered screens and the conversation they came from. |
| `docs/` | The spec, the phased brief, and `tagging.md`. |
| `prototype/` | The agreed visual direction. Not a placeholder. |

Tests, three suites, all `node --test`:

```sh
npm run test:client         # pure client logic — no DOM available
npm run test:import
cd server && npm test
```

## Traps that cost time here before

**A wrong media path sounds like it works.** If the audio 404s, the app falls
back to speech synthesis without complaining — because a card with no recording
is an ordinary thing. Always check that ♪ plays a *recording*, not the synthetic
voice. The import must run under `umask 022` or nginx (`www-data`) cannot read
the files it wrote.

**Fastify strips unknown properties by default.** `app.js` sets
`ajv: { customOptions: { removeAdditional: false } }` so that a misspelled field
is rejected rather than silently dropped, which used to return 200 and change
nothing.

**The client has no DOM in tests.** Screen behaviour is verified by driving the
real app in a browser, not by unit tests. Let Playwright resolve its own
browsers rather than hardcoding a path: they live wherever the environment put
them — `~/.cache/ms-playwright/` on the server, `/opt/pw-browsers/` in a cloud
sandbox — and a path from the other one silently finds nothing. When a test
reads the *source* instead, say so in the test and record what the browser run
actually measured.

**Use WebKit for anything that has to hold on her phone.** Chromium is fine for
layout and copy, but every device trap listed here was invisible in it: the
`Range` request for audio, `height: 100%` short of the bottom, the safe-area
inset eating a fixed height. WebKit at 394 × 859 with `isMobile` is the closest
thing here to her iPhone.

**Only a session on the server can deploy.** `/srv/kotoba` is on this machine,
so a cloud session can merge but not release — and `ops/deploy.sh` used to
create its own `/srv/kotoba/app` in the sandbox and report success. It now
refuses instead. If work is merged and not live, that is why.

**Deck data is never committed.** No `.apkg`, no audio, no SQLite file. See
`.gitignore`; the import fetches ~110 MB and writes ~75 MB of audio.

**The day boundary is Asia/Tokyo, computed server-side** (§8a). Streaks, jokers
and "due today" all depend on it. Never derive it from the device clock.

## Topics

Two axes, both in `import/lib/tagging.js`: **fields** (what a word is about) and
**situations** (where in Tokyo she would need it). A card may carry both.

Precedence is `tags-overrides.tsv` → `tags-llm.tsv` → the keyword rules. The
model pass is keyed on **card id, not word**: 24 words appear twice in the deck
with different senses (もう "already"/"another", 聞く "to hear"/"to ask"), and a
word-keyed file gives both cards the same topics and silently loses one.

`grammar` is a real field, not a bin for leftovers. If it starts growing far
past the others, something with an actual subject matter is being filed there —
that is exactly how the previous taxonomy went wrong twice (see #24).

## Pitch accent

`word_pitch` is the mora the pitch drops after, or 0 for a word that never
drops — not the deck's drawing of it. `import/lib/pitch.js` reduces one to the
other; the client draws the contour from the number and the reading. NULL
means "the deck said nothing", which is true of ten single-mora words and of
every card she writes herself: never invent a contour for those.

## Deploying

Three places, and they are not the same place:

```
GitHub (a store)  →  ~/kotoba_line (the clone)  →  /srv/kotoba (what runs)
                       git pull                      ops/deploy.sh
```

`/srv/kotoba` holds her data and is never overwritten by a deploy. Migrations
run themselves when the container starts. After deploying a client change, the
installed app on the phone must be **quit and reopened**, not just backgrounded.

`ops/README.md` is the runbook. Two steps in it are deliberately not an agent's
to make: **the PIN** (`--pin` puts it in the shell history, and it is hers), and
**which vhost** the nginx blocks go into (the wrong one yields a working app on
the wrong domain — a failure that looks like a success).

## Working style this repo expects

Measure rather than estimate, and say what was measured. Several conclusions
here were wrong until someone counted: "most of the deck has no topic" (it was
the taxonomy), "the tab bar reaches the bottom" (61 px short on iOS), "the
reading search works" (the field was never imported). A number in a commit
message is worth more than an adjective.

When the build deviates from `design/`, say so in the source and give the
reason. Screens 41 and 42 draw a revealed card with no speaker; the app now adds
one, because for a language app that call was wrong — and the comment says that,
so the next reader does not "fix" it back.
