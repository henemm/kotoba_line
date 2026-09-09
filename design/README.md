# Screen designs

Exported from Claude Design. `Kotoba Line - Screens.dc.html` is one canvas holding
26 numbered screens with their states named above each frame, and notes underneath
flagging where a layout depends on data that can grow or vanish.

Open it in a browser; `support.js` is the canvas runtime it loads. The screens are
prototypes — recreate the visual output, not the internal markup.

`chats/chat1.md` is the conversation the designs came out of. It records why things
are the way they are and which decisions were made deliberately.

## What is covered

Five blocks, newest first on the canvas.

| Block | Screens |
|---|---|
| **5a** The gaps closed | 22 Settings (iPhone), 23 Topic picker, 24 Topics expanded (12 entries), 25 Offline indicator (3 states), 26 Settings (iPad) |
| **4a** iPad — remaining screens | 14 Sign in, 15 Practise tab portrait, 16 Session, 17 Session summary, 18 Level up, 19 Joker spent, 20 Streak reset, 21 Add to home screen (iPad Safari) |
| **3a** iPad — the two that re-flow | 12 Stats portrait (two columns, no scroll), 13 Practise tab landscape |
| **2a** Open decisions resolved | 08 Streak reset, 09 Session summary, 10 Practise tab / nothing due, 11 Tab bar (3 states), joker token |
| **1a** The original seven | 01 Sign in (default, wrong PIN, rate limited), 02 Stats (typical, day one, long haul), 03–05 Level up / Joker spent / Nothing due, 06 Add to home screen, 07 App icon |

Frame sizes: 390 × 844 (iPhone), 834 × 1194 (iPad portrait), 1194 × 834 (landscape).

## Decisions a developer should not have to infer

- **Nothing-due sits on top of the Practise tab**, it does not replace it. The four
  lines stay one tap away. Screen 05 in block 1a is superseded by 10.
- **A drill is a normal session with a filtered queue** — the mode is still chosen
  afterwards, on the next screen.
- **The offline bar never appears during a session**, so a card is never covered.
  It belongs to the tab screens only.
- **The four saturated line colours are reserved for the modes.** Maturity bands and
  topic bars are a grey-to-white ramp on purpose.
- **A diamond is the only diamond in the app**, and it means a joker. Circles are
  stations, bars are progress.
- **iPad is a 560 pt column centred**, except Stats and the Practise tab, which
  genuinely re-flow. Type goes up ~15%, not double. Split view (507 pt) and Slide
  Over (320 pt) fall back to the phone layout.

## Icons

`icons/` holds the four exported PNGs — 192, 512, maskable 512 (mark at 66% inside
the safe circle), and a 180 for iOS. Square, no rounding, no transparency; iOS
masks them itself.

## Where the built screens depart from the canvas

Three, all on **22/26 Settings**, and all because the drawing promises something
the data does not yet support. Each is a row that would have been a dead
control.

- **The deck rows have no toggles.** `user_settings` has no per-deck column, and
  with one deck imported a switch could only turn the whole app off. The rows
  are a name and a count. The personal deck stays at zero cards exactly as the
  design intends, so the second import has somewhere to land.
- **"Topics in a session" is not there.** It leads to the topic picker (23),
  which is drawn but not wired, and a chevron that goes nowhere is worse than a
  row that is not yet offered.
- **Pitch accent is not there.** Kaishi *does* carry it — 1,500 of its 1,501
  notes have a Pitch Accent field — but it arrives as katakana wrapped in
  inline-styled spans that draw the overline and the drop, the import does not
  map it, and no card row holds it. Rendering it means parsing that markup into
  moras rather than handing it to `innerHTML`, which this client never does.
  Until then the switch would write a value nothing reads. See `next-brief.md`:
  "pitch accent switched on" is also an undesigned state.

Two annotations on 22 are wrong rather than unimplemented, and were already
recorded in `next-brief.md`: the new-card range is **5–40, and zero is not
legitimate** (the product owner's ruling), and the diagnostics line for the
audio cache reads "nothing cached yet" until phase 5 gives it a cache to count.

## Known gaps

The canvas predates §5a of the specification, so none of the selection features
are designed. Several states inside the practice loop are also missing.

`next-brief.md` holds the full analysis and a ready-to-paste brief for the next
design round. In short:

- **Blocking** — the browse-and-star screen, the deck and `only=` dimensions at
  session start, any indication that a filtered session is running, めくる's four
  rating buttons, all of 話す, and a card with no audio in 聞く.
- **Important** — first-run deck download, leaving and resuming a session, an
  expired session cookie (distinct from offline, which 25 covers).
- **Smaller** — a populated personal deck, the topic picker at twelve entries,
  pitch accent switched on, sign-out confirmation.
