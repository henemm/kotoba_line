# kotoba_line

ことばライン — a Japanese vocabulary PWA. Four practice modes over the Kaishi 1.5k
deck, drawn as four Tokyo metro lines: pick the meaning (選ぶ), listen only (聞く),
say it aloud (話す), flip the card (めくる).

Self-hosted behind nginx under the path `/kotoba/`, with a small Fastify + SQLite
backend. Progress is derived from an append-only review log, so an iPhone and an
iPad never disagree. Fully usable offline; events reconcile afterwards.

**Status: phase 2.** The backend runs — schema, authentication, and the
append-only event log with FSRS scheduling. No deck and no client yet.

## Repository layout

| Path | What it is |
|---|---|
| `docs/kotoba-line-spec.md` | Build specification — the source of truth. Architecture, data model, sync, API, scheduling, PWA behaviour, deck import, XP/streak/jokers, nginx, milestones. |
| `docs/claude-code-brief.md` | Task brief: phases 0–5, ground rules, working agreement. |
| `docs/phase-0-plan.md` | Phase 0 output: what to build differently, the repository layout, and the decisions still open. |
| `design/` | Screen designs for everything around the practice loop — 26 screens with named states, iPhone and iPad. See `design/README.md`. |
| `prototype/kotoba-line.html` | Working prototype of the four modes. The agreed visual direction, not a placeholder. |
| `server/` | Node 22 + Fastify + better-sqlite3 — the schema, authentication and sessions. See `server/README.md`. |
| `ops/` | Dockerfile, compose file, nginx configuration. |

## Where to start

Read `docs/kotoba-line-spec.md` first, then `docs/claude-code-brief.md`, then
`docs/phase-0-plan.md` — the plan-only phase the brief opens with, already done.
It carries the proposed layout and the questions still waiting on an answer.

The practice loop is already designed and prototyped. The designs in `design/`
cover the screens around it — sign in, stats, settings, session summary, and the
moments (level up, joker spent, streak reset).

## Design system

Fixed, not up for renegotiation. Extend it rather than replacing it.

```
--night       #141824    page background
--night-deep  #0D1017    recessed areas
--surface     #1E2433    cards, inactive controls
--surface-hi  #2A3244    raised controls, rails
--ink         #F2F4F8    primary text
--ink-muted   #8A93A8    secondary text

line-choose   #F15A22    pick the meaning
line-listen   #00A7DB    listen only
line-speak    #C7008B    say it aloud
line-flip     #80C241    flip the card

yes           #3DDC84
no            #FF4B4B
```

System sans for the interface; Hiragino Sans / Noto Sans JP for Japanese, always
noticeably larger than the Latin text beside it. No emoji anywhere — the visual
language is transit signage: colour-coded lines, dots, rules, plain numerals.

Interface language is English throughout.
