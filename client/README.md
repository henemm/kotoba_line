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
| Offline strip | 25 | done — the three states, never during a session |
| Stats | 02, 12, 24 | done — level, streak, jokers, maturity, topics with the truncation rule |
| Settings | 22, 26 | placeholder; the API is partly ready |
| Session | 16 | done for 選ぶ — the other three lines need their cards designed |
| Session summary | 09 | done |
| Level up | 03 | done — overlays the summary, dismisses itself |

## Layout

```
index.html            the shell
manifest.webmanifest  §7: standalone, scoped to /kotoba/
src/api.js            one fetch wrapper; distinguishes offline from refused
src/modes.js          the four lines
src/app.js            shell, tabs, the offline strip
src/screens/          one module per screen
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

## The session

Only **選ぶ** is built. 聞く shares this shape and is a small change once its
card is drawn; めくる needs four rating buttons and 話す needs its own states,
and neither is designed (`design/next-brief.md`).

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
