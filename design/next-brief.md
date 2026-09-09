# Next design brief — the screens §5a needs

The build specification gained §5a *Letting her choose* after the canvas in
`Kotoba Line - Screens.dc.html` was drawn. None of the 26 existing screens cover
it, and the task brief moves it into the same phase as the four practice modes.

Paste the block below into Claude Design, in the same project, with
`docs/kotoba-line-spec.md` and `Kotoba Line - Screens.dc.html` attached so it
extends the existing canvas rather than starting over.

---

```
# Claude Design — brief: ことばライン, the screens §5a needs

## What changed

The build specification gained a section after you drew the canvas: §5a,
"Letting her choose". It is not a refinement — the brief now calls it the
reason the project exists, and moves it into the same phase as the four
modes. Nothing in the existing 26 screens covers it.

Extend the canvas. Do not propose a new direction: same palette, same
transit-signage language, same reserved diamond for a joker, same rule that
the four line colours belong to the modes and nothing else. No emoji.
390 pt for iPhone, 834 × 1194 for iPad, and keep the existing rule that
iPad is a centred 560 pt column unless a screen genuinely re-flows.

## What §5a asks for

Three levels of control, all present in the first version she tests:

1. Filter a session by topic — she picks a line, then optionally a topic.
2. Filter by deck — `kaishi` (the frequency foundation) or `personal`
   (her own collected words).
3. Star individual cards — a browse screen with search where she pins
   anything she wants next. A starred session ignores the scheduler
   entirely.

`only=` also takes `lapsed` and `new`. When any filter is active the
scheduler advises rather than decides, and the daily new-card cap does
not apply.

## Screens to design

### 1. Browse

The one screen that doesn't exist at all. 1,482 cards, searchable by
Japanese or by English gloss, filterable by deck and tag, with a star on
every row.

Show: idle (no query yet), results, no results, and the starred-only view.
The row has to carry the word, the gloss, and enough state that she can
tell a mature card from a new one without opening it — but it is a list she
scans, not a dashboard.

Annotate what happens at 1,482 rows: paging, lazy loading, or a cap.

### 2. Starting a chosen session

The topic picker (23) already does one dimension. §5a needs three, and
they compose: deck, topic, and `only=` (starred, lapsed, new). Show how
they combine without becoming a settings screen — she is two taps from
practising and it should stay that way.

Include the state where a filter yields very few cards, and where it
yields none.

### 3. A filtered session, running

The session chrome currently shows mode colour and the station strip.
When a chosen set is running, she should be able to tell — the queue is
hers, not the scheduler's, and finishing it does not mean she is done for
the day. Find the lightest thing that says so without competing with the
card. The summary afterwards needs the same distinction.

### 4. めくる ratings

Every other mode grades with two buttons. めくる offers four: again, hard,
good, easy. Draw it, and draw the two-button case beside it so the
difference is visible.

### 5. 話す

Never drawn. It needs: listening, recognition returned (as feedback, never
as a grade — she still self-grades), microphone permission refused, and
speech recognition unavailable on this device. The last two are not errors;
the mode still works, she just grades herself unaided.

### 6. Audio missing

A card can have no recorded audio, and in 聞く the audio *is* the prompt.
Show what 聞く does with a card it cannot play, and what a 選ぶ card looks
like with the sound control absent.

### 7. First run

The deck downloads on first launch, on metered mobile data. Show that
wait. It happens once and it is the first thing she ever sees.

### 8. Leaving a session, and coming back

The × exists; what it does was never specified. Answered cards are already
recorded, so nothing is lost — design the exit and the return.

### 9. Session expired

The offline bar (25) covers no connection. This is the other case: the
server is reachable and the session cookie is gone. She has to sign in
again; nothing she did should be at risk.

## What I need back

Static screens with the states named, variants side by side rather than
described, and the same data-scaling annotations as the existing canvas —
what a browse row does with a very long gloss, what the filter summary
does with three filters active, what 話す shows when recognition returns
nothing at all.

Where a new screen supersedes an existing one, say which number.
```

---

## Changes to screens that already exist

Not new screens — corrections to drawn ones, settled in `docs/phase-0-plan.md`.

**Screen 22, Settings — the new-card stepper may not reach zero.** Its annotation
currently reads "range 0-40, and 0 is legitimate (reviews only)". The product
owner reversed that: some new material must always keep arriving. The range is
**5–40, default 15**, and the stepper's minus control goes inert at 5.

**Screen 22 and 23 — the session-length picker needs a stated ceiling.** "All"
is capped at 60 cards. The picker should say so rather than appear to offer an
unbounded session; after a week away the backlog can be several hundred, and the
station strip is drawn for twenty.

**The topic vocabulary is nine, not five.** school, konbini, food, travel, small
talk, family, health, money, time. Screens showing five topics (02 Stats, 23
Topic picker) should assume nine as the ordinary case — which means the topic
list on Stats is past its five-entry truncation point by default, and screen 24's
expanded state is the normal one rather than an edge case.

**Screen 02, day one — "100 XP to level 2" is off by one threshold.** The
spec's level-up thresholds are 100, 300, 600, 1000, 1500, and the other two
Stats variants match them exactly ("level 7 · 2,800" with 3,140 XP; "level 23 ·
27,600" with 28,940). Under the same formula a beginner reaches level 2 at 300
XP, not 100. The server implements the spec, with level 1 absorbing everything
below 300 so no one is ever shown a level 0. The day-one frame's copy needs the
corrected number.

**Topics cover an eighth of the deck, not all of it — and unevenly.** This is
the big one, and it changes what two screens can honestly show. Measured against
the real Kaishi deck (`docs/tagging.md`):

| health | time | family | small talk | food | school | money | travel | konbini |
|---|---|---|---|---|---|---|---|---|
| 52 | 43 | 27 | 22 | 18 | 12 | 9 | 6 | 3 |

**191 of 1,500 cards carry any topic at all.** The rest — する, なる, これ, さん,
ちょっと — have no topic, because a frequency deck is mostly grammar and general
vocabulary. An ontology would raise this to roughly a quarter of the deck; it
cannot raise it further, because most of these words genuinely belong to no
topic.

The designs assume the opposite. Stats draws "school 84 / 120" and the topic
picker draws "22 / 80 travel", both of which read as *this topic covers a large,
known slice of the deck*. Two consequences to design for:

- **Stats** should say what topics actually cover — a total, or a share of the
  deck — so the bars are not read as the whole picture. A card counted in no
  topic is the normal case, not a gap.
- **The topic picker (23)** has to work at three cards as well as at eighty.
  "Start 20 travel cards" is a promise the deck cannot keep for most topics; the
  button and the counts need to reflect what is really there, and a nearly empty
  topic should probably still be offerable rather than hidden.

Topics will fill out with the personal deck (§8's second deck), which is topical
by construction — that is where konbini stops being three cards.

---

## Why these nine

Derived by reading the canvas against the current specification.

**Blocking the build** — §5a is undesigned end to end (browse, star, the starred
session entry, the deck dimension at session start, `only=new`, and any sign that
a filtered set is running). From the practice loop itself: めくる needs four rating
buttons where the others need two (§6), 話す was never drawn at all despite §7
requiring three distinct fallback states, and a card with no audio is a dead end
in 聞く, where audio *is* the prompt.

**Important, not blocking** — the first-run deck download on metered data, leaving
and resuming a session, and an expired session cookie (distinct from offline,
which screen 25 already covers).

**Smaller, deliberately left out of the brief above** — a populated personal deck
(every screen currently says "0 cards"), the topic picker at twelve entries
(described in 23's note, not drawn), pitch accent switched on, and a sign-out
confirmation.
