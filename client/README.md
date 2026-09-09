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
npm run dev:client                                            # terminal 2
# → http://127.0.0.1:5173/kotoba/
```

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
| Session | 16 | not started — 選ぶ is designed, the other three modes are not |

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
